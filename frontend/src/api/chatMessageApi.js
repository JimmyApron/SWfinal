import { supabase } from "../lib/supabaseClient";

// Common room_messages write format, shared by plain chat and course cards.
export function createRoomMessage(message) {
  return supabase.from("room_messages").insert([message]);
}
