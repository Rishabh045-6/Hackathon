export type ExplanationSeverity = "low" | "medium" | "high";

export type ClassifierExplanation = {
  summary: string;
  likelyCause: string;
  severity: ExplanationSeverity;
  recommendedAction: string;
};

export type OperationalExplanation = {
  summary: string;
  what_is_happening: string;
  likely_cause: string;
  severity_reason: string;
  recommended_action: string;
  operator_note: string;
  severity: ExplanationSeverity;
  source: "llm" | "fallback";
  fallback_reason?: string;
};

export type ExplanationRequestPayload = {
  predicted_label: number;
  predicted_class: string;
  confidence: number;
  top_k: Array<{
    predicted_class: string;
    predicted_label: number;
    confidence: number;
  }>;
  severity: ExplanationSeverity;
  source_class?: string | null;
  source_row?: number | null;
  is_correct?: boolean | null;
};

const EXPLANATIONS: Record<number, ClassifierExplanation> = {
  0: {
    summary: "The waveform looks nominal and close to a healthy sinusoidal operating condition.",
    likelyCause: "No significant disturbance pattern is present in the current signal window.",
    severity: "low",
    recommendedAction: "Continue monitoring and store this waveform as a healthy reference sample.",
  },
  1: {
    summary: "A voltage sag pattern is present, showing a temporary drop in waveform magnitude.",
    likelyCause: "Motor starts, feeder overload, or upstream faults commonly trigger this behavior.",
    severity: "medium",
    recommendedAction: "Inspect feeder loading, fault logs, and any large equipment starts around the event.",
  },
  2: {
    summary: "A voltage swell pattern is present, indicating a temporary rise above normal amplitude.",
    likelyCause: "Capacitor switching, regulation issues, or source-side instability may be causing the increase.",
    severity: "medium",
    recommendedAction: "Review voltage regulation settings, capacitor bank activity, and recent switching operations.",
  },
  3: {
    summary: "The signal indicates a clear interruption, with loss of usable voltage over the sample window.",
    likelyCause: "Breaker trips, feeder faults, or source loss are the most likely drivers.",
    severity: "high",
    recommendedAction: "Investigate outage events immediately and verify protection coordination and feeder health.",
  },
  4: {
    summary: "The waveform contains a transient disturbance with a sharp short-duration deviation.",
    likelyCause: "Switching events, surge activity, or lightning-related disturbances are likely causes.",
    severity: "high",
    recommendedAction: "Check surge protection, switching logs, and transient suppression equipment.",
  },
  5: {
    summary: "The waveform suggests an oscillatory transient superimposed on the base signal.",
    likelyCause: "Capacitor switching or transformer energization can produce this damped oscillation pattern.",
    severity: "medium",
    recommendedAction: "Inspect recent switching operations and damping behavior in connected equipment.",
  },
  6: {
    summary: "The signal contains harmonic distortion beyond a clean sinusoidal profile.",
    likelyCause: "Non-linear loads such as drives, converters, or power electronics are likely contributors.",
    severity: "medium",
    recommendedAction: "Review harmonic-producing loads and verify filter or compensation performance.",
  },
  7: {
    summary: "The waveform combines harmonic distortion with a sag event.",
    likelyCause: "A weak source condition alongside non-linear loading is likely affecting the feeder.",
    severity: "high",
    recommendedAction: "Prioritize both voltage support checks and harmonic mitigation on the affected circuit.",
  },
  8: {
    summary: "The waveform combines harmonic distortion with a swell event.",
    likelyCause: "Overvoltage conditions interacting with harmonic-rich loads are likely present.",
    severity: "high",
    recommendedAction: "Review overvoltage sources, capacitor operation, and harmonic filter health together.",
  },
  9: {
    summary: "The signal shows flicker behavior with visible modulation in waveform magnitude.",
    likelyCause: "Rapidly varying industrial loads or unstable demand swings often create this effect.",
    severity: "medium",
    recommendedAction: "Inspect fluctuating loads and correlate the event with known variable-demand equipment.",
  },
  10: {
    summary: "The waveform shows flicker combined with an underlying sag pattern.",
    likelyCause: "Unstable heavy loads or repeated voltage drops under changing demand may be responsible.",
    severity: "high",
    recommendedAction: "Check feeder voltage support and isolate the fluctuating load source causing the disturbance.",
  },
  11: {
    summary: "The waveform shows flicker combined with a swell condition.",
    likelyCause: "Regulation overshoot or unstable compensating equipment may be interacting with varying load demand.",
    severity: "high",
    recommendedAction: "Inspect regulator response, capacitor behavior, and fluctuating upstream conditions.",
  },
  12: {
    summary: "The signal combines a sag event with an oscillatory transient component.",
    likelyCause: "A disturbance plus switching-related oscillation is affecting voltage quality at the same time.",
    severity: "high",
    recommendedAction: "Review the triggering event, source weakness, and switching sequence around the fault window.",
  },
  13: {
    summary: "The signal combines a swell event with an oscillatory transient component.",
    likelyCause: "A switching or regulation event is likely causing both overvoltage and oscillation together.",
    severity: "high",
    recommendedAction: "Check switching devices, regulation equipment, and overvoltage protection immediately.",
  },
  14: {
    summary: "The waveform indicates sag behavior together with harmonic distortion.",
    likelyCause: "Source weakness and harmonic-rich industrial loading are likely occurring together.",
    severity: "high",
    recommendedAction: "Investigate supply stability and non-linear load contribution on the same feeder segment.",
  },
  15: {
    summary: "The waveform indicates swell behavior together with harmonic distortion.",
    likelyCause: "Overvoltage conditions are likely interacting with power-electronic or converter-driven loads.",
    severity: "high",
    recommendedAction: "Review capacitor banks, voltage regulation, and harmonic mitigation equipment together.",
  },
  16: {
    summary: "The waveform shows notch-like distortion, typically around waveform commutation intervals.",
    likelyCause: "Converter commutation and power-electronic switching are the most likely causes.",
    severity: "medium",
    recommendedAction: "Inspect converter behavior, commutation overlap, and distortion near zero-crossing intervals.",
  },
};

export function getClassifierExplanation(predictedLabel: number): ClassifierExplanation {
  return (
    EXPLANATIONS[predictedLabel] ?? {
      summary: "The waveform has been classified, but no detailed explanation mapping was found.",
      likelyCause: "The exact cause needs manual review against operating conditions and event logs.",
      severity: "medium",
      recommendedAction: "Review the waveform, the top predictions, and recent system events before taking action.",
    }
  );
}

export function buildFallbackOperationalExplanation(
  payload: ExplanationRequestPayload,
  fallbackReason?: string,
): OperationalExplanation {
  const local = getClassifierExplanation(payload.predicted_label);
  const topAlternative = payload.top_k.find(
    (item) => item.predicted_label !== payload.predicted_label,
  );
  const confidencePercent = (payload.confidence * 100).toFixed(2);
  const correctnessNote =
    payload.is_correct === null || payload.is_correct === undefined
      ? "Ground-truth validation is not available for this run."
      : payload.is_correct
        ? "This prediction matches the source waveform class for the current simulation run."
        : "This prediction does not match the source waveform class for the current simulation run.";

  const isNormal = payload.predicted_label === 0;

  return {
    summary: isNormal
      ? `System looks normal right now at ${confidencePercent}% confidence.`
      : `${payload.predicted_class} detected at ${confidencePercent}% confidence.`,
    what_is_happening: isNormal
      ? "The current waveform appears nominal, stable, and close to a healthy sinusoidal operating condition."
      : local.summary,
    likely_cause: isNormal
      ? "No meaningful disturbance pattern is present in the current signal window."
      : local.likelyCause,
    severity_reason: isNormal
      ? "This run is treated as low severity because the classifier indicates a normal operating condition."
      : `This run is treated as ${payload.severity} severity based on the classified disturbance type and confidence profile.`,
    recommended_action: isNormal
      ? "No immediate action is required. Continue monitoring and keep this waveform as a normal operating reference."
      : local.recommendedAction,
    operator_note: topAlternative
      ? `${correctnessNote} The nearest alternative was ${topAlternative.predicted_class} at ${(topAlternative.confidence * 100).toFixed(2)}% confidence.`
      : correctnessNote,
    severity: payload.severity,
    source: "fallback",
    fallback_reason: fallbackReason,
  };
}
