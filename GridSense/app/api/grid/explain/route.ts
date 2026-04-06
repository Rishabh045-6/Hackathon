import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  buildFallbackOperationalExplanation,
  type ExplanationRequestPayload,
  type OperationalExplanation,
} from "@/lib/classifier-explanations";

export const runtime = "nodejs";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 20_000;
const RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 220;

type GroqErrorPayload = {
  error?: {
    message?: string;
    type?: string;
    param?: string | null;
    code?: string | null;
  };
};

const explanationCache = new Map<string, { expiresAt: number; data: OperationalExplanation }>();
let providerBackoffUntil = 0;

const systemPrompt =
  "You are GridSense AI, an industrial power quality assistant. Explain electrical disturbances clearly for plant operators. Return valid JSON only with exactly these keys: summary, what_is_happening, likely_cause, severity_reason, recommended_action, operator_note. Do not include markdown fences or extra text. Be concise and practical.";

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

function estimateTokens(value: string) {
  return Math.ceil(value.length / 4);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractResponseText(data: any): string | null {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
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

function getRetryDelayMs(attempt: number, retryAfterHeader: string | null) {
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS);
  }

  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * 500);
  return exponential + jitter;
}

function logDiagnostics(data: {
  timestamp: string;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  retryCount: number;
  queued: boolean;
  parallel: boolean;
  status?: number;
  errorType?: string | null;
  errorCode?: string | null;
}) {
  console.info("[grid-explain]", JSON.stringify(data));
}

function readLocalEnvValue(key: string) {
  try {
    const envPath = path.join(process.cwd(), ".env");
    const contents = readFileSync(envPath, "utf8");
    const line = contents
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${key}=`));
    if (!line) {
      return undefined;
    }

    return line.slice(key.length + 1).trim();
  } catch {
    return undefined;
  }
}

function getConfiguredGroqSettings() {
  return {
    apiKey: readLocalEnvValue("GROQ_API_KEY") || process.env.GROQ_API_KEY?.trim(),
    model: readLocalEnvValue("GROQ_MODEL") || process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL,
  };
}

async function generateLlmExplanation(
  payload: ExplanationRequestPayload,
): Promise<{ explanation: OperationalExplanation | null; errorMessage?: string }> {
  const { apiKey, model } = getConfiguredGroqSettings();
  if (!apiKey) {
    return { explanation: null, errorMessage: "GROQ_API_KEY is missing." };
  }

  if (Date.now() < providerBackoffUntil) {
    return { explanation: null, errorMessage: "Groq backoff is active after rate limiting." };
  }

  const requestText = JSON.stringify(payload);
  const estimatedInputTokens = estimateTokens(systemPrompt) + estimateTokens(requestText);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      logDiagnostics({
        timestamp: new Date().toISOString(),
        model,
        estimatedInputTokens,
        estimatedOutputTokens: MAX_OUTPUT_TOKENS,
        retryCount: attempt,
        queued: attempt > 0,
        parallel: false,
      });

      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: `Explain this event:\n${requestText}`,
            },
          ],
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const responseText = await response.text();
        let errorPayload: GroqErrorPayload | undefined;
        try {
          errorPayload = responseText ? (JSON.parse(responseText) as GroqErrorPayload) : undefined;
        } catch {
          errorPayload = undefined;
        }
        const errorType = errorPayload?.error?.type ?? null;
        const errorCode = errorPayload?.error?.code ?? null;
        const errorMessage =
          errorPayload?.error?.message ??
          `Groq explanation request failed with status ${response.status}.`;

        logDiagnostics({
          timestamp: new Date().toISOString(),
          model,
          estimatedInputTokens,
          estimatedOutputTokens: MAX_OUTPUT_TOKENS,
          retryCount: attempt,
          queued: attempt > 0,
          parallel: false,
          status: response.status,
          errorType,
          errorCode,
        });

        if (response.status === 429) {
          if (attempt < MAX_RETRIES) {
            const delay = getRetryDelayMs(attempt, response.headers.get("retry-after"));
            await sleep(delay);
            continue;
          }

          providerBackoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
        }

        return { explanation: null, errorMessage };
      }

      const data = await response.json();
      const rawText = extractResponseText(data);
      if (!rawText) {
        return { explanation: null, errorMessage: "Groq response was empty." };
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch (error) {
        return { explanation: null, errorMessage: "Groq returned non-JSON content." };
      }
      const explanation = normalizeExplanation(parsed, payload);
      if (!explanation) {
        return { explanation: null, errorMessage: "Groq JSON response did not match the expected explanation shape." };
      }

      return { explanation };
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : "Groq request failed.";

      logDiagnostics({
        timestamp: new Date().toISOString(),
        model,
        estimatedInputTokens,
        estimatedOutputTokens: MAX_OUTPUT_TOKENS,
        retryCount: attempt,
        queued: attempt > 0,
        parallel: false,
        errorType: "request_error",
        errorCode: null,
      });

      if (attempt < MAX_RETRIES) {
        const delay = getRetryDelayMs(attempt, null);
        await sleep(delay);
        continue;
      }

      return { explanation: null, errorMessage: message };
    }
  }

  return { explanation: null, errorMessage: "Groq explanation retries were exhausted." };
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

    const cacheKey = getCacheKey(body);
    const cached = explanationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({
        ok: true,
        data: cached.data,
        error: null,
      });
    }

    const { explanation, errorMessage } = await generateLlmExplanation(body);
    if (explanation) {
      explanationCache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        data: explanation,
      });

      return NextResponse.json({
        ok: true,
        data: explanation,
        error: null,
      });
    }

    console.info("[grid-explain] fallback", JSON.stringify({ reason: errorMessage ?? "unknown" }));
    return NextResponse.json({
      ok: true,
      data: buildFallbackOperationalExplanation(body, errorMessage),
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
