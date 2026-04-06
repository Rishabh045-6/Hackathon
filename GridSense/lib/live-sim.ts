import { getClassifierExplanation } from "@/lib/classifier-explanations";
import type { Alert, Anomaly, GridReading, Prediction, Severity } from "@/types/grid";

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function jitter(amount: number) {
  return (Math.random() - 0.5) * amount;
}

function isoAtOffset(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialReading(index: number, total: number, prefix: string): GridReading {
  const phase = index / Math.max(total - 1, 1);
  return {
    id: `${prefix}-reading-${index}-${Date.now()}`,
    user_id: "simulated-user",
    voltage: Number((230 + Math.sin(phase * Math.PI * 1.4) * 5).toFixed(2)),
    current: Number((16 + Math.cos(phase * Math.PI * 1.2) * 2.5).toFixed(2)),
    frequency: Number((50 + Math.sin(phase * Math.PI * 0.9) * 0.06).toFixed(2)),
    load: Number((62 + Math.sin(phase * Math.PI * 1.6) * 8).toFixed(2)),
    power_factor: Number((0.96 - Math.cos(phase * Math.PI) * 0.02).toFixed(3)),
    source: "simulated",
    recorded_at: isoAtOffset((index - total + 1) * 2000),
    created_at: isoAtOffset((index - total + 1) * 2000),
  };
}

export function createInitialReadings(total: number, prefix: string) {
  return Array.from({ length: total }, (_, index) => createInitialReading(index, total, prefix));
}

export function stepReading(base: GridReading, prefix: string): GridReading {
  const phase = Date.now() / 4000;
  const voltage = clamp(base.voltage + Math.sin(phase) * 2.8 + jitter(1.4), 214, 252);
  const current = clamp(base.current + Math.cos(phase * 1.1) * 1.7 + jitter(0.8), 8, 34);
  const frequency = clamp(base.frequency + Math.sin(phase * 0.7) * 0.05 + jitter(0.015), 49.75, 50.25);
  const load = clamp(base.load + Math.sin(phase * 0.85) * 3.6 + jitter(1.5), 40, 110);
  const powerFactor = clamp(
    base.power_factor + Math.cos(phase * 0.6) * 0.015 + jitter(0.008),
    0.88,
    0.99,
  );

  return {
    ...base,
    id: `${prefix}-reading-${Date.now()}`,
    voltage: Number(voltage.toFixed(2)),
    current: Number(current.toFixed(2)),
    frequency: Number(frequency.toFixed(2)),
    load: Number(load.toFixed(2)),
    power_factor: Number(powerFactor.toFixed(3)),
    source: "simulated",
    recorded_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

export function createPredictionFromReading(reading: GridReading, prefix: string): Prediction {
  const predictedLoad = clamp(reading.load * 1.018 + Math.sin(Date.now() / 5000) * 1.25, 40, 120);
  return {
    id: `${prefix}-prediction-${Date.now()}`,
    user_id: "simulated-user",
    predicted_load: Number(predictedLoad.toFixed(2)),
    confidence: Number(clamp(0.89 + Math.random() * 0.08, 0.89, 0.97).toFixed(3)),
    model_name: "live-simulator",
    input_window_minutes: 20,
    predicted_for: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date().toISOString(),
  };
}

export function createInitialPredictions(readings: GridReading[], limit: number, prefix: string) {
  return readings.slice(-limit).map((reading) => createPredictionFromReading(reading, prefix));
}

export function createAnomaliesFromReading(reading: GridReading, prefix: string): Anomaly[] {
  const items: Anomaly[] = [];

  if (reading.voltage > 244 || reading.voltage < 218) {
    items.push({
      id: `${prefix}-anomaly-voltage-${uniqueSuffix()}`,
      user_id: "simulated-user",
      reading_id: reading.id,
      anomaly_type: reading.voltage > 244 ? "voltage_swell" : "voltage_sag",
      severity: reading.voltage > 246 || reading.voltage < 216 ? "high" : "medium",
      metric: "voltage",
      observed_value: reading.voltage,
      threshold_value: reading.voltage > 244 ? 244 : 218,
      description: "Live simulation detected voltage outside the preferred operating band.",
      detected_at: new Date().toISOString(),
      resolved: false,
      created_at: new Date().toISOString(),
    });
  }

  if (reading.load > 95) {
    items.push({
      id: `${prefix}-anomaly-load-${uniqueSuffix()}`,
      user_id: "simulated-user",
      reading_id: reading.id,
      anomaly_type: "high_load",
      severity: reading.load > 102 ? "high" : "medium",
      metric: "load",
      observed_value: reading.load,
      threshold_value: 95,
      description: "Live simulation detected sustained high feeder load.",
      detected_at: new Date().toISOString(),
      resolved: false,
      created_at: new Date().toISOString(),
    });
  }

  if (Math.random() < 0.12) {
    items.push({
      id: `${prefix}-anomaly-frequency-${uniqueSuffix()}`,
      user_id: "simulated-user",
      reading_id: reading.id,
      anomaly_type: "frequency_drift",
      severity: "low",
      metric: "frequency",
      observed_value: reading.frequency,
      threshold_value: 50,
      description: "Live simulation introduced a minor frequency drift event.",
      detected_at: new Date().toISOString(),
      resolved: false,
      created_at: new Date().toISOString(),
    });
  }

  return items;
}

export function createInitialAnomalies(readings: GridReading[], limit: number, prefix: string) {
  return readings.flatMap((reading) => createAnomaliesFromReading(reading, prefix)).slice(-limit);
}

export function getAlertPriorityFromReading(reading: GridReading): Severity | null {
  if (reading.load > 102 || reading.voltage < 216 || reading.voltage > 246) return "high";
  if (reading.load > 95 || reading.voltage < 218 || reading.voltage > 244) return "medium";
  if (Math.random() < 0.2) return "low";
  return null;
}

export function createCriticalAlertFromReading(reading: GridReading, prefix: string): Alert | null {
  if (reading.load > 102) {
    return {
      id: `${prefix}-high-load-${uniqueSuffix()}`,
      user_id: "simulated-user",
      anomaly_id: null,
      title: "Critical Load Alert",
      message: `Feeder load is critically high at ${reading.load.toFixed(2)} kW.`,
      status: "open",
      priority: "high",
      triggered_by: prefix,
      created_at: new Date().toISOString(),
    };
  }

  if (reading.voltage < 216) {
    return {
      id: `${prefix}-voltage-sag-${uniqueSuffix()}`,
      user_id: "simulated-user",
      anomaly_id: null,
      title: "Critical Voltage Sag",
      message: `Voltage dropped to ${reading.voltage.toFixed(2)} V, below the critical operating band.`,
      status: "open",
      priority: "high",
      triggered_by: prefix,
      created_at: new Date().toISOString(),
    };
  }

  if (reading.voltage > 246) {
    return {
      id: `${prefix}-voltage-swell-${uniqueSuffix()}`,
      user_id: "simulated-user",
      anomaly_id: null,
      title: "Critical Voltage Swell",
      message: `Voltage rose to ${reading.voltage.toFixed(2)} V, above the critical operating band.`,
      status: "open",
      priority: "high",
      triggered_by: prefix,
      created_at: new Date().toISOString(),
    };
  }

  return null;
}

export function createCriticalDisturbanceAlert(
  predictedLabel: number,
  predictedClass: string,
  prefix: string,
): Alert | null {
  const explanation = getClassifierExplanation(predictedLabel);
  if (explanation.severity !== "high") {
    return null;
  }

  return {
    id: `${prefix}-disturbance-${predictedLabel}-${uniqueSuffix()}`,
    user_id: "simulated-user",
    anomaly_id: null,
    title: `Critical Disturbance: ${predictedClass}`,
    message: `AI classified a high-severity ${predictedClass} disturbance. ${explanation.recommendedAction}`,
    status: "open",
    priority: "high",
    triggered_by: prefix,
    created_at: new Date().toISOString(),
  };
}

export function createAlert(priority: Severity, prefix: string, titlePrefix = "live grid event"): Alert {
  return {
    id: `${prefix}-alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user_id: "simulated-user",
    anomaly_id: null,
    title: `${priority[0].toUpperCase()}${priority.slice(1)} ${titlePrefix}`,
    message: `Live simulation flagged ${priority} priority conditions at ${new Date().toLocaleTimeString()}.`,
    status: "open",
    priority,
    triggered_by: prefix,
    created_at: new Date().toISOString(),
  };
}

export function createInitialAlerts(readings: GridReading[], limit: number, prefix: string, titlePrefix = "live grid event") {
  const alerts = readings
    .map((reading) => getAlertPriorityFromReading(reading))
    .filter((priority): priority is Severity => priority !== null)
    .map((priority) => createAlert(priority, prefix, titlePrefix));

  return alerts.slice(-limit);
}
