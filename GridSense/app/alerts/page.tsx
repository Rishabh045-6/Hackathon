"use client";

import { useEffect, useState } from "react";
import { PanelCard } from "@/components/dashboard/panel-card";
import { SeverityBadge, StatusBadge } from "@/components/dashboard/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { StatePanel } from "@/components/layout/state-panel";
import type { Alert, AlertStatus } from "@/types/grid";

type ApiResponse<T> = {
  ok: boolean;
  data: T;
  error: string | null;
};

const statusOptions: AlertStatus[] = ["open", "acknowledged", "resolved"];

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function loadAlerts() {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/alerts?limit=50", { cache: "no-store" });
      const json = (await response.json()) as ApiResponse<Alert[]>;

      if (!json.ok) {
        throw new Error(json.error ?? "Failed to load alerts.");
      }

      setAlerts(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load alerts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
  }, []);

  async function updateStatus(alertId: string, status: AlertStatus) {
    try {
      setUpdatingId(alertId);
      setError(null);

      const response = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, status }),
      });

      const json = (await response.json()) as ApiResponse<Alert | null>;

      if (!json.ok || !json.data) {
        throw new Error(json.error ?? "Failed to update alert.");
      }

      setAlerts((current) =>
        current.map((alert) => (alert.id === alertId ? json.data ?? alert : alert)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update alert.");
    } finally {
      setUpdatingId(null);
    }
  }

  if (loading) {
    return (
      <AppShell title="Alerts" subtitle="Operational events and response workflow.">
        <StatePanel title="Loading alerts" message="Fetching current alert queue." />
      </AppShell>
    );
  }

  if (error && alerts.length === 0) {
    return (
      <AppShell title="Alerts" subtitle="Operational events and response workflow.">
        <StatePanel title="Unable to load alerts" message={error} />
      </AppShell>
    );
  }

  if (alerts.length === 0) {
    return (
      <AppShell title="Alerts" subtitle="Operational events and response workflow.">
        <StatePanel title="No alerts found" message="The system has not generated any alerts yet." />
      </AppShell>
    );
  }

  return (
    <AppShell title="Alerts" subtitle="Operational events and response workflow.">
      <PanelCard title="Alert Queue" subtitle="Review and update alert status">
        {error ? <p className="mb-4 text-sm text-rose-300">{error}</p> : null}

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
              {alerts.map((alert) => (
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
