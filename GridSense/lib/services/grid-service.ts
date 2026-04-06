import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Alert,
  AlertCandidate,
  Anomaly,
  AppSettings,
  GridReading,
  GridStatus,
  Prediction,
  PredictionLog,
  PredictionLogInsert,
  ReadingSource,
  ServiceResult,
  SimulatedReadingInput,
} from "@/types/grid";

const DEFAULT_LIMIT = 24;

type NumericReadingRow = Omit<
  GridReading,
  "voltage" | "current" | "frequency" | "load" | "power_factor"
> & {
  voltage: number | string;
  current: number | string;
  frequency: number | string;
  load: number | string;
  power_factor: number | string;
};

type NumericPredictionRow = Omit<Prediction, "predicted_load" | "confidence"> & {
  predicted_load: number | string;
  confidence: number | string;
};

type NumericPredictionLogRow = Omit<PredictionLog, "confidence"> & {
  confidence: number | string;
};

type NumericAnomalyRow = Omit<Anomaly, "observed_value" | "threshold_value"> & {
  observed_value: number | string;
  threshold_value: number | string | null;
};

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }

  return Number(value ?? 0);
}

function mapReading(row: NumericReadingRow): GridReading {
  return {
    ...row,
    voltage: toNumber(row.voltage),
    current: toNumber(row.current),
    frequency: toNumber(row.frequency),
    load: toNumber(row.load),
    power_factor: toNumber(row.power_factor),
  };
}

function mapPrediction(row: NumericPredictionRow): Prediction {
  return {
    ...row,
    predicted_load: toNumber(row.predicted_load),
    confidence: toNumber(row.confidence),
  };
}

function mapPredictionLog(row: NumericPredictionLogRow): PredictionLog {
  return {
    ...row,
    confidence: toNumber(row.confidence),
    predicted_label: Number(row.predicted_label),
    sample_index: row.sample_index === null ? null : Number(row.sample_index),
    signal_length: Number(row.signal_length),
    signal_preview: Array.isArray(row.signal_preview)
      ? row.signal_preview.map((value) => Number(value))
      : null,
    top_k: Array.isArray(row.top_k)
      ? row.top_k.map((item) => ({
          predicted_class: String(item.predicted_class),
          predicted_label: Number(item.predicted_label),
          confidence: toNumber(item.confidence),
        }))
      : [],
  };
}

function mapAnomaly(row: NumericAnomalyRow): Anomaly {
  return {
    ...row,
    observed_value: toNumber(row.observed_value),
    threshold_value: row.threshold_value === null ? null : toNumber(row.threshold_value),
  };
}

function getGridStatus(reading: GridReading, settings: AppSettings): GridStatus {
  if (
    reading.load >= settings.alert_load_max ||
    reading.frequency < settings.alert_frequency_min ||
    reading.frequency > settings.alert_frequency_max
  ) {
    return "critical";
  }

  if (
    reading.voltage < settings.alert_voltage_min ||
    reading.voltage > settings.alert_voltage_max
  ) {
    return "warning";
  }

  return "stable";
}

function buildSimulatedReading(input?: SimulatedReadingInput): Omit<GridReading, "id" | "created_at"> {
  const load = input?.load ?? Number((55 + Math.random() * 45).toFixed(2));
  const voltage = input?.voltage ?? Number((225 + Math.random() * 20).toFixed(2));
  const current = input?.current ?? Number((9 + load / 8 + Math.random() * 2).toFixed(2));
  const frequency = input?.frequency ?? Number((49.7 + Math.random() * 0.7).toFixed(2));
  const powerFactor = input?.power_factor ?? Number((0.9 + Math.random() * 0.09).toFixed(2));

  return {
    user_id: "",
    voltage,
    current,
    frequency,
    load,
    power_factor: powerFactor,
    source: (input?.source ?? "simulated") as ReadingSource,
    recorded_at: input?.recorded_at ?? new Date().toISOString(),
  };
}

