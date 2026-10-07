-- 4·5차시에 추가된 열을 한 번에 맞추는 스크립트 (Supabase SQL Editor에 붙여 넣고 Run)
-- 입력: 없음 / 출력: 아래 열들이 없으면 추가 (이미 있으면 건너뜀, 기존 데이터는 지우지 않음 — 여러 번 실행해도 됨)
-- ※ sql/add_age_groups.sql 내용도 포함되어 있어 이 파일 하나만 실행하면 됨

-- 4차시: 나이대별 인원
alter table public.trips
  add column if not exists infants  int not null default 0,   -- 유아 0~6세
  add column if not exists children int not null default 0,   -- 어린이 7~12세
  add column if not exists teens    int not null default 0,   -- 청소년 13~18세
  add column if not exists adults   int not null default 0;   -- 성인 19세 이상

-- 5차시: 숙소 방 수, 날짜별 시작 시각
alter table public.trips
  add column if not exists rooms      int not null default 1 check (rooms >= 1),
  add column if not exists day_starts int[];                  -- 예: {540,600} = 1일차 09:00, 2일차 10:00

-- 5차시: 일정 장소의 식사 표시와 식사 시작 가능 시각
alter table public.trip_places
  add column if not exists meal       text,                   -- '점심' | '저녁' | '식사' | null(식사 아님)
  add column if not exists not_before int;                    -- 이 시각(분) 전에는 시작하지 않음

-- Supabase API가 새 열을 바로 알아보도록 스키마 새로고침 ('schema cache' 오류 방지)
notify pgrst, 'reload schema';
