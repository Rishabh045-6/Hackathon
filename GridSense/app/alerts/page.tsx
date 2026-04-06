"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PanelCard } from "@/components/dashboard/panel-card";
import { SeverityBadge, StatusBadge } from "@/components/dashboard/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import type { Alert, AlertStatus } from "@/types/grid";

const statusOptions: AlertStatus[] = ["open", "acknowledged", "resolved"];
const ALERT_REFRESH_MS = 4_000;
const FILTERS: Array<{ id: AlertStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "acknowledged", label: "Acknowledged" },
  { id: "resolved", label: "Resolved" },
];

type ApiResponse<T> = {
  ok: boolean;
  data: T;
  error: string | null;
};

async function readApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text();

  if (!text.trim()) {
    return { ok: false, data: null as T, error: "The server returned an empty response." };
  }

  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    return { ok: false, data: null as T, error: "The server returned an invalid JSON response." };
  }
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<AlertStatus | "all">("open");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAlerts() {
      try {
        const response = await fetch("/api/alerts?limit=50", { cache: "no-store" });
        const json = await readApiResponse<Alert[]>(response);

        if (!response.ok || !json.ok) {
          if (!cancelled) {
            setError(json.error ?? "Failed to load alerts.");
          }
          return;
        }

        if (!cancelled) {
          setAlerts(json.data ?? []);
          setError(null);
          setLastSyncedAt(new Date().toISOString());
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load alerts.");
        }
      }
    }

    void loadAlerts();
    const timer = window.setInterval(() => {
      void loadAlerts();
    }, ALERT_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const filteredAlerts = useMemo(
    () =>
      alerts.filter((alert) => (activeFilter === "all" ? true : alert.status === activeFilter)),
    [activeFilter, alerts],
  );

  const openCount = alerts.filter((alert) => alert.status === "open").length;
  const acknowledgedCount = alerts.filter((alert) => alert.status === "acknowledged").length;
  const resolvedCount = alerts.filter((alert) => alert.status === "resolved").length;
  const criticalCount = alerts.filter((alert) => alert.priority === "high").length;

  async function updateStatus(alertId: string, status: AlertStatus) {
    try {
      setUpdatingId(alertId);
      const response = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, status }),
      });
      const json = await readApiResponse<Alert | null>(response);

      if (!response.ok || !json.ok || !json.data) {
        throw new Error(json.error ?? "Failed to update alert.");
      }

      setAlerts((current) =>
        current.map((alert) => (alert.id === alertId ? json.data ?? alert : alert)),
      );
      setError(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update alert.");
    } finally {
      setUpdatingId(null);
    }
  }

  if (error) {
    return (
      <AppShell title="Alerts" subtitle="Operational events and response workflow.">
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center">
          <h2 className="text-lg font-semibold text-white">Alerts unavailable</h2>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
        </div>
      </AppShell>
    );
  }

  if (alerts.length === 0) {
    return (
      <AppShell title="Alerts" subtitle="Operational events and response workflow.">
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center">
          <h2 className="text-lg font-semibold text-white">No alerts found</h2>
          <p className="mt-2 text-sm text-slate-400">No backend alerts have been generated yet.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Alerts" subtitle="Operational events and response workflow.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Open Alerts" value={String(openCount)} hint="active queue" tone={openCount > 0 ? "warning" : "success"} />
        <KpiCard label="Acknowledged" value={String(acknowledgedCount)} hint="under review" />
        <KpiCard label="Resolved" value={String(resolvedCount)} hint="closed incidents" tone={resolvedCount > 0 ? "success" : "default"} />
        <KpiCard
          label="Critical Alerts"
          value={String(criticalCount)}
          hint={lastSyncedAt ? `synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : "awaiting sync"}
          tone={criticalCount > 0 ? "danger" : "success"}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setActiveFilter(filter.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeFilter === filter.id
                ? "bg-cyan-400 text-slate-950"
                : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <PanelCard title="Alert Queue" subtitle="Backend alerts from the waveform classifier and other connected alert sources are tracked here with real status updates.">
          {filteredAlerts.length === 0 ? (
            <p className="text-sm text-slate-400">No alerts match the current filter.</p>
          ) : (
            <div className="space-y-4">
              {filteredAlerts.map((alert) => (
                <div key={alert.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{alert.title}</p>
                      <p className="mt-1 text-sm text-slate-400">{alert.message}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge value={alert.priority} />
                      <StatusBadge value={alert.status} />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-slate-950/60 p-4">
                      <p className="text-xs font-medium text-slate-500">Triggered</p>
                      <p className="mt-2 text-sm text-white">{alert.triggered_by}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-950/60 p-4">
                      <p className="text-xs font-medium text-slate-500">Created</p>
                      <p className="mt-2 text-sm text-white">{new Date(alert.created_at).toLocaleString()}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-950/60 p-4">
                      <p className="text-xs font-medium text-slate-500">Status Action</p>
                      <select
                        value={alert.status}
                        disabled={updatingId === alert.id}
                        onChange={(event) => updateStatus(alert.id, event.target.value as AlertStatus)}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none ring-0"
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelCard>

        <PanelCard title="Alert Guide" subtitle="Use this queue like an incident workspace in a production app.">
          <div className="space-y-4 text-sm text-slate-300">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="font-medium text-white">Open</p>
              <p className="mt-2">A new issue has been detected and still needs operator attention.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="font-medium text-white">Acknowledged</p>
              <p className="mt-2">Someone has seen the alert and is actively reviewing or triaging it.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="font-medium text-white">Resolved</p>
              <p className="mt-2">The disturbance or incident has been handled and the alert can stay in history.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="font-medium text-white">Backend Sync</p>
              <p className="mt-2">
                This page reads from the backend alerts API and writes status changes back to the database, so it reflects the same queue other app surfaces can use.
              </p>
            </div>
          </div>
        </PanelCard>
      </div>
    </AppShell>
  );
}
