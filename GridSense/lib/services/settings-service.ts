import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSettings, ServiceResult } from "@/types/grid";

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

export async function getSettings(
  supabase: SupabaseClient,
): Promise<ServiceResult<AppSettings | null>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: null, error: userResult.error };
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("user_id", userResult.data)
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as AppSettings, error: null };
}

export async function updateSettings(
  supabase: SupabaseClient,
  updates: Partial<
    Pick<
      AppSettings,
      | "site_name"
      | "refresh_interval_seconds"
      | "alert_voltage_min"
      | "alert_voltage_max"
      | "alert_frequency_min"
      | "alert_frequency_max"
      | "alert_load_max"
      | "simulation_enabled"
    >
  >,
): Promise<ServiceResult<AppSettings | null>> {
  const userResult = await getCurrentUserId(supabase);

  if (userResult.error) {
    return { data: null, error: userResult.error };
  }

  const { data, error } = await supabase
    .from("app_settings")
    .update(updates)
    .eq("user_id", userResult.data)
    .select("*")
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as AppSettings, error: null };
}
