import { supabase } from "./supabaseClient";

export async function saveMyLocation(locationData) {
    const { data, error } = await supabase
        .from("user_locations")
        .insert([
            {
                user_id: locationData.userId || "test-user",
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                accuracy: locationData.accuracy,
            },
        ])
        .select();

    if (error) {
        throw error;
    }

    return data;
}

export async function getMyLocation(userId = "test-user") {
    const { data, error } = await supabase
        .from("user_locations")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);

    if (error) {
        throw error;
    }

    return data?.[0] || null;
}

export async function getRoomMemberLocations(roomId) {
    const { data, error } = await supabase
        .from("user_locations")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false });

    if (error) {
        throw error;
    }

    return data;
}