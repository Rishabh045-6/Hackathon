import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const SIGNAL_LENGTH = 100;
export const NORMAL_WAVEFORM_CLASS = "Pure_Sinusoidal";

export type WaveformSampleRecord = {
  className: string;
  sampleIndex: number;
  totalSamples: number;
  signal: number[];
};

function getDatasetDir() {
  return path.resolve(process.cwd(), "..", "archive", "XPQRS");
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

async function getWaveformRows(className: string) {
  const filePath = path.join(getDatasetDir(), `${className}.csv`);
  const raw = await readFile(filePath, "utf-8");

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getAvailableWaveformClasses(): Promise<string[]> {
  const entries = await readdir(getDatasetDir(), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".csv"))
    .map((entry) => entry.name.replace(/\.csv$/i, ""))
    .sort();
}

export async function getWaveformDatasetMeta() {
  const classes = await getAvailableWaveformClasses();
  const firstClass = classes[0];
  const rows = firstClass ? await getWaveformRows(firstClass) : [];

  return {
    classes,
    signalLength: SIGNAL_LENGTH,
    samplesPerClass: rows.length,
  };
}

export async function getWaveformSample(options: {
  className: string;
  sampleIndex?: number;
  random?: boolean;
}): Promise<WaveformSampleRecord> {
  const rows = await getWaveformRows(options.className);
  const rawIndex = options.sampleIndex ?? 0;
  const boundedIndex = Number.isFinite(rawIndex)
    ? Math.min(Math.max(Math.floor(rawIndex), 0), rows.length - 1)
    : 0;
  const sampleIndex = options.random ? Math.floor(Math.random() * rows.length) : boundedIndex;

  return {
    className: options.className,
    sampleIndex,
    totalSamples: rows.length,
    signal: parseSignalLine(rows[sampleIndex]),
  };
}
