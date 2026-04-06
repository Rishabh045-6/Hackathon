import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <section>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">
              GridSense AI
            </p>
            <h1 className="mt-4 text-5xl font-semibold tracking-tight text-white">
              Smart grid monitoring with alerts, trends, and AI-ready forecasting.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-slate-400">
              Track voltage, current, frequency, and load in one clean dashboard backed by
              Supabase and Next.js.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-950"
              >
                Open Dashboard
              </Link>
              <Link
                href="/login"
                className="rounded-full border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white"
              >
                Sign In
              </Link>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-900/80 p-4">
                <p className="text-sm text-slate-400">Voltage</p>
                <p className="mt-3 text-3xl font-semibold text-cyan-300">231.4 V</p>
              </div>
              <div className="rounded-2xl bg-slate-900/80 p-4">
                <p className="text-sm text-slate-400">Current</p>
                <p className="mt-3 text-3xl font-semibold text-amber-300">14.8 A</p>
              </div>
              <div className="rounded-2xl bg-slate-900/80 p-4">
                <p className="text-sm text-slate-400">Frequency</p>
                <p className="mt-3 text-3xl font-semibold text-emerald-300">49.98 Hz</p>
              </div>
              <div className="rounded-2xl bg-slate-900/80 p-4">
                <p className="text-sm text-slate-400">Alerts</p>
                <p className="mt-3 text-3xl font-semibold text-rose-300">3 Active</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
