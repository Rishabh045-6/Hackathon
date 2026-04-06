import { KpiCard } from "@/components/dashboard/kpi-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/layout/state-panel";
import { PredictionLogExplorer } from "@/components/logs/prediction-log-explorer";
import { createClient } from "@/lib/supabase/server";
import { getPredictionLogs } from "@/lib/services/grid-service";

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
          label="Latest Source"
          value={latest?.source_class ?? "N/A"}
          hint="current source class"
        />
        <KpiCard
          label="Matches"
          value={`${matchedCount}`}
          hint="predicted vs source class"
          tone={matchedCount > 0 ? "success" : "default"}
        />
      </div>

      <div className="mt-6">
        <PanelCard title="Prediction History" subtitle="Newest predictions first, with source class context from the waveform simulation when available.">
          <PredictionLogExplorer logs={logs} />
        </PanelCard>
      </div>
    </AppShell>
  );
}
