"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { SeverityBadge, StatusBadge } from "@/components/dashboard/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/layout/state-panel";
import {
  createInitialReadings,
  stepReading,
} from "@/lib/live-sim";
import { getClassifierExplanation } from "@/lib/classifier-explanations";
import type { Alert, Anomaly, GridReading, PredictionLog } from "@/types/grid";

type ApiResponse<T> = {
  ok: boolean;
  data: T;
  error: string | null;
};

const DISTURBANCE_POLL_MS = 4_000;

function toAnomalyFromLog(log: PredictionLog): Anomaly {
  const explanation = getClassifierExplanation(log.predicted_label);

  return {
    id: `dashboard-anomaly-${log.id}`,
    user_id: log.user_id,
    reading_id: null,
    anomaly_type: log.predicted_class.toLowerCase().replace(/\s+/g, "_"),
    severity: explanation.severity,
    metric: "waveform",
    observed_value: Number((log.confidence * 100).toFixed(2)),
    threshold_value: 90,
    description: log.explanation_summary ?? explanation.summary,
    detected_at: log.created_at,
    resolved: false,
    created_at: log.created_at,
  };
}

function toAlertFromLog(log: PredictionLog): Alert | null {
  const explanation = getClassifierExplanation(log.predicted_label);
  if (explanation.severity !== "high") {
    return null;
  }

  return {
    id: `dashboard-alert-${log.id}`,
    user_id: log.user_id,
    anomaly_id: null,
    title: `Critical Disturbance: ${log.predicted_class}`,
    message: log.explanation_summary ?? explanation.summary,
    status: "open",
    priority: "high",
    triggered_by: "analytics-waveform-classifier",
    created_at: log.created_at,
  };
}

function getAnomalyLabel(anomaly: Anomaly) {
  return anomaly.anomaly_type.replace(/_/g, " ");
}
export default function DashboardPage() {
  const [readings, setReadings] = useState<GridReading[]>(() => createInitialReadings(24, "dashboard"));
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);

  useEffect(() => {
    if (readings.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setReadings((current) => {
        const base = current[current.length - 1];
        if (!base) {
          return current;
        }
        const nextReading = stepReading(base, "dashboard");

        return [...current.slice(-23), nextReading];
      });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [readings.length]);

  useEffect(() => {
    let cancelled = false;

    async function loadDisturbances() {
      try {
        const response = await fetch("/api/grid/prediction-logs?limit=24", { cache: "no-store" });
        const json = (await response.json()) as ApiResponse<PredictionLog[]>;

        if (!response.ok || !json.ok) {
          return;
        }

        const recentLogs = json.data ?? [];
        const nextAnomalies = recentLogs
          .map(toAnomalyFromLog)
          .slice(0, 3);
        const nextAlerts = recentLogs
          .map(toAlertFromLog)
          .filter((alert): alert is Alert => alert !== null)
          .slice(0, 3);

        if (!cancelled) {
          setAnomalies(nextAnomalies);
          setAlerts(nextAlerts);
        }
      } catch {
        if (!cancelled) {
          setAnomalies([]);
          setAlerts([]);
        }
      }
    }

    void loadDisturbances();
    const timer = window.setInterval(() => {
      void loadDisturbances();
    }, DISTURBANCE_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const latest = readings[readings.length - 1];
  const chartData = useMemo(
    () =>
      readings.map((reading) => ({
          time: new Date(reading.recorded_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          load: reading.load,
          voltage: reading.voltage,
          current: reading.current,
        })),
    [readings],
  );

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

        <PanelCard title="Anomaly Summary" subtitle="Recent disturbances detected by the Analytics waveform classifier are summarized here.">
          <div className="space-y-3">
            {anomalies.length === 0 ? (
              <p className="text-sm text-slate-400">No recent disturbance from Analytics.</p>
            ) : (
              anomalies.slice(0, 3).map((anomaly) => (
                <div key={anomaly.id} className="rounded-2xl bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{getAnomalyLabel(anomaly)}</p>
                    <SeverityBadge value={anomaly.severity} />
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{anomaly.description}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                    confidence {anomaly.observed_value.toFixed(2)}%
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

        <PanelCard title="Recent Alerts" subtitle="High-severity disturbances from the Analytics page appear here as critical alerts.">
            <div className="space-y-3">
              {alerts.length === 0 ? (
                <p className="text-sm text-slate-400">No critical disturbance alert right now.</p>
              ) : (
                alerts.slice(0, 3).map((alert) => (
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
