-- 5차시: 일정 저장에 필요한 열 추가 (Supabase SQL Editor에 붙여 넣고 Run, 한 번만 실행)
-- 입력: 없음 / 출력: trips에 rooms(숙소 방 수)·day_starts(날짜별 시작 시각, 분), trip_places에 meal·not_before 열
alter table public.trips add column if not exists rooms int not null default 1 check (rooms >= 1);
alter table public.trips add column if not exists day_starts int[];          -- 예: {540,600} = 1일차 09:00, 2일차 10:00
alter table public.trip_places add column if not exists meal text;          -- '점심' | '저녁' | '식사' | null(식사 아님)
alter table public.trip_places add column if not exists not_before int;     -- 이 시각(분) 전에는 시작하지 않음 (식사 시간)
