-- 친구와 여행 공유·함께 편집 (Supabase SQL Editor에 붙여 넣고 Run)
-- 입력: 없음 / 출력: trip_members 표, 초대 코드 열, 권한 확인 함수, 함께하는 여행을 보고·고칠 수 있는 RLS, 초대 수락 함수 join_trip
-- ※ 기존 데이터는 지우지 않음 — 여러 번 실행해도 됨. sql/add_6th.sql을 먼저 실행해 둔 상태여야 함
--
-- 권한 정리
--   만든 사람(owner) : 모든 것 + 초대 링크 만들기·끊기, 친구 권한 바꾸기·내보내기, 공개 설정, 여행 삭제
--   함께 편집(editor): 여행 조건·여행지·일정·준비물 고치기, 자기 후기·사진
--   보기만(viewer)   : 보기 + 자기 후기·사진
--   공통             : 출발지 주소가 친구에게 보임(같이 가는 사람이므로), 후기는 사람마다 따로, 사진은 함께하는 사람끼리 모두 보임

-- 1. 열과 표
alter table public.trips
  add column if not exists invite_code text unique,                         -- 초대 링크의 코드 (null이면 링크 없음)
  add column if not exists invite_role text not null default 'editor' check (invite_role in ('editor', 'viewer')),
  add column if not exists updated_at  timestamptz not null default now();  -- 마지막으로 고친 시각 (동시 수정 경고용)

create table if not exists public.trip_members (
  trip_id    bigint not null references public.trips(id) on delete cascade,
  user_id    uuid   not null references public.users(id) on delete cascade,
  role       text   not null default 'editor' check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
alter table public.trip_members enable row level security;

-- 2. 권한 확인 함수 (security definer: 정책 안에서 다른 표를 읽을 때 RLS가 서로를 계속 부르는 문제 방지)
create or replace function public.is_trip_owner(tid bigint)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.trips where id = tid and user_id = auth.uid()) $$;

create or replace function public.can_view_trip(tid bigint)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_trip_owner(tid)
          or exists (select 1 from public.trip_members where trip_id = tid and user_id = auth.uid()) $$;

create or replace function public.can_edit_trip(tid bigint)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_trip_owner(tid)
          or exists (select 1 from public.trip_members where trip_id = tid and user_id = auth.uid() and role = 'editor') $$;

-- 3. trips: 함께하는 사람은 보기, 편집 권한이면 고치기 (삭제는 기존 정책대로 만든 사람만)
drop policy if exists "trips: 함께하는 여행 보기" on public.trips;
drop policy if exists "trips: 함께하는 여행 고치기" on public.trips;
create policy "trips: 함께하는 여행 보기" on public.trips for select using (public.can_view_trip(id));
create policy "trips: 함께하는 여행 고치기" on public.trips for update
  using (public.can_edit_trip(id)) with check (public.can_edit_trip(id));

-- 친구가 고칠 때 주인·공개 여부·초대 링크는 바뀌지 않게 막고, 고친 시각을 기록
create or replace function public.trips_guard()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null and auth.uid() <> old.user_id then
    new.user_id     := old.user_id;
    new.is_public   := old.is_public;
    new.invite_code := old.invite_code;
    new.invite_role := old.invite_role;
  end if;
  return new;
end;
$$;
drop trigger if exists trips_guard on public.trips;
create trigger trips_guard before update on public.trips for each row execute function public.trips_guard();

-- 4. 일정·준비물: 함께하는 사람은 보기, 편집 권한이면 추가·수정·삭제
drop policy if exists "trip_places: 함께하는 여행 보기" on public.trip_places;
drop policy if exists "trip_places: 함께하는 여행 편집" on public.trip_places;
create policy "trip_places: 함께하는 여행 보기" on public.trip_places for select using (public.can_view_trip(trip_id));
create policy "trip_places: 함께하는 여행 편집" on public.trip_places for all
  using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));

drop policy if exists "checklist: 함께하는 여행 보기" on public.checklist;
drop policy if exists "checklist: 함께하는 여행 편집" on public.checklist;
create policy "checklist: 함께하는 여행 보기" on public.checklist for select using (public.can_view_trip(trip_id));
create policy "checklist: 함께하는 여행 편집" on public.checklist for all
  using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));

