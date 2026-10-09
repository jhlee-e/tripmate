-- 7차시: 친구와 함께 정하기 (Supabase SQL Editor에 붙여 넣고 Run)
-- 입력: 없음 / 출력: trips.together 열, 사람별 취향을 담는 trip_prefs 표와 RLS
-- ※ sql/add_share.sql(친구 공유)을 먼저 실행해 둔 상태여야 함 (can_view_trip·can_edit_trip 함수 사용). 여러 번 실행해도 됨
--
-- 취향은 두 가지 방법으로 모음 (2026-10-10 이재훈 결정: 둘 다 가능)
--   ① 초대 링크로 들어온 친구가 자기 취향을 직접 입력 → user_id = 그 친구
--   ② 함께 편집할 수 있는 사람이 친구 취향을 대신 입력 → user_id = null, name = 친구 이름
--   만든 사람의 취향은 지금처럼 trips.tags에 있음

-- 1. 함께 정하는 여행인지 표시
alter table public.trips add column if not exists together boolean not null default false;

-- 2. 사람별 취향
create table if not exists public.trip_prefs (
  id         bigint generated always as identity primary key,
  trip_id    bigint not null references public.trips(id) on delete cascade,
  user_id    uuid   references public.users(id) on delete cascade,   -- null이면 대신 입력한 사람
  name       text,                                                    -- 대신 입력한 사람의 이름
  tags       text[] not null default '{}',                            -- 선택 순서대로 (0번 = 1순위)
  created_by uuid   not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (trip_id, user_id)                                           -- 링크로 들어온 사람은 한 줄씩 (null끼리는 겹쳐도 됨)
);
alter table public.trip_prefs enable row level security;
grant select, insert, update, delete on public.trip_prefs to authenticated;

-- 3. 권한: 함께하는 사람은 모두 보기 / 자기 취향은 누구나(보기만 권한이어도) 입력·수정 / 대신 입력·삭제는 편집 권한
drop policy if exists "trip_prefs: 함께하는 사람 보기" on public.trip_prefs;
drop policy if exists "trip_prefs: 입력"              on public.trip_prefs;
drop policy if exists "trip_prefs: 수정"              on public.trip_prefs;
drop policy if exists "trip_prefs: 삭제"              on public.trip_prefs;
create policy "trip_prefs: 함께하는 사람 보기" on public.trip_prefs for select using (public.can_view_trip(trip_id));
create policy "trip_prefs: 입력" on public.trip_prefs for insert with check (
  (user_id = auth.uid() and public.can_view_trip(trip_id)) or (user_id is null and public.can_edit_trip(trip_id)));
create policy "trip_prefs: 수정" on public.trip_prefs for update
  using      ((user_id = auth.uid() and public.can_view_trip(trip_id)) or (user_id is null and public.can_edit_trip(trip_id)))
  with check ((user_id = auth.uid() and public.can_view_trip(trip_id)) or (user_id is null and public.can_edit_trip(trip_id)));
create policy "trip_prefs: 삭제" on public.trip_prefs for delete using (
  user_id = auth.uid() or public.can_edit_trip(trip_id));

notify pgrst, 'reload schema';
