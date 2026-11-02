-- Server-owned Google Drive credentials and per-member, per-room backup preferences.
-- No browser role can read refresh tokens, even in encrypted form.
CREATE TABLE IF NOT EXISTS public.google_drive_connections (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_refresh_token text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.room_google_drive_backups (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id bigint NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  last_error text,
  PRIMARY KEY (user_id, room_id)
);
CREATE INDEX IF NOT EXISTS room_google_drive_backups_enabled_idx
  ON public.room_google_drive_backups (user_id, room_id) WHERE enabled;

ALTER TABLE public.google_drive_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_google_drive_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_drive_connections, public.room_google_drive_backups FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_drive_connections, public.room_google_drive_backups TO service_role;
