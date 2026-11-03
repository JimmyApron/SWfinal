-- 방 공동 할 일: 날짜가 있는 할 일을 방 멤버가 각자 완료 체크한다.
-- requiredcount: NULL 이면 방 멤버 모두, 숫자면 그 인원만 완료하면 끝.
-- 반복 일정은 회차(occurrencedate)마다 완료를 따로 기록한다.
CREATE TABLE IF NOT EXISTS public.room_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roomid bigint NOT NULL,
  createdby uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL CHECK (char_length(btrim(title)) > 0),
  date date NOT NULL,
  duetime time,
  repeat text NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  reminder text NOT NULL DEFAULT 'none',
  requiredcount integer CHECK (requiredcount IS NULL OR requiredcount >= 1),
  memo text,
  createdat timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_todos_roomid_date_idx ON public.room_todos (roomid, date);

CREATE TABLE IF NOT EXISTS public.room_todo_completions (
  todoid uuid NOT NULL REFERENCES public.room_todos (id) ON DELETE CASCADE,
  occurrencedate date NOT NULL,
  userid uuid NOT NULL DEFAULT auth.uid(),
  completedat timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (todoid, occurrencedate, userid)
);

ALTER TABLE public.room_todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_todo_completions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_todos, public.room_todo_completions TO authenticated;

DROP POLICY IF EXISTS "room members read todos" ON public.room_todos;
CREATE POLICY "room members read todos" ON public.room_todos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.room_members m WHERE m.roomid::text = room_todos.roomid::text AND m.userid::text = auth.uid()::text));
DROP POLICY IF EXISTS "room members create todos" ON public.room_todos;
CREATE POLICY "room members create todos" ON public.room_todos FOR INSERT TO authenticated
  WITH CHECK (createdby = auth.uid() AND EXISTS (SELECT 1 FROM public.room_members m WHERE m.roomid::text = room_todos.roomid::text AND m.userid::text = auth.uid()::text));
DROP POLICY IF EXISTS "creator updates todos" ON public.room_todos;
CREATE POLICY "creator updates todos" ON public.room_todos FOR UPDATE TO authenticated
  USING (createdby = auth.uid()) WITH CHECK (createdby = auth.uid());
DROP POLICY IF EXISTS "creator deletes todos" ON public.room_todos;
CREATE POLICY "creator deletes todos" ON public.room_todos FOR DELETE TO authenticated
  USING (createdby = auth.uid());

DROP POLICY IF EXISTS "room members read completions" ON public.room_todo_completions;
CREATE POLICY "room members read completions" ON public.room_todo_completions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.room_todos t JOIN public.room_members m ON m.roomid::text = t.roomid::text
                 WHERE t.id = room_todo_completions.todoid AND m.userid::text = auth.uid()::text));
DROP POLICY IF EXISTS "members complete own" ON public.room_todo_completions;
CREATE POLICY "members complete own" ON public.room_todo_completions FOR INSERT TO authenticated
  WITH CHECK (userid = auth.uid() AND EXISTS (SELECT 1 FROM public.room_todos t JOIN public.room_members m ON m.roomid::text = t.roomid::text
                 WHERE t.id = room_todo_completions.todoid AND m.userid::text = auth.uid()::text));
DROP POLICY IF EXISTS "members undo own" ON public.room_todo_completions;
CREATE POLICY "members undo own" ON public.room_todo_completions FOR DELETE TO authenticated
  USING (userid = auth.uid());

-- 실시간 갱신(팀원이 완료 체크하면 다른 팀원 화면에 바로 반영)을 위해 Realtime 발행에 추가
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_todos') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.room_todos;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_todo_completions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.room_todo_completions;
    END IF;
  END IF;
END $$;

-- 완료 기록에 방 정보를 둬서 Realtime 이 방 단위로 걸러 보낼 수 있게 한다 (roomid 는 할 일에서 자동으로 채움)
ALTER TABLE public.room_todo_completions ADD COLUMN IF NOT EXISTS roomid bigint;
UPDATE public.room_todo_completions c SET roomid = t.roomid FROM public.room_todos t WHERE t.id = c.todoid AND c.roomid IS NULL;

CREATE OR REPLACE FUNCTION public.set_room_todo_completion_roomid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT roomid INTO NEW.roomid FROM public.room_todos WHERE id = NEW.todoid;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS room_todo_completions_set_roomid ON public.room_todo_completions;
CREATE TRIGGER room_todo_completions_set_roomid BEFORE INSERT ON public.room_todo_completions
  FOR EACH ROW EXECUTE FUNCTION public.set_room_todo_completion_roomid();
CREATE INDEX IF NOT EXISTS room_todo_completions_roomid_idx ON public.room_todo_completions (roomid);

-- DELETE(체크 해제) 이벤트에도 roomid 가 실리도록 전체 컬럼을 old 레코드에 포함
ALTER TABLE public.room_todo_completions REPLICA IDENTITY FULL;
