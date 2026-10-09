-- trips 테이블에 반려동물 동반 열 추가 (Supabase SQL Editor에 붙여 넣고 Run — 다시 실행해도 됨)
-- 입력: 없음 / 출력: trips.pet (true면 반려동물 동반 가능한 곳 점수를 올림, 기존 여행은 false)
alter table public.trips
  add column if not exists pet boolean not null default false;

-- Supabase API가 새 열을 바로 알아보도록 스키마 새로고침
notify pgrst, 'reload schema';
