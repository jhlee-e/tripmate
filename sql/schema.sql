-- TripMate 데이터베이스 설계 (Supabase SQL Editor에 통째로 붙여 넣고 Run)
-- 입력: 없음 / 출력: 테이블 7개 + 접근 권한(RLS) + 회원가입 시 users 행 자동 생성 트리거
-- ※ 처음부터 다시 만드는 스크립트: 기존 7개 테이블과 그 안의 데이터는 지워짐
--   (auth의 로그인 계정은 그대로 남고, 아래 7번에서 users 행을 다시 채움)

-- 0. 기존 테이블 정리 (이름이 같아도 열 구성이 다르면 코드와 안 맞으므로 새로 만듦)
drop table if exists public.shared_courses cascade;
drop table if exists public.reviews        cascade;
drop table if exists public.photos         cascade;
drop table if exists public.checklist      cascade;
drop table if exists public.trip_places    cascade;
drop table if exists public.trips          cascade;
drop table if exists public.users          cascade;

-- 1. users: 회원 정보 (로그인 계정 auth.users 와 id가 같음)
create table public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  nickname   text not null default '여행자',
  created_at timestamptz not null default now()
);

-- 2. trips: 여행 한 건 (조건 입력값 + 나중에 고른 여행지·일정안)
create table public.trips (
  id                bigint generated always as identity primary key,
  user_id           uuid not null default auth.uid() references public.users(id) on delete cascade,
  start_date        date not null,
  end_date          date not null,
  days              int  not null,
  budget_min        int  not null,
  budget_max        int  not null,
  people            int  not null,
  departure_address text,
  departure_lat     double precision,
  departure_lng     double precision,
  transport         text not null,
  tags              text[] not null,          -- 선택 순서대로, 0번이 1순위
  tempo             text not null,
  region            text,                     -- 5차시: 고른 여행지
  plan_type         text,                     -- 5차시: 'A' | 'B' | 'C'
  total_cost        int,                      -- 5차시: 일정 총비용
  is_public         boolean not null default false,
  created_at        timestamptz not null default now()
);

-- 3. trip_places: 일정에 들어간 장소와 방문 순서 (5차시)
create table public.trip_places (
  id         bigint generated always as identity primary key,
  trip_id    bigint not null references public.trips(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.users(id) on delete cascade,
  place_id   text,                            -- places.json의 id
  name       text not null,
  type       text,                            -- 명소 | 식당 | 숙소
  day_no     int  not null,                   -- 몇째 날
  order_no   int  not null,                   -- 그날 몇 번째
  start_time text,                            -- 'HH:MM'
  stay_min   int,
  cost       int,
  lat        double precision,
  lng        double precision
);

-- 4. checklist: 준비물 항목과 체크 여부
create table public.checklist (
  id         bigint generated always as identity primary key,
  trip_id    bigint not null references public.trips(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.users(id) on delete cascade,
  item       text not null,
  checked    boolean not null default false,
  created_at timestamptz not null default now()
);

-- 5. photos: 여행 사진 (6차시)
create table public.photos (
  id         bigint generated always as identity primary key,
  trip_id    bigint not null references public.trips(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.users(id) on delete cascade,
  url        text not null,
  place_name text,
  lat        double precision,
  lng        double precision,
  is_public  boolean not null default false,
  created_at timestamptz not null default now()
);

-- 6. reviews: 별점과 후기 (6차시)
create table public.reviews (
  id         bigint generated always as identity primary key,
  trip_id    bigint not null references public.trips(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.users(id) on delete cascade,
  rating     int not null check (rating between 1 and 5),
  content    text,
  created_at timestamptz not null default now()
);

-- 7. shared_courses: 공개 코스와 담아간 횟수 (6차시)
create table public.shared_courses (
  id          bigint generated always as identity primary key,
  trip_id     bigint not null unique references public.trips(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.users(id) on delete cascade,
  title       text not null,
  saved_count int not null default 0,
  created_at  timestamptz not null default now()
);

-- 8. 접근 권한(RLS): 기본은 "내 행만" 보고·쓰고·지울 수 있음
alter table public.users          enable row level security;
alter table public.trips          enable row level security;
alter table public.trip_places    enable row level security;
alter table public.checklist      enable row level security;
alter table public.photos         enable row level security;
alter table public.reviews        enable row level security;
alter table public.shared_courses enable row level security;

create policy "users: 내 정보" on public.users
  for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "users: 닉네임은 누구나 조회" on public.users
  for select using (true);

create policy "trips: 내 여행" on public.trips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trips: 공개 여행은 누구나 조회" on public.trips
  for select using (is_public);

create policy "trip_places: 내 장소" on public.trip_places
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trip_places: 공개 여행의 장소는 누구나 조회" on public.trip_places
  for select using (exists (select 1 from public.trips t where t.id = trip_id and t.is_public));

create policy "checklist: 내 준비물" on public.checklist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "photos: 내 사진" on public.photos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "photos: 공개 사진은 누구나 조회" on public.photos
  for select using (is_public);

create policy "reviews: 내 후기" on public.reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reviews: 후기는 누구나 조회" on public.reviews
  for select using (true);

create policy "shared_courses: 내 공개 코스" on public.shared_courses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "shared_courses: 공개 코스는 누구나 조회" on public.shared_courses
  for select using (true);

-- 9. 회원가입하면 users 테이블에 닉네임과 함께 행 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, nickname)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'nickname', ''), '여행자'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 10. 이미 가입해 둔 계정이 있으면 users 행 채워 넣기
insert into public.users (id, nickname)
select id, coalesce(nullif(raw_user_meta_data->>'nickname', ''), '여행자')
from auth.users
on conflict (id) do nothing;
