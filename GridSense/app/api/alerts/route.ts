import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAlerts, updateAlertStatus } from "@/lib/services/alert-service";
import type { AlertStatus } from "@/types/grid";

const VALID_STATUSES: AlertStatus[] = ["open", "acknowledged", "resolved"];

export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;

  const result = await getAlerts(supabase, limit);

  if (result.error) {
    return NextResponse.json(
      { ok: false, data: [], error: result.error },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: result.data,
    error: null,
    meta: { count: result.data.length, limit },
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const body = (await request.json().catch(() => ({}))) as {
    alertId?: string;
    status?: AlertStatus;
  };

  if (!body.alertId || !body.status || !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { ok: false, data: null, error: "Invalid alertId or status." },
      { status: 400 },
    );
  }

  const result = await updateAlertStatus(supabase, body.alertId, body.status);

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
