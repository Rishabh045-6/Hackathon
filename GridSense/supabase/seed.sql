with seed_user as (
  select
    id,
    email,
    coalesce(raw_user_meta_data ->> 'full_name', split_part(email, '@', 1)) as full_name
  from auth.users
  order by created_at asc
  limit 1
)
insert into public.profiles (id, email, full_name)
select id, email, full_name
from seed_user
on conflict (id) do update
set email = excluded.email,
    full_name = excluded.full_name;

with seed_user as (
  select id
  from auth.users
  order by created_at asc
  limit 1
)
insert into public.app_settings (
  user_id,
  site_name,
  refresh_interval_seconds,
  alert_voltage_min,
  alert_voltage_max,
  alert_frequency_min,
  alert_frequency_max,
  alert_load_max,
  simulation_enabled
)
select
  id,
  'GridSense AI',
  30,
  210,
  250,
  49.5,
  50.5,
  95,
  true
from seed_user
on conflict (user_id) do update
set refresh_interval_seconds = excluded.refresh_interval_seconds,
    alert_voltage_min = excluded.alert_voltage_min,
    alert_voltage_max = excluded.alert_voltage_max,
    alert_frequency_min = excluded.alert_frequency_min,
    alert_frequency_max = excluded.alert_frequency_max,
    alert_load_max = excluded.alert_load_max,
    simulation_enabled = excluded.simulation_enabled,
    updated_at = now();

with seed_user as (
  select id
  from auth.users
  order by created_at asc
  limit 1
)
insert into public.grid_readings (user_id, voltage, current, frequency, load, power_factor, source, recorded_at)
select id, 229.4, 12.3, 49.98, 62.5, 0.96, 'seed', now() - interval '20 minutes' from seed_user
union all
select id, 233.6, 15.2, 50.08, 77.1, 0.94, 'seed', now() - interval '10 minutes' from seed_user
union all
select id, 247.5, 18.1, 50.61, 97.8, 0.91, 'seed', now() from seed_user;

with seed_user as (
  select id
  from auth.users
  order by created_at asc
  limit 1
)
insert into public.predictions (user_id, predicted_load, confidence, model_name, input_window_minutes, predicted_for)
select id, 72.4, 0.84, 'baseline-simulator', 60, now() + interval '15 minutes' from seed_user
union all
select id, 79.6, 0.81, 'baseline-simulator', 60, now() + interval '30 minutes' from seed_user;

with seed_user as (
  select id
  from auth.users
  order by created_at asc
  limit 1
),
latest_reading as (
  select gr.id, gr.user_id, gr.load
  from public.grid_readings gr
  join seed_user su on su.id = gr.user_id
  order by gr.recorded_at desc
  limit 1
)
insert into public.anomalies (
  user_id,
  reading_id,
  anomaly_type,
  severity,
  metric,
  observed_value,
  threshold_value,
  description
)
select
  user_id,
  id,
  'threshold-breach',
  'high',
  'load',
  load,
  95,
  'Load exceeded configured safe threshold.'
from latest_reading
where load > 95;

with seed_user as (
  select id
  from auth.users
  order by created_at asc
  limit 1
)
insert into public.alerts (user_id, anomaly_id, title, message, status, priority, triggered_by)
select
  a.user_id,
  a.id,
  'High Load Alert',
  'Load is above the safe operating band. Review feeder balance.',
  'open',
  'high',
  'rule-engine'
from public.anomalies a
join seed_user su on su.id = a.user_id
where a.metric = 'load'
  and not exists (
    select 1
    from public.alerts al
    where al.anomaly_id = a.id
  );
