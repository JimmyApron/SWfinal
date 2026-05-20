import { supabase } from "./supabaseClient";

export async function getRoomById(roomId) {
    const { data, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .single();

    if (error) {
        throw error;
    }

    return data;
}