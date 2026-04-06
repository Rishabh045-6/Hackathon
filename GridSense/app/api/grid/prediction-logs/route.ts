import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPredictionLogs } from "@/lib/services/grid-service";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const limitParam = Number(searchParams.get("limit") ?? 24);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 24;

  const result = await getPredictionLogs(supabase, limit);

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
