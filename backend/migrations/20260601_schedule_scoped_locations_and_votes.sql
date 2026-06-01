create table if not exists public.schedule_user_locations (
  like public.user_locations including defaults including generated
);

alter table public.schedule_user_locations
  add column if not exists scheduleid bigint;

alter table public.schedule_user_locations
  alter column scheduleid set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_user_locations_profile_fkey'
  ) then
    alter table public.schedule_user_locations
      add constraint schedule_user_locations_profile_fkey
      foreign key (userid) references public.profiles(id) on delete cascade;
  end if;
end $$;

drop index if exists public.schedule_user_locations_schedule_user_idx;
create unique index schedule_user_locations_schedule_user_idx
  on public.schedule_user_locations (scheduleid, userid);

drop index if exists public.schedule_user_locations_schedule_guest_idx;
create unique index schedule_user_locations_schedule_guest_idx
  on public.schedule_user_locations (scheduleid, guestid);

create index if not exists schedule_user_locations_room_schedule_idx
  on public.schedule_user_locations (roomid, scheduleid);

alter table public.votes
  add column if not exists scheduleid bigint references public.confirmed_schedules(id) on delete cascade;

create index if not exists votes_scheduleid_idx
  on public.votes (scheduleid);

grant select, insert, update, delete
  on public.schedule_user_locations
  to anon, authenticated;

alter table public.schedule_user_locations enable row level security;

drop policy if exists "schedule locations follow existing guest access model"
  on public.schedule_user_locations;

create policy "schedule locations follow existing guest access model"
  on public.schedule_user_locations
  for all
  to anon, authenticated
  using (true)
  with check (true);

notify pgrst, 'reload schema';
