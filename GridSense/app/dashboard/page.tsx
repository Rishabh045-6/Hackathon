"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { SeverityBadge, StatusBadge } from "@/components/dashboard/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/layout/state-panel";
import {
  createAnomaliesFromReading,
  createCriticalAlertFromReading,
  createInitialAlerts,
  createInitialAnomalies,
  createInitialReadings,
  stepReading,
} from "@/lib/live-sim";
import type { Alert, Anomaly, GridReading } from "@/types/grid";

const REPEAT_COOLDOWN_MS = 12_000;

function isRecent(timestamp: string) {
  return Date.now() - new Date(timestamp).getTime() < REPEAT_COOLDOWN_MS;
}

function getAnomalyLabel(anomaly: Anomaly) {
  if (anomaly.anomaly_type === "high_load") {
    return "High Load";
  }

  if (anomaly.anomaly_type === "voltage_sag") {
    return "Voltage Sag";
  }

  if (anomaly.anomaly_type === "voltage_swell") {
    return "Voltage Swell";
  }

  return anomaly.metric.replace(/_/g, " ");
}
export default function DashboardPage() {
  const [readings, setReadings] = useState<GridReading[]>(() => createInitialReadings(24, "dashboard"));
  const [alerts, setAlerts] = useState<Alert[]>(() =>
    createInitialAlerts(createInitialReadings(12, "dashboard-alerts"), 12, "live-dashboard-simulator", "dashboard event")
      .filter((alert) => alert.priority === "high")
      .slice(0, 3),
  );
  const [anomalies, setAnomalies] = useState<Anomaly[]>(() =>
    createInitialAnomalies(createInitialReadings(12, "dashboard-anomalies"), 12, "dashboard")
      .filter((anomaly) => anomaly.severity === "high")
      .slice(0, 3),
  );

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

        setAnomalies((currentAnomalies) => {
          const nextHighAnomalies = createAnomaliesFromReading(nextReading, "dashboard").filter(
            (anomaly) => anomaly.severity === "high",
          );

          const dedupedNewItems = nextHighAnomalies.filter((anomaly) => {
            const existing = currentAnomalies.find(
              (current) => current.anomaly_type === anomaly.anomaly_type && isRecent(current.detected_at),
            );
            return !existing;
          });

          return [...dedupedNewItems, ...currentAnomalies].slice(0, 3);
        });

        setAlerts((currentAlerts) => {
          const nextAlert = createCriticalAlertFromReading(nextReading, "live-dashboard-simulator");
          if (!nextAlert) {
            return currentAlerts;
          }

          const duplicateRecentAlert = currentAlerts.find(
            (alert) => alert.title === nextAlert.title && isRecent(alert.created_at),
          );

          if (duplicateRecentAlert) {
            return currentAlerts;
          }

          return [nextAlert, ...currentAlerts].slice(0, 3);
        });

        return [...current.slice(-23), nextReading];
      });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [readings.length]);

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

        <PanelCard title="Anomaly Summary" subtitle="Only fresh high-severity operating problems are shown here. Repeated readings of the same issue are suppressed for a short cooldown.">
          <div className="space-y-3">
            {anomalies.length === 0 ? (
              <p className="text-sm text-slate-400">No high-severity anomaly right now.</p>
            ) : (
              anomalies.slice(0, 3).map((anomaly) => (
                <div key={anomaly.id} className="rounded-2xl bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{getAnomalyLabel(anomaly)}</p>
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

        <PanelCard title="Recent Alerts" subtitle="Only active high-priority alerts are shown. If nothing critical is happening, this stays empty.">
            <div className="space-y-3">
              {alerts.length === 0 ? (
                <p className="text-sm text-slate-400">No critical alert right now.</p>
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
