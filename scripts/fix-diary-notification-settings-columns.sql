-- Run in the application's Supabase SQL Editor.
-- Restores the two settings columns defined by the existing diary migration.
-- Keeps existing settings, RLS policies, grants and notification functions.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.room_diary_notification_settings
  ADD COLUMN IF NOT EXISTS lightning_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS all_complete_enabled boolean NOT NULL DEFAULT true;

-- Verify all five options requested by RoomDetailPage, not only the first error.
DO $$
DECLARE
  setting_name text;
BEGIN
  FOREACH setting_name IN ARRAY ARRAY[
    'reminders_enabled', 'published_diary_enabled', 'reaction_enabled',
    'lightning_enabled', 'all_complete_enabled'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'room_diary_notification_settings'
        AND column_name = setting_name
        AND data_type = 'boolean'
        AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'Missing or incompatible notification setting: %', setting_name;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'room_diary_notification_settings'
  AND column_name IN (
    'reminders_enabled', 'published_diary_enabled', 'reaction_enabled',
    'lightning_enabled', 'all_complete_enabled'
  )
ORDER BY column_name;
