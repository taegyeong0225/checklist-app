-- 현재 Supabase 프로젝트의 체크리스트 데이터 전체를 삭제합니다.
-- auth.users(로그인 계정)는 삭제하지 않습니다.
-- 실행 후 복구할 수 없습니다.

delete from public.photos;
delete from public.results;
delete from public.checklists;
delete from public.equipments;
delete from public.folders;
delete from public.templates;
