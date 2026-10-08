-- 대중교통 여행: 구간마다 '걷기 / 대중교통'을 사용자가 고른 값 저장 (Supabase SQL Editor에 붙여 넣고 Run)
-- 입력: 없음 / 출력: trip_places.leg_mode, trips.back_modes 열 (없으면 추가, 기존 데이터는 그대로 — 여러 번 실행해도 됨)
--   trip_places.leg_mode : 이 장소로 오는 구간을 'walk'(걷기) 또는 'transit'(대중교통)으로 고정. null이면 자동(400m 미만·대중교통 없음 → 걷기)
--   trips.back_modes     : 날짜별로 마지막 장소 → 숙소 구간의 같은 값 (예: {walk,null,null})
alter table public.trip_places add column if not exists leg_mode text check (leg_mode in ('walk', 'transit'));
alter table public.trips       add column if not exists back_modes text[];
notify pgrst, 'reload schema';
