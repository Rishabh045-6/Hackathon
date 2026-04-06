"use client";

import { useEffect, useState } from "react";
import { PanelCard } from "@/components/dashboard/panel-card";
import { SeverityBadge, StatusBadge } from "@/components/dashboard/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { createAlert } from "@/lib/live-sim";
import type { Alert, AlertStatus } from "@/types/grid";

const statusOptions: AlertStatus[] = ["open", "acknowledged", "resolved"];

function randomPriority(): Alert["priority"] {
  const roll = Math.random();
  if (roll > 0.82) return "high";
  if (roll > 0.45) return "medium";
  return "low";
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>(() =>
    Array.from({ length: 8 }, (_, index) =>
      createAlert(randomPriority(), "live-alerts-simulator", `alert stream ${index + 1}`),
    ),
  );
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAlerts((current) => {
        const priority = randomPriority();
        const nextAlert = createAlert(priority, "live-alerts-simulator", "alert stream event");

        return [nextAlert, ...current].slice(0, 5);
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
      <PanelCard title="Alert Queue" subtitle="Review and update alert status">
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
              {alerts.slice(0, 5).map((alert) => (
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
