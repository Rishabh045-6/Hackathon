"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { BarChartCard } from "@/components/charts/bar-chart-card";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { getClassifierExplanation } from "@/lib/classifier-explanations";

type ClassifierResponse = {
  predicted_class: string;
  predicted_label: number;
  confidence: number;
  top_k: Array<{
    predicted_class: string;
    predicted_label: number;
    confidence: number;
  }>;
};

type ApiResponse<T> = {
  ok: boolean;
  data: T;
  error: string | null;
};

type DatasetMeta = {
  classes: string[];
  signalLength: number;
  samplesPerClass: number;
};

type WaveformSample = {
  className: string;
  sampleIndex: number;
  totalSamples: number;
  signal: number[];
};

type SimulationMode = "single" | "all";

type SimulationHistoryEntry = {
  run: number;
  sourceClass: string;
  sourceIndex: number;
  signal: number[];
  predictedLabel: number;
  predictedClass: string;
  confidence: number;
  topK: ClassifierResponse["top_k"];
  severity: "low" | "medium" | "high";
  isCorrect: boolean;
  timestamp: string;
  explanation: ReturnType<typeof getClassifierExplanation>;
};

function getSeverityStyle(predictedLabel: number | null) {
  if (predictedLabel === null) {
    return {
      accent: "text-slate-300",
      badge: "border-white/10 bg-white/5 text-slate-200",
      panel: "border-white/10 bg-white/5",
    };
  }

  if (predictedLabel === 0) {
    return {
      accent: "text-emerald-300",
      badge: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
      panel: "border-emerald-400/20 bg-emerald-400/10",
    };
  }

  if ([3, 4, 12, 13].includes(predictedLabel)) {
    return {
      accent: "text-rose-300",
      badge: "border-rose-400/20 bg-rose-400/10 text-rose-200",
      panel: "border-rose-400/20 bg-rose-400/10",
    };
  }

  return {
    accent: "text-amber-300",
    badge: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    panel: "border-amber-400/20 bg-amber-400/10",
  };
}

function parseSignalInput(raw: string): number[] {
  const cleaned = raw.replace(/[\[\]]/g, " ").trim();
  if (!cleaned) {
    throw new Error("Provide exactly 100 numeric values.");
  }

  const tokens = cleaned
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length !== 100) {
    throw new Error(`Expected 100 numeric values, received ${tokens.length}.`);
  }

  const values = tokens.map((token) => Number(token));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Signal contains non-numeric values.");
  }

  return values;
}

