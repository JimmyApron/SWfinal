-- Existing appDataFolder connections must reauthorize before writing to My Drive.
ALTER TABLE public.google_drive_connections
  ADD COLUMN drive_scope text;
