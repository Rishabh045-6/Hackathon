import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createAlertsFromReadings,
  getAnomalies,
  getLatestReadings,
} from "@/lib/services/grid-service";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? 24);
  const createAlerts = searchParams.get("createAlerts") !== "false";
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 24;

  const anomaliesResult = await getAnomalies(supabase, limit);

  if (anomaliesResult.error) {
    return NextResponse.json(
      { ok: false, data: [], alerts: [], error: anomaliesResult.error },
      { status: 400 },
    );
  }

  let alerts = [] as Awaited<ReturnType<typeof createAlertsFromReadings>>["data"];

  if (createAlerts) {
    const readingsResult = await getLatestReadings(supabase, 6);

    if (readingsResult.error) {
      return NextResponse.json(
        { ok: false, data: anomaliesResult.data, alerts: [], error: readingsResult.error },
        { status: 400 },
      );
    }

    const alertsResult = await createAlertsFromReadings(supabase, readingsResult.data);

    if (alertsResult.error) {
      return NextResponse.json(
        { ok: false, data: anomaliesResult.data, alerts: [], error: alertsResult.error },
        { status: 400 },
      );
    }

    alerts = alertsResult.data;
  }

  return NextResponse.json({
    ok: true,
    data: anomaliesResult.data,
    alerts,
    error: null,
    meta: { count: anomaliesResult.data.length, alertsCreated: alerts.length, limit },
  });
}
