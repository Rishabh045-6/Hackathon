# GridSense AI

GridSense AI is a Next.js 15 application for smart-grid monitoring with:
- Live simulated telemetry (voltage, current, frequency, load, power factor)
- High-severity anomaly and alert surfacing
- Rule-based baseline forecasting
- Waveform disturbance classification via a Python + PyTorch CNN model
- Optional LLM-powered operational explanations with fallback logic
- Supabase-backed auth, storage, and row-level security

The UI is built with React 19 + Tailwind CSS + Recharts, and the backend is implemented with Next.js App Router API routes and Supabase.

## Table of Contents

1. Overview
2. Tech Stack
3. Project Structure
4. Core Features
5. Prerequisites
6. Environment Variables
7. Local Setup
8. Database Setup (Supabase)
9. Running the App
10. API Reference
11. Authentication and Route Protection
12. ML Classifier Pipeline
13. Explanation Pipeline (LLM + Fallback)
14. Common Workflows
15. Troubleshooting
16. Deployment Notes
17. Future Improvements

## Overview

GridSense AI provides an operator-facing dashboard for monitoring simulated power-quality conditions and operational events.

The app blends three layers:
- Monitoring: live UI widgets/charts for KPIs and trends.
- Detection: thresholds and anomaly/alert generation from telemetry.
- Intelligence: waveform classification + explanation support.

## Tech Stack

- Framework: Next.js 15 (App Router)
- Language: TypeScript
- UI: React 19, Tailwind CSS, Recharts
- Auth + DB: Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- ML Inference: Python script (`scripts/classify_signal.py`) using NumPy + PyTorch
- Optional LLM provider for explanations: Groq-compatible OpenAI endpoint

## Project Structure

```text
app/
  (auth)/login/page.tsx         # Sign in / sign up
  dashboard/page.tsx            # Live operational dashboard
  analytics/page.tsx            # Analytics + waveform classifier panels
  alerts/page.tsx               # Alert queue and status workflow
  logs/page.tsx                 # Persisted prediction logs
  api/
    alerts/route.ts             # GET alerts, PATCH alert status
    settings/route.ts           # GET/PATCH app settings
    grid/
      readings/route.ts         # GET latest readings
      simulate/route.ts         # POST generated readings
      anomalies/route.ts        # GET anomalies (+ optional alert creation)
      predict/route.ts          # GET predictions, POST waveform classification
      waveform/route.ts         # GET waveform classes/samples from dataset files
      explain/route.ts          # POST operational explanation
components/
  analytics/waveform-classifier-card.tsx
  charts/*
  dashboard/*
  layout/*
lib/
  live-sim.ts                   # Live simulation and synthetic events
  classifier-explanations.ts    # Disturbance mapping + fallback explanations
  services/
    grid-service.ts             # Readings, predictions, anomalies, logs, alert creation
    alert-service.ts
    settings-service.ts
  supabase/
    client.ts
    server.ts
    env.ts
scripts/
  classify_signal.py            # PyTorch CNN inference over 100-point waveforms
supabase/
  schema.sql                    # Tables, triggers, indexes
  rls.sql                       # Row-level security policies
  seed.sql                      # Optional seed data
middleware.ts                   # Auth-based route protection
```

## Core Features

- Live Dashboard
  - Simulated streaming of grid readings.
  - KPI cards and trend charts.
  - High-severity anomaly panel with duplicate suppression cooldown.
  - Critical alert panel (high priority only).

- Analytics
  - Multi-chart trend exploration (voltage/current/frequency/load/power factor).
  - Predicted vs actual load behavior.
  - Embedded waveform classifier simulation component.

- Alerts
  - Critical reading alerts and high-severity disturbance alerts.
  - Client-side status transitions: `open`, `acknowledged`, `resolved`.

- Prediction Logs
  - Persisted waveform predictions with confidence, top-k classes, and explanation summaries.

- Settings + Thresholding
  - Per-user thresholds and simulation flags via `app_settings`.

## Prerequisites

Install the following before running locally:

- Node.js 20+
- npm 10+
- A Supabase project
- Python 3.10+ (recommended) for waveform classifier endpoint
- Python packages used by `scripts/classify_signal.py`:
  - `numpy`
  - `torch`

## Environment Variables

Create a `.env` file in the project root with:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Optional: override Python binary used by /api/grid/predict
PYTHON_EXECUTABLE=python

# Optional: enable LLM explanations via /api/grid/explain
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile
```

Notes:
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are required at startup.
- If `GROQ_API_KEY` is missing or provider calls fail, explain API returns a deterministic fallback explanation.

## Local Setup

1. Install JavaScript dependencies:

```bash
npm install
```

2. Install Python dependencies for classifier inference:

```bash
pip install numpy torch
```

3. Configure environment variables in `.env` (see above).

4. Ensure ML artifacts and waveform dataset exist (see ML section below).

5. Run the app:

```bash
npm run dev
```

Then open:
- Home: `http://localhost:3000`
- Login: `http://localhost:3000/login`
- Dashboard: `http://localhost:3000/dashboard`

## Database Setup (Supabase)

Run SQL files in this order using Supabase SQL editor:

1. `supabase/schema.sql`
2. `supabase/rls.sql`
3. `supabase/seed.sql` (optional but useful for demo data)

What this sets up:
- Tables: `profiles`, `grid_readings`, `predictions`, `prediction_logs`, `anomalies`, `alerts`, `app_settings`
- Trigger for new auth users -> creates profile/settings rows
- Indexes for recent-query patterns
- RLS policies for per-user data isolation

## Running the App

Available scripts:

```bash
npm run dev
npm run build
npm run start
npm run lint
```

