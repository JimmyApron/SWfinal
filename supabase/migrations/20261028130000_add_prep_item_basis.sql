-- AI 추천 근거 종류 (화면에서 추천 이유 앞 아이콘으로 사용).
alter table public.prep_items
  add column if not exists basis text
  check (basis is null or basis in ('weather', 'place', 'time', 'event', 'date', 'people', 'air'));
