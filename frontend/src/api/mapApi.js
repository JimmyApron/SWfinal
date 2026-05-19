import { supabase } from "./supabaseClient";

export async function saveMyLocation(locationData) {
    const { data, error } = await supabase
        .from("user_locations")
        .upsert(
            {
                userid: locationData.userId,
                roomid: locationData.roomId,
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                accuracy: locationData.accuracy,
                createdat: new Date().toISOString(),
            },
            {
                onConflict: "userid,roomid",
            }
        )
        .select();

    if (error) {
        throw error;
    }

    return data;
}

export async function getMyLocation(userId) {
    if (!userId) {
        throw new Error("userId가 필요합니다.");
    }

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
    if (!roomId) {
        throw new Error("roomId가 필요합니다.");
    }

    const { data, error } = await supabase
        .from("user_locations")
        .select(`
            *,
            profiles (
                id,
                nickname,
                profile_image_url
            )
        `)
        .eq("roomid", roomId)
        .order("createdat", { ascending: false });

    if (error) {
        throw error;
    }

    return data;
}