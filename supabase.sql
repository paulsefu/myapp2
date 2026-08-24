-- Rulează integral acest fișier în Supabase > SQL Editor.

create table if not exists public.vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  envelope jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vaults enable row level security;

revoke all on table public.vaults from anon;
grant select, insert, update, delete on table public.vaults to authenticated;

drop policy if exists "vaults_select_own" on public.vaults;
create policy "vaults_select_own"
on public.vaults for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "vaults_insert_own" on public.vaults;
create policy "vaults_insert_own"
on public.vaults for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "vaults_update_own" on public.vaults;
create policy "vaults_update_own"
on public.vaults for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "vaults_delete_own" on public.vaults;
create policy "vaults_delete_own"
on public.vaults for delete
to authenticated
using ((select auth.uid()) = user_id);