-- 5. 사진·후기: 함께하는 사람끼리 보기 (올리기·지우기는 기존 정책대로 자기 것만)
drop policy if exists "photos: 함께하는 여행 사진 보기" on public.photos;
create policy "photos: 함께하는 여행 사진 보기" on public.photos for select using (public.can_view_trip(trip_id));
drop policy if exists "reviews: 함께하는 여행 후기 보기" on public.reviews;
create policy "reviews: 함께하는 여행 후기 보기" on public.reviews for select using (public.can_view_trip(trip_id));

-- 후기는 사람마다 하나씩 (예전: 여행마다 하나) → 친구도 같은 여행에 자기 후기를 쓸 수 있게
drop index if exists public.reviews_one_per_trip;
drop index if exists public.reviews_one_per_place;
create unique index reviews_one_per_trip  on public.reviews (trip_id, user_id) where place_id is null;
create unique index reviews_one_per_place on public.reviews (trip_id, user_id, place_id) where place_id is not null;

-- 공개 코스 보기: 후기가 여러 개가 될 수 있으므로 코스 주인의 후기만 고름 (나머지는 add_6th.sql과 같음)
drop view if exists public.public_courses;
create view public.public_courses as
select c.id, c.trip_id, c.title, c.saved_count, c.created_at, c.user_id, u.nickname,
       t.region, t.plan_type, t.days, t.people, t.rooms, t.transport, t.tempo, t.tags, t.total_cost, t.day_starts,
       (select r.rating  from public.reviews r where r.trip_id = t.id and r.user_id = t.user_id and r.place_id is null limit 1) as rating,
       (select r.content from public.reviews r where r.trip_id = t.id and r.user_id = t.user_id and r.place_id is null limit 1) as review
from public.shared_courses c
join public.trips t on t.id = c.trip_id and t.is_public
join public.users u on u.id = c.user_id;
grant select on public.public_courses to anon, authenticated;

-- 사진 파일(Storage): 함께하는 여행의 사진 파일도 열 수 있게
create or replace function public.can_view_photo(path text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.photos p where p.url = path and public.can_view_trip(p.trip_id)) $$;
drop policy if exists "trip-photos: 함께하는 여행 사진 보기" on storage.objects;
create policy "trip-photos: 함께하는 여행 사진 보기" on storage.objects for select to authenticated
  using (bucket_id = 'trip-photos' and public.can_view_photo(name));

-- 6. trip_members: 같은 여행 사람끼리 목록 보기, 만든 사람이 권한 바꾸기, 만든 사람이 내보내기·본인이 나가기
--    (추가는 표에 직접 못 하고 초대 링크 → join_trip 함수로만)
drop policy if exists "trip_members: 같은 여행 사람 보기" on public.trip_members;
drop policy if exists "trip_members: 만든 사람이 권한 바꾸기" on public.trip_members;
drop policy if exists "trip_members: 내보내기·나가기" on public.trip_members;
create policy "trip_members: 같은 여행 사람 보기" on public.trip_members for select using (public.can_view_trip(trip_id));
create policy "trip_members: 만든 사람이 권한 바꾸기" on public.trip_members for update
  using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));
create policy "trip_members: 내보내기·나가기" on public.trip_members for delete
  using (public.is_trip_owner(trip_id) or user_id = auth.uid());
grant select, insert, update, delete on public.trip_members to authenticated;

-- 7. 초대 수락: 초대 코드 → 그 여행의 멤버로 추가(링크에 정해 둔 권한), 여행 번호를 돌려줌
create or replace function public.join_trip(code text)
returns bigint language plpgsql security definer set search_path = public
as $$
declare tid bigint; owner uuid; r text;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select id, user_id, invite_role into tid, owner, r from public.trips where invite_code = code;
  if tid is null then raise exception '초대 링크가 올바르지 않거나 만료됐어요'; end if;
  if owner <> auth.uid() then
    insert into public.trip_members (trip_id, user_id, role) values (tid, auth.uid(), r)
    on conflict (trip_id, user_id) do nothing;   -- 이미 멤버면 권한은 그대로
  end if;
  return tid;
end;
$$;
grant execute on function public.join_trip(text) to authenticated;

notify pgrst, 'reload schema';
