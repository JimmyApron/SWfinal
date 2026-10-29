-- Prep reminders use a stable schedule/attendee/date key so restarts and
-- overlapping job instances cannot create duplicate inbox records.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_key_uidx
  ON public.notifications(idempotency_key);

-- Notify once when the first non-empty checklist is created. A statement
-- trigger lets an AI batch produce one checklist event instead of one alert
-- per recommended item. The insert and inbox records commit together.
CREATE OR REPLACE FUNCTION meetup_private.notify_first_prep_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_schedule record;
  v_room_name text;
  v_creator_ids text[];
  v_created_schedule_id bigint;
BEGIN
  FOR v_created_schedule_id IN
    SELECT DISTINCT n.scheduleid FROM inserted_prep_items n
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('prep-checklist:' || v_created_schedule_id::text, 0));

    IF EXISTS (
      SELECT 1 FROM public.prep_items p
      WHERE p.scheduleid = v_created_schedule_id
        AND NOT EXISTS (SELECT 1 FROM inserted_prep_items n WHERE n.id = p.id)
    ) THEN
      CONTINUE;
    END IF;

    SELECT cs.id, cs.roomid, cs.title, cs.absentees
      INTO v_schedule
    FROM public.confirmed_schedules cs
    WHERE cs.id = v_created_schedule_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT r.roomname INTO v_room_name
    FROM public.rooms r WHERE r.id = v_schedule.roomid;

    SELECT COALESCE(array_agg(DISTINCT n.createdby), ARRAY[]::text[])
      INTO v_creator_ids
    FROM inserted_prep_items n
    WHERE n.scheduleid = v_created_schedule_id AND n.createdby IS NOT NULL;

    INSERT INTO public.notifications(
      roomid, receiverid, senderid, type, title, message, link, isread,
      issilent, idempotency_key
    )
    SELECT v_schedule.roomid,
      audience.receiver_id,
      NULL,
      'prep_checklist_created',
      '여행 준비물 체크리스트가 만들어졌어요',
      '[' || COALESCE(v_room_name, '모임') || '] 여행 준비물 체크리스트가 만들어졌어요. 필요한 물품을 확인해 주세요.',
      '/schedules/' || v_schedule.id::text || '/prep',
      false,
      NOT COALESCE(audience.notifications_enabled, true),
      'prep_checklist_created:' || v_schedule.id::text || ':' || audience.receiver_id
    FROM (
      SELECT rm.userid::text AS receiver_id, rm.schedulenotifenabled AS notifications_enabled
      FROM public.room_members rm
      WHERE rm.roomid = v_schedule.roomid
        AND rm.userid IS NOT NULL
        AND NOT (COALESCE(to_jsonb(v_schedule.absentees), '[]'::jsonb) ? rm.userid::text)
        AND NOT (rm.userid::text = ANY(v_creator_ids))
      UNION ALL
      SELECT rg.id::text AS receiver_id, rg.schedulenotifenabled AS notifications_enabled
      FROM public.room_guests rg
      WHERE rg.roomid = v_schedule.roomid
        AND NOT (COALESCE(to_jsonb(v_schedule.absentees), '[]'::jsonb) ? rg.id::text)
        AND NOT (rg.id::text = ANY(v_creator_ids))
    ) audience
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS prep_checklist_first_insert_notification ON public.prep_items;
CREATE TRIGGER prep_checklist_first_insert_notification
AFTER INSERT ON public.prep_items
REFERENCING NEW TABLE AS inserted_prep_items
FOR EACH STATEMENT
EXECUTE FUNCTION meetup_private.notify_first_prep_checklist();

REVOKE ALL ON FUNCTION meetup_private.notify_first_prep_checklist() FROM PUBLIC, anon, authenticated;

