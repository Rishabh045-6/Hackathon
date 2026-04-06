"use client";

import { useEffect, useState } from "react";
import { PanelCard } from "@/components/dashboard/panel-card";
import { SeverityBadge, StatusBadge } from "@/components/dashboard/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import {
  createCriticalAlertFromReading,
  createCriticalDisturbanceAlert,
  createInitialReadings,
  stepReading,
} from "@/lib/live-sim";
import type { Alert, AlertStatus, GridReading } from "@/types/grid";

const statusOptions: AlertStatus[] = ["open", "acknowledged", "resolved"];
const REPEAT_COOLDOWN_MS = 12_000;
const DISTURBANCE_ALERT_CLASSES = [
  { predictedLabel: 3, predictedClass: "Interruption" },
  { predictedLabel: 4, predictedClass: "Transient" },
  { predictedLabel: 7, predictedClass: "Flicker_with_Sag" },
  { predictedLabel: 8, predictedClass: "Flicker_with_Swell" },
  { predictedLabel: 12, predictedClass: "Sag_with_Oscillatory_Transient" },
  { predictedLabel: 13, predictedClass: "Swell_with_Oscillatory_Transient" },
  { predictedLabel: 14, predictedClass: "Sag_with_Harmonics" },
  { predictedLabel: 15, predictedClass: "Swell_with_Harmonics" },
];

function isRecent(timestamp: string) {
  return Date.now() - new Date(timestamp).getTime() < REPEAT_COOLDOWN_MS;
}

export default function AlertsPage() {
  const [latestReading, setLatestReading] = useState<GridReading>(() => createInitialReadings(1, "alerts")[0]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLatestReading((currentReading) => {
        const nextReading = stepReading(currentReading, "alerts");

        setAlerts((currentAlerts) => {
          const readingAlert = createCriticalAlertFromReading(nextReading, "live-alerts-simulator");
          const disturbanceSeed =
            Math.random() < 0.35
              ? DISTURBANCE_ALERT_CLASSES[
                  Math.floor(Math.random() * DISTURBANCE_ALERT_CLASSES.length)
                ]
              : null;
          const disturbanceAlert = disturbanceSeed
            ? createCriticalDisturbanceAlert(
                disturbanceSeed.predictedLabel,
                disturbanceSeed.predictedClass,
                "waveform-classifier",
              )
            : null;
          const nextAlert = readingAlert ?? disturbanceAlert;

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

        return nextReading;
      });
    }, 3500);

    return () => window.clearInterval(timer);
  }, []);

  async function updateStatus(alertId: string, status: AlertStatus) {
    try {
      setUpdatingId(alertId);
      setAlerts((current) =>
        current.map((alert) => (alert.id === alertId ? { ...alert, status } : alert)),
      );
    } finally {
      setUpdatingId(null);
    }
  }

  if (alerts.length === 0) {
    return (
      <AppShell title="Alerts" subtitle="Operational events and response workflow.">
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center">
          <h2 className="text-lg font-semibold text-white">No alerts found</h2>
          <p className="mt-2 text-sm text-slate-400">The live simulation has not generated any alerts yet.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Alerts" subtitle="Operational events and response workflow.">
      <PanelCard title="Alert Queue" subtitle="Only critical operating alerts and high-severity AI disturbance alerts appear here. If nothing serious is happening, this stays empty.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr className="border-b border-white/10">
                <th className="pb-3 pr-4 font-medium">Title</th>
                <th className="pb-3 pr-4 font-medium">Priority</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 pr-4 font-medium">Triggered</th>
                <th className="pb-3 pr-4 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {alerts.slice(0, 3).map((alert) => (
                <tr key={alert.id} className="border-b border-white/5 align-top">
                  <td className="py-4 pr-4">
                    <p className="font-medium text-white">{alert.title}</p>
                    <p className="mt-1 max-w-md text-slate-400">{alert.message}</p>
                  </td>
                  <td className="py-4 pr-4">
                    <SeverityBadge value={alert.priority} />
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge value={alert.status} />
                  </td>
                  <td className="py-4 pr-4 text-slate-400">
                    {new Date(alert.created_at).toLocaleString()}
                  </td>
                  <td className="py-4 pr-0">
                    <select
                      value={alert.status}
                      disabled={updatingId === alert.id}
                      onChange={(event) => updateStatus(alert.id, event.target.value as AlertStatus)}
                      className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none ring-0"
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </AppShell>
  );
}
