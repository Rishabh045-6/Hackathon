import type { AlertStatus, Severity } from "@/types/grid";

export function SeverityBadge({ value }: { value: Severity }) {
  const className =
    value === "high"
      ? "bg-rose-500/15 text-rose-300 ring-rose-400/30"
      : value === "medium"
        ? "bg-amber-500/15 text-amber-300 ring-amber-400/30"
        : "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${className}`}>
      {value}
    </span>
  );
}

export function StatusBadge({ value }: { value: AlertStatus }) {
  const className =
    value === "resolved"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30"
      : value === "acknowledged"
        ? "bg-cyan-500/15 text-cyan-300 ring-cyan-400/30"
        : "bg-amber-500/15 text-amber-300 ring-amber-400/30";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${className}`}>
      {value}
    </span>
  );
}
