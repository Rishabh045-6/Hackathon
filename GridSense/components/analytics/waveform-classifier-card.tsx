"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { BarChartCard } from "@/components/charts/bar-chart-card";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import {
  buildFallbackOperationalExplanation,
  getClassifierExplanation,
  type ExplanationRequestPayload,
  type OperationalExplanation,
} from "@/lib/classifier-explanations";
import { usePersistentState } from "@/lib/use-persistent-state";
import type { LiveStreamState } from "@/types/grid";

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
  meta?: {
    advanced?: boolean;
    expired?: boolean;
    expires_at?: string | null;
  } | null;
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
  explanation: OperationalExplanation;
};

async function readApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text();

  if (!text.trim()) {
    return {
      ok: false,
      data: null as T,
      error: "The server returned an empty response.",
    };
  }

  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    return {
      ok: false,
      data: null as T,
      error: "The server returned an invalid JSON response.",
    };
  }
}

const CONFIDENCE_THRESHOLD = 0.9;
const INITIAL_SIMULATION_CLASS = "Pure_Sinusoidal";
const EXPLANATION_MIN_REQUEST_GAP_MS = 15_000;
const SOURCE_CLASS_REVEAL_REMAINING_MS = 2_000;

function computeSignalMetrics(values: number[]) {
  if (values.length === 0) {
    return { rms: 0, peak: 0, trough: 0, mean: 0 };
  }

  const peak = Math.max(...values);
  const trough = Math.min(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const rms = Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length);

  return { rms, peak, trough, mean };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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
  const [inputValue, setInputValue] = usePersistentState("gridsense:waveform:inputValue", "");
  const [selectedFile, setSelectedFile] = usePersistentState<string | null>("gridsense:waveform:selectedFile", null);
  const [signal, setSignal] = usePersistentState<number[] | null>("gridsense:waveform:signal", null);
  const [result, setResult] = usePersistentState<ClassifierResponse | null>("gridsense:waveform:result", null);
  const [datasetMeta, setDatasetMeta] = useState<DatasetMeta | null>(null);
  const [liveStreamState, setLiveStreamState] = useState<LiveStreamState | null>(null);
  const [simulationInfo, setSimulationInfo] = useState<WaveformSample | null>(null);
  const [history, setHistory] = usePersistentState<SimulationHistoryEntry[]>("gridsense:waveform:history", []);
  const [expandedRuns, setExpandedRuns] = usePersistentState<number[]>("gridsense:waveform:expandedRuns", []);
  const [liveSourceClass, setLiveSourceClass] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confidenceGateMessage, setConfidenceGateMessage] = usePersistentState<string | null>(
    "gridsense:waveform:confidenceGateMessage",
    null,
  );
  const [loading, setLoading] = useState(false);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [manualModeOpen, setManualModeOpen] = usePersistentState("gridsense:waveform:manualModeOpen", false);
  const [explanation, setExplanation] = usePersistentState<OperationalExplanation | null>("gridsense:waveform:explanation", null);
  const [playbackIndex, setPlaybackIndex] = usePersistentState("gridsense:waveform:playbackIndex", 0);
  const [highSeverityPopup, setHighSeverityPopup] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [streamNowMs, setStreamNowMs] = useState(() => Date.now());
  const lastExplanationMetaRef = useRef<{
    key: string;
    source: "llm" | "fallback";
    at: number;
    explanation: OperationalExplanation;
  } | null>(null);
  const lastExplanationRequestRef = useRef<{ key: string; at: number } | null>(null);
  const explanationRequestInFlightRef = useRef<string | null>(null);
  const lastSharedEventKeyRef = useRef<string | null>(null);

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
  const disturbanceStreamData = useMemo(() => {
    const recentSignals = history.slice(-4);
    let offset = 0;

    return recentSignals.flatMap((entry) => {
      const points = entry.signal.map((value, index) => ({
        sample: offset + index,
        amplitude: Number(value.toFixed(6)),
      }));
      offset += entry.signal.length;
      return points;
    });
  }, [history]);

  const confidenceTimeline = useMemo(
    () =>
      history.map((entry) => ({
        run: `Run ${entry.run}`,
        confidence: entry.confidence * 100,
      })),
    [history],
  );

  const predictedDistribution = useMemo(() => {
    const counts = history.reduce<Record<string, number>>((acc, entry) => {
      if (entry.predictedClass === INITIAL_SIMULATION_CLASS) {
        return acc;
      }

      acc[entry.predictedClass] = (acc[entry.predictedClass] ?? 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([className, count]) => ({ className, count }));
  }, [history]);

  const sessionSummary = useMemo(() => {
    const samplesShown = history.length;
    const averageConfidence =
      samplesShown === 0
        ? 0
        : history.reduce((sum, entry) => sum + entry.confidence, 0) / samplesShown;

    return {
      samplesShown,
      averageConfidence: Number((averageConfidence * 100).toFixed(2)),
    };
  }, [history]);
  const recentTimelineEntries = useMemo(
    () => history.slice(-5).reverse(),
    [history],
  );
  const liveElapsedMs = liveStreamState
    ? Math.max(0, streamNowMs - new Date(liveStreamState.started_at).getTime())
    : 0;
  const sharedProgressRatio = liveStreamState
    ? clamp(liveElapsedMs / liveStreamState.duration_ms, 0, 1)
    : 0;
  const effectivePlaybackIndex =
    liveStreamState && signal?.length
      ? Math.min(signal.length - 1, Math.floor(sharedProgressRatio * Math.max(signal.length - 1, 0)))
      : playbackIndex;
  const liveWaveformPreview = useMemo(
    () => waveformPreview.slice(0, effectivePlaybackIndex + 1),
    [effectivePlaybackIndex, waveformPreview],
  );
  const currentSampleValue = signal?.[effectivePlaybackIndex] ?? null;
  const processedSamples = signal ? Math.min(effectivePlaybackIndex + 1, signal.length) : 0;
  const playbackProgress =
    liveStreamState && signal?.length
      ? Number((sharedProgressRatio * 100).toFixed(2))
      : (signal?.length ? (processedSamples / signal.length) * 100 : 0);
  const streamRemainingMs = liveStreamState
    ? Math.max(0, liveStreamState.duration_ms - liveElapsedMs)
    : 0;
  const shouldRevealSourceClass =
    liveStreamState
      ? streamRemainingMs <= SOURCE_CLASS_REVEAL_REMAINING_MS
      : signal
        ? processedSamples >= Math.max(signal.length - 2, 1)
        : false;
  const sourceClassDisplay = shouldRevealSourceClass ? (liveSourceClass ?? "--") : "Classifying...";
  const liveMetrics = useMemo(
    () => computeSignalMetrics((signal ?? []).slice(0, processedSamples)),
    [signal, processedSamples],
  );
  const liveTelemetry = useMemo(() => {
    const currentValue = currentSampleValue ?? 0;
    const voltage = 230 + currentValue * 28;
    const current = 14 + Math.abs(currentValue) * 11;
    const frequency = 50 + liveMetrics.mean * 0.35;
    const load = 18 + liveMetrics.rms * 10;
    const powerFactor = 0.98 - Math.min(0.18, Math.abs(liveMetrics.peak - liveMetrics.trough) * 0.04);

    return {
      voltage: clamp(voltage, 180, 280),
      current: clamp(current, 0, 60),
      frequency: clamp(frequency, 48.5, 51.5),
      load: clamp(load, 0, 100),
      powerFactor: clamp(powerFactor, 0.7, 1),
    };
  }, [currentSampleValue, liveMetrics]);

  function showHighSeverityPopup(message: string) {
    setHighSeverityPopup({
      title: "High severity risk detected",
      message,
    });
  }

  useEffect(() => {
    async function loadDatasetMeta() {
      try {
        const response = await fetch("/api/grid/waveform", { cache: "no-store" });
        const json = await readApiResponse<DatasetMeta | null>(response);
        if (!json.ok || !json.data) {
          throw new Error(json.error ?? "Failed to load waveform dataset.");
        }

        setDatasetMeta(json.data);
      } catch (metaError) {
        setError(metaError instanceof Error ? metaError.message : "Failed to load waveform dataset.");
      }
    }

    void loadDatasetMeta();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseClient();

    async function loadCurrentLiveStream() {
      try {
        const response = await fetch("/api/grid/live-stream", { cache: "no-store" });
        const json = await readApiResponse<LiveStreamState | null>(response);
        if (!response.ok || !json.ok || !json.data) {
          throw new Error(json.error ?? "Failed to load live stream state.");
        }

        if (!cancelled) {
          setLiveStreamState(json.data);
          setLiveSourceClass(json.data.class_name);
        }
      } catch (streamError) {
        if (!cancelled) {
          setError(streamError instanceof Error ? streamError.message : "Failed to load live stream state.");
        }
      }
    }

    void loadCurrentLiveStream();

    const channel = supabase
      .channel("live-stream-state")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_stream_state",
          filter: "stream_key=eq.global",
        },
        (payload) => {
          const nextRow = payload.new as LiveStreamState | undefined;
          if (!nextRow || cancelled) {
            return;
          }

          setLiveStreamState(nextRow);
          setLiveSourceClass(nextRow.class_name);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshIfNeeded() {
      if (!liveStreamState) {
        return;
      }

      const staleAt = new Date(liveStreamState.started_at).getTime() + liveStreamState.duration_ms;
      if (Date.now() < staleAt + 250) {
        return;
      }

      try {
        const response = await fetch("/api/grid/live-stream", { cache: "no-store" });
        const json = await readApiResponse<LiveStreamState | null>(response);
        if (!cancelled && response.ok && json.ok && json.data) {
          setLiveStreamState(json.data);
          setLiveSourceClass(json.data.class_name);
        }
      } catch {
        // Keep the current shared state and try again on the next interval tick.
      }
    }

    const timer = window.setInterval(() => {
      void refreshIfNeeded();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [liveStreamState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStreamNowMs(Date.now());
    }, 100);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!signal?.length || liveStreamState) {
      if (!signal?.length) {
        setPlaybackIndex(0);
      }
      return;
    }

    setPlaybackIndex(0);
    const timer = window.setInterval(() => {
      setPlaybackIndex((current) => {
        if (current >= signal.length - 1) {
          window.clearInterval(timer);
          return current;
        }

        return current + 1;
      });
    }, 20);

    return () => window.clearInterval(timer);
  }, [liveStreamState, signal]);

  useEffect(() => {
    if (!liveStreamState) {
      return;
    }

    const eventKey = `${liveStreamState.class_name}:${liveStreamState.sample_index}:${liveStreamState.started_at}`;
    if (lastSharedEventKeyRef.current === eventKey) {
      return;
    }

    lastSharedEventKeyRef.current = eventKey;
    setLiveSourceClass(liveStreamState.class_name);
    void loadWaveform({
      className: liveStreamState.class_name,
      sampleIndex: liveStreamState.sample_index,
    });
  }, [liveStreamState]);

  function handleTextParse(raw: string) {
    const parsed = parseSignalInput(raw);
    setInputValue(raw);
    setSignal(parsed);
    setSelectedFile(null);
    setError(null);
    setConfidenceGateMessage(null);
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
      setConfidenceGateMessage(null);
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

  async function requestExplanation(
    payload: ExplanationRequestPayload,
    explanationKey: string,
  ): Promise<OperationalExplanation> {
    const fallback = buildFallbackOperationalExplanation(payload);
    const now = Date.now();
    const lastRequest = lastExplanationRequestRef.current;

    if (explanationRequestInFlightRef.current) {
      return fallback;
    }

    if (
      lastRequest &&
      lastRequest.key === explanationKey &&
      now - lastRequest.at < EXPLANATION_MIN_REQUEST_GAP_MS
    ) {
      return fallback;
    }

    try {
      explanationRequestInFlightRef.current = explanationKey;
      lastExplanationRequestRef.current = { key: explanationKey, at: now };
      setExplanationLoading(true);
      const response = await fetch("/api/grid/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await readApiResponse<OperationalExplanation | null>(response);
      if (!response.ok || !json.ok || !json.data) {
        return fallback;
      }

      return json.data;
    } catch {
      return fallback;
    } finally {
      explanationRequestInFlightRef.current = null;
      setExplanationLoading(false);
    }
  }

  function applyResolvedExplanation(
    resolvedExplanation: OperationalExplanation,
    resultData: ClassifierResponse,
    sourceClass: string,
    sourceIndex: number,
    nextSignal: number[],
    severity: "low" | "medium" | "high",
    isCorrect: boolean,
  ) {
    setExplanation(resolvedExplanation);
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
        severity,
        isCorrect,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        explanation: resolvedExplanation,
      };
      return [...current.slice(-11), entry];
    });
  }

  async function classifySignal(nextSignal: number[], sourceClass: string, sourceIndex: number) {
    try {
      setLoading(true);
      setError(null);
      setConfidenceGateMessage(null);

      const response = await fetch("/api/grid/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signal: nextSignal,
          source_class: sourceClass === "Manual" ? null : sourceClass,
          sample_index: sourceClass === "Manual" ? null : sourceIndex,
          source_identifier: sourceClass === "Manual" ? "manual-waveform" : "waveform-simulation",
        }),
      });

      const json = await readApiResponse<ClassifierResponse | null>(response);
      if (!json.ok || !json.data) {
        throw new Error(json.error ?? "Classification failed.");
      }

      const resultData = json.data;
      if (resultData.confidence < CONFIDENCE_THRESHOLD) {
        setResult(null);
        setExplanation(null);
        setConfidenceGateMessage("Confidence is below 90%, so the result is hidden until the model is more certain.");
        return;
      }

      const nextExplanation = getClassifierExplanation(resultData.predicted_label);
      const isCorrect = resultData.predicted_class === sourceClass;
      const explanationPayload: ExplanationRequestPayload = {
        predicted_label: resultData.predicted_label,
        predicted_class: resultData.predicted_class,
        confidence: resultData.confidence,
        top_k: resultData.top_k,
        severity: nextExplanation.severity,
        source_class: sourceClass,
        source_row: sourceIndex,
        is_correct: sourceClass === "Manual" ? null : isCorrect,
      };
      const explanationKey = JSON.stringify({
        predicted_label: explanationPayload.predicted_label,
        severity: explanationPayload.severity,
        top_k: explanationPayload.top_k.map((item) => item.predicted_label),
      });
      const now = Date.now();
      const lastExplanationMeta = lastExplanationMetaRef.current;

      setResult(resultData);
      setConfidenceGateMessage(null);

      if (nextExplanation.severity === "high") {
        showHighSeverityPopup(nextExplanation.summary);
      }

      if (
        lastExplanationMeta &&
        lastExplanationMeta.key === explanationKey &&
        lastExplanationMeta.source === "llm" &&
        now - lastExplanationMeta.at < 60_000
      ) {
        applyResolvedExplanation(
          lastExplanationMeta.explanation,
          resultData,
          sourceClass,
          sourceIndex,
          nextSignal,
          nextExplanation.severity,
          isCorrect,
        );
      } else if (
        lastExplanationMeta &&
        lastExplanationMeta.key === explanationKey &&
        lastExplanationMeta.source === "fallback" &&
        now - lastExplanationMeta.at < 90_000
      ) {
        applyResolvedExplanation(
          lastExplanationMeta.explanation,
          resultData,
          sourceClass,
          sourceIndex,
          nextSignal,
          nextExplanation.severity,
          isCorrect,
        );
      } else {
        const localFallback = buildFallbackOperationalExplanation(explanationPayload);
        applyResolvedExplanation(
          localFallback,
          resultData,
          sourceClass,
          sourceIndex,
          nextSignal,
          nextExplanation.severity,
          isCorrect,
        );

        void requestExplanation(explanationPayload, explanationKey).then((resolvedExplanation) => {
          lastExplanationMetaRef.current = {
            key: explanationKey,
            source: resolvedExplanation.source,
            at: Date.now(),
            explanation: resolvedExplanation,
          };
          setExplanation(resolvedExplanation);
          setHistory((current) => {
            if (current.length === 0) {
              return current;
            }

            const nextHistory = [...current];
            const lastEntry = nextHistory[nextHistory.length - 1];
            if (
              lastEntry.predictedLabel === resultData.predicted_label &&
              lastEntry.sourceIndex === sourceIndex
            ) {
              nextHistory[nextHistory.length - 1] = {
                ...lastEntry,
                explanation: resolvedExplanation,
              };
            }
            return nextHistory;
          });
        });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Classification failed.");
    } finally {
      setLoading(false);
    }
  }

  function dismissHighSeverityPopup() {
    setHighSeverityPopup(null);
  }

  async function loadWaveform({
    className,
    sampleIndex,
  }: {
    className: string;
    sampleIndex: number;
  }) {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        className,
        sampleIndex: String(sampleIndex),
      });

      const response = await fetch(`/api/grid/waveform?${params.toString()}`, { cache: "no-store" });
      const json = await readApiResponse<WaveformSample | null>(response);
      if (!json.ok || !json.data) {
        throw new Error(json.error ?? "Failed to load waveform sample.");
      }

      const sample = json.data;
      setSignal(sample.signal);
      setInputValue(sample.signal.join(", "));
      setSimulationInfo(sample);
      setLiveSourceClass(sample.className);
      setSelectedFile(null);
      setConfidenceGateMessage(null);
      await classifySignal(sample.signal, sample.className, sample.sampleIndex);
    } catch (waveformError) {
      setLoading(false);
      setError(waveformError instanceof Error ? waveformError.message : "Failed to load waveform sample.");
    }
  }

  const latestHistoryEntry = history[history.length - 1] ?? null;

  return (
    <>
      {highSeverityPopup ? (
        <div className="fixed bottom-6 right-6 z-50 w-[min(92vw,28rem)] rounded-3xl border border-rose-400/20 bg-slate-950/95 p-4 shadow-2xl shadow-rose-950/30 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-rose-200">{highSeverityPopup.title}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{highSeverityPopup.message}</p>
            </div>
            <button
              type="button"
              onClick={dismissHighSeverityPopup}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/logs#prediction-history"
              className="rounded-full bg-rose-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-rose-300"
              onClick={dismissHighSeverityPopup}
            >
              Open logs
            </Link>
          </div>
        </div>
      ) : null}

      <PanelCard
        title="Waveform Classifier"
        subtitle="Run live disturbance simulation from the 17-class waveform dataset and inspect classifier behavior in real time."
      >
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">Live Disturbance Stream</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Shared across devices from the backend-authoritative live stream state.
                  </p>
                </div>
                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                  Synced stream
                </span>
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-400">
              Every client listens to the same shared event row and derives playback from its server start time instead of choosing classes locally.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-slate-500">
              <span>{signal ? "100-point waveform loaded" : "Waiting for waveform sample"}</span>
              <span>mode: shared realtime stream</span>
              {liveStreamState ? <span>phase: {liveStreamState.phase}</span> : null}
              {liveSourceClass ? <span>source: {sourceClassDisplay}</span> : null}
              {liveStreamState ? <span>duration: {liveStreamState.duration_ms} ms</span> : null}
              {selectedFile ? <span>manual file: {selectedFile}</span> : null}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-medium text-white">Live Disturbance Stream</p>
              {disturbanceStreamData.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  Start the live stream to build the combined disturbance waveform feed.
                </p>
              ) : (
                <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <LineChartCard
                    data={disturbanceStreamData}
                    xKey="sample"
                    series={[{ dataKey: "amplitude", name: "Amplitude", color: "#22d3ee" }]}
                  />
                </div>
              )}
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-xs font-medium text-slate-500">Voltage</p>
                  <p className="mt-2 text-xl font-semibold text-white">{liveTelemetry.voltage.toFixed(1)} V</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-xs font-medium text-slate-500">Current</p>
                  <p className="mt-2 text-xl font-semibold text-white">{liveTelemetry.current.toFixed(2)} A</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-xs font-medium text-slate-500">Frequency</p>
                  <p className="mt-2 text-xl font-semibold text-white">{liveTelemetry.frequency.toFixed(2)} Hz</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-xs font-medium text-slate-500">Load</p>
                  <p className="mt-2 text-xl font-semibold text-white">{liveTelemetry.load.toFixed(2)} kW</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-xs font-medium text-slate-500">Power Factor</p>
                  <p className="mt-2 text-xl font-semibold text-white">{liveTelemetry.powerFactor.toFixed(3)}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">Waveform Preview</p>
                  <span className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-xs font-medium text-cyan-200">
                    Sample {processedSamples}/{signal?.length ?? 0}
                  </span>
                </div>
                {!signal ? (
                  <p className="mt-3 text-sm text-slate-400">
                    Load a valid signal to preview all 100 samples before classification.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-xs font-medium text-slate-500">Source class</p>
                        <p className="mt-2 text-sm font-semibold text-white">{sourceClassDisplay}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-xs font-medium text-slate-500">Current sample</p>
                        <p className="mt-2 text-xl font-semibold text-white">
                          {currentSampleValue === null ? "--" : currentSampleValue.toFixed(4)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-xs font-medium text-slate-500">RMS so far</p>
                        <p className="mt-2 text-xl font-semibold text-white">{liveMetrics.rms.toFixed(4)}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-xs font-medium text-slate-500">Peak / trough</p>
                        <p className="mt-2 text-xl font-semibold text-white">
                          {liveMetrics.peak.toFixed(3)} / {liveMetrics.trough.toFixed(3)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-xs font-medium text-slate-500">Playback progress</p>
                        <p className="mt-2 text-xl font-semibold text-white">{playbackProgress.toFixed(0)}%</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                      <div className="h-2 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full bg-cyan-400 transition-all duration-75"
                          style={{ width: `${playbackProgress}%` }}
                        />
                      </div>
                      <div className="mt-4">
                        <LineChartCard
                          data={liveWaveformPreview}
                          xKey="sample"
                          series={[{ dataKey: "amplitude", name: "Amplitude", color: "#22d3ee" }]}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-medium text-white">Event Count by Predicted Class</p>
                <p className="mt-1 text-sm text-slate-400">
                  Counts which AI-predicted disturbance classes are appearing most often in the current live stream window.
                </p>
                {predictedDistribution.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-400">No simulated events yet.</p>
                ) : (
                  <div className="mt-3">
                    <BarChartCard data={predictedDistribution} xKey="className" yKey="count" color="#34d399" />
                  </div>
                )}
              </div>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-white">Result</p>
              <Link
                href="/logs"
                className="rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              >
                Open Logs
              </Link>
            </div>
            {!result ? (
              <p className="mt-3 text-sm text-slate-400">
                {confidenceGateMessage ??
                  "Start the waveform simulation to see the predicted disturbance class and confidence."}
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl bg-slate-950/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-cyan-300">Predicted class</p>
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-2xl font-semibold text-white">{result.predicted_class}</p>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${severityStyle.badge}`}>
                          {result.predicted_label === 0 ? "Stable" : "Attention"}
                        </span>
                      </div>
                      <p className="text-sm text-slate-400">Class ID {result.predicted_label}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
                      <p className="text-xs font-medium text-emerald-300">Confidence</p>
                      <p className="mt-1 text-3xl font-semibold text-white">{(result.confidence * 100).toFixed(2)}%</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-400">AI answer</p>
                  <p className="mt-2 text-sm text-white">{result.predicted_class}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-400">Stream status</p>
                  <p className="mt-2 text-sm text-white">{liveStreamState ? "Synced live" : "Waiting for state"}</p>
                </div>
              </div>
            </div>

              </div>
            )}
          </div>

          <div className={`rounded-2xl border p-5 ${severityStyle.panel}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className={`text-sm font-medium ${severityStyle.accent}`}>AI Explanation Layer</p>
              {explanation ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-slate-950/50 px-3 py-1 text-xs font-medium text-slate-200">
                    {explanation.source === "llm" ? "LLM explanation" : "Local fallback"}
                  </span>
                  {loading ? (
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                      Updating...
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {explanationLoading ? (
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Currently the status is normal, whenever there is a disturbance, the system will alert you.
              </p>
            ) : !explanation ? (
              <p className="mt-4 text-sm leading-6 text-slate-300">
                No explanation yet. Run the waveform simulation to generate a classifier explanation.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 text-sm text-slate-300 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 lg:col-span-2">
                  <p className="text-xs font-medium text-slate-400">Summary</p>
                  <p className="mt-2 leading-6">{explanation.summary}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <p className="text-xs font-medium text-slate-400">What is happening</p>
                  <p className="mt-2 leading-6">{explanation.what_is_happening}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <p className="text-xs font-medium text-slate-400">Likely cause</p>
                  <p className="mt-2 leading-6">{explanation.likely_cause}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs font-medium text-slate-400">Severity</p>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${severityStyle.badge}`}>
                      {explanation.severity}
                    </span>
                  </div>
                  <p className="mt-3 leading-6">{explanation.severity_reason}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 lg:col-span-2">
                  <p className="text-xs font-medium text-slate-400">Recommended action</p>
                  <p className="mt-2 leading-6">{explanation.recommended_action}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 lg:col-span-2">
                  <p className="text-xs font-medium text-slate-400">Operator note</p>
                  <p className="mt-2 leading-6">{explanation.operator_note}</p>
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
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Average Confidence</p>
                <p className="mt-2 text-xl font-semibold text-white">{sessionSummary.averageConfidence}%</p>
              </div>
              <div className="rounded-2xl bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Active Mode</p>
                <p className="mt-2 text-xl font-semibold text-white">Live Stream</p>
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
                  yAxisDomain={[90, 100]}
                />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-medium text-white">Recent Predictions Timeline</p>
            {recentTimelineEntries.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">Recent simulated predictions will appear here.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {recentTimelineEntries.map((entry) => {
                  const isExpanded = expandedRuns.includes(entry.run);
                  const entryWaveform = entry.signal.map((value, index) => ({
                    sample: index,
                    amplitude: Number(value.toFixed(6)),
                  }));

                  return (
                    <div
                      key={`${entry.run}-${entry.sourceClass}-${entry.sourceIndex}-${entry.predictedLabel}`}
                      className="space-y-3"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedRuns((current) =>
                            current.includes(entry.run)
                              ? current.filter((run) => run !== entry.run)
                              : [entry.run, ...current],
                          )
                        }
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          isExpanded
                            ? "border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
                            : "border-white/10 bg-slate-950/70 hover:border-white/20 hover:bg-white/10"
                        } cursor-pointer`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <p className="text-sm font-semibold text-white">
                              Run {entry.run}: {entry.predictedClass}
                            </p>
                            <p className="text-sm text-slate-400">AI classification event</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
                              {entry.timestamp}
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
                            {isExpanded ? "Hide details" : "Show details"}
                          </span>
                        </div>
                      </button>

                      {isExpanded ? (
                        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
                          <p className="text-sm font-medium text-white">Selected Run Details</p>
                          <div className="mt-5 grid gap-5 xl:grid-cols-2">
                            <div className="space-y-5">
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                                <p className="text-sm font-medium text-white">Waveform Preview</p>
                                <div className="mt-3">
                                  <LineChartCard
                                    data={entryWaveform}
                                    xKey="sample"
                                    series={[{ dataKey: "amplitude", name: "Amplitude", color: "#22d3ee" }]}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="space-y-5">
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                                <p className="text-sm font-medium text-white">Prediction Summary</p>
                                <div className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                                    <p className="text-xs font-medium text-slate-500">Predicted class</p>
                                    <p className="mt-2 text-white">{entry.predictedClass}</p>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                                    <p className="text-xs font-medium text-slate-500">Confidence</p>
                                    <p className="mt-2 text-white">{(entry.confidence * 100).toFixed(2)}%</p>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                                    <p className="text-xs font-medium text-slate-500">Severity</p>
                                    <p className="mt-2 text-white">{entry.severity}</p>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                                    <p className="text-xs font-medium text-slate-500">Timestamp</p>
                                    <p className="mt-2 text-white">{entry.timestamp}</p>
                                  </div>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <span
                                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                      entry.severity === "high"
                                        ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
                                        : entry.severity === "medium"
                                          ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
                                          : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                    }`}
                                  >
                                    Severity {entry.severity}
                                  </span>
                                </div>
                              </div>

                              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                                <p className="text-sm font-medium text-white">Explanation</p>
                                <div className="mt-4 grid gap-4 text-sm text-slate-300 lg:grid-cols-2">
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 lg:col-span-2">
                                    <p className="text-xs font-medium text-slate-500">Summary</p>
                                    <p className="mt-2 leading-6">{entry.explanation.summary}</p>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                                    <p className="text-xs font-medium text-slate-500">What is happening</p>
                                    <p className="mt-2 leading-6">{entry.explanation.what_is_happening}</p>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                                    <p className="text-xs font-medium text-slate-500">Likely cause</p>
                                    <p className="mt-2 leading-6">{entry.explanation.likely_cause}</p>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                                    <p className="text-xs font-medium text-slate-500">Severity reason</p>
                                    <p className="mt-2 leading-6">{entry.explanation.severity_reason}</p>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 lg:col-span-2">
                                    <p className="text-xs font-medium text-slate-500">Recommended action</p>
                                    <p className="mt-2 leading-6">{entry.explanation.recommended_action}</p>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 lg:col-span-2">
                                    <p className="text-xs font-medium text-slate-500">Operator note</p>
                                    <p className="mt-2 leading-6">{entry.explanation.operator_note}</p>
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
    </>
  );
}
