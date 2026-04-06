import { NextResponse } from "next/server";
import {
  buildFallbackOperationalExplanation,
  type ExplanationRequestPayload,
  type OperationalExplanation,
} from "@/lib/classifier-explanations";

export const runtime = "nodejs";

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;

const explanationCache = new Map<string, { expiresAt: number; data: OperationalExplanation }>();
let openAiCooldownUntil = 0;

const explanationSchema = {
  name: "grid_disturbance_explanation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      what_is_happening: { type: "string" },
      likely_cause: { type: "string" },
      severity_reason: { type: "string" },
      recommended_action: { type: "string" },
      operator_note: { type: "string" },
    },
    required: [
      "summary",
      "what_is_happening",
      "likely_cause",
      "severity_reason",
      "recommended_action",
      "operator_note",
    ],
  },
} as const;

function isValidPayload(body: unknown): body is ExplanationRequestPayload {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Partial<ExplanationRequestPayload>;
  return (
    typeof candidate.predicted_label === "number" &&
    typeof candidate.predicted_class === "string" &&
    typeof candidate.confidence === "number" &&
    Array.isArray(candidate.top_k) &&
    typeof candidate.severity === "string"
  );
}

function extractResponseText(data: any): string | null {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  return null;
}

function normalizeExplanation(
  parsed: Record<string, unknown>,
  payload: ExplanationRequestPayload,
): OperationalExplanation | null {
  const fields = [
    "summary",
    "what_is_happening",
    "likely_cause",
    "severity_reason",
    "recommended_action",
    "operator_note",
  ] as const;

  if (fields.some((field) => typeof parsed[field] !== "string" || !String(parsed[field]).trim())) {
    return null;
  }

  return {
    summary: String(parsed.summary).trim(),
    what_is_happening: String(parsed.what_is_happening).trim(),
    likely_cause: String(parsed.likely_cause).trim(),
    severity_reason: String(parsed.severity_reason).trim(),
    recommended_action: String(parsed.recommended_action).trim(),
    operator_note: String(parsed.operator_note).trim(),
    severity: payload.severity,
    source: "llm",
  };
}

function getCacheKey(payload: ExplanationRequestPayload) {
  return JSON.stringify({
    predicted_label: payload.predicted_label,
    predicted_class: payload.predicted_class,
    severity: payload.severity,
    top_k: payload.top_k.map((item) => ({
      predicted_label: item.predicted_label,
      confidence: Number(item.confidence.toFixed(3)),
    })),
  });
}

async function generateLlmExplanation(
  payload: ExplanationRequestPayload,
): Promise<OperationalExplanation | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (Date.now() < openAiCooldownUntil) {
    throw new Error("OpenAI cooldown active after a rate-limit response.");
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You explain power-quality classifier results for grid operators. The classifier output is the source of truth. Do not change or question the predicted class. Keep the explanation concise, operational, and specific. Do not invent values that are not provided. If the predicted label indicates a normal or nominal operating condition, explicitly say the system looks normal right now and that no immediate action is required beyond monitoring.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(payload),
            },
          ],
        },
      ],
      temperature: 0.2,
      text: {
        format: {
          type: "json_schema",
          ...explanationSchema,
        },
      },
    }),
  });
  clearTimeout(timeout);

  if (!response.ok) {
    if (response.status === 429) {
      openAiCooldownUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    }
    throw new Error(`OpenAI explanation request failed with status ${response.status}.`);
  }

  const data = await response.json();
  const rawText = extractResponseText(data);
  if (!rawText) {
    return null;
  }

  const parsed = JSON.parse(rawText) as Record<string, unknown>;
  return normalizeExplanation(parsed, payload);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!isValidPayload(body)) {
      return NextResponse.json(
        {
          ok: false,
          data: null,
          error: "Invalid explanation payload.",
        },
        { status: 400 },
      );
    }

    let fallbackReason: string | undefined;
    const cacheKey = getCacheKey(body);
    const cached = explanationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({
        ok: true,
        data: cached.data,
        error: null,
      });
    }

    try {
      const llmExplanation = await generateLlmExplanation(body);
      if (llmExplanation) {
        explanationCache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          data: llmExplanation,
        });
        return NextResponse.json({
          ok: true,
          data: llmExplanation,
          error: null,
        });
      }
      fallbackReason = "LLM response was empty or invalid.";
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : "LLM request failed.";
      // Fall through to the local operational fallback.
    }

    return NextResponse.json({
      ok: true,
      data: buildFallbackOperationalExplanation(body, fallbackReason),
      error: null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : "Failed to generate explanation.",
      },
      { status: 500 },
    );
  }
}
