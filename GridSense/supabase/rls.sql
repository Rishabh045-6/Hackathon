alter table public.profiles enable row level security;
alter table public.grid_readings enable row level security;
alter table public.predictions enable row level security;
alter table public.anomalies enable row level security;
alter table public.alerts enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "profiles self access" on public.profiles;
create policy "profiles self access"
on public.profiles
for all
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "grid readings authenticated read" on public.grid_readings;
create policy "grid readings authenticated read"
on public.grid_readings
for select
using (auth.role() = 'authenticated');

drop policy if exists "grid readings self write" on public.grid_readings;
create policy "grid readings self write"
on public.grid_readings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "predictions authenticated read" on public.predictions;
create policy "predictions authenticated read"
on public.predictions
for select
using (auth.role() = 'authenticated');

drop policy if exists "predictions self write" on public.predictions;
create policy "predictions self write"
on public.predictions
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "anomalies authenticated read" on public.anomalies;
create policy "anomalies authenticated read"
on public.anomalies
for select
using (auth.role() = 'authenticated');

drop policy if exists "anomalies self write" on public.anomalies;
create policy "anomalies self write"
on public.anomalies
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "alerts authenticated read" on public.alerts;
create policy "alerts authenticated read"
on public.alerts
for select
using (auth.role() = 'authenticated');

drop policy if exists "alerts self write" on public.alerts;
create policy "alerts self write"
on public.alerts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "settings authenticated read" on public.app_settings;
create policy "settings authenticated read"
on public.app_settings
for select
using (auth.role() = 'authenticated');

drop policy if exists "settings self write" on public.app_settings;
create policy "settings self write"
on public.app_settings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
