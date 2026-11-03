-- Forward-only extension for owner deletion. The diary and photo metadata are
-- removed transactionally; remaining private Storage objects are inaccessible
-- because Storage SELECT requires a matching diary_photos row.
CREATE OR REPLACE FUNCTION public.delete_meeting_diary(p_diary_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_room_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
  END IF;

  SELECT m.room_id::text INTO v_room_id
  FROM public.meeting_diaries d
  JOIN public.room_meetings m ON m.id=d.meeting_id
  JOIN public.room_actor_identities i ON i.id=d.author_identity_id
  WHERE d.id=p_diary_id AND i.auth_user_id=auth.uid();

  IF v_room_id IS NULL OR NOT meetup_private.is_active_room_actor(v_room_id) THEN
    RAISE EXCEPTION 'Only the active diary owner may delete this record' USING ERRCODE='42501';
  END IF;

  DELETE FROM public.meeting_diaries d
  USING public.room_actor_identities i
  WHERE d.id=p_diary_id AND d.author_identity_id=i.id AND i.auth_user_id=auth.uid();
  RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION public.delete_meeting_diary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_meeting_diary(uuid) TO authenticated;
