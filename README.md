# Clinova Rx (Smart-RX India)

Voice-first prescription builder for Indian doctors. Streams dictation to Deepgram, runs scribe/review/format with Gemini/OpenAI/Groq, and returns print-ready HTML and structured Rx data.

## What it does

- Live scribing with Socket.IO + Deepgram (fallback to upload-and-process).
- AI scribe → review → format pipeline with schema-enforced outputs.
- Macros/protocols, custom doctor header, and printable prescriptions.
- Admin console for users/credits and provider overrides.
- S3 presigned uploads with optional cleanup for stale audio.

## Architecture

- **Backend:** Express + Socket.IO (`server.js`), Helmet + rate limiting, session-backed auth via Supabase Postgres (`connect-pg-simple`).
- **Frontend:** Static Tailwind pages in `public/` for login/register/dashboard/admin.
- **Data:** Supabase Postgres for users/macros/provider settings/session, optional local `logs/format.log` for formatter traces.
- **External providers:** Deepgram (live/offline transcription), Gemini/OpenAI/Groq for LLM tasks, AWS S3 for audio blobs.
- See `ARCHITECTURE.md` and `docs/diagrams/*.svg` for flow diagrams.

### Medicine typeahead sidecar

- **Python FastAPI sidecar** (`search_engine.py`): loads `indian_medicine_data.csv`, cleans/partitions brand/composition text, and exposes `/medicine-suggest` and `/medicine-validate` (returns `{id, brand, manufacturer, composition, mol1, mol2}`).
- **Node proxy**: `server.js` proxies `/api/medicine-suggest` and `/api/medicine-validate` to the sidecar (`MEDICINE_SERVICE_BASE`, default `http://127.0.0.1:8000`) with timeouts and result normalization.
- **UI wiring**: the formatted Rx table in `public/index.html` makes medicine names clickable; a popover typeahead calls the proxy endpoints, supports keyboard navigation, and updates the medicine name + molecule columns inline without persisting server state.

Run the sidecar locally

```
# in the repo root
uvicorn search_engine:app --host 0.0.0.0 --port 8000
```

Notes:
- `indian_medicine_data.csv` must be present (already in the repo).
- If you change host/port, set `MEDICINE_SERVICE_BASE` for the Node app (e.g., `MEDICINE_SERVICE_BASE=http://localhost:9000 npm start`).

## Privacy (summary)

- External services (Deepgram, Gemini/OpenAI/Groq, Supabase, S3) receive audio/text; do not process PHI unless you have compliance clearance and agreements with those providers.
- Configure HTTPS, strong secrets, and access controls before handling real data.
- Clear runtime artifacts (`uploads/`, `logs/`, `smartrx.db`, `.env`) before sharing builds; set your own retention policy in production.
- See `PRIVACY.md` to adjust the notice for your deployment.

## Requirements

- Node.js 20+
- Supabase project (URL, Service Role key, and Postgres connection string for session storage)
- AWS S3 bucket + credentials (or compatible S3 API)
- Provider API keys: Deepgram (live transcription), Gemini and/or OpenAI, optional Groq
- Modern browser with mic access (for live streaming)

## Setup

1) Install dependencies:

```
npm install
```

2) Create `.env` from `.env.example` and fill in real values (see variables below).
3) Provision Supabase tables/functions in the SQL editor:

```sql
-- users
create table if not exists public.users (
  id bigint generated always as identity primary key,
  phone text not null unique,
  password text not null,
  credits integer not null default 50,
  header_html text,
  custom_keywords text,
  doctor_name text,
  qualification text,
  reg_no text,
  clinic_details text,
  created_at timestamptz default now()
);

-- macros
create table if not exists public.macros (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  trigger_phrase text not null,
  expansion text not null
);
create unique index if not exists macros_user_trigger_idx on public.macros(user_id, trigger_phrase);

-- credit helpers
create or replace function public.deduct_credit(user_id_input bigint)
returns boolean
language plpgsql
security definer
as $$
declare success boolean;
begin
  update public.users set credits = credits - 1 where id = user_id_input and credits > 0;
  success := found;
  return success;
end;
$$;

create or replace function public.add_credits(user_id_input bigint, amount_input integer)
returns void
language plpgsql
security definer
as $$
begin
  update public.users set credits = credits + greatest(amount_input, 0) where id = user_id_input;
end;
$$;
```

`connect-pg-simple` will auto-create the `session` table on first boot using `SUPABASE_DB_URL`.

4) Run locally:

```
PORT=3000 npm start
```

Open `http://localhost:3000` and log in. Admin console is at `/admin.html`.

## Environment variables (key ones)

- **Core:** `PORT`, `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_PASSCODE`, `REGISTRATION_OTP`, `SESSION_SECRET`.
- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (used for session store).
- **S3:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`, `S3_CLEANUP_MAX_AGE_HOURS` (hours; cleanup runs every 3 hours).
- **Providers:** `DEEPGRAM_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, optional `GROQ_API_KEY`.
- **Provider/model overrides:** `TRANSCRIPTION_LIVE_PROVIDER`, `TRANSCRIPTION_OFFLINE_PROVIDER`, `SCRIBE_PROVIDER`, `FORMAT_PROVIDER`, `REVIEW_PROVIDER`, plus `*_MODEL` overrides. Defaults live in `services/providerConfig.js`.

## Data and security notes

- Keep `.env`, `smartrx.db`, `uploads/`, and `logs/` out of git and out of public builds. Rotate any keys already committed elsewhere.
- Change default admin credentials/passcodes in production.
- TLS terminate in front of the app; sessions are cookie-based with `secure` enabled in production.
- Review HIPAA/NMC/clinic policies before handling real patient data; this code ships without compliance guarantees.

## Docs

- `ARCHITECTURE.md` – components and data flows.
- `docs/diagrams/*.svg` – rendered diagrams for auth/scribing/formatting.
- `PUBLIC_RELEASE_CHECKLIST.md` – quick audit before making the repo public.
- `PRIVACY.md` – brief privacy statement to customize for your deployment.
