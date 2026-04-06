import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAvailableWaveformClasses,
  getWaveformDatasetMeta,
  getWaveformSample,
  NORMAL_WAVEFORM_CLASS,
} from "@/lib/waveform-dataset";
import type { LiveStreamPhase, LiveStreamState, ServiceResult } from "@/types/grid";

const GLOBAL_STREAM_KEY = "global";
const STREAM_DURATION_MS = 7_000;
type LiveStreamStateResult = ServiceResult<LiveStreamState | null>;
type LiveStreamResolution = LiveStreamStateResult & {
  meta?: {
    advanced: boolean;
    expired: boolean;
    expires_at: string | null;
  };
};

function normalizeLiveStreamState(row: Record<string, unknown>): LiveStreamState {
  return {
    id: String(row.id),
    stream_key: String(row.stream_key),
    phase: row.phase as LiveStreamPhase,
    class_name: String(row.class_name),
    sample_index: Number(row.sample_index),
    started_at: String(row.started_at),
    duration_ms: Number(row.duration_ms),
    updated_at: String(row.updated_at),
  };
}

function getNextPhase(current: LiveStreamState | null): LiveStreamPhase {
  if (!current) {
    return "normal";
  }

  return current.phase === "normal" ? "disturbance" : "normal";
}

async function chooseNextEvent(current: LiveStreamState | null) {
  const nextPhase = getNextPhase(current);
  const classes = await getAvailableWaveformClasses();
  const normalClass = classes.includes(NORMAL_WAVEFORM_CLASS)
    ? NORMAL_WAVEFORM_CLASS
    : (classes[0] ?? "");

  if (!normalClass) {
    throw new Error("No waveform classes were found in the dataset.");
  }

  const disturbanceClasses = classes.filter((className) => className !== normalClass);
  const className =
    nextPhase === "normal"
      ? normalClass
      : (disturbanceClasses[Math.floor(Math.random() * disturbanceClasses.length)] ?? normalClass);

  const sample = await getWaveformSample({ className, random: true });

  return {
    phase: nextPhase,
    class_name: className,
    sample_index: sample.sampleIndex,
    started_at: new Date().toISOString(),
    duration_ms: STREAM_DURATION_MS,
  };
}

export async function getLiveStreamState(
  supabase: SupabaseClient,
): Promise<LiveStreamStateResult> {
  const { data, error } = await supabase
    .from("live_stream_state")
    .select("*")
    .eq("stream_key", GLOBAL_STREAM_KEY)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }

  return {
    data: data ? normalizeLiveStreamState(data as Record<string, unknown>) : null,
    error: null,
  };
}

export async function ensureLiveStreamState(
  supabase: SupabaseClient,
): Promise<LiveStreamStateResult> {
  const existing = await getLiveStreamState(supabase);

  if (existing.error || existing.data) {
    return existing;
  }

  const classes = await getWaveformDatasetMeta();
  const normalClass = classes.classes.includes(NORMAL_WAVEFORM_CLASS)
    ? NORMAL_WAVEFORM_CLASS
    : (classes.classes[0] ?? "");

  if (!normalClass) {
    return { data: null, error: "No waveform classes were found in the dataset." };
  }

  const initialSample = await getWaveformSample({ className: normalClass, sampleIndex: 0 });
  const insertPayload = {
    stream_key: GLOBAL_STREAM_KEY,
    phase: "normal" as const,
    class_name: normalClass,
    sample_index: initialSample.sampleIndex,
    started_at: new Date().toISOString(),
    duration_ms: STREAM_DURATION_MS,
  };

  const { data, error } = await supabase
    .from("live_stream_state")
    .upsert(insertPayload, { onConflict: "stream_key" })
    .select("*")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return {
    data: normalizeLiveStreamState(data as Record<string, unknown>),
    error: null,
  };
}

export async function advanceLiveStreamState(
  supabase: SupabaseClient,
): Promise<LiveStreamStateResult> {
  const ensured = await ensureLiveStreamState(supabase);

  if (ensured.error) {
    return { data: null, error: ensured.error };
  }

  const nextEvent = await chooseNextEvent(ensured.data);
  console.info("[live-stream] advancing row", {
    current: ensured.data
      ? {
          phase: ensured.data.phase,
          class_name: ensured.data.class_name,
          sample_index: ensured.data.sample_index,
          started_at: ensured.data.started_at,
          duration_ms: ensured.data.duration_ms,
        }
      : null,
    next: nextEvent,
  });
  const { data, error } = await supabase
    .from("live_stream_state")
    .update(nextEvent)
    .eq("stream_key", GLOBAL_STREAM_KEY)
    .select("*")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return {
    data: normalizeLiveStreamState(data as Record<string, unknown>),
    error: null,
  };
}

export async function getOrAdvanceLiveStreamState(
  supabase: SupabaseClient,
): Promise<LiveStreamResolution> {
  const ensured = await ensureLiveStreamState(supabase);

  if (ensured.error || !ensured.data) {
    return {
      data: ensured.data,
      error: ensured.error,
      meta: { advanced: false, expired: false, expires_at: null },
    };
  }

  const expiresAtMs = new Date(ensured.data.started_at).getTime() + ensured.data.duration_ms;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const expired = Date.now() >= expiresAtMs;

  console.info("[live-stream] fetched current row", {
    phase: ensured.data.phase,
    class_name: ensured.data.class_name,
    sample_index: ensured.data.sample_index,
    started_at: ensured.data.started_at,
    duration_ms: ensured.data.duration_ms,
    expires_at: expiresAt,
    expired,
  });

  if (!expired) {
    return {
      data: ensured.data,
      error: null,
      meta: { advanced: false, expired: false, expires_at: expiresAt },
    };
  }

  const advanced = await advanceLiveStreamState(supabase);
  if (advanced.error || !advanced.data) {
    return {
      data: advanced.data,
      error: advanced.error,
      meta: { advanced: false, expired: true, expires_at: expiresAt },
    };
  }

  console.info("[live-stream] wrote new row", {
    phase: advanced.data.phase,
    class_name: advanced.data.class_name,
    sample_index: advanced.data.sample_index,
    started_at: advanced.data.started_at,
    duration_ms: advanced.data.duration_ms,
  });

  return {
    data: advanced.data,
    error: null,
    meta: {
      advanced: true,
      expired: true,
      expires_at: new Date(
        new Date(advanced.data.started_at).getTime() + advanced.data.duration_ms,
      ).toISOString(),
    },
  };
}
