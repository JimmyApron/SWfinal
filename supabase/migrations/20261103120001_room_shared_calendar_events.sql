-- 방 공용 캘린더: 개인 일정에 방 연결(roomid)을 추가한다.
-- roomid가 있는 일정은 작성자 홈 캘린더(userid 기준)에도 그대로 보이고, 같은 방 멤버에게는 방 공용 캘린더에서 보인다.
ALTER TABLE public.personal_events ADD COLUMN IF NOT EXISTS roomid bigint;
CREATE INDEX IF NOT EXISTS personal_events_roomid_date_idx ON public.personal_events (roomid, date) WHERE roomid IS NOT NULL;

DROP POLICY IF EXISTS "room members can read room events" ON public.personal_events;
CREATE POLICY "room members can read room events" ON public.personal_events
  FOR SELECT TO authenticated
  USING (
    roomid IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.room_members m
      WHERE m.roomid::text = personal_events.roomid::text AND m.userid::text = auth.uid()::text
    )
  );

-- 팀원이 직접 고르는 공용 캘린더 색상 (방 안에서 중복 불가, 비어 있으면 앱이 자동 배정)
ALTER TABLE public.room_members ADD COLUMN IF NOT EXISTS calendarcolor text;
CREATE UNIQUE INDEX IF NOT EXISTS room_members_room_calendarcolor_key ON public.room_members (roomid, calendarcolor) WHERE calendarcolor IS NOT NULL;
