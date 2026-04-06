import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSettings, updateSettings } from "@/lib/services/settings-service";
import type { AppSettings } from "@/types/grid";

type SettingsUpdate = Partial<
  Pick<
    AppSettings,
    | "site_name"
    | "refresh_interval_seconds"
    | "alert_voltage_min"
    | "alert_voltage_max"
    | "alert_frequency_min"
    | "alert_frequency_max"
    | "alert_load_max"
    | "simulation_enabled"
  >
>;

export async function GET() {
  const supabase = await createClient();
  const result = await getSettings(supabase);

  if (result.error) {
    return NextResponse.json(
      { ok: false, data: null, error: result.error },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: result.data,
    error: null,
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const body = (await request.json().catch(() => ({}))) as SettingsUpdate;

  const result = await updateSettings(supabase, body);

  if (result.error) {
    return NextResponse.json(
      { ok: false, data: null, error: result.error },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: result.data,
    error: null,
  });
}
