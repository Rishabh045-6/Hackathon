"use client";

import { useEffect, useMemo, useState } from "react";
import { WaveformClassifierCard } from "@/components/analytics/waveform-classifier-card";
import { BarChartCard, PieChartCard } from "@/components/charts/bar-chart-card";
import { LineChartCard } from "@/components/charts/line-chart-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/layout/state-panel";
import type { Alert, Anomaly, GridReading, Prediction } from "@/types/grid";

type ApiResponse<T> = {
  ok: boolean;
  data: T;
  error: string | null;
};

export default function AnalyticsPage() {
  const [readings, setReadings] = useState<GridReading[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [readingsRes, predictionsRes, anomaliesRes, alertsRes] = await Promise.all([
          fetch("/api/grid/readings?limit=24", { cache: "no-store" }),
          fetch("/api/grid/predict?limit=12", { cache: "no-store" }),
          fetch("/api/grid/anomalies?limit=24&createAlerts=false", { cache: "no-store" }),
          fetch("/api/alerts?limit=24", { cache: "no-store" }),
        ]);

        const readingsJson = (await readingsRes.json()) as ApiResponse<GridReading[]>;
        const predictionsJson = (await predictionsRes.json()) as ApiResponse<Prediction[]>;
        const anomaliesJson = (await anomaliesRes.json()) as ApiResponse<Anomaly[]>;
        const alertsJson = (await alertsRes.json()) as ApiResponse<Alert[]>;

        if (!readingsJson.ok) throw new Error(readingsJson.error ?? "Failed to load readings.");
        if (!predictionsJson.ok) throw new Error(predictionsJson.error ?? "Failed to load predictions.");
        if (!anomaliesJson.ok) throw new Error(anomaliesJson.error ?? "Failed to load anomalies.");
        if (!alertsJson.ok) throw new Error(alertsJson.error ?? "Failed to load alerts.");

        setReadings(readingsJson.data);
        setPredictions(predictionsJson.data);
        setAnomalies(anomaliesJson.data);
        setAlerts(alertsJson.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load analytics.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const trendData = useMemo(
    () =>
      [...readings]
        .reverse()
        .map((reading) => ({
          time: new Date(reading.recorded_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
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

  if (loading) {
    return (
      <AppShell title="Analytics" subtitle="Historical and predictive grid intelligence.">
        <StatePanel title="Loading analytics" message="Preparing trends, anomalies, and prediction views." />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell title="Analytics" subtitle="Historical and predictive grid intelligence.">
        <StatePanel title="Unable to load analytics" message={error} />
      </AppShell>
    );
  }

  if (readings.length === 0) {
    return (
      <AppShell title="Analytics" subtitle="Historical and predictive grid intelligence.">
        <StatePanel title="No analytics available" message="Generate sample readings to populate analytics." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Analytics" subtitle="Historical and predictive grid intelligence.">
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
        <PanelCard title="Anomaly Count" subtitle="Rule-based detections by metric">
          {anomalyCounts.length === 0 ? (
            <p className="text-sm text-slate-400">No anomaly counts available.</p>
          ) : (
            <BarChartCard data={anomalyCounts} xKey="metric" yKey="count" color="#22c55e" />
          )}
        </PanelCard>

        <PanelCard title="Alert Severity" subtitle="Alert distribution by priority">
          {alertSeverity.length === 0 ? (
            <p className="text-sm text-slate-400">No alert severity data available.</p>
          ) : (
            <PieChartCard
              data={alertSeverity}
              dataKey="value"
              nameKey="name"
              colors={["#fb7185", "#fbbf24", "#34d399"]}
            />
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

        <PanelCard title="Disturbance Distribution" subtitle="Current disturbance mix from detected anomalies">
          {disturbanceDistribution.length === 0 ? (
            <p className="text-sm text-slate-400">No disturbance distribution available.</p>
          ) : (
            <PieChartCard
              data={disturbanceDistribution}
              dataKey="value"
              nameKey="name"
              colors={["#22d3ee", "#fb7185", "#f59e0b", "#34d399", "#a78bfa"]}
            />
          )}
        </PanelCard>
      </div>

      <div className="mt-6">
        <WaveformClassifierCard />
      </div>
    </AppShell>
  );
}
