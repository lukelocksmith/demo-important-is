create extension if not exists pgcrypto;

create table if not exists public.trip_users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  pin_hash text,
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

-- The browser never talks to these tables directly. Vercel API routes use the
-- Supabase service-role key stored only in server environment variables.

insert into public.trip_users(name)
values
  ('Łukasz'),('Nela'),('Marta'),('Przemysław'),('Ninka'),('Michał'),('Elżbieta'),('Grzegorz'),('Adam')
on conflict (name) do nothing;

create or replace function public.claim_or_login_trip_user(p_name text, p_pin text)
returns table(user_id uuid, user_name text, first_login boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.trip_users%rowtype;
  was_first boolean := false;
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must have exactly four digits';
  end if;

  select * into u from public.trip_users where name = p_name for update;
  if not found then
    raise exception 'Unknown user';
  end if;

  if u.pin_hash is null then
    update public.trip_users
      set pin_hash = crypt(p_pin, gen_salt('bf'))
      where id = u.id;
    was_first := true;
  elsif crypt(p_pin, u.pin_hash) <> u.pin_hash then
    raise exception 'Invalid PIN';
  end if;

  return query select u.id, u.name, was_first;
end $$;

revoke all on function public.claim_or_login_trip_user(text,text) from public;
grant execute on function public.claim_or_login_trip_user(text,text) to service_role;
