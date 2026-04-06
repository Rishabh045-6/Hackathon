create extension if not exists "pgcrypto";

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.app_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.grid_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  voltage numeric(6,2) not null,
  current numeric(6,2) not null,
  frequency numeric(5,2) not null,
  load numeric(8,2) not null,
  power_factor numeric(4,2) not null default 0.95,
  source text not null default 'simulated',
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  predicted_load numeric(8,2) not null,
  confidence numeric(4,2) not null default 0.82,
  model_name text not null default 'baseline-simulator',
  input_window_minutes integer not null default 60,
  predicted_for timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.anomalies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reading_id uuid references public.grid_readings (id) on delete set null,
  anomaly_type text not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  metric text not null,
  observed_value numeric(10,2) not null,
  threshold_value numeric(10,2),
  description text not null,
  detected_at timestamptz not null default now(),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  anomaly_id uuid references public.anomalies (id) on delete set null,
  title text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  triggered_by text not null default 'rule-engine',
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  site_name text not null default 'GridSense AI',
  refresh_interval_seconds integer not null default 30,
  alert_voltage_min numeric(6,2) not null default 210,
  alert_voltage_max numeric(6,2) not null default 250,
  alert_frequency_min numeric(5,2) not null default 49.5,
  alert_frequency_max numeric(5,2) not null default 50.5,
  alert_load_max numeric(8,2) not null default 95,
  simulation_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_grid_readings_user_recorded_at
  on public.grid_readings (user_id, recorded_at desc);

create index if not exists idx_predictions_user_predicted_for
  on public.predictions (user_id, predicted_for desc);

create index if not exists idx_anomalies_user_detected_at
  on public.anomalies (user_id, detected_at desc);

create index if not exists idx_alerts_user_created_at
  on public.alerts (user_id, created_at desc);

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_settings_updated_at on public.app_settings;
create trigger set_app_settings_updated_at
before update on public.app_settings
for each row execute procedure public.set_updated_at();
