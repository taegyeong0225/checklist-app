-- 이슈 리스트(트러블슈팅) 테이블 (Supabase SQL Editor에서 한 번 실행)
-- 여러 번 실행해도 안전합니다.

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists issues_owner_id_idx on public.issues (owner_id);

alter table public.issues enable row level security;
drop policy if exists "owner access" on public.issues;
create policy "owner access" on public.issues for all
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

grant select, insert, update, delete on table public.issues to authenticated;
