-- SakayGo database schema for Supabase (Postgres 15+).
-- Run in the Supabase SQL editor, then set backend: "supabase" in js/config.js.
-- To make someone an admin:  update public.profiles set role = 'admin' where id = '<user uuid>';

create extension if not exists pgcrypto;

-- Profiles -----------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Commuter',
  bio          text not null default '',
  home_city    text not null default '',
  role         text not null default 'commuter' check (role in ('commuter','admin')),
  points       integer not null default 0,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Routes -------------------------------------------------------------------
create table if not exists public.routes (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 3 and 140),
  origin       text not null,
  destination  text not null,
  steps        jsonb not null default '[]',   -- [{mode, instruction, landmark, fare}]
  total_fare   numeric(8,2) not null default 0,
  duration_min integer not null default 0,
  notes        text not null default '',
  status       text not null default 'pending' check (status in ('pending','verified','flagged')),
  submitted_by uuid references public.profiles on delete cascade,
  created_at   timestamptz not null default now(),
  verified_at  timestamptz
);

create table if not exists public.route_votes (
  route_id   uuid references public.routes on delete cascade,
  user_id    uuid references public.profiles on delete cascade,
  kind       text not null check (kind in ('up','outdated')),
  created_at timestamptz not null default now(),
  primary key (route_id, user_id, kind)
);

create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null references public.routes on delete cascade,
  user_id    uuid not null references public.profiles on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  comment    text not null default '',
  created_at timestamptz not null default now(),
  unique (route_id, user_id)
);

create table if not exists public.alerts (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('traffic','roadblock','no_vehicle','queue','other')),
  location   text not null,
  message    text not null default '',
  route_id   uuid references public.routes on delete set null,
  user_id    uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_routes (
  user_id    uuid references public.profiles on delete cascade,
  route_id   uuid references public.routes on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, route_id)
);

create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

-- Views --------------------------------------------------------------------
create or replace view public.route_stats with (security_invoker = true) as
select r.*,
       p.display_name as submitter_name,
       (select count(*) from public.route_votes v where v.route_id = r.id and v.kind = 'up')::int       as up,
       (select count(*) from public.route_votes v where v.route_id = r.id and v.kind = 'outdated')::int as outdated,
       coalesce((select avg(rating) from public.reviews rv where rv.route_id = r.id), 0)::float        as avg_rating,
       (select count(*) from public.reviews rv where rv.route_id = r.id)::int                          as review_count,
       array(select distinct s->>'mode' from jsonb_array_elements(r.steps) s)                          as modes,
       (select string_agg(coalesce(s->>'instruction','') || ' ' || coalesce(s->>'landmark',''), ' ')
          from jsonb_array_elements(r.steps) s)                                                         as search_text
from public.routes r
left join public.profiles p on p.id = r.submitted_by;

create or replace view public.leaderboard with (security_invoker = true) as
select p.id, p.display_name as name, p.points,
       (select count(*) from public.routes r where r.submitted_by = p.id and r.status = 'verified')::int as verified
from public.profiles p
order by p.points desc, verified desc;

-- Admin: change route status and adjust points --------------------------------
create or replace function public.set_route_status(p_route_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  old_status text; owner uuid;
  pts constant int := 50;  -- keep in sync with pointsPerVerifiedRoute in js/config.js
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('pending','verified','flagged') then raise exception 'Invalid status'; end if;
  select status, submitted_by into old_status, owner from public.routes where id = p_route_id for update;
  if not found then raise exception 'Route not found'; end if;
  update public.routes set status = p_status,
         verified_at = case when p_status = 'verified' then now() else null end
   where id = p_route_id;
  if old_status <> 'verified' and p_status = 'verified' then
    update public.profiles set points = points + pts where id = owner;
  elsif old_status = 'verified' and p_status <> 'verified' then
    update public.profiles set points = greatest(0, points - pts) where id = owner;
  end if;
end $$;

-- Self-service account deletion --------------------------------------------------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.set_route_status(uuid, text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.set_route_status(uuid, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Row level security -----------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.routes           enable row level security;
alter table public.route_votes      enable row level security;
alter table public.reviews          enable row level security;
alter table public.alerts           enable row level security;
alter table public.saved_routes     enable row level security;
alter table public.contact_messages enable row level security;

create policy "profiles readable"   on public.profiles for select using (true);
create policy "update own profile"  on public.profiles for update using (id = auth.uid());
-- users may only edit these columns; role and points change through set_route_status
revoke update on public.profiles from authenticated;
grant update (display_name, bio, home_city) on public.profiles to authenticated;

create policy "routes readable" on public.routes for select
  using (status in ('verified','pending') or submitted_by = auth.uid() or public.is_admin());
create policy "submit routes" on public.routes for insert
  with check (submitted_by = auth.uid() and status = 'pending');
create policy "delete own pending" on public.routes for delete
  using (submitted_by = auth.uid() and status = 'pending');

create policy "votes readable" on public.route_votes for select using (true);
create policy "vote as self"   on public.route_votes for insert with check (user_id = auth.uid());
create policy "unvote as self" on public.route_votes for delete using (user_id = auth.uid());

create policy "reviews readable"   on public.reviews for select using (true);
create policy "review as self"     on public.reviews for insert with check (user_id = auth.uid());
create policy "edit own review"    on public.reviews for update using (user_id = auth.uid());
create policy "delete own review"  on public.reviews for delete using (user_id = auth.uid() or public.is_admin());

create policy "alerts readable"    on public.alerts for select using (true);
create policy "post alert as self" on public.alerts for insert with check (user_id = auth.uid());
create policy "delete own alert"   on public.alerts for delete using (user_id = auth.uid() or public.is_admin());

create policy "own saved routes"   on public.saved_routes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "anyone can send a message" on public.contact_messages for insert with check (true);
create policy "admins read messages"      on public.contact_messages for select using (public.is_admin());
