import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const SIGNAL_LENGTH = 100;

async function getAvailableClasses(datasetDir: string): Promise<string[]> {
  const entries = await readdir(datasetDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".csv"))
    .map((entry) => entry.name.replace(/\.csv$/i, ""))
    .sort();
}

function parseSignalLine(line: string): number[] {
  const values = line
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));

  if (values.length !== SIGNAL_LENGTH) {
    throw new Error(`Expected ${SIGNAL_LENGTH} numeric values per row, received ${values.length}.`);
  }

  return values;
}

export async function GET(request: Request) {
  try {
    const datasetDir = path.resolve(process.cwd(), "..", "archive", "XPQRS");
    const classNames = await getAvailableClasses(datasetDir);
    const { searchParams } = new URL(request.url);
    const requestedClass = searchParams.get("className");
    const random = searchParams.get("random") === "true";

    if (!requestedClass && !random) {
      return NextResponse.json({
        ok: true,
        data: {
          classes: classNames,
          signalLength: SIGNAL_LENGTH,
          samplesPerClass: 1000,
        },
        error: null,
      });
    }

    const resolvedClass =
      requestedClass ??
      classNames[Math.floor(Math.random() * classNames.length)];

    if (!classNames.includes(resolvedClass)) {
      return NextResponse.json(
        {
          ok: false,
          data: null,
          error: `Unknown className '${resolvedClass}'.`,
        },
        { status: 400 },
      );
    }

    const filePath = path.join(datasetDir, `${resolvedClass}.csv`);
    const raw = await readFile(filePath, "utf-8");
    const rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const rawIndex = Number(searchParams.get("sampleIndex") ?? 0);
    const boundedIndex = Number.isFinite(rawIndex)
      ? Math.min(Math.max(Math.floor(rawIndex), 0), rows.length - 1)
      : 0;
    const sampleIndex = random ? Math.floor(Math.random() * rows.length) : boundedIndex;
    const signal = parseSignalLine(rows[sampleIndex]);

    return NextResponse.json({
      ok: true,
      data: {
        className: resolvedClass,
        sampleIndex,
        totalSamples: rows.length,
        signal,
      },
      error: null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : "Failed to load waveform sample.",
      },
      { status: 500 },
    );
  }
}
