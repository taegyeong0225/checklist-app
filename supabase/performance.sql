-- 조회 성능 개선 (Supabase SQL Editor에서 한 번 실행)
-- 여러 번 실행해도 안전합니다.

-- 1) 외래키/조회 조건 컬럼 인덱스 (Postgres는 FK에 인덱스를 자동으로 만들지 않음)
create index if not exists equipments_folder_id_idx   on public.equipments (folder_id);
create index if not exists checklists_equipment_id_idx on public.checklists (equipment_id);
create index if not exists checklists_template_id_idx  on public.checklists (template_id);
create index if not exists photos_result_id_idx        on public.photos (result_id);
-- results(checklist_id, item_id)는 unique 제약으로 이미 인덱스가 있음

-- 2) RLS 정책 검사용 owner_id 인덱스
create index if not exists templates_owner_id_idx  on public.templates (owner_id);
create index if not exists folders_owner_id_idx    on public.folders (owner_id);
create index if not exists equipments_owner_id_idx on public.equipments (owner_id);
create index if not exists checklists_owner_id_idx on public.checklists (owner_id);
create index if not exists results_owner_id_idx    on public.results (owner_id);
create index if not exists photos_owner_id_idx     on public.photos (owner_id);

-- 3) RLS 정책: auth.uid()를 행마다 호출하지 않고 쿼리당 한 번만 평가 (Supabase 권장)
do $$
declare t text;
begin
  foreach t in array array['templates','folders','equipments','checklists','results','photos'] loop
    execute format('drop policy if exists "owner access" on public.%I', t);
    execute format('create policy "owner access" on public.%I for all using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
  end loop;
end $$;

analyze public.templates, public.folders, public.equipments, public.checklists, public.results, public.photos;
