import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSimulatedReadings } from "@/lib/services/grid-service";
import type { SimulatedReadingInput } from "@/types/grid";

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = (await request.json().catch(() => ({}))) as {
    count?: number;
    readings?: SimulatedReadingInput[];
  };

  const count = Math.min(Math.max(body.count ?? body.readings?.length ?? 12, 1), 48);
  const result = await createSimulatedReadings(supabase, count, body.readings ?? []);

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
    meta: { count: result.data.length },
  });
}
