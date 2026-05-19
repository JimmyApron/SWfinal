import { supabase } from "./supabaseClient";

export async function saveMyLocation(locationData) {
    const { data, error } = await supabase
        .from("user_locations")
        .insert([
            {
                userid: locationData.userId || "test-user",
                roomid: locationData.roomId || null,
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
        .eq("userid", userId)
        .order("createdat", { ascending: false })
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
        .eq("roomid", roomId)
        .order("createdat", { ascending: false });

    if (error) {
        throw error;
    }

    return data;
}