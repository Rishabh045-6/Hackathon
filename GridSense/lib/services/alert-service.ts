import type { SupabaseClient } from "@supabase/supabase-js";
import type { Alert, AlertStatus, ServiceResult, Severity } from "@/types/grid";

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

export async function getAlerts(
  supabase: SupabaseClient,
  limit = 20,
): Promise<ServiceResult<Alert[]>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: [], error: userResult.error };
  }

  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("user_id", userResult.data)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data ?? []) as Alert[], error: null };
}

export async function updateAlertStatus(
  supabase: SupabaseClient,
  alertId: string,
  status: AlertStatus,
): Promise<ServiceResult<Alert | null>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: null, error: userResult.error };
  }

  const { data, error } = await supabase
    .from("alerts")
    .update({ status })
    .eq("id", alertId)
    .eq("user_id", userResult.data)
    .select("*")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Alert, error: null };
}

export async function createAlertRecord(
  supabase: SupabaseClient,
  input: {
    title: string;
    message: string;
    priority: Severity;
    triggered_by: string;
    anomaly_id?: string | null;
  },
): Promise<ServiceResult<Alert | null>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: null, error: userResult.error };
  }

  const dedupeSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const existingResult = await supabase
    .from("alerts")
    .select("*")
    .eq("user_id", userResult.data)
    .eq("title", input.title)
    .eq("triggered_by", input.triggered_by)
    .neq("status", "resolved")
    .gte("created_at", dedupeSince)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingResult.error) {
    return { data: null, error: existingResult.error.message };
  }

  if (existingResult.data) {
    return { data: existingResult.data as Alert, error: null };
  }

  const { data, error } = await supabase
    .from("alerts")
    .insert({
      user_id: userResult.data,
      anomaly_id: input.anomaly_id ?? null,
      title: input.title,
      message: input.message,
      status: "open",
      priority: input.priority,
      triggered_by: input.triggered_by,
    })
    .select("*")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as Alert, error: null };
}