export function WaveformClassifierCard() {
  const [inputValue, setInputValue] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [signal, setSignal] = useState<number[] | null>(null);
  const [result, setResult] = useState<ClassifierResponse | null>(null);
  const [datasetMeta, setDatasetMeta] = useState<DatasetMeta | null>(null);
  const [simulationMode, setSimulationMode] = useState<SimulationMode>("single");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [simulationInfo, setSimulationInfo] = useState<WaveformSample | null>(null);
  const [history, setHistory] = useState<SimulationHistoryEntry[]>([]);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualModeOpen, setManualModeOpen] = useState(false);

  const explanation = useMemo(() => {
    if (!result) {
      return null;
    }
    return getClassifierExplanation(result.predicted_label);
  }, [result]);

  const severityStyle = useMemo(
    () => getSeverityStyle(result?.predicted_label ?? null),
    [result?.predicted_label],
  );

  const waveformPreview = useMemo(
    () =>
      (signal ?? []).map((value, index) => ({
        sample: index,
        amplitude: Number(value.toFixed(6)),
      })),
    [signal],
  );

  const topProbabilityData = useMemo(
    () =>
      (result?.top_k ?? []).map((item) => ({
        className: item.predicted_class,
        confidence: Number((item.confidence * 100).toFixed(2)),
      })),
    [result],
  );

  const confidenceTimeline = useMemo(
    () =>
      history.map((entry) => ({
        run: `Run ${entry.run}`,
        confidence: Number((entry.confidence * 100).toFixed(2)),
      })),
    [history],
  );

  const predictedDistribution = useMemo(() => {
    const counts = history.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.predictedClass] = (acc[entry.predictedClass] ?? 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([className, count]) => ({ className, count }));
  }, [history]);

  const severityDistribution = useMemo(() => {
    const counts = history.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.severity] = (acc[entry.severity] ?? 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [history]);

  const sessionSummary = useMemo(() => {
    const samplesShown = history.length;
    const correctPredictions = history.filter((entry) => entry.isCorrect).length;
    const sessionAccuracy = samplesShown === 0 ? 0 : (correctPredictions / samplesShown) * 100;

    return {
      samplesShown,
      correctPredictions,
      sessionAccuracy: Number(sessionAccuracy.toFixed(2)),
    };
  }, [history]);

  useEffect(() => {
    async function loadDatasetMeta() {
      try {
        const response = await fetch("/api/grid/waveform", { cache: "no-store" });
        const json = (await response.json()) as ApiResponse<DatasetMeta | null>;
        if (!json.ok || !json.data) {
          throw new Error(json.error ?? "Failed to load waveform dataset.");
        }

        setDatasetMeta(json.data);
        setSelectedClass(json.data.classes[0] ?? "");
      } catch (metaError) {
        setError(metaError instanceof Error ? metaError.message : "Failed to load waveform dataset.");
      }
    }

    void loadDatasetMeta();
  }, []);

  useEffect(() => {
    if (simulationMode !== "single" || !selectedClass) {
      return;
    }

    void loadWaveform({ mode: "single", className: selectedClass, sampleIndex: 0 });
  }, [selectedClass, simulationMode]);

  useEffect(() => {
    if (!autoplay || loading) {
      return;
    }

    if (simulationMode === "single" && !selectedClass) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (simulationMode === "all") {
        void loadWaveform({ mode: "all" });
        return;
      }

      const total = simulationInfo?.totalSamples ?? datasetMeta?.samplesPerClass ?? 1000;
      const nextIndex =
        simulationInfo ? (simulationInfo.sampleIndex + 1) % total : (selectedIndex + 1) % total;
      void loadWaveform({ mode: "single", className: selectedClass, sampleIndex: nextIndex });
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [
    autoplay,
    loading,
    simulationMode,
    selectedClass,
    selectedIndex,
    simulationInfo,
    datasetMeta?.samplesPerClass,
  ]);

  function handleTextParse(raw: string) {
    const parsed = parseSignalInput(raw);
    setInputValue(raw);
    setSignal(parsed);
    setSelectedFile(null);
    setError(null);
    setResult(null);
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseSignalInput(text);
      setInputValue(parsed.join(", "));
      setSignal(parsed);
      setSelectedFile(file.name);
      setError(null);
      setResult(null);
    } catch (uploadError) {
      setSignal(null);
      setSelectedFile(file.name);
      setResult(null);
      setError(uploadError instanceof Error ? uploadError.message : "Unable to parse uploaded CSV.");
    } finally {
      event.target.value = "";
    }
  }

  async function classifySignal(nextSignal: number[], sourceClass: string, sourceIndex: number) {
    try {
      setLoading(true);
      setError(null);
      setResult(null);

      const response = await fetch("/api/grid/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal: nextSignal }),
      });

      const json = (await response.json()) as ApiResponse<ClassifierResponse | null>;
      if (!json.ok || !json.data) {
        throw new Error(json.error ?? "Classification failed.");
      }

      const resultData = json.data;
      const nextExplanation = getClassifierExplanation(resultData.predicted_label);
      const isCorrect = resultData.predicted_class === sourceClass;
      setResult(resultData);
      setHistory((current) => {
        const entry: SimulationHistoryEntry = {
          run: current.length + 1,
          sourceClass,
          sourceIndex,
          signal: nextSignal,
          predictedLabel: resultData.predicted_label,
          predictedClass: resultData.predicted_class,
          confidence: resultData.confidence,
          topK: resultData.top_k,
          severity: nextExplanation.severity,
          isCorrect,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          explanation: nextExplanation,
        };
        const nextHistory = [...current.slice(-11), entry];
        setSelectedRun(entry.run);
        return nextHistory;
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Classification failed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadWaveform({
    mode,
    className,
    sampleIndex,
    random = false,
  }: {
    mode: SimulationMode;
    className?: string;
    sampleIndex?: number;
    random?: boolean;
  }) {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (mode === "single" && className) {
        params.set("className", className);
      }
      if (mode === "all" || random) {
        params.set("random", "true");
      } else {
        params.set("sampleIndex", String(sampleIndex ?? 0));
      }

      const response = await fetch(`/api/grid/waveform?${params.toString()}`, { cache: "no-store" });
      const json = (await response.json()) as ApiResponse<WaveformSample | null>;
      if (!json.ok || !json.data) {
        throw new Error(json.error ?? "Failed to load waveform sample.");
      }

      const sample = json.data;
      setSignal(sample.signal);
      setInputValue(sample.signal.join(", "));
      setSimulationInfo(sample);
      setSelectedIndex(sample.sampleIndex);
      setSelectedFile(null);
      if (mode === "all") {
        setSelectedClass(sample.className);
      }

      await classifySignal(sample.signal, sample.className, sample.sampleIndex);
    } catch (waveformError) {
      setLoading(false);
      setError(waveformError instanceof Error ? waveformError.message : "Failed to load waveform sample.");
    }
  }

  const latestHistoryEntry = history[history.length - 1] ?? null;
  const selectedHistoryEntry =
    history.find((entry) => entry.run === selectedRun) ?? latestHistoryEntry ?? null;
  const selectedHistoryWaveform = useMemo(
    () =>
      (selectedHistoryEntry?.signal ?? []).map((value, index) => ({
        sample: index,
        amplitude: Number(value.toFixed(6)),
      })),
    [selectedHistoryEntry],
  );
  const selectedHistoryTopK = useMemo(
    () =>
      (selectedHistoryEntry?.topK ?? []).map((item) => ({
        className: item.predicted_class,
        confidence: Number((item.confidence * 100).toFixed(2)),
      })),
    [selectedHistoryEntry],
  );

  return (
    <PanelCard
      title="Waveform Classifier"
      subtitle="Run live disturbance simulation from the 17-class waveform dataset and inspect classifier behavior in real time."
    >
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-sm font-medium text-white">Simulation Mode</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAutoplay(false);
                    setSimulationMode("single");
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    simulationMode === "single"
                      ? "bg-cyan-400 text-slate-950"
                      : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  Single Class Mode
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoplay(false);
                    setSimulationMode("all");
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    simulationMode === "all"
                      ? "bg-cyan-400 text-slate-950"
                      : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  All Classes Random Demo
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
              <div>
                <label htmlFor="simulation-class" className="text-sm font-medium text-white">
                  Simulation Class
                </label>
                <select
                  id="simulation-class"
                  value={selectedClass}
                  onChange={(event) => {
                    setAutoplay(false);
                    setSelectedClass(event.target.value);
                  }}
                  disabled={simulationMode === "all"}
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {(datasetMeta?.classes ?? []).map((className) => (
                    <option key={className} value={className}>
                      {className}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sample-index" className="text-sm font-medium text-white">
                  Sample Row
                </label>
                <input
                  id="sample-index"
                  type="number"
                  min={0}
                  max={Math.max((simulationInfo?.totalSamples ?? datasetMeta?.samplesPerClass ?? 1) - 1, 0)}
                  value={selectedIndex}
                  onChange={(event) => setSelectedIndex(Number(event.target.value) || 0)}
                  disabled={simulationMode === "all"}
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-400">
              {simulationMode === "all"
                ? "Random demo mode samples across all 17 class CSV files to simulate a live disturbance stream."
                : "Single class mode uses the real dataset CSV files directly. Each step loads one true 100-sample waveform row and classifies it live."}
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  void loadWaveform(
                    simulationMode === "all"
                      ? { mode: "all" }
                      : { mode: "single", className: selectedClass, sampleIndex: selectedIndex },
                  )
                }
                disabled={(simulationMode === "single" && !selectedClass) || loading}
                className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Running..." : simulationMode === "all" ? "Run Random Demo Step" : "Load Sample"}
              </button>

              <button
                type="button"
                onClick={() =>
                  void loadWaveform(
                    simulationMode === "all"
                      ? { mode: "all" }
                      : { mode: "single", className: selectedClass, random: true },
                  )
                }
                disabled={(simulationMode === "single" && !selectedClass) || loading}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Random Sample
              </button>

              <button
                type="button"
                onClick={() => {
                  if (simulationMode === "all" || !selectedClass) {
                    return;
                  }
                  setAutoplay(false);
                  const total = simulationInfo?.totalSamples ?? datasetMeta?.samplesPerClass ?? 1000;
                  const nextIndex = selectedIndex <= 0 ? total - 1 : selectedIndex - 1;
                  void loadWaveform({ mode: "single", className: selectedClass, sampleIndex: nextIndex });
                }}
                disabled={simulationMode === "all" || !selectedClass || loading}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Previous
              </button>

              <button
                type="button"
                onClick={() => {
                  if (simulationMode === "all" || !selectedClass) {
                    return;
                  }
                  setAutoplay(false);
                  const total = simulationInfo?.totalSamples ?? datasetMeta?.samplesPerClass ?? 1000;
                  const nextIndex = (selectedIndex + 1) % total;
                  void loadWaveform({ mode: "single", className: selectedClass, sampleIndex: nextIndex });
                }}
                disabled={simulationMode === "all" || !selectedClass || loading}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>

              <button
                type="button"
                onClick={() => setAutoplay((current) => !current)}
                disabled={simulationMode === "single" && !selectedClass}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {autoplay ? "Stop Demo" : "Start Auto-Play"}
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-slate-500">
              <span>{signal ? "100-point waveform loaded" : "Waiting for waveform sample"}</span>
              <span>mode: {simulationMode === "all" ? "all classes" : "single class"}</span>
              {simulationInfo ? <span>source: {simulationInfo.className}</span> : null}
              {simulationInfo ? <span>row: {simulationInfo.sampleIndex}</span> : null}
              {selectedFile ? <span>manual file: {selectedFile}</span> : null}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-medium text-white">Waveform Preview</p>
              {!signal ? (
                <p className="mt-3 text-sm text-slate-400">
                  Load a valid signal to preview all 100 samples before classification.
                </p>
              ) : (
                <div className="mt-3">
                  <LineChartCard
                    data={waveformPreview}
                    xKey="sample"
                    series={[{ dataKey: "amplitude", name: "Amplitude", color: "#22d3ee" }]}
                  />
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <button
                type="button"
                onClick={() => setManualModeOpen((current) => !current)}
                className="text-sm font-medium text-white"
              >
                {manualModeOpen ? "Hide Advanced Manual/Test Mode" : "Show Advanced Manual/Test Mode"}
              </button>

              {manualModeOpen ? (
                <div className="mt-4">
                  <p className="text-sm text-slate-400">
                    Secondary mode for demo fallback only. Requires exactly 100 numeric samples.
                  </p>
                  <textarea
                    value={inputValue}
                    onChange={(event) => {
                      setInputValue(event.target.value);
                      setSignal(null);
                      setResult(null);
                      setError(null);
                    }}
                    placeholder="[0.0, 0.12, 0.25, ... 100 values]"
                    className="mt-4 min-h-32 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          handleTextParse(inputValue);
                        } catch (parseError) {
                          setSignal(null);
                          setResult(null);
                          setError(parseError instanceof Error ? parseError.message : "Invalid signal input.");
                        }
                      }}
                      className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
                    >
                      Validate Manual Signal
                    </button>
                    <label className="cursor-pointer rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10">
                      Upload CSV
                      <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileUpload} />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (!signal) {
                          setError("Provide a valid manual 100-value signal before classifying.");
                          return;
                        }
                        void classifySignal(signal, "Manual", 0);
                      }}
                      disabled={loading}
                      className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loading ? "Classifying..." : "Run Manual Classification"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {error ? (
              <p className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">Result</p>
            {!result ? (
              <p className="mt-3 text-sm text-slate-400">
                Start the waveform simulation to see the predicted disturbance class, confidence, and top matches.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Predicted Label</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-xl font-semibold text-white">{result.predicted_class}</p>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${severityStyle.badge}`}
                    >
                      {result.predicted_label === 0 ? "Stable" : "Attention"}
                    </span>
                    {latestHistoryEntry ? (
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                          latestHistoryEntry.isCorrect
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                            : "border-rose-400/20 bg-rose-400/10 text-rose-200"
                        }`}
                      >
                        {latestHistoryEntry.isCorrect ? "Correct" : "Mismatch"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-slate-400">Class ID {result.predicted_label}</p>
                  {simulationInfo ? (
                    <div className="mt-3 space-y-1 text-sm text-slate-400">
                      <p>True/source class: {simulationInfo.className}</p>
                      <p>Source row: {simulationInfo.sampleIndex}</p>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Confidence</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{(result.confidence * 100).toFixed(2)}%</p>
                </div>

                <div className="rounded-2xl bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-amber-300">Top 3 Predictions</p>
                  <div className="mt-3">
                    <BarChartCard data={topProbabilityData} xKey="className" yKey="confidence" color="#f59e0b" />
                  </div>
                  <div className="mt-3 space-y-3">
                    {result.top_k.map((item, index) => (
                      <div
                        key={`${item.predicted_label}-${index}`}
                        className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">{item.predicted_class}</p>
                          <p className="text-xs text-slate-400">Class ID {item.predicted_label}</p>
                        </div>
                        <p className="text-sm font-semibold text-slate-100">
                          {(item.confidence * 100).toFixed(2)}%
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={`rounded-2xl border p-4 ${severityStyle.panel}`}>
            <p className={`text-sm font-medium ${severityStyle.accent}`}>AI Explanation Layer</p>
            {!explanation ? (
              <p className="mt-3 text-sm leading-6 text-slate-300">
                No explanation yet. Run the waveform simulation to generate a classifier explanation.
              </p>
            ) : (
              <div className="mt-3 space-y-4 text-sm text-slate-300">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">What Is Happening</p>
                  <p className="mt-2 leading-6">{explanation.summary}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Likely Cause</p>
                  <p className="mt-2 leading-6">{explanation.likelyCause}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Severity</p>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${severityStyle.badge}`}
                  >
                    {explanation.severity}
                  </span>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Recommended Action</p>
                  <p className="mt-2 leading-6">{explanation.recommendedAction}</p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">Session Summary</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Samples Shown</p>
                <p className="mt-2 text-xl font-semibold text-white">{sessionSummary.samplesShown}</p>
              </div>
              <div className="rounded-2xl bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Correct Predictions</p>
                <p className="mt-2 text-xl font-semibold text-white">{sessionSummary.correctPredictions}</p>
              </div>
              <div className="rounded-2xl bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Session Accuracy</p>
                <p className="mt-2 text-xl font-semibold text-white">{sessionSummary.sessionAccuracy}%</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">Confidence Over Time</p>
            {confidenceTimeline.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Run a few simulated waveforms to build a confidence timeline.</p>
            ) : (
              <div className="mt-3">
                <LineChartCard
                  data={confidenceTimeline}
                  xKey="run"
                  series={[{ dataKey: "confidence", name: "Confidence (%)", color: "#22d3ee" }]}
                />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">Event Count by Predicted Class</p>
            {predictedDistribution.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">No simulated events yet.</p>
            ) : (
              <div className="mt-3">
                <BarChartCard data={predictedDistribution} xKey="className" yKey="count" color="#34d399" />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">Severity Distribution</p>
            {severityDistribution.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Severity distribution will appear after simulation runs.</p>
            ) : (
              <div className="mt-3">
                <BarChartCard data={severityDistribution} xKey="name" yKey="value" color="#fb7185" />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">Recent Predictions Timeline</p>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Recent simulated predictions will appear here.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {[...history].reverse().slice(0, 6).map((entry) => {
                  const isSelected = selectedHistoryEntry?.run === entry.run;

                  return (
                    <div key={`${entry.run}-${entry.timestamp}`} className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setSelectedRun(entry.run)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          isSelected
                            ? "border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
                            : "border-white/10 bg-slate-950/70 hover:border-white/20 hover:bg-white/10"
                        } cursor-pointer`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <p className="text-sm font-semibold text-white">
                              Run {entry.run}: {entry.predictedClass}
                            </p>
                            <p className="text-sm text-slate-400">
                              Source {entry.sourceClass} row {entry.sourceIndex}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
                              {entry.timestamp}
                            </span>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                entry.isCorrect
                                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                  : "border-rose-400/20 bg-rose-400/10 text-rose-200"
                              }`}
                            >
                              {entry.isCorrect ? "Correct" : "Mismatch"}
                            </span>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                entry.severity === "high"
                                  ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
                                  : entry.severity === "medium"
                                    ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
                                    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                              }`}
                            >
                              {entry.severity}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="text-sm text-slate-300">
                            Confidence {(entry.confidence * 100).toFixed(2)}%
                          </p>
                          <span className="text-sm text-cyan-200">
                            {isSelected ? "Viewing details" : "Click for details"}
                          </span>
                        </div>
                      </button>

                      {isSelected && selectedHistoryEntry ? (
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                          <p className="text-sm font-medium text-white">Selected Run Details</p>
                          <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                            <div className="space-y-4">
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-sm font-medium text-white">Waveform Preview</p>
                                <div className="mt-3">
                                  <LineChartCard
                                    data={selectedHistoryWaveform}
                                    xKey="sample"
                                    series={[{ dataKey: "amplitude", name: "Amplitude", color: "#22d3ee" }]}
                                  />
                                </div>
                              </div>

                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-sm font-medium text-white">Top 3 Predictions</p>
                                <div className="mt-3">
                                  <BarChartCard
                                    data={selectedHistoryTopK}
                                    xKey="className"
                                    yKey="confidence"
                                    color="#f59e0b"
                                  />
                                </div>
                                <div className="mt-3 space-y-3">
                                  {selectedHistoryEntry.topK.map((item, index) => (
                                    <div
                                      key={`${selectedHistoryEntry.run}-${item.predicted_label}-${index}`}
                                      className="flex items-center justify-between rounded-2xl bg-slate-900/80 px-3 py-3"
                                    >
                                      <div>
                                        <p className="text-sm font-medium text-white">{item.predicted_class}</p>
                                        <p className="text-xs text-slate-400">Class ID {item.predicted_label}</p>
                                      </div>
                                      <p className="text-sm font-semibold text-slate-100">
                                        {(item.confidence * 100).toFixed(2)}%
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-sm font-medium text-white">Prediction Summary</p>
                                <div className="mt-3 space-y-3 text-sm text-slate-300">
                                  <p>True/source class: {selectedHistoryEntry.sourceClass}</p>
                                  <p>Source row: {selectedHistoryEntry.sourceIndex}</p>
                                  <p>Predicted class: {selectedHistoryEntry.predictedClass}</p>
                                  <p>Confidence: {(selectedHistoryEntry.confidence * 100).toFixed(2)}%</p>
                                  <p>Severity: {selectedHistoryEntry.severity}</p>
                                  <p>Timestamp: {selectedHistoryEntry.timestamp}</p>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <span
                                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                      selectedHistoryEntry.isCorrect
                                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                        : "border-rose-400/20 bg-rose-400/10 text-rose-200"
                                    }`}
                                  >
                                    {selectedHistoryEntry.isCorrect ? "Correct" : "Mismatch"}
                                  </span>
                                  <span
                                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                      selectedHistoryEntry.severity === "high"
                                        ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
                                        : selectedHistoryEntry.severity === "medium"
                                          ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
                                          : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                    }`}
                                  >
                                    Severity {selectedHistoryEntry.severity}
                                  </span>
                                </div>
                              </div>

                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-sm font-medium text-white">Explanation</p>
                                <div className="mt-3 space-y-4 text-sm text-slate-300">
                                  <div>
                                    <p className="text-xs text-slate-500">What is happening</p>
                                    <p className="mt-1 leading-6">{selectedHistoryEntry.explanation.summary}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-500">Likely cause</p>
                                    <p className="mt-1 leading-6">{selectedHistoryEntry.explanation.likelyCause}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-500">Recommended action</p>
                                    <p className="mt-1 leading-6">{selectedHistoryEntry.explanation.recommendedAction}</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </PanelCard>
  );
}
