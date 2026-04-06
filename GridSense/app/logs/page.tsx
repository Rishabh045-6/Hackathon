import { KpiCard } from "@/components/dashboard/kpi-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { SeverityBadge } from "@/components/dashboard/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/layout/state-panel";
import { createClient } from "@/lib/supabase/server";
import { getPredictionLogs } from "@/lib/services/grid-service";

function getConfidenceTone(confidence: number) {
  if (confidence >= 0.9) {
    return "success";
  }

  if (confidence >= 0.75) {
    return "warning";
  }

  return "danger";
}

function getSeverityFromConfidence(confidence: number) {
  if (confidence >= 0.9) {
    return "low";
  }

  if (confidence >= 0.75) {
    return "medium";
  }

  return "high";
}

export default async function LogsPage() {
  const supabase = await createClient();
  const logsResult = await getPredictionLogs(supabase, 200);

  if (logsResult.error) {
    return (
      <AppShell title="Prediction Logs" subtitle="Historical waveform classifications stored from the live simulation and manual prediction flow.">
        <StatePanel title="Logs unavailable" message={logsResult.error} />
      </AppShell>
    );
  }

  const logs = logsResult.data;
  const latest = logs[0] ?? null;
  const avgConfidence =
    logs.length === 0
      ? 0
      : logs.reduce((sum, log) => sum + log.confidence, 0) / logs.length;
  const matchedCount = logs.filter(
    (log) => log.source_class && log.predicted_class === log.source_class,
  ).length;

  return (
    <AppShell
      title="Prediction Logs"
      subtitle="All persisted waveform-class predictions, newest first, with source class context from the simulation flow when available."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Logs" value={String(logs.length)} hint="stored predictions" />
        <KpiCard
          label="Latest Class"
          value={latest?.predicted_class ?? "None"}
          hint={latest ? new Date(latest.created_at).toLocaleString() : "no predictions yet"}
        />
        <KpiCard
          label="Avg Confidence"
          value={`${(avgConfidence * 100).toFixed(2)}%`}
          hint="across stored predictions"
          tone={getConfidenceTone(avgConfidence)}
        />
        <KpiCard
          label="Matches"
          value={`${matchedCount}`}
          hint="predicted vs source class"
          tone={matchedCount > 0 ? "success" : "default"}
        />
      </div>

      <div className="mt-6">
        <PanelCard title="Prediction History" subtitle="Newest predictions first. Source class and sample row come from the dataset-driven waveform simulation when available.">
          {logs.length === 0 ? (
            <p className="text-sm text-slate-400">No prediction logs have been stored yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr className="border-b border-white/10">
                    <th className="pb-3 pr-4 font-medium">Time</th>
                    <th className="pb-3 pr-4 font-medium">Predicted Class</th>
                    <th className="pb-3 pr-4 font-medium">Confidence</th>
                    <th className="pb-3 pr-4 font-medium">Source Class</th>
                    <th className="pb-3 pr-4 font-medium">Sample Row</th>
                    <th className="pb-3 pr-4 font-medium">Model</th>
                    <th className="pb-3 pr-4 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-white/5 align-top">
                      <td className="py-4 pr-4 text-slate-300">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="py-4 pr-4">
                        <div className="space-y-2">
                          <p className="font-medium text-white">{log.predicted_class}</p>
                          <p className="text-xs text-slate-500">Class ID {log.predicted_label}</p>
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="space-y-2">
                          <p className="text-white">{(log.confidence * 100).toFixed(2)}%</p>
                          <SeverityBadge value={getSeverityFromConfidence(log.confidence)} />
                        </div>
                      </td>
                      <td className="py-4 pr-4 text-slate-300">
                        {log.source_class ?? "N/A"}
                      </td>
                      <td className="py-4 pr-4 text-slate-300">
                        {log.sample_index ?? "N/A"}
                      </td>
                      <td className="py-4 pr-4 text-slate-300">
                        <div className="space-y-1">
                          <p>{log.model_name}</p>
                          <p className="text-xs text-slate-500">{log.source_identifier ?? "N/A"}</p>
                        </div>
                      </td>
                      <td className="py-4 pr-0">
                        <div className="max-w-xl space-y-2">
                          <p className="text-slate-300">
                            {log.explanation_summary ?? "No summary stored."}
                          </p>
                          {log.signal_preview?.length ? (
                            <p className="text-xs text-slate-500">
                              Preview: {log.signal_preview.join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PanelCard>
      </div>
    </AppShell>
  );
}
