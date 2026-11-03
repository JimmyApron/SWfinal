-- 공동 할 일은 만든 사람과 상관없이 방 멤버 누구나 수정/삭제할 수 있다.
DROP POLICY IF EXISTS "creator updates todos" ON public.room_todos;
DROP POLICY IF EXISTS "room members update todos" ON public.room_todos;
CREATE POLICY "room members update todos" ON public.room_todos FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.room_members m WHERE m.roomid::text = room_todos.roomid::text AND m.userid::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.room_members m WHERE m.roomid::text = room_todos.roomid::text AND m.userid::text = auth.uid()::text));

DROP POLICY IF EXISTS "creator deletes todos" ON public.room_todos;
DROP POLICY IF EXISTS "room members delete todos" ON public.room_todos;
CREATE POLICY "room members delete todos" ON public.room_todos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.room_members m WHERE m.roomid::text = room_todos.roomid::text AND m.userid::text = auth.uid()::text));
