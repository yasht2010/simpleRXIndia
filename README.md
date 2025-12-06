# simpleRXIndia
AI based prescription service for Indian doctors

## Supabase migration (SQLite → Postgres)

1) Provision Supabase (free tier is fine) and grab:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` (Database connection string from Project Settings → Database → Connection info). Keep `?pgbouncer=true` off; the raw `postgresql://...` works best for the session store.

2) Create tables/functions in the Supabase SQL editor:

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

`connect-pg-simple` will auto-create a `session` table on first boot using the DB connection string (Supabase grants table creation to the `postgres` user used by `SUPABASE_DB_URL`). If you prefer manual creation, run `CREATE TABLE IF NOT EXISTS public.session (...)` using the template from the package docs.

3) Environment variables (`.env`):

```
SUPABASE_URL=<your supabase url>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_DB_URL=<postgres connection string for sessions>
SESSION_SECRET=<random string>
S3_CLEANUP_MAX_AGE_HOURS=24 # optional; S3 cleanup runs every 3 hours
```

Existing SQLite file `smartrx.db` is no longer used.

## Optional: move existing data

Export from SQLite and import into Supabase:

```
sqlite3 smartrx.db ".headers on" ".mode csv" "select * from users;" > users.csv
sqlite3 smartrx.db ".headers on" ".mode csv" "select * from macros;" > macros.csv
```

Then use Supabase Table Editor → Import Data (CSV) for `users` and `macros`. Ensure the column order matches the table definitions above.
