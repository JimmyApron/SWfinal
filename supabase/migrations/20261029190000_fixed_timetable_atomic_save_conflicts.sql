-- Atomic replacement and optimistic concurrency for private weekly schedules.
CREATE OR REPLACE FUNCTION public.save_my_fixed_timetable(
  p_user_id uuid,
  p_expected_blocks jsonb,
  p_blocks jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_block record;
  v_current jsonb;
  v_expected jsonb;
  v_next jsonb;
  v_start time;
  v_end time;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Only the signed-in owner may save this timetable' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_expected_blocks) <> 'array' OR jsonb_typeof(p_blocks) <> 'array'
     OR jsonb_array_length(p_expected_blocks) > 336 OR jsonb_array_length(p_blocks) > 336 THEN
    RAISE EXCEPTION 'Invalid timetable payload' USING ERRCODE = '22023';
  END IF;

  -- Serialize replacements for the same owner. The current snapshot check prevents
  -- a stale device from overwriting a newer edit.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  FOR v_block IN
    SELECT * FROM pg_catalog.jsonb_to_recordset(p_blocks)
      AS x(weekday integer, starttime text, endtime text)
  LOOP
    IF v_block.weekday IS NULL OR v_block.weekday NOT BETWEEN 0 AND 6
       OR v_block.starttime !~ '^(?:[01][0-9]|2[0-3]):[03]0$'
       OR v_block.endtime !~ '^(?:(?:[01][0-9]|2[0-3]):[03]0|24:00)$' THEN
      RAISE EXCEPTION 'Timetable entries must use weekdays 0-6 and 30-minute intervals' USING ERRCODE = '22023';
    END IF;
    v_start := v_block.starttime::time;
    v_end := v_block.endtime::time;
    IF v_end <= v_start THEN
      RAISE EXCEPTION 'Timetable end must be later than start' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT weekday, starttime::time AS starttime, endtime::time AS endtime,
             max(endtime::time) OVER (
               PARTITION BY weekday ORDER BY starttime::time, endtime::time
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ) AS previous_end
      FROM pg_catalog.jsonb_to_recordset(p_blocks) AS x(weekday integer, starttime text, endtime text)
    ) ranges
    WHERE previous_end > starttime
  ) THEN
    RAISE EXCEPTION 'Overlapping timetable entries are not allowed' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('weekday', weekday, 'starttime', pg_catalog.to_char(starttime, 'HH24:MI'), 'endtime', pg_catalog.to_char(endtime, 'HH24:MI'))
    ORDER BY weekday, starttime, endtime
  ), '[]'::jsonb)
  INTO v_current
  FROM public.fixed_timetables
  WHERE userid = p_user_id;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('weekday', weekday, 'starttime', pg_catalog.to_char(starttime::time, 'HH24:MI'), 'endtime', pg_catalog.to_char(endtime::time, 'HH24:MI'))
    ORDER BY weekday, starttime::time, endtime::time
  ), '[]'::jsonb)
  INTO v_expected
  FROM pg_catalog.jsonb_to_recordset(p_expected_blocks) AS x(weekday integer, starttime text, endtime text);

  IF v_current IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Timetable changed on another device; reload before saving' USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('weekday', weekday, 'starttime', pg_catalog.to_char(starttime::time, 'HH24:MI'), 'endtime', pg_catalog.to_char(endtime::time, 'HH24:MI'))
    ORDER BY weekday, starttime::time, endtime::time
  ), '[]'::jsonb)
  INTO v_next
  FROM pg_catalog.jsonb_to_recordset(p_blocks) AS x(weekday integer, starttime text, endtime text);

  IF v_current = v_next THEN
    RETURN;
  END IF;

  DELETE FROM public.fixed_timetables WHERE userid = p_user_id;
  INSERT INTO public.fixed_timetables(userid, weekday, starttime, endtime)
  SELECT p_user_id, weekday::smallint, starttime::time, endtime::time
  FROM pg_catalog.jsonb_to_recordset(p_blocks) AS x(weekday integer, starttime text, endtime text)
  ORDER BY weekday, starttime::time;
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_fixed_timetable(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_fixed_timetable(uuid, jsonb, jsonb) TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fixed_timetables FROM anon, authenticated;
GRANT SELECT ON public.fixed_timetables TO authenticated;

-- Private deduplication state. The trigger is the only writer; no Data API role
-- can inspect conflict history or another person's timetable.
CREATE TABLE IF NOT EXISTS meetup_private.fixed_timetable_conflict_state (
  scheduleid bigint NOT NULL,
  userid uuid NOT NULL,
  roomid bigint NOT NULL,
  conflict_signature text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updatedat timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scheduleid, userid)
);
ALTER TABLE meetup_private.fixed_timetable_conflict_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON meetup_private.fixed_timetable_conflict_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION meetup_private.sync_fixed_timetable_conflict_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_schedule public.confirmed_schedules%ROWTYPE;
  v_member record;
  v_room_name text;
  v_signature text;
  v_new_conflict boolean;
  v_has_conflict boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE meetup_private.fixed_timetable_conflict_state
      SET is_active = false, updatedat = now()
      WHERE scheduleid = OLD.id AND is_active;
    RETURN OLD;
  END IF;

  v_schedule := NEW;
  IF TG_OP = 'UPDATE' AND OLD.roomid IS DISTINCT FROM NEW.roomid THEN
    UPDATE meetup_private.fixed_timetable_conflict_state
      SET is_active = false, updatedat = now()
      WHERE scheduleid = OLD.id AND roomid = OLD.roomid AND is_active;
  END IF;

  SELECT roomname INTO v_room_name FROM public.rooms WHERE id = v_schedule.roomid;
  v_signature := pg_catalog.md5(concat_ws('|', v_schedule.date::text, v_schedule.starttime::text, v_schedule.endtime::text, v_schedule.isallday::text));

  FOR v_member IN
    SELECT rm.userid, rm.schedulenotifenabled
    FROM public.room_members rm
    WHERE rm.roomid = v_schedule.roomid
      AND rm.userid IS NOT NULL
      AND NOT (COALESCE(v_schedule.absentees, ARRAY[]::uuid[]) @> ARRAY[rm.userid])
      AND NOT EXISTS (
        SELECT 1 FROM public.dismissed_schedules ds
        WHERE ds.scheduleid = v_schedule.id AND ds.userid = rm.userid::text
      )
  LOOP
    v_has_conflict := false;
    IF v_schedule.date IS NOT NULL
       AND v_schedule.date >= (now() AT TIME ZONE 'Asia/Seoul')::date
       AND (v_schedule.date > (now() AT TIME ZONE 'Asia/Seoul')::date
         OR v_schedule.isallday
         OR v_schedule.endtime > (now() AT TIME ZONE 'Asia/Seoul')::time) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.fixed_timetables ft
        WHERE ft.userid = v_member.userid
          AND ft.weekday = EXTRACT(DOW FROM v_schedule.date)::smallint
          AND (v_schedule.isallday OR (
            v_schedule.starttime IS NOT NULL AND v_schedule.endtime IS NOT NULL
            AND ft.starttime < v_schedule.endtime AND v_schedule.starttime < ft.endtime
          ))
      ) INTO v_has_conflict;
    END IF;

    IF v_has_conflict THEN
      v_new_conflict := false;
      INSERT INTO meetup_private.fixed_timetable_conflict_state(scheduleid, userid, roomid, conflict_signature, is_active)
      VALUES (v_schedule.id, v_member.userid, v_schedule.roomid, v_signature, true)
      ON CONFLICT (scheduleid, userid) DO UPDATE
        SET roomid = EXCLUDED.roomid,
            conflict_signature = EXCLUDED.conflict_signature,
            is_active = true,
            updatedat = now()
        WHERE NOT meetup_private.fixed_timetable_conflict_state.is_active
           OR meetup_private.fixed_timetable_conflict_state.conflict_signature IS DISTINCT FROM EXCLUDED.conflict_signature
      RETURNING true INTO v_new_conflict;

      IF COALESCE(v_new_conflict, false) AND COALESCE(v_member.schedulenotifenabled, true) THEN
        INSERT INTO public.notifications(roomid, receiverid, senderid, type, title, message, link, isread, issilent)
        VALUES (
          v_schedule.roomid, v_member.userid::text, NULL, 'fixed_timetable_conflict',
          '[' || COALESCE(v_room_name, '모임') || '] 일정 확인',
          '변경된 약속 시간이 고정 시간표와 겹쳐요. 일정을 확인해 주세요.',
          '/rooms/' || v_schedule.roomid::text || '?tab=schedule&scheduleId=' || v_schedule.id::text,
          false, false
        );
      END IF;
    ELSE
      UPDATE meetup_private.fixed_timetable_conflict_state
        SET is_active = false, updatedat = now()
        WHERE scheduleid = v_schedule.id AND userid = v_member.userid AND is_active;
    END IF;
  END LOOP;

  UPDATE meetup_private.fixed_timetable_conflict_state state
    SET is_active = false, updatedat = now()
    WHERE state.scheduleid = v_schedule.id AND state.is_active
      AND (state.roomid <> v_schedule.roomid OR NOT EXISTS (
        SELECT 1 FROM public.room_members rm
        WHERE rm.roomid = v_schedule.roomid AND rm.userid = state.userid
          AND NOT (COALESCE(v_schedule.absentees, ARRAY[]::uuid[]) @> ARRAY[rm.userid])
          AND NOT EXISTS (SELECT 1 FROM public.dismissed_schedules ds WHERE ds.scheduleid = v_schedule.id AND ds.userid = rm.userid::text)
      ));

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION meetup_private.sync_fixed_timetable_conflict_notifications() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS fixed_timetable_conflicts_after_insert ON public.confirmed_schedules;
CREATE TRIGGER fixed_timetable_conflicts_after_insert
AFTER INSERT ON public.confirmed_schedules
FOR EACH ROW EXECUTE FUNCTION meetup_private.sync_fixed_timetable_conflict_notifications();

DROP TRIGGER IF EXISTS fixed_timetable_conflicts_after_schedule_change ON public.confirmed_schedules;
CREATE TRIGGER fixed_timetable_conflicts_after_schedule_change
AFTER UPDATE OF roomid, date, starttime, endtime, isallday, absentees ON public.confirmed_schedules
FOR EACH ROW EXECUTE FUNCTION meetup_private.sync_fixed_timetable_conflict_notifications();

DROP TRIGGER IF EXISTS fixed_timetable_conflicts_after_delete ON public.confirmed_schedules;
CREATE TRIGGER fixed_timetable_conflicts_after_delete
AFTER DELETE ON public.confirmed_schedules
FOR EACH ROW EXECUTE FUNCTION meetup_private.sync_fixed_timetable_conflict_notifications();
