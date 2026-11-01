-- Active room actors may correct a lightning meeting's place, even when
-- another member created the meeting or a diary has already been written.
CREATE OR REPLACE FUNCTION public.update_room_lightning_meeting_place(
  p_room_id text,
  p_meeting_id uuid,
  p_location text,
  p_location_address text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_room_id public.rooms.id%TYPE;
  v_location text := NULLIF(btrim(p_location), '');
  v_address text := NULLIF(btrim(p_location_address), '');
  v_updated_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_meeting_id IS NULL THEN
    RAISE EXCEPTION 'Meeting id is required' USING ERRCODE = '22023';
  END IF;
  SELECT r.id INTO v_room_id FROM public.rooms r WHERE r.id::text = p_room_id;
  IF v_room_id IS NULL OR NOT meetup_private.is_active_room_actor(p_room_id) THEN
    RAISE EXCEPTION 'Active room membership required' USING ERRCODE = '42501';
  END IF;
  IF length(v_location) > 200 OR length(v_address) > 500
     OR (v_location IS NULL AND v_address IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid meeting place' USING ERRCODE = '22023';
  END IF;

  UPDATE public.room_meetings m
  SET location = v_location,
      location_address = v_address,
      updated_at = now()
  WHERE m.id = p_meeting_id
    AND m.room_id = v_room_id
    AND m.source_type = 'lightning'
    AND m.lifecycle_status <> 'cancelled'
  RETURNING m.id INTO v_updated_id;
  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Lightning meeting not found in room' USING ERRCODE = 'P0002';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.update_room_lightning_meeting_place(text,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_room_lightning_meeting_place(text,uuid,text,text) TO authenticated;