-- Serialize all assignment and request-seat claims for one item. Pending
-- requests reserve a seat, while reminder shortage counts include assigned
-- rows only. Acceptance rechecks confirmed capacity under the same lock.
CREATE OR REPLACE FUNCTION meetup_private.validate_prep_assignment_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item public.prep_items%ROWTYPE;
  v_room_id bigint;
  v_absentees_json jsonb;
  v_active_count integer;
  v_assigned_count integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('prep-item:' || NEW.itemid::text, 0));
  SELECT * INTO v_item FROM public.prep_items WHERE id = NEW.itemid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Preparation item no longer exists' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.kind <> 'shared' THEN
    RAISE EXCEPTION 'Assignments are only allowed for shared preparation items' USING ERRCODE = '22023';
  END IF;

  SELECT cs.roomid, COALESCE(to_jsonb(cs.absentees), '[]'::jsonb)
    INTO v_room_id, v_absentees_json
  FROM public.confirmed_schedules cs WHERE cs.id = v_item.scheduleid;
  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Schedule no longer exists' USING ERRCODE = 'P0002';
  END IF;

  IF NEW.membertype = 'member' THEN
    IF NOT EXISTS (SELECT 1 FROM public.room_members m WHERE m.roomid = v_room_id AND m.userid::text = NEW.memberid)
       OR v_absentees_json ? NEW.memberid THEN
      RAISE EXCEPTION 'Assignee is not attending this schedule' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.room_guests g WHERE g.roomid = v_room_id AND g.id::text = NEW.memberid)
       OR v_absentees_json ? NEW.memberid THEN
      RAISE EXCEPTION 'Assignee is not attending this schedule' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status = 'requested' THEN
    IF NEW.requestedby IS NULL OR NEW.requestedbytype IS NULL
       OR (NEW.memberid = NEW.requestedby AND NEW.membertype = NEW.requestedbytype) THEN
      RAISE EXCEPTION 'A request must target another attendee' USING ERRCODE = '22023';
    END IF;
    IF NEW.requestedbytype = 'member' THEN
      IF NOT EXISTS (SELECT 1 FROM public.room_members m WHERE m.roomid = v_room_id AND m.userid::text = NEW.requestedby)
         OR v_absentees_json ? NEW.requestedby THEN
        RAISE EXCEPTION 'Requester is not attending this schedule' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.room_guests g WHERE g.roomid = v_room_id AND g.id::text = NEW.requestedby)
         OR v_absentees_json ? NEW.requestedby THEN
        RAISE EXCEPTION 'Requester is not attending this schedule' USING ERRCODE = '42501';
      END IF;
    END IF;

    SELECT count(*)::integer INTO v_active_count
    FROM public.prep_assignments a
    WHERE a.itemid = NEW.itemid AND a.status IN ('assigned', 'requested')
      AND (TG_OP = 'INSERT' OR a.id <> NEW.id);
    IF v_active_count >= v_item.neededcount THEN
      RAISE EXCEPTION 'No available preparation seats' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'assigned' AND TG_OP = 'UPDATE' AND OLD.status = 'requested' THEN
    IF NEW.requestedby IS NULL OR NEW.requestedbytype IS NULL THEN
      RAISE EXCEPTION 'Request details are missing' USING ERRCODE = '22023';
    END IF;
    IF NEW.requestedbytype = 'member' THEN
      IF NOT EXISTS (SELECT 1 FROM public.room_members m WHERE m.roomid = v_room_id AND m.userid::text = NEW.requestedby)
         OR v_absentees_json ? NEW.requestedby THEN
        RAISE EXCEPTION 'Requester is no longer attending this schedule' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.requestedbytype = 'guest' THEN
      IF NOT EXISTS (SELECT 1 FROM public.room_guests g WHERE g.roomid = v_room_id AND g.id::text = NEW.requestedby)
         OR v_absentees_json ? NEW.requestedby THEN
        RAISE EXCEPTION 'Requester is no longer attending this schedule' USING ERRCODE = '42501';
      END IF;
    END IF;
    SELECT count(*)::integer INTO v_assigned_count
    FROM public.prep_assignments a
    WHERE a.itemid = NEW.itemid AND a.status = 'assigned' AND a.id <> NEW.id;
    IF v_assigned_count >= v_item.neededcount THEN
      RAISE EXCEPTION 'No confirmed preparation seats remain' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'assigned' AND TG_OP = 'INSERT' THEN
    SELECT count(*)::integer INTO v_active_count
    FROM public.prep_assignments a
    WHERE a.itemid = NEW.itemid AND a.status IN ('assigned', 'requested');
    IF v_active_count >= v_item.neededcount THEN
      RAISE EXCEPTION 'No available preparation seats' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS prep_assignment_capacity_guard ON public.prep_assignments;
CREATE TRIGGER prep_assignment_capacity_guard
BEFORE INSERT OR UPDATE OF status ON public.prep_assignments
FOR EACH ROW
EXECUTE FUNCTION meetup_private.validate_prep_assignment_capacity();

REVOKE ALL ON FUNCTION meetup_private.validate_prep_assignment_capacity() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
