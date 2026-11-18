-- 2026-11-18: 피드백 3차 반영 5차시 (Supabase SQL Editor에 붙여 넣고 Run, 여러 번 실행해도 됨)
-- 입력: 없음 / 출력: trips에 열 3개
--   start_time  : 첫날 집 출발 시각 (하루 시작부터 몇 분, 예: 09:00 → 540) — 조정인 1번
--   end_time    : 마지막 날 집 도착 희망 시각 (분, 비워 두면 제한 없음) — 조정인 1번
--   must_places : 꼭 가고 싶은 명소 { "region": "강릉", "ids": [장소 id, ...] } — 최세민 1번
alter table public.trips add column if not exists start_time integer;
alter table public.trips add column if not exists end_time integer;
alter table public.trips add column if not exists must_places jsonb;
notify pgrst, 'reload schema';
