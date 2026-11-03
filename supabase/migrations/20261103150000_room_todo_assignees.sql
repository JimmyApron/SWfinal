-- 공동 할 일 담당자 지정 (선택): 비어 있으면 방 멤버 누구나, 값이 있으면 담당자만 완료 체크 가능
ALTER TABLE public.room_todos ADD COLUMN IF NOT EXISTS assignees uuid[] NOT NULL DEFAULT '{}';

DROP POLICY IF EXISTS "members complete own" ON public.room_todo_completions;
CREATE POLICY "members complete own" ON public.room_todo_completions FOR INSERT TO authenticated
  WITH CHECK (
    userid = auth.uid() AND EXISTS (
      SELECT 1 FROM public.room_todos t JOIN public.room_members m ON m.roomid::text = t.roomid::text
      WHERE t.id = room_todo_completions.todoid
        AND m.userid::text = auth.uid()::text
        AND (cardinality(t.assignees) = 0 OR auth.uid() = ANY (t.assignees))
    )
  );
