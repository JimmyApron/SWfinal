-- AI preparation checklist: schedule context (event type) and place category.

-- 1) 장소 종류 (카카오 category_name 예: "음식점 > 한식 > 육류,고기").
--    기존 일정은 null 이며, 값이 없으면 장소 이름으로만 추론한다.
alter table public.confirmed_schedules
  add column if not exists locationcategory text;

-- 2) 일정별 약속 종류 / 한 줄 설명 (일정당 하나, 멤버 누구나 수정).
create table if not exists public.prep_contexts (
  scheduleid bigint primary key references public.confirmed_schedules (id) on delete cascade,
  category text check (
    category is null or category in (
      'meal', 'drink', 'birthday', 'concert', 'sports', 'trip', 'picnic', 'study', 'etc'
    )
  ),
  note text check (note is null or char_length(note) <= 40),
  updatedby text,
  updatedbytype text check (updatedbytype in ('member', 'guest')),
  updatedat timestamptz not null default now()
);

-- 기존 prep_* 테이블과 동일하게 RLS 비활성 (프론트 anon 키로 직접 접근).
alter table public.prep_contexts disable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'prep_contexts'
  ) then
    alter publication supabase_realtime add table public.prep_contexts;
  end if;
end
$$;
