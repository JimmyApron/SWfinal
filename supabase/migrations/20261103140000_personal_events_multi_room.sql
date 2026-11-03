-- 개인 일정을 여러 방에 동시에 공유: roomid(1개) -> roomids(배열)
-- roomids 가 비어 있으면 나만 보는 일정, 방 id 가 들어 있으면 그 방 멤버에게 공용 캘린더로 보인다.
ALTER TABLE public.personal_events ADD COLUMN IF NOT EXISTS roomids bigint[] NOT NULL DEFAULT '{}';
UPDATE public.personal_events SET roomids = ARRAY[roomid] WHERE roomid IS NOT NULL AND roomids = '{}';
CREATE INDEX IF NOT EXISTS personal_events_roomids_gin ON public.personal_events USING gin (roomids);

DROP POLICY IF EXISTS "room members can read room events" ON public.personal_events;
CREATE POLICY "room members can read room events" ON public.personal_events
  FOR SELECT TO authenticated
  USING (
    cardinality(roomids) > 0 AND EXISTS (
      SELECT 1 FROM public.room_members m
      WHERE m.userid::text = auth.uid()::text AND m.roomid::text = ANY (personal_events.roomids::text[])
    )
  );