Typical local flow:
1. Start app with `npm run dev`.
2. Open `/login` and create/sign in with a Supabase user.
3. Navigate to `/dashboard`, `/analytics`, `/alerts`, `/logs`.

## API Reference

Base path: `/api`

### Alerts

- `GET /api/alerts?limit=20`
  - Returns recent alerts for authenticated user.
- `PATCH /api/alerts`
  - Body:
    ```json
    { "alertId": "uuid", "status": "open|acknowledged|resolved" }
    ```

### Settings

- `GET /api/settings`
- `PATCH /api/settings`
  - Body supports partial updates:
    - `site_name`
    - `refresh_interval_seconds`
    - `alert_voltage_min`, `alert_voltage_max`
    - `alert_frequency_min`, `alert_frequency_max`
    - `alert_load_max`
    - `simulation_enabled`

### Grid Readings and Events

- `GET /api/grid/readings?limit=24`
- `POST /api/grid/simulate`
  - Body:
    ```json
    { "count": 12, "readings": [] }
    ```
- `GET /api/grid/anomalies?limit=24&createAlerts=true`

### Forecast + Waveform Intelligence

- `GET /api/grid/predict?limit=12`
  - Returns persisted forecast rows from `predictions`.
- `POST /api/grid/predict`
  - Body must include exactly 100 numeric samples:
    ```json
    {
      "signal": [0.0, 0.1, -0.1],
      "source_class": "Pure_Sinusoidal",
      "sample_index": 42,
      "source_identifier": "waveform-simulation"
    }
    ```
  - Persists to `prediction_logs` only when confidence and class-gating rules pass.

- `GET /api/grid/waveform`
  - Returns available classes and metadata.
- `GET /api/grid/waveform?className=Pure_Sinusoidal&sampleIndex=0`
- `GET /api/grid/waveform?random=true`

- `POST /api/grid/explain`
  - Body:
    ```json
    {
      "predicted_label": 4,
      "predicted_class": "Transient",
      "confidence": 0.93,
      "top_k": [],
      "severity": "high"
    }
    ```

## Authentication and Route Protection

- Authentication is handled by Supabase Auth.
- Middleware protects:
  - `/dashboard`
  - `/analytics`
  - `/alerts`
- Unauthenticated users are redirected to `/login`.
- Logged-in users hitting `/login` are redirected to `/dashboard`.

## ML Classifier Pipeline

The endpoint `POST /api/grid/predict` executes `scripts/classify_signal.py`, which:
- Reads JSON from stdin with `signal` (100 points).
- Loads a PyTorch CNN checkpoint.
- Returns `predicted_class`, `predicted_label`, `confidence`, and top-k candidates.

Expected file locations relative to this repo:
- Model checkpoint:
  - `../pytorch_cnn_outputs/cnn_model.pt`
- Waveform dataset directory (for `GET /api/grid/waveform`):
  - `../archive/XPQRS/*.csv`

Important:
- These paths resolve one level above this repository directory.
- If your data lives elsewhere, either move it to these expected paths or update route/script path resolution.

## Explanation Pipeline (LLM + Fallback)

`POST /api/grid/explain` behavior:
- Validates payload shape.
- Checks in-memory explanation cache (10 minute TTL).
- Calls Groq API when configured.
- Retries with backoff on transient failures/rate limits.
- Falls back to deterministic explanation from `lib/classifier-explanations.ts` when needed.

This guarantees explanation output even when LLM provider is unavailable.

## Common Workflows

### 1) End-to-end local demo

1. Run schema + RLS + seed SQL.
2. Start app with `npm run dev`.
3. Sign up through `/login`.
4. Open `/dashboard` and `/analytics` to observe streaming simulated behavior.
5. Visit `/logs` to see persisted waveform predictions when classifier gating allows writes.

### 2) Manual classifier test via curl

```bash
curl -X POST http://localhost:3000/api/grid/predict \
  -H "Content-Type: application/json" \
  -d "{\"signal\": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}"
```

### 3) Update alert status

```bash
curl -X PATCH http://localhost:3000/api/alerts \
  -H "Content-Type: application/json" \
  -d '{"alertId":"<uuid>","status":"acknowledged"}'
```

## Troubleshooting

- App fails on startup with Supabase env error:
  - Ensure `.env` has both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- `POST /api/grid/predict` fails with process/model errors:
  - Confirm Python is installed and accessible.
  - Set `PYTHON_EXECUTABLE` if needed (for example, venv path).
  - Install `numpy` and `torch`.
  - Verify model exists at `../pytorch_cnn_outputs/cnn_model.pt`.

- `GET /api/grid/waveform` fails:
  - Ensure CSV files exist at `../archive/XPQRS`.
  - Each row must contain exactly 100 numeric values.

- Explain endpoint always falls back:
  - Provide valid `GROQ_API_KEY`.
  - Optionally set `GROQ_MODEL`.
  - Check API/network/rate limits.

- No data shown after login:
  - Confirm SQL schema and RLS have been applied.
  - Ensure user can read/write own rows under RLS policies.

## Deployment Notes

- Recommended runtime: Node.js (required for child process usage in `/api/grid/predict`).
- Ensure environment variables are present in deployment platform.
- Include access to Python runtime + model artifacts for classifier endpoints.
- If deploying serverless without Python support, migrate classifier inference to a separate inference service.

## Future Improvements

- Add a `requirements.txt` (or `pyproject.toml`) for Python reproducibility.
- Add automated tests for API routes and gating logic.
- Add observability dashboards (latency, error-rate, fallback-rate).
- Externalize ML artifact/dataset paths into explicit env vars.
- Add role-based access controls for operator/admin workflows.
