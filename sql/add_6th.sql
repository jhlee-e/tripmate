-- 6차시: 후기·장소 한줄평, 공개 코스, 사진 저장소 (Supabase SQL Editor에 붙여 넣고 Run)
-- 입력: 없음 / 출력: reviews 열 추가, 공개 범위 보안 정리, 공개 코스 보기(public_courses), 담기 함수, 사진 저장소(trip-photos)
-- ※ 기존 데이터는 지우지 않음 — 여러 번 실행해도 됨

-- 1. reviews: 여행 전체 후기(place_id 없음, 별점 필수) + 장소별 한줄평(place_id 있음, 별점 선택)
alter table public.reviews
  add column if not exists place_id   text,                    -- places.json의 id (여행 전체 후기는 null)
  add column if not exists place_name text;
alter table public.reviews alter column rating drop not null;
alter table public.reviews drop constraint if exists reviews_trip_rating_required;
alter table public.reviews add constraint reviews_trip_rating_required check (place_id is not null or rating is not null);
create unique index if not exists reviews_one_per_trip  on public.reviews (trip_id) where place_id is null;
create unique index if not exists reviews_one_per_place on public.reviews (trip_id, place_id) where place_id is not null;

-- 2. trips: 다른 사람 코스를 담아 만든 여행이면 원래 여행 번호
alter table public.trips add column if not exists copied_from bigint;

-- 3. 공개 범위: 공개 여행이어도 출발지 주소·좌표는 남에게 보이지 않게
--    trips 표를 남이 직접 읽는 권한은 없애고, 필요한 열만 고른 public_courses 보기로만 공개
create or replace function public.is_public_trip(tid bigint)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.trips where id = tid and is_public) $$;

drop policy if exists "trips: 공개 여행은 누구나 조회" on public.trips;

drop policy if exists "trip_places: 공개 여행의 장소는 누구나 조회" on public.trip_places;
create policy "trip_places: 공개 여행의 장소는 누구나 조회" on public.trip_places
  for select using (public.is_public_trip(trip_id));

drop policy if exists "photos: 공개 사진은 누구나 조회" on public.photos;
create policy "photos: 공개 사진은 누구나 조회" on public.photos
  for select using (is_public and public.is_public_trip(trip_id));

drop policy if exists "reviews: 후기는 누구나 조회" on public.reviews;
drop policy if exists "reviews: 공개 여행의 후기는 누구나 조회" on public.reviews;
create policy "reviews: 공개 여행의 후기는 누구나 조회" on public.reviews
  for select using (public.is_public_trip(trip_id));

drop policy if exists "shared_courses: 공개 코스는 누구나 조회" on public.shared_courses;
create policy "shared_courses: 공개 코스는 누구나 조회" on public.shared_courses
  for select using (public.is_public_trip(trip_id));

-- 4. 공개 코스 목록용 보기: 출발지·예산 범위 없이 코스 정보 + 닉네임 + 여행 전체 별점
drop view if exists public.public_courses;
create view public.public_courses as
select c.id, c.trip_id, c.title, c.saved_count, c.created_at, c.user_id, u.nickname,
       t.region, t.plan_type, t.days, t.people, t.rooms, t.transport, t.tempo, t.tags, t.total_cost, t.day_starts,
       (select r.rating  from public.reviews r where r.trip_id = t.id and r.place_id is null) as rating,
       (select r.content from public.reviews r where r.trip_id = t.id and r.place_id is null) as review
from public.shared_courses c
join public.trips t on t.id = c.trip_id and t.is_public
join public.users u on u.id = c.user_id;
grant select on public.public_courses to anon, authenticated;

-- 5. 담기: 남의 공개 코스를 담으면 담은 횟수 +1 (내 코스는 세지 않음). 남의 행은 직접 고칠 수 없어서 함수로 처리
create or replace function public.save_course(cid bigint)
returns int language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  update public.shared_courses c set saved_count = saved_count + 1
   where c.id = cid and public.is_public_trip(c.trip_id) and c.user_id <> auth.uid()
  returning saved_count into n;
  return coalesce(n, (select saved_count from public.shared_courses where id = cid));
end;
$$;
grant execute on function public.save_course(bigint) to authenticated;

-- 6. 사진 저장소: 비공개 버킷 trip-photos (5MB 이하 이미지). 파일 경로 = 사용자id/여행id/파일이름
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-photos', 'trip-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.is_public_photo(path text)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.photos p where p.url = path and p.is_public and public.is_public_trip(p.trip_id)) $$;

drop policy if exists "trip-photos: 내 폴더에 올리기" on storage.objects;
drop policy if exists "trip-photos: 내 사진 보기"     on storage.objects;
drop policy if exists "trip-photos: 내 사진 지우기"   on storage.objects;
drop policy if exists "trip-photos: 공개 사진 보기"   on storage.objects;
create policy "trip-photos: 내 폴더에 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "trip-photos: 내 사진 보기" on storage.objects for select to authenticated
  using (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "trip-photos: 내 사진 지우기" on storage.objects for delete to authenticated
  using (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "trip-photos: 공개 사진 보기" on storage.objects for select
  using (bucket_id = 'trip-photos' and public.is_public_photo(name));

notify pgrst, 'reload schema';