function predictLoad(readings: GridReading[]): { predictedLoad: number; confidence: number } {
  if (readings.length === 0) {
    return { predictedLoad: 60, confidence: 0.72 };
  }

  const recent = readings.slice(0, 6);
  const averageLoad =
    recent.reduce((sum, reading) => sum + reading.load, 0) / recent.length;
  const trend =
    recent.length > 1 ? (recent[0].load - recent[recent.length - 1].load) / recent.length : 0;
  const predictedLoad = Number(Math.max(0, averageLoad + trend * 2).toFixed(2));
  const confidence = Number(Math.min(0.95, 0.72 + recent.length * 0.03).toFixed(2));

  return { predictedLoad, confidence };
}

function detectAnomalies(readings: GridReading[], settings: AppSettings): Omit<Anomaly, "id" | "created_at">[] {
  return readings.flatMap((reading) => {
    const anomalies: Omit<Anomaly, "id" | "created_at">[] = [];

    if (reading.voltage < settings.alert_voltage_min || reading.voltage > settings.alert_voltage_max) {
      anomalies.push({
        user_id: reading.user_id,
        reading_id: reading.id,
        anomaly_type: "threshold-breach",
        severity: "medium",
        metric: "voltage",
        observed_value: reading.voltage,
        threshold_value:
          reading.voltage < settings.alert_voltage_min
            ? settings.alert_voltage_min
            : settings.alert_voltage_max,
        description: "Voltage moved outside configured range.",
        detected_at: new Date().toISOString(),
        resolved: false,
      });
    }

    if (
      reading.frequency < settings.alert_frequency_min ||
      reading.frequency > settings.alert_frequency_max
    ) {
      anomalies.push({
        user_id: reading.user_id,
        reading_id: reading.id,
        anomaly_type: "frequency-drift",
        severity: "high",
        metric: "frequency",
        observed_value: reading.frequency,
        threshold_value:
          reading.frequency < settings.alert_frequency_min
            ? settings.alert_frequency_min
            : settings.alert_frequency_max,
        description: "Frequency drift detected beyond safe band.",
        detected_at: new Date().toISOString(),
        resolved: false,
      });
    }

    if (reading.load >= settings.alert_load_max) {
      anomalies.push({
        user_id: reading.user_id,
        reading_id: reading.id,
        anomaly_type: "load-spike",
        severity: "high",
        metric: "load",
        observed_value: reading.load,
        threshold_value: settings.alert_load_max,
        description: "Load exceeded configured maximum.",
        detected_at: new Date().toISOString(),
        resolved: false,
      });
    }

    return anomalies;
  });
}

function buildAlertCandidates(anomalies: Anomaly[]): AlertCandidate[] {
  return anomalies.map((anomaly) => ({
    title:
      anomaly.metric === "load"
        ? "High Load Alert"
        : anomaly.metric === "frequency"
          ? "Frequency Drift Alert"
          : "Voltage Alert",
    message: anomaly.description,
    priority: anomaly.severity,
    anomaly_id: anomaly.id,
    triggered_by: "rule-engine",
  }));
}

async function getCurrentUserId(supabase: SupabaseClient): Promise<ServiceResult<string>> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { data: "", error: error?.message ?? "User not authenticated." };
  }

  return { data: user.id, error: null };
}

export async function getLatestReadings(
  supabase: SupabaseClient,
  limit = DEFAULT_LIMIT,
): Promise<ServiceResult<GridReading[]>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: [], error: userResult.error };
  }

  const { data, error } = await supabase
    .from("grid_readings")
    .select("*")
    .eq("user_id", userResult.data)
    .order("recorded_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { data: [], error: error.message };
  }

  return {
    data: ((data ?? []) as NumericReadingRow[]).map(mapReading),
    error: null,
  };
}

