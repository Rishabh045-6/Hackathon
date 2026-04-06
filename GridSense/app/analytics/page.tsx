"use client";

import { useEffect, useMemo } from "react";
import { WaveformClassifierCard } from "@/components/analytics/waveform-classifier-card";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/layout/state-panel";
import {
  createAnomaliesFromReading,
  createCriticalAlertFromReading,
  createInitialAlerts,
  createInitialAnomalies,
  createPredictionFromReading,
  createInitialPredictions,
  createInitialReadings,
  stepReading,
} from "@/lib/live-sim";
import { usePersistentState } from "@/lib/use-persistent-state";
import type { Alert, Anomaly, GridReading, Prediction } from "@/types/grid";

export default function AnalyticsPage() {
  const [readings, setReadings] = usePersistentState<GridReading[]>("gridsense:analytics:readings", () =>
    createInitialReadings(24, "analytics"),
  );
  const [predictions, setPredictions] = usePersistentState<Prediction[]>("gridsense:analytics:predictions", () =>
    createInitialPredictions(createInitialReadings(12, "analytics-predictions"), 12, "analytics"),
  );
  const [anomalies, setAnomalies] = usePersistentState<Anomaly[]>("gridsense:analytics:anomalies", () =>
    createInitialAnomalies(createInitialReadings(24, "analytics-anomalies"), 24, "analytics"),
  );
  const [alerts, setAlerts] = usePersistentState<Alert[]>("gridsense:analytics:alerts", () =>
    createInitialAlerts(createInitialReadings(24, "analytics-alerts"), 24, "live-simulator")
      .filter((alert) => alert.priority === "high")
      .slice(-3),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReadings((current) => {
        const base = current[current.length - 1];
        if (!base) {
          return current;
        }
        const nextReading = stepReading(base, "analytics");

        setPredictions((currentPredictions) => [
          ...currentPredictions.slice(-11),
          createPredictionFromReading(nextReading, "analytics"),
        ]);

        setAnomalies((currentAnomalies) => [
          ...currentAnomalies.slice(-20),
          ...createAnomaliesFromReading(nextReading, "analytics"),
        ]);

        setAlerts((currentAlerts) => {
          const nextAlert = createCriticalAlertFromReading(nextReading, "live-simulator");
          if (!nextAlert) {
            return currentAlerts;
          }

          return [...currentAlerts.slice(-2), nextAlert];
        });

        return [...current.slice(-23), nextReading];
      });
    }, 1500);

    return () => window.clearInterval(timer);
  }, []);

  const trendData = useMemo(
    () =>
      readings.map((reading) => ({
          time: new Date(reading.recorded_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          load: reading.load,
          frequency: reading.frequency,
          voltage: reading.voltage,
          voltageDelta: Number((reading.voltage - 230).toFixed(2)),
          current: reading.current,
          powerFactor: reading.power_factor,
          frequencyDelta: Number((reading.frequency - 50).toFixed(3)),
        })),
    [readings],
  );

  const actualVsPredicted = useMemo(() => {
    const actual = readings.slice(-Math.max(predictions.length, 4));

    return actual.map((reading, index) => ({
      time: new Date(reading.recorded_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      actual: reading.load,
      predicted: predictions[index]?.predicted_load ?? reading.load * 1.04,
    }));
  }, [predictions, readings]);

  const recentCriticalAlerts = useMemo(
    () =>
      [...alerts]
        .filter((alert) => alert.priority === "high")
        .slice(-3)
        .reverse(),
    [alerts],
  );

  if (readings.length === 0) {
    return (
      <AppShell title="Analytics" subtitle="Historical and predictive grid intelligence.">
        <StatePanel title="No analytics available" message="Generate sample readings to populate analytics." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Analytics" subtitle="Historical and predictive grid intelligence.">
      <div className="mb-6">
        <WaveformClassifierCard />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <PanelCard title="Grid Trend" subtitle="Load, voltage, and frequency over time">
          <LineChartCard
            data={trendData}
            xKey="time"
            series={[
              { dataKey: "load", name: "Load (kW)", color: "#22d3ee" },
              { dataKey: "voltage", name: "Voltage (V)", color: "#38bdf8" },
              { dataKey: "frequency", name: "Frequency (Hz)", color: "#f59e0b" },
            ]}
          />
        </PanelCard>

        <PanelCard title="Predicted vs Actual" subtitle="Simple AI-ready baseline forecast">
          <LineChartCard
            data={actualVsPredicted}
            xKey="time"
            series={[
              { dataKey: "actual", name: "Actual Load", color: "#34d399" },
              { dataKey: "predicted", name: "Predicted Load", color: "#f97316" },
            ]}
          />
        </PanelCard>
      </div>

      <div className="mt-6">
        <PanelCard title="Voltage Deviation" subtitle="Shows how far voltage is moving above or below the 230 V nominal reference over the live window.">
          <LineChartCard
            data={trendData}
            xKey="time"
            series={[{ dataKey: "voltageDelta", name: "Voltage Delta (V)", color: "#22d3ee" }]}
          />
        </PanelCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <PanelCard title="Voltage Trend" subtitle="Live feeder voltage over the current window">
          <LineChartCard
            data={trendData}
            xKey="time"
            series={[{ dataKey: "voltage", name: "Voltage (V)", color: "#38bdf8" }]}
          />
        </PanelCard>

        <PanelCard title="Current Trend" subtitle="Live current draw over the current window">
          <LineChartCard
            data={trendData}
            xKey="time"
            series={[{ dataKey: "current", name: "Current (A)", color: "#f59e0b" }]}
          />
        </PanelCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <PanelCard title="Frequency Trend" subtitle="Grid stability over the current window">
          <LineChartCard
            data={trendData}
            xKey="time"
            series={[{ dataKey: "frequency", name: "Frequency (Hz)", color: "#34d399" }]}
          />
        </PanelCard>

        <PanelCard title="Power Factor Trend" subtitle="Power factor behavior across recent samples">
          <LineChartCard
            data={trendData}
            xKey="time"
            series={[{ dataKey: "powerFactor", name: "Power Factor", color: "#a78bfa" }]}
          />
        </PanelCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <PanelCard title="Load vs Power Factor" subtitle="Compares demand and efficiency together so you can see whether heavier loading is reducing power factor.">
          <LineChartCard
            data={trendData}
            xKey="time"
            series={[
              { dataKey: "load", name: "Load (kW)", color: "#22d3ee" },
              { dataKey: "powerFactor", name: "Power Factor", color: "#f472b6" },
            ]}
          />
        </PanelCard>

        <PanelCard title="Recent Critical Alerts" subtitle="Shows only the latest high-priority alerts. If there is no serious issue, this panel stays empty.">
          {recentCriticalAlerts.length === 0 ? (
            <p className="text-sm text-slate-400">No critical alert right now.</p>
          ) : (
            <div className="space-y-3">
              {recentCriticalAlerts.map((alert) => (
                <div key={alert.id} className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{alert.title}</p>
                    <span className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs font-medium text-rose-200">
                      high
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{alert.message}</p>
                  <p className="mt-3 text-xs text-slate-400">
                    {new Date(alert.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      </div>
    </AppShell>
  );
}
