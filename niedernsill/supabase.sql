create extension if not exists pgcrypto;

create table if not exists public.trip_users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.trip_users(id) on delete cascade,
  item_type text not null check (item_type in ('route','food','day')),
  item_id text not null,
  vote text not null check (vote in ('want','maybe','no')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, item_type, item_id)
);

create table if not exists public.trip_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.trip_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trip_users_set_updated_at
before update on public.trip_users
for each row execute function public.set_updated_at();

create trigger trip_votes_set_updated_at
before update on public.trip_votes
for each row execute function public.set_updated_at();

alter table public.trip_users enable row level security;
alter table public.trip_votes enable row level security;
alter table public.trip_sessions enable row level security;

-- Access is intentionally server-only. The browser talks to Vercel API routes;
-- service-role credentials must stay in server environment variables.

insert into public.trip_users(name, pin_hash)
values
  ('Łukasz', crypt('0000', gen_salt('bf'))),
  ('Nela', crypt('0000', gen_salt('bf'))),
  ('Marta', crypt('0000', gen_salt('bf'))),
  ('Przemysław', crypt('0000', gen_salt('bf'))),
  ('Ninka', crypt('0000', gen_salt('bf'))),
  ('Michał', crypt('0000', gen_salt('bf'))),
  ('Elżbieta', crypt('0000', gen_salt('bf'))),
  ('Grzegorz', crypt('0000', gen_salt('bf'))),
  ('Adam', crypt('0000', gen_salt('bf')))
on conflict (name) do nothing;
