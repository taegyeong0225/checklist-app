-- Supabase SQL Editor에서 한 번 실행합니다.

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.equipments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  equipment_id uuid not null references public.equipments(id) on delete cascade,
  template_id uuid references public.templates(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  item_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (checklist_id, item_id)
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  result_id uuid not null references public.results(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.templates enable row level security;
alter table public.folders enable row level security;
alter table public.equipments enable row level security;
alter table public.checklists enable row level security;
alter table public.results enable row level security;
alter table public.photos enable row level security;

drop policy if exists "owner access" on public.templates;
drop policy if exists "owner access" on public.folders;
drop policy if exists "owner access" on public.equipments;
drop policy if exists "owner access" on public.checklists;
drop policy if exists "owner access" on public.results;
drop policy if exists "owner access" on public.photos;

create policy "owner access" on public.templates for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner access" on public.folders for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner access" on public.equipments for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner access" on public.checklists for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner access" on public.results for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner access" on public.photos for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.templates, public.folders, public.equipments, public.checklists, public.results, public.photos to authenticated;

alter publication supabase_realtime add table public.templates, public.folders, public.equipments, public.checklists, public.results;
