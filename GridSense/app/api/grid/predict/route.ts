import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { getClassifierExplanation } from "@/lib/classifier-explanations";
import { createPredictionLog } from "@/lib/services/grid-service";
import { getPredictions } from "@/lib/services/grid-service";

export const runtime = "nodejs";
const CONFIDENCE_THRESHOLD = 0.9;
const MODEL_NAME = "pytorch-cnn";
const NORMAL_CLASS = "Pure_Sinusoidal";

type ClassifierResult = {
  predicted_class: string;
  predicted_label: number;
  confidence: number;
  top_k: Array<{
    predicted_class: string;
    predicted_label: number;
    confidence: number;
  }>;
};

type PredictionRequestBody = {
  signal?: unknown;
  source_class?: unknown;
  sample_index?: unknown;
  source_identifier?: unknown;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? 12);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 24) : 12;

  const result = await getPredictions(supabase, limit);

  if (result.error) {
    return NextResponse.json(
      { ok: false, data: [], error: result.error },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: result.data,
    error: null,
    meta: { count: result.data.length, limit },
  });
}

function isValidSignal(signal: unknown): signal is number[] {
  return (
    Array.isArray(signal) &&
    signal.length === 100 &&
    signal.every((value) => typeof value === "number" && Number.isFinite(value))
  );
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function buildSignalPreview(signal: number[]) {
  return signal.slice(0, 12).map((value) => Number(value.toFixed(6)));
}

function shouldPersistPrediction(result: ClassifierResult, sourceClass: string | null) {
  if (result.confidence < CONFIDENCE_THRESHOLD) {
    return false;
  }

  if (result.predicted_class === NORMAL_CLASS) {
    return false;
  }

  if (sourceClass === NORMAL_CLASS) {
    return false;
  }

  return true;
}

function runClassifier(signal: number[]): Promise<ClassifierResult> {
  return new Promise((resolve, reject) => {
    const projectRoot = process.cwd();
    const pythonPath = process.env.PYTHON_EXECUTABLE || "python";
    const scriptPath = path.resolve(projectRoot, "scripts", "classify_signal.py");

    const child = spawn(pythonPath, [scriptPath], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start inference process: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const message = stdout.trim() || stderr.trim() || "Classifier inference failed.";
        reject(new Error(message));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as ClassifierResult);
      } catch {
        reject(new Error("Classifier returned invalid JSON."));
      }
    });

    child.stdin.write(JSON.stringify({ signal }));
    child.stdin.end();
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as PredictionRequestBody | null;

  if (!body || !isValidSignal(body.signal)) {
    return NextResponse.json(
      {
        ok: false,
        data: null,
        error: "Invalid input. 'signal' must be an array of 100 finite numeric values.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runClassifier(body.signal);
    const supabase = await createClient();
    const sourceClass = readOptionalString(body.source_class);

    if (shouldPersistPrediction(result, sourceClass)) {
      const explanation = getClassifierExplanation(result.predicted_label);
      const logResult = await createPredictionLog(supabase, {
        predicted_class: result.predicted_class,
        predicted_label: result.predicted_label,
        confidence: result.confidence,
        source_class: sourceClass,
        sample_index: readOptionalInteger(body.sample_index),
        signal_preview: buildSignalPreview(body.signal),
        signal_length: body.signal.length,
        explanation_summary: explanation.summary,
        model_name: MODEL_NAME,
        source_identifier: readOptionalString(body.source_identifier) ?? "waveform-simulation",
        top_k: result.top_k,
      });

      if (logResult.error) {
        throw new Error(logResult.error);
      }
    }

    return NextResponse.json({
      ok: true,
      data: result,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Classifier inference failed.";

    return NextResponse.json(
      {
        ok: false,
        data: null,
        error: message,
      },
      { status: 500 },
    );
  }
}
