"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { BarChartCard } from "@/components/charts/bar-chart-card";
import { SeverityBadge } from "@/components/dashboard/status-badge";
import { getClassifierExplanation } from "@/lib/classifier-explanations";
import type { PredictionLog } from "@/types/grid";

type PredictionLogExplorerProps = {
  logs: PredictionLog[];
};

const logTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZone: "UTC",
});

function formatLogTimestamp(timestamp: string) {
  return logTimestampFormatter.format(new Date(timestamp));
}

type WaveformApiResponse = {
  ok: boolean;
  data: {
    className: string;
    sampleIndex: number;
    totalSamples: number;
    signal: number[];
  } | null;
  error: string | null;
};

function computeSignalMetrics(values: number[]) {
  if (values.length === 0) {
    return { rms: 0, peak: 0, trough: 0, mean: 0, span: 0 };
  }

  const peak = Math.max(...values);
  const trough = Math.min(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const rms = Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length);
  const span = peak - trough;

  return { rms, peak, trough, mean, span };
}

export function PredictionLogExplorer({ logs }: PredictionLogExplorerProps) {
  const [selectedLogId, setSelectedLogId] = useState<string>(logs[0]?.id ?? "");
  const [resolvedSignal, setResolvedSignal] = useState<number[] | null>(null);
  const [signalLoading, setSignalLoading] = useState(false);
  const [signalError, setSignalError] = useState<string | null>(null);

  useEffect(() => {
    if (logs.length === 0) {
      return;
    }

    if (!selectedLogId || !logs.some((log) => log.id === selectedLogId)) {
      setSelectedLogId(logs[0].id);
    }
  }, [logs, selectedLogId]);

  const selectedLog = useMemo(
    () => logs.find((log) => log.id === selectedLogId) ?? logs[0] ?? null,
    [logs, selectedLogId],
  );
  const signalValues = resolvedSignal ?? selectedLog?.signal_preview ?? [];

  const waveformData = useMemo(
    () =>
      signalValues.map((value, index) => ({
        sample: index + 1,
        amplitude: Number(value.toFixed(6)),
      })),
    [signalValues],
  );

  const topPredictions = useMemo(
    () =>
      (selectedLog?.top_k ?? []).map((item) => ({
        className: item.predicted_class,
        confidence: Number((item.confidence * 100).toFixed(2)),
      })),
    [selectedLog],
  );
  const signalMetrics = useMemo(
    () => computeSignalMetrics(signalValues),
    [signalValues],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadFullSignal() {
      if (!selectedLog) {
        return;
      }

      if (selectedLog.signal_preview && selectedLog.signal_preview.length >= selectedLog.signal_length) {
        setResolvedSignal(selectedLog.signal_preview);
        setSignalError(null);
        return;
      }

      if (!selectedLog.source_class || selectedLog.sample_index === null) {
        setResolvedSignal(selectedLog.signal_preview ?? null);
        setSignalError(null);
        return;
      }

      try {
        setSignalLoading(true);
        setSignalError(null);
        const params = new URLSearchParams({
          className: selectedLog.source_class,
          sampleIndex: String(selectedLog.sample_index),
        });
        const response = await fetch(`/api/grid/waveform?${params.toString()}`, { cache: "no-store" });
        const json = (await response.json()) as WaveformApiResponse;

        if (!response.ok || !json.ok || !json.data?.signal) {
          throw new Error(json.error ?? "Failed to load waveform.");
        }

        if (!cancelled) {
          setResolvedSignal(json.data.signal);
        }
      } catch (error) {
        if (!cancelled) {
          setResolvedSignal(selectedLog.signal_preview ?? null);
          setSignalError(error instanceof Error ? error.message : "Failed to load waveform.");
        }
      } finally {
        if (!cancelled) {
          setSignalLoading(false);
        }
      }
    }

    setResolvedSignal(null);
    void loadFullSignal();

    return () => {
      cancelled = true;
    };
  }, [selectedLog]);

  if (logs.length === 0) {
    return <p className="text-sm text-slate-400">No prediction logs have been stored yet.</p>;
  }

  if (!selectedLog) {
    return <p className="text-sm text-slate-400">Select a prediction log to inspect it.</p>;
  }

  const explanation = getClassifierExplanation(selectedLog.predicted_label);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr className="border-b border-white/10">
              <th className="pb-3 pr-4 font-medium">Time</th>
              <th className="pb-3 pr-4 font-medium">Predicted Class</th>
              <th className="pb-3 pr-4 font-medium">Confidence</th>
              <th className="pb-3 pr-4 font-medium">Source Class</th>
              <th className="pb-3 pr-4 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const isSelected = log.id === selectedLog.id;

              return (
                <tr
                  key={log.id}
                  onClick={() => setSelectedLogId(log.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedLogId(log.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={`border-b border-white/5 align-top transition cursor-pointer ${
                    isSelected ? "bg-cyan-400/10" : "hover:bg-white/5"
                  }`}
                >
                  <td className="py-4 pr-4 text-slate-300">{formatLogTimestamp(log.created_at)}</td>
                  <td className="py-4 pr-4">
                    <div className="text-left">
                      <p className="font-medium text-white">{log.predicted_class}</p>
                      <p className="text-xs text-slate-500">Class ID {log.predicted_label}</p>
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-white">{(log.confidence * 100).toFixed(2)}%</td>
                  <td className="py-4 pr-4 text-slate-300">{log.source_class ?? "N/A"}</td>
                  <td className="py-4 pr-0 max-w-xl text-slate-300">{log.explanation_summary ?? "No summary stored."}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-sm font-medium text-white">Selected Log Details</p>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <div className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
              <p className="text-sm font-medium text-white">Waveform Preview</p>
              {signalLoading ? (
                <p className="mt-3 text-sm text-slate-400">Loading full waveform for this log...</p>
              ) : null}
              {waveformData.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No waveform preview was stored for this log.</p>
              ) : (
                <div className="mt-3">
                  <LineChartCard
                    data={waveformData}
                    xKey="sample"
                    series={[{ dataKey: "amplitude", name: "Amplitude", color: "#22d3ee" }]}
                  />
                </div>
              )}
              {signalError ? <p className="mt-3 text-xs text-slate-500">{signalError}</p> : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
              <p className="text-sm font-medium text-white">Signal Metrics</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Peak amplitude</p>
                  <p className="mt-2 text-sm font-semibold text-white">{signalMetrics.peak.toFixed(4)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Trough amplitude</p>
                  <p className="mt-2 text-sm font-semibold text-white">{signalMetrics.trough.toFixed(4)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Amplitude span</p>
                  <p className="mt-2 text-sm font-semibold text-white">{signalMetrics.span.toFixed(4)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">RMS</p>
                  <p className="mt-2 text-sm font-semibold text-white">{signalMetrics.rms.toFixed(4)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Mean</p>
                  <p className="mt-2 text-sm font-semibold text-white">{signalMetrics.mean.toFixed(4)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Loaded samples</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {signalValues.length} / {selectedLog.signal_length}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
              <p className="text-sm font-medium text-white">Top Predictions</p>
              {topPredictions.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">No class ranking was stored for this log.</p>
              ) : (
                <div className="mt-3">
                  <BarChartCard data={topPredictions} xKey="className" yKey="confidence" color="#22d3ee" />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
              <p className="text-sm font-medium text-white">Prediction Summary</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Predicted class</p>
                  <p className="mt-2 text-sm font-semibold text-white">{selectedLog.predicted_class}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Confidence</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {(selectedLog.confidence * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Severity</p>
                  <p className="mt-2 text-sm font-semibold capitalize text-white">{explanation.severity}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Timestamp</p>
                  <p className="mt-2 text-sm font-semibold text-white">{formatLogTimestamp(selectedLog.created_at)}</p>
                </div>
              </div>
              <div className="mt-4">
                <SeverityBadge value={explanation.severity} />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
              <p className="text-sm font-medium text-white">Explanation</p>
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Summary</p>
                  <p className="mt-2 text-sm text-white">
                    {selectedLog.explanation_summary ?? explanation.summary}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Likely cause</p>
                  <p className="mt-2 text-sm text-slate-300">{explanation.likelyCause}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-medium text-slate-500">Recommended action</p>
                  <p className="mt-2 text-sm text-slate-300">{explanation.recommendedAction}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
