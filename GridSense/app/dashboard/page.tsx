"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { SeverityBadge, StatusBadge } from "@/components/dashboard/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/layout/state-panel";
import type { Alert, Anomaly, GridReading } from "@/types/grid";

type ApiResponse<T> = {
  ok: boolean;
  data: T;
  error: string | null;
};

type AnomalyResponse = ApiResponse<Anomaly[]> & { alerts?: Alert[] };

export default function DashboardPage() {
  const [readings, setReadings] = useState<GridReading[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [readingsRes, anomaliesRes, alertsRes] = await Promise.all([
          fetch("/api/grid/readings?limit=24", { cache: "no-store" }),
          fetch("/api/grid/anomalies?limit=6&createAlerts=true", { cache: "no-store" }),
          fetch("/api/alerts?limit=5", { cache: "no-store" }),
        ]);

        const readingsJson = (await readingsRes.json()) as ApiResponse<GridReading[]>;
        const anomaliesJson = (await anomaliesRes.json()) as AnomalyResponse;
        const alertsJson = (await alertsRes.json()) as ApiResponse<Alert[]>;

        if (!readingsJson.ok) throw new Error(readingsJson.error ?? "Failed to load readings.");
        if (!anomaliesJson.ok) throw new Error(anomaliesJson.error ?? "Failed to load anomalies.");
        if (!alertsJson.ok) throw new Error(alertsJson.error ?? "Failed to load alerts.");

        setReadings(readingsJson.data);
        setAnomalies(anomaliesJson.data);
        setAlerts(alertsJson.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load dashboard.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const latest = readings[0];
  const chartData = useMemo(
    () =>
      [...readings]
        .reverse()
        .map((reading) => ({
          time: new Date(reading.recorded_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          load: reading.load,
          voltage: reading.voltage,
          current: reading.current,
        })),
    [readings],
  );

  if (loading) {
    return (
      <AppShell title="Dashboard" subtitle="Real-time grid health, alerts, and operating metrics.">
        <StatePanel title="Loading dashboard" message="Fetching live grid readings and alert status." />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell title="Dashboard" subtitle="Real-time grid health, alerts, and operating metrics.">
        <StatePanel title="Unable to load data" message={error} />
      </AppShell>
    );
  }

  if (!latest) {
    return (
      <AppShell title="Dashboard" subtitle="Real-time grid health, alerts, and operating metrics.">
        <StatePanel title="No readings yet" message="Run the simulator to generate the first grid dataset." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Dashboard" subtitle="Real-time grid health, alerts, and operating metrics.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Voltage" value={`${latest.voltage.toFixed(1)} V`} hint="latest reading" />
        <KpiCard label="Current" value={`${latest.current.toFixed(1)} A`} hint="feeder draw" />
        <KpiCard label="Frequency" value={`${latest.frequency.toFixed(2)} Hz`} hint="grid stability" />
        <KpiCard
          label="Load"
          value={`${latest.load.toFixed(1)} kW`}
          hint="active demand"
          tone={latest.load >= 95 ? "danger" : latest.load >= 80 ? "warning" : "success"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <PanelCard title="Load Trend" subtitle="Recent operating window">
          <LineChartCard
            data={chartData}
            xKey="time"
            series={[{ dataKey: "load", name: "Load (kW)", color: "#22d3ee" }]}
          />
        </PanelCard>

        <PanelCard title="Anomaly Summary" subtitle="Current rule-based detections">
          <div className="space-y-3">
            {anomalies.length === 0 ? (
              <p className="text-sm text-slate-400">No anomalies detected in the current window.</p>
            ) : (
              anomalies.slice(0, 4).map((anomaly) => (
                <div key={anomaly.id} className="rounded-2xl bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{anomaly.metric}</p>
                    <SeverityBadge value={anomaly.severity} />
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{anomaly.description}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                    observed {anomaly.observed_value}
                  </p>
                </div>
              ))
            )}
          </div>
        </PanelCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <PanelCard title="Voltage vs Current" subtitle="Distribution across the latest samples">
          <LineChartCard
            data={chartData}
            xKey="time"
            series={[
              { dataKey: "voltage", name: "Voltage (V)", color: "#38bdf8" },
              { dataKey: "current", name: "Current (A)", color: "#f59e0b" },
            ]}
          />
        </PanelCard>

        <PanelCard title="Recent Alerts" subtitle="Latest generated system alerts">
          <div className="space-y-3">
            {alerts.length === 0 ? (
              <p className="text-sm text-slate-400">No active alerts available.</p>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className="rounded-2xl bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{alert.title}</p>
                    <SeverityBadge value={alert.priority} />
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{alert.message}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <StatusBadge value={alert.status} />
                    <span className="text-xs text-slate-500">
                      {new Date(alert.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </PanelCard>
      </div>
    </AppShell>
  );
}
