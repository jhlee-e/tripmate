-- 2026-11-18: 피드백 반영 6차시 — N빵 정산 (조정인 8번) (Supabase SQL Editor에 붙여 넣고 Run, 여러 번 실행해도 됨)
-- 입력: 없음 / 출력: trips에 열 1개
--   settle : 정산 내용 { "members": ["나", "민수", ...], "items": [{ "what": "숙소", "amount": 120000, "payer": 0, "split": [0, 1, 2] }, ...] }
--            payer·split은 members 배열의 순서 번호. 여행을 고칠 수 있는 사람(만든 사람·함께 편집 친구)이 기존 trips 권한으로 저장
alter table public.trips add column if not exists settle jsonb;
notify pgrst, 'reload schema';
