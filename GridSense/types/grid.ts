export type AlertStatus = "open" | "acknowledged" | "resolved";

export type Severity = "low" | "medium" | "high";

export type ModelMode = "simulated" | "rule-based" | "ml-ready";

export type GridStatus = "stable" | "warning" | "critical";

export type ReadingSource = "seed" | "simulated" | "manual" | "ingested";
export type LiveStreamPhase = "normal" | "disturbance";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
}

export interface GridReading {
  id: string;
  user_id: string;
  voltage: number;
  current: number;
  frequency: number;
  load: number;
  power_factor: number;
  source: ReadingSource | string;
  recorded_at: string;
  created_at: string;
}

export interface Prediction {
  id: string;
  user_id: string;
  predicted_load: number;
  confidence: number;
  model_name: string;
  input_window_minutes: number;
  predicted_for: string;
  created_at: string;
}

export interface PredictionLogEntry {
  predicted_class: string;
  predicted_label: number;
  confidence: number;
}

export interface PredictionLog {
  id: string;
  user_id: string;
  predicted_class: string;
  predicted_label: number;
  confidence: number;
  source_class: string | null;
  sample_index: number | null;
  signal_preview: number[] | null;
  signal_length: number;
  explanation_summary: string | null;
  model_name: string;
  source_identifier: string | null;
  top_k: PredictionLogEntry[];
  created_at: string;
}

export interface LiveStreamState {
  id: string;
  stream_key: string;
  phase: LiveStreamPhase;
  class_name: string;
  sample_index: number;
  started_at: string;
  duration_ms: number;
  updated_at: string;
}

export interface Anomaly {
  id: string;
  user_id: string;
  reading_id: string | null;
  anomaly_type: string;
  severity: Severity;
  metric: string;
  observed_value: number;
  threshold_value: number | null;
  description: string;
  detected_at: string;
  resolved: boolean;
  created_at: string;
}

export interface Alert {
  id: string;
  user_id: string;
  anomaly_id: string | null;
  title: string;
  message: string;
  status: AlertStatus;
  priority: Severity;
  triggered_by: string;
  created_at: string;
}

export interface AppSettings {
  id: string;
  user_id: string;
  site_name: string;
  refresh_interval_seconds: number;
  alert_voltage_min: number;
  alert_voltage_max: number;
  alert_frequency_min: number;
  alert_frequency_max: number;
  alert_load_max: number;
  simulation_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceResult<T> {
  data: T;
  error: string | null;
}

export interface PredictionPoint {
  predicted_load: number;
  confidence: number;
  predicted_for: string;
  model_name: string;
}

export interface SimulatedReadingInput {
  voltage?: number;
  current?: number;
  frequency?: number;
  load?: number;
  power_factor?: number;
  source?: ReadingSource;
  recorded_at?: string;
}

export interface AlertCandidate {
  title: string;
  message: string;
  priority: Severity;
  anomaly_id: string | null;
  triggered_by: string;
}

export interface PredictionLogInsert {
  predicted_class: string;
  predicted_label: number;
  confidence: number;
  source_class?: string | null;
  sample_index?: number | null;
  signal_preview?: number[] | null;
  signal_length: number;
  explanation_summary?: string | null;
  model_name: string;
  source_identifier?: string | null;
  top_k: PredictionLogEntry[];
}
