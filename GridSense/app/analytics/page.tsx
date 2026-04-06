"use client";

import { useEffect, useMemo, useState } from "react";
import { WaveformClassifierCard } from "@/components/analytics/waveform-classifier-card";
import { BarChartCard } from "@/components/charts/bar-chart-card";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/layout/state-panel";
import {
  createAlert,
  createAnomaliesFromReading,
  createInitialAlerts,
  createInitialAnomalies,
  createPredictionFromReading,
  createInitialPredictions,
  createInitialReadings,
  getAlertPriorityFromReading,
  stepReading,
} from "@/lib/live-sim";
import type { Alert, Anomaly, GridReading, Prediction } from "@/types/grid";

export default function AnalyticsPage() {
  const [readings, setReadings] = useState<GridReading[]>(() => createInitialReadings(24, "analytics"));
  const [predictions, setPredictions] = useState<Prediction[]>(() =>
    createInitialPredictions(createInitialReadings(12, "analytics-predictions"), 12, "analytics"),
  );
  const [anomalies, setAnomalies] = useState<Anomaly[]>(() =>
    createInitialAnomalies(createInitialReadings(24, "analytics-anomalies"), 24, "analytics"),
  );
  const [alerts, setAlerts] = useState<Alert[]>(() =>
    createInitialAlerts(createInitialReadings(24, "analytics-alerts"), 24, "live-simulator"),
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
          const priority = getAlertPriorityFromReading(nextReading);
          if (!priority) {
            return currentAlerts;
          }

          return [...currentAlerts.slice(-23), createAlert(priority, "live-simulator")];
        });

        return [...current.slice(-23), nextReading];
      });
    }, 1500);

    return () => window.clearInterval(timer);
  }, []);

  const trendData = useMemo(
    () =>
      [...readings]
        .reverse()
        .map((reading) => ({
          time: new Date(reading.recorded_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          load: reading.load,
          frequency: reading.frequency,
          voltage: reading.voltage,
          current: reading.current,
          powerFactor: reading.power_factor,
        })),
    [readings],
  );

  const actualVsPredicted = useMemo(() => {
    const actual = [...readings].reverse().slice(-Math.max(predictions.length, 4));

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

  const anomalyCounts = useMemo(() => {
    const counts = anomalies.reduce<Record<string, number>>((acc, anomaly) => {
      acc[anomaly.metric] = (acc[anomaly.metric] ?? 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([metric, count]) => ({ metric, count }));
  }, [anomalies]);

  const alertSeverity = useMemo(() => {
    const counts = alerts.reduce<Record<string, number>>((acc, alert) => {
      acc[alert.priority] = (acc[alert.priority] ?? 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [alerts]);

  const disturbanceDistribution = useMemo(() => {
    const counts = anomalies.reduce<Record<string, number>>((acc, anomaly) => {
      acc[anomaly.anomaly_type] = (acc[anomaly.anomaly_type] ?? 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [anomalies]);

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

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <PanelCard title="Live Event Count" subtitle="Counts the most recent simulated operating events by metric so you can see whether voltage, load, or frequency is driving the current activity.">
          {anomalyCounts.length === 0 ? (
            <p className="text-sm text-slate-400">No anomaly counts available.</p>
          ) : (
            <BarChartCard data={anomalyCounts} xKey="metric" yKey="count" color="#22c55e" />
          )}
        </PanelCard>

        <PanelCard title="Alert Severity" subtitle="Shows how many live alerts are currently high, medium, or low priority, so you can see urgency without interpreting pie slices.">
          {alertSeverity.length === 0 ? (
            <p className="text-sm text-slate-400">No alert severity data available.</p>
          ) : (
            <BarChartCard data={alertSeverity} xKey="name" yKey="value" color="#f59e0b" />
          )}
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
        <PanelCard title="Load vs Power Factor" subtitle="Demand and efficiency side by side">
          <LineChartCard
            data={trendData}
            xKey="time"
            series={[
              { dataKey: "load", name: "Load (kW)", color: "#22d3ee" },
              { dataKey: "powerFactor", name: "Power Factor", color: "#f472b6" },
            ]}
          />
        </PanelCard>

        <PanelCard title="Disturbance Distribution" subtitle="Shows which disturbance/event types are appearing most often in the current simulated anomaly window, ranked by count.">
          {disturbanceDistribution.length === 0 ? (
            <p className="text-sm text-slate-400">No disturbance distribution available.</p>
          ) : (
            <BarChartCard data={disturbanceDistribution} xKey="name" yKey="value" color="#22d3ee" />
          )}
        </PanelCard>
      </div>
    </AppShell>
  );
}
