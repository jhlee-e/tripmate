-- trips 테이블에 나이대별 인원 열 추가 (Supabase SQL Editor에 붙여 넣고 Run, 한 번만)
-- 입력: 없음 / 출력: trips에 infants·teens·adults 열 (기존 데이터는 지우지 않음)
-- ※ schema.sql을 처음부터 다시 돌리는 경우에는 이미 들어 있으므로 실행할 필요 없음
alter table public.trips
  add column if not exists infants int not null default 0,   -- 유아 0~6세
  add column if not exists teens   int not null default 0,   -- 청소년 7~18세
  add column if not exists adults  int not null default 0;   -- 성인 19세 이상

-- 이미 저장한 여행은 나이대를 알 수 없으므로 0으로 두고, 합계 people은 그대로 유지
-- (화면에서는 나이대 없이 'N명'으로만 표시됨)

-- Supabase API가 새 열을 바로 알아보도록 스키마 새로고침
notify pgrst, 'reload schema';
