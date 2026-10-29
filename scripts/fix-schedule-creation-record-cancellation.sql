-- Run in the app project's Supabase SQL Editor.
-- Changes only the creator-record foreign key's deletion behavior.
-- Existing schedules and creator records are not deleted by this script.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  target record;
  definition text;
  updated_definition text;
  matches integer;
BEGIN
  SELECT count(*) INTO matches
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.conrelid = 'public.schedule_creation_records'::regclass
    AND c.confrelid = 'public.confirmed_schedules'::regclass
    AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid = c.conrelid AND attname = 'schedule_id')]::smallint[]
    AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid = c.confrelid AND attname = 'id')]::smallint[];

  IF matches <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one schedule_id foreign key, found %', matches;
  END IF;

  SELECT c.conname, c.confdeltype, pg_get_constraintdef(c.oid) AS definition
  INTO target
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.conrelid = 'public.schedule_creation_records'::regclass
    AND c.confrelid = 'public.confirmed_schedules'::regclass
    AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid = c.conrelid AND attname = 'schedule_id')]::smallint[]
    AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid = c.confrelid AND attname = 'id')]::smallint[];

  IF target.confdeltype = 'c' THEN RETURN; END IF;
  IF target.confdeltype NOT IN ('a', 'r') THEN
    RAISE EXCEPTION 'Unexpected deletion policy; inspect before changing: %', target.definition;
  END IF;

  -- Preserve ON UPDATE, deferrability and validation options from the real FK.
  definition := regexp_replace(target.definition, ' ON DELETE (NO ACTION|RESTRICT)', '');
  updated_definition := regexp_replace(definition,
    '(REFERENCES [^(]+\([^)]*\)( ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT))?)',
    '\1 ON DELETE CASCADE');
  IF updated_definition = definition THEN
    RAISE EXCEPTION 'Cannot safely rewrite foreign key: %', target.definition;
  END IF;

  EXECUTE format('ALTER TABLE public.schedule_creation_records DROP CONSTRAINT %I', target.conname);
  EXECUTE format('ALTER TABLE public.schedule_creation_records ADD CONSTRAINT %I %s', target.conname, updated_definition);
END $$;

COMMIT;

-- Confirm the creator-record FK now includes ON DELETE CASCADE.
SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.conrelid = 'public.schedule_creation_records'::regclass
  AND c.confrelid = 'public.confirmed_schedules'::regclass;