export async function createSimulatedReadings(
  supabase: SupabaseClient,
  count = 12,
  inputs: SimulatedReadingInput[] = [],
): Promise<ServiceResult<GridReading[]>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: [], error: userResult.error };
  }

  const rows = Array.from({ length: count }, (_, index) => {
    const base = buildSimulatedReading(inputs[index]);
    return {
      ...base,
      user_id: userResult.data,
      recorded_at:
        inputs[index]?.recorded_at ??
        new Date(Date.now() - (count - index - 1) * 5 * 60 * 1000).toISOString(),
    };
  });

  const { data, error } = await supabase
    .from("grid_readings")
    .insert(rows)
    .select("*")
    .order("recorded_at", { ascending: false });

  if (error) {
    return { data: [], error: error.message };
  }

  return {
    data: ((data ?? []) as NumericReadingRow[]).map(mapReading),
    error: null,
  };
}

export async function getPredictions(
  supabase: SupabaseClient,
  limit = 12,
): Promise<ServiceResult<Prediction[]>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: [], error: userResult.error };
  }

  const { data, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("user_id", userResult.data)
    .order("predicted_for", { ascending: true })
    .limit(limit);

  if (!error && data && data.length > 0) {
    return {
      data: (data as NumericPredictionRow[]).map(mapPrediction),
      error: null,
    };
  }

  const readingsResult = await getLatestReadings(supabase, 12);

  if (readingsResult.error) {
    return { data: [], error: readingsResult.error };
  }

  const base = predictLoad(readingsResult.data);
  const predictionRows = Array.from({ length: 4 }, (_, index) => ({
    user_id: userResult.data,
    predicted_load: Number((base.predictedLoad + index * 4.5).toFixed(2)),
    confidence: Number(Math.max(0.68, base.confidence - index * 0.03).toFixed(2)),
    model_name: "baseline-simulator",
    input_window_minutes: 60,
    predicted_for: new Date(Date.now() + (index + 1) * 15 * 60 * 1000).toISOString(),
  }));

  const insertResult = await supabase.from("predictions").insert(predictionRows).select("*");

  if (insertResult.error) {
    return { data: [], error: insertResult.error.message };
  }

  return {
    data: ((insertResult.data ?? []) as NumericPredictionRow[]).map(mapPrediction),
    error: null,
  };
}

export async function getPredictionLogs(
  supabase: SupabaseClient,
  limit = DEFAULT_LIMIT,
): Promise<ServiceResult<PredictionLog[]>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: [], error: userResult.error };
  }

  const { data, error } = await supabase
    .from("prediction_logs")
    .select("*")
    .eq("user_id", userResult.data)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { data: [], error: error.message };
  }

  return {
    data: ((data ?? []) as NumericPredictionLogRow[]).map(mapPredictionLog),
    error: null,
  };
}

export async function createPredictionLog(
  supabase: SupabaseClient,
  input: PredictionLogInsert,
): Promise<ServiceResult<PredictionLog | null>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: null, error: userResult.error };
  }

  const { data, error } = await supabase
    .from("prediction_logs")
    .insert({
      user_id: userResult.data,
      predicted_class: input.predicted_class,
      predicted_label: input.predicted_label,
      confidence: input.confidence,
      source_class: input.source_class ?? null,
      sample_index: input.sample_index ?? null,
      signal_preview: input.signal_preview ?? null,
      signal_length: input.signal_length,
      explanation_summary: input.explanation_summary ?? null,
      model_name: input.model_name,
      source_identifier: input.source_identifier ?? null,
      top_k: input.top_k,
    })
    .select("*")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return {
    data: mapPredictionLog(data as NumericPredictionLogRow),
    error: null,
  };
}

