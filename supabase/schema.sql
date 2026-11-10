create table if not exists public.app_users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  token_hash text primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null
);

create index if not exists app_sessions_user_id_idx on public.app_sessions(user_id);

create table if not exists public.app_profiles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  height_cm integer check (height_cm between 100 and 250),
  questionnaire jsonb,
  privacy_accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.app_profiles add column if not exists questionnaire jsonb;

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.app_profiles enable row level security;

revoke all on public.app_users, public.app_sessions, public.app_profiles from anon, authenticated;
