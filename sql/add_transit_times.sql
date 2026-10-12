-- 대중교통 여행: 예매한 열차·버스 시각 저장 (2026-10-12, 피드백 2차 2단계)
-- 형태: { "go": { "dep": "09:30", "arr": "11:24" }, "back": { "dep": "18:00", "arr": "19:54" } }  (넣지 않은 편은 빠짐, 모두 없으면 null)
alter table trips add column if not exists transit_times jsonb;
