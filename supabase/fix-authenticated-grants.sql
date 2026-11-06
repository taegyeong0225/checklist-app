-- 이미 schema.sql을 실행한 프로젝트에서 한 번 실행합니다.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.templates, public.folders, public.equipments, public.checklists, public.results, public.photos to authenticated;