export async function getAnomalies(
  supabase: SupabaseClient,
  limit = DEFAULT_LIMIT,
): Promise<ServiceResult<Anomaly[]>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: [], error: userResult.error };
  }

  const { data, error } = await supabase
    .from("anomalies")
    .select("*")
    .eq("user_id", userResult.data)
    .order("detected_at", { ascending: false })
    .limit(limit);

  if (!error && data && data.length > 0) {
    return {
      data: (data as NumericAnomalyRow[]).map(mapAnomaly),
      error: null,
    };
  }

  const settingsResult = await supabase
    .from("app_settings")
    .select("*")
    .eq("user_id", userResult.data)
    .single();

  if (settingsResult.error) {
    return { data: [], error: settingsResult.error.message };
  }

  const readingsResult = await getLatestReadings(supabase, 12);

  if (readingsResult.error) {
    return { data: [], error: readingsResult.error };
  }

  const anomalyRows = detectAnomalies(readingsResult.data, settingsResult.data as AppSettings);

  if (anomalyRows.length === 0) {
    return { data: [], error: null };
  }

  const insertResult = await supabase.from("anomalies").insert(anomalyRows).select("*");

  if (insertResult.error) {
    return { data: [], error: insertResult.error.message };
  }

  return {
    data: ((insertResult.data ?? []) as NumericAnomalyRow[]).map(mapAnomaly),
    error: null,
  };
}

export async function createAlertsFromReadings(
  supabase: SupabaseClient,
  readings?: GridReading[],
): Promise<ServiceResult<Alert[]>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: [], error: userResult.error };
  }

  const { data: settings, error: settingsError } = await supabase
    .from("app_settings")
    .select("*")
    .eq("user_id", userResult.data)
    .single();

  if (settingsError) {
    return { data: [], error: settingsError.message };
  }

  const sourceReadings = readings ?? (await getLatestReadings(supabase, 6)).data;
  const statusRank: Record<GridStatus, number> = { stable: 0, warning: 1, critical: 2 };
  const filteredReadings = sourceReadings.filter(
    (reading) => statusRank[getGridStatus(reading, settings as AppSettings)] > 0,
  );

  const anomaliesResult = await getAnomalies(supabase, Math.max(filteredReadings.length, 6));

  if (anomaliesResult.error) {
    return { data: [], error: anomaliesResult.error };
  }

  const candidates = buildAlertCandidates(anomaliesResult.data);

  if (candidates.length === 0) {
    return { data: [], error: null };
  }

  const anomalyIds = candidates
    .map((candidate) => candidate.anomaly_id)
    .filter((value): value is string => Boolean(value));

  if (anomalyIds.length > 0) {
    const existingAlertsResult = await supabase
      .from("alerts")
      .select("anomaly_id")
      .eq("user_id", userResult.data)
      .in("anomaly_id", anomalyIds);

    if (existingAlertsResult.error) {
      return { data: [], error: existingAlertsResult.error.message };
    }

    const existingIds = new Set(
      (existingAlertsResult.data ?? [])
        .map((row) => row.anomaly_id)
        .filter((value): value is string => Boolean(value)),
    );

    const filteredCandidates = candidates.filter(
      (candidate) => !candidate.anomaly_id || !existingIds.has(candidate.anomaly_id),
    );

    if (filteredCandidates.length === 0) {
      return { data: [], error: null };
    }

    const rows = filteredCandidates.map((candidate) => ({
      user_id: userResult.data,
      anomaly_id: candidate.anomaly_id,
      title: candidate.title,
      message: candidate.message,
      status: "open" as const,
      priority: candidate.priority,
      triggered_by: candidate.triggered_by,
    }));

    const { data, error } = await supabase.from("alerts").insert(rows).select("*");

    if (error) {
      return { data: [], error: error.message };
    }

    return {
      data: (data ?? []) as Alert[],
      error: null,
    };
  }

  const rows = candidates.map((candidate) => ({
    user_id: userResult.data,
    anomaly_id: candidate.anomaly_id,
    title: candidate.title,
    message: candidate.message,
    status: "open" as const,
    priority: candidate.priority,
    triggered_by: candidate.triggered_by,
  }));

  const { data, error } = await supabase.from("alerts").insert(rows).select("*");

  if (error) {
    return { data: [], error: error.message };
  }

  return {
    data: (data ?? []) as Alert[],
    error: null,
  };
}
