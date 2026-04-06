import type { ReactNode } from "react";

export function StatePanel({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm text-slate-400">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
