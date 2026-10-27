-- 2026-10-27: 음식 선호 표 (Supabase SQL Editor에 붙여 넣고 Run, 여러 번 실행해도 됨)
-- 입력: 없음 / 출력: trips.food_pref 열, trip_prefs.food_pref 열 (함께 정하기 친구별)
-- 값 모양: { coffee, allergy[], no[], dislike[], diet, noWords[], dislikeWords[] } — js/food-pref.js
-- ※ trip_prefs는 sql/add_together.sql을 먼저 실행해 둔 상태여야 함
alter table public.trips add column if not exists food_pref jsonb;
alter table public.trip_prefs add column if not exists food_pref jsonb;
notify pgrst, 'reload schema';
