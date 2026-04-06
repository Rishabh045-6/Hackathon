import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  advanceLiveStreamState,
  getOrAdvanceLiveStreamState,
} from "@/lib/services/live-stream-service";

function isAuthorized(request: Request) {
  const secret = process.env.LIVE_STREAM_ADMIN_SECRET;

  if (!secret) {
    throw new Error("Missing LIVE_STREAM_ADMIN_SECRET environment variable.");
  }

  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${secret}`;
}

export async function GET() {
  try {
    const current = await getOrAdvanceLiveStreamState(createAdminClient());

    if (current.error) {
      return NextResponse.json(
        { ok: false, data: null, error: current.error, meta: current.meta ?? null },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      data: current.data,
      error: null,
      meta: current.meta ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : "Failed to load live stream state.",
        meta: null,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { ok: false, data: null, error: "Unauthorized." },
        { status: 401 },
      );
    }

    const supabase = createAdminClient();
    const result = await advanceLiveStreamState(supabase);

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
      meta: { advanced: true, expired: false, expires_at: null },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : "Failed to advance live stream.",
        meta: null,
      },
      { status: 500 },
    );
  }
}
