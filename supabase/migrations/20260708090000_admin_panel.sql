-- Admin panel: hidden admin account, admin sessions, and per-user activity log.
-- The admin tables have RLS enabled with NO policies: they are reachable only
-- through the admin-api edge function (service role). The default admin
-- password is a placeholder — the edge function forces a change on first login.
--
-- Note: on Supabase, pgcrypto lives in the `extensions` schema, so its
-- functions must be schema-qualified. Statements are idempotent so a partial
-- failure can simply be re-pushed.

create extension if not exists pgcrypto with schema extensions;

-- ── Admin credentials ──
create table if not exists public.admin_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null, -- bcrypt
  must_change_password boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.admin_accounts enable row level security;

-- Seed the default account (username "admin"). must_change_password makes the
-- edge function reject every action except a password change until rotated.
insert into public.admin_accounts (username, password_hash, must_change_password)
values ('admin', extensions.crypt('password', extensions.gen_salt('bf')), true)
on conflict (username) do nothing;

-- ── Admin sessions (opaque bearer tokens, stored hashed) ──
create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.admin_accounts(id) on delete cascade,
  token_hash text not null unique, -- sha256 hex of the bearer token
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.admin_sessions enable row level security;

-- ── User activity log (which work area a user opened, when) ──
create table if not exists public.user_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  area text not null check (char_length(area) between 1 and 80),
  at timestamptz not null default now()
);
create index if not exists user_activity_user_at on public.user_activity (user_id, at desc);
alter table public.user_activity enable row level security;

-- Users write and read only their own rows; the admin panel reads everyone's
-- through the service role, which bypasses RLS.
drop policy if exists "users insert own activity" on public.user_activity;
create policy "users insert own activity"
  on public.user_activity for insert
  with check (auth.uid() = user_id);

drop policy if exists "users read own activity" on public.user_activity;
create policy "users read own activity"
  on public.user_activity for select
  using (auth.uid() = user_id);
