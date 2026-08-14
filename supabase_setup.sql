-- My Vocabulary v5.1 Invite-only setup
-- Run in Supabase Dashboard -> SQL Editor.
--
-- Security model:
-- 1) Authentication: invited/existing Supabase Auth users only.
-- 2) Authorization: email must also exist in public.approved_users.
-- 3) Data isolation: each approved user can access only their own vocab_state row.

-- Approved email allow-list
create table if not exists public.approved_users (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.approved_users enable row level security;

revoke all on table public.approved_users from anon;
grant select on table public.approved_users to authenticated;

drop policy if exists "Approved users can verify own approval" on public.approved_users;
create policy "Approved users can verify own approval"
on public.approved_users
for select
to authenticated
using (
  (select auth.uid()) is not null
  and lower(email) = lower((select auth.jwt()->>'email'))
);

-- Per-user vocabulary state
create table if not exists public.vocab_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.vocab_state enable row level security;

revoke all on table public.vocab_state from anon;
grant select, insert, update, delete on table public.vocab_state to authenticated;

-- Helper expression used below:
-- the current JWT email must be present in approved_users.
drop policy if exists "Approved users can read own vocab state" on public.vocab_state;
create policy "Approved users can read own vocab state"
on public.vocab_state
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.approved_users a
    where lower(a.email) = lower((select auth.jwt()->>'email'))
  )
);

drop policy if exists "Approved users can insert own vocab state" on public.vocab_state;
create policy "Approved users can insert own vocab state"
on public.vocab_state
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.approved_users a
    where lower(a.email) = lower((select auth.jwt()->>'email'))
  )
);

drop policy if exists "Approved users can update own vocab state" on public.vocab_state;
create policy "Approved users can update own vocab state"
on public.vocab_state
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.approved_users a
    where lower(a.email) = lower((select auth.jwt()->>'email'))
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.approved_users a
    where lower(a.email) = lower((select auth.jwt()->>'email'))
  )
);

drop policy if exists "Approved users can delete own vocab state" on public.vocab_state;
create policy "Approved users can delete own vocab state"
on public.vocab_state
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.approved_users a
    where lower(a.email) = lower((select auth.jwt()->>'email'))
  )
);

-- ==========================================================
-- ADMIN EXAMPLES — run only in the Supabase SQL Editor
-- ==========================================================
--
-- Allow a user:
-- insert into public.approved_users(email)
-- values ('friend@example.com')
-- on conflict (email) do nothing;
--
-- Revoke a user immediately at the database authorization layer:
-- delete from public.approved_users
-- where lower(email)=lower('friend@example.com');
--
-- IMPORTANT:
-- Invite/create Auth users from the Supabase Dashboard or a trusted server.
-- Never put a service_role/secret key in this web app.
