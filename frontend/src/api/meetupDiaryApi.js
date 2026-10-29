import { supabase } from "../lib/supabaseClient";

const BUCKET = "meetup-diary-photos";

export async function getRoomDiaryIdentity(roomId) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) return { user: null, identityId: null };

  const { data: membership, error: membershipError } = await supabase
    .from("room_members")
    .select("userid")
    .eq("roomid", Number(roomId))
    .eq("userid", user.id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return { user, identityId: null };

  const { data, error } = await supabase.rpc("register_room_member_identity", {
    p_room_id: String(roomId),
  });
  if (error) throw error;
  return { user, identityId: data };
}

export async function getRoomMeetings(roomId, firstDay, lastDay) {
  const meetings = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("room_meetings")
      .select("id, source_type, source_schedule_id, title, meeting_date, start_time, end_time, is_all_day, location, location_address, lifecycle_status, attendance_status, created_at")
      .eq("room_id", Number(roomId))
      .order("meeting_date")
      .order("created_at")
      .order("id")
      .range(from, from + pageSize - 1);
    if (firstDay) query = query.gte("meeting_date", firstDay);
    if (lastDay) query = query.lte("meeting_date", lastDay);
    const { data, error } = await query;
    if (error) throw error;
    meetings.push(...(data || []));
    if (!data || data.length < pageSize) return meetings;
  }
}

export async function getRoomDiaries(roomId, meetingIds = []) {
  if (meetingIds.length === 0) return [];
  const { data, error } = await supabase
    .from("meeting_diaries")
    .select("id, meeting_id, author_identity_id, status, visibility, mood_emoji, body, version, published_at, updated_at")
    .in("meeting_id", meetingIds)
    .order("published_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getMeetingDiaryDetails(meetingId) {
  const { data, error } = await supabase.rpc("get_meeting_diary_details", {
    p_meeting_id: meetingId,
  });
  if (error) throw error;
  return data || [];
}

export async function getMeetingDiaryProgress(meetingId) {
  const { data, error } = await supabase.rpc("get_meeting_diary_progress", {
    p_meeting_id: meetingId,
  });
  if (error) throw error;
  return data;
}

export async function getMyMeetingDiary(meetingId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: identities, error: identityError } = await supabase
    .from("room_actor_identities")
    .select("id")
    .eq("auth_user_id", user.id);
  if (identityError) throw identityError;
  const ids = (identities || []).map((identity) => identity.id);
  if (ids.length === 0) return null;
  const { data, error } = await supabase
    .from("meeting_diaries")
    .select("id, meeting_id, author_identity_id, status, visibility, mood_emoji, body, version, published_at, updated_at")
    .eq("meeting_id", meetingId)
    .in("author_identity_id", ids)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDiaryPhotos(diaryId, { thumbnail = false } = {}) {
  const { data, error } = await supabase
    .from("diary_photos")
    .select("id, storage_path, sort_order, is_cover")
    .eq("diary_id", diaryId)
    .order("sort_order");
  if (error) throw error;
  const photos = await Promise.all((data || []).map(async (photo) => {
    let request = supabase.storage
      .from(BUCKET)
      .createSignedUrl(photo.storage_path, 60 * 60, thumbnail
        ? { transform: { width: 480, height: 480, resize: "cover" } }
        : undefined);
    const { data: signed, error: signedError } = await request;
    if (signedError) throw signedError;
    return { ...photo, url: signed.signedUrl, file: null };
  }));
  return photos;
}

export async function getCalendarDiaryThumbnails(diaryIds) {
  if (diaryIds.length === 0) return {};
  const { data, error } = await supabase
    .from("diary_photos")
    .select("diary_id, storage_path, sort_order")
    .in("diary_id", diaryIds)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const firstPhotos = new Map();
  (data || []).forEach((photo) => {
    if (!firstPhotos.has(photo.diary_id)) firstPhotos.set(photo.diary_id, photo);
  });
  const entries = await Promise.all([...firstPhotos.values()].map(async (photo) => {
    const { data: signed, error: signedError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(photo.storage_path, 60 * 60, {
        transform: { width: 120, height: 120, resize: "cover" },
      });
    if (signedError) return null;
    return [photo.diary_id, signed.signedUrl];
  }));
  return Object.fromEntries(entries.filter(Boolean));
}

export async function saveDiary({ meetingId, expectedVersion, body, moodEmoji, visibility, publish, requestId }) {
  const { data, error } = await supabase.rpc("save_meeting_diary", {
    p_meeting_id: meetingId,
    p_expected_version: expectedVersion,
    p_body: body,
    p_mood_emoji: moodEmoji || null,
    p_visibility: visibility,
    p_publish: publish,
    p_request_id: requestId,
  });
  if (error) throw error;
  return data;
}

export async function uploadDiaryPhotos({ roomId, meetingId, diaryId, photos, expectedVersion }) {
  const uploadedPaths = [];
  const prepared = [];
  try {
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      let path = photo.storage_path;
      if (photo.file) {
        const extension = (photo.file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";
        path = `${roomId}/${meetingId}/${diaryId}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, photo.file, {
          contentType: photo.file.type || "image/jpeg",
          upsert: false,
        });
        if (error) throw error;
        uploadedPaths.push(path);
      }
      prepared.push({ storage_path: path, sort_order: index, is_cover: Boolean(photo.is_cover) });
    }
    const { data, error } = await supabase.rpc("replace_meeting_diary_photos", {
      p_diary_id: diaryId,
      p_expected_version: expectedVersion,
      p_photos: prepared,
      p_request_id: crypto.randomUUID(),
    });
    if (error) throw error;
    return { ...data, photos: prepared };
  } catch (error) {
    if (uploadedPaths.length) {
      await supabase.storage.from(BUCKET).remove(uploadedPaths);
    }
    throw error;
  }
}

export async function createLightningMeeting({ roomId, date, title, startTime, endTime, location, address, participantUserIds = [], requestId }) {
  const { data, error } = await supabase.rpc("create_room_lightning_meeting", {
    p_room_id: String(roomId),
    p_meeting_date: date,
    p_title: title || null,
    p_start_time: startTime || null,
    p_end_time: endTime || null,
    p_location: location || null,
    p_location_address: address || null,
    p_participant_actor_ids: participantUserIds,
    p_request_id: requestId || crypto.randomUUID(),
  });
  if (error) throw error;
  return data;
}

export async function saveDiaryReaction({ diaryId, identityId, emoji }) {
  const { data: existing, error: readError } = await supabase
    .from("diary_reactions")
    .select("id, emoji")
    .eq("diary_id", diaryId)
    .eq("actor_identity_id", identityId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing?.emoji === emoji) {
    const { error } = await supabase.from("diary_reactions").delete().eq("id", existing.id);
    if (error) throw error;
    return null;
  }
  if (existing) {
    const { error } = await supabase.from("diary_reactions").delete().eq("id", existing.id);
    if (error) throw error;
  }
  const { data, error } = await supabase.from("diary_reactions").insert({
    diary_id: diaryId,
    actor_identity_id: identityId,
    emoji,
  }).select("id, emoji, actor_identity_id").single();
  if (error) throw error;
  return data;
}

export async function deleteDiaryPhotosAndRecord(diary) {
  const { error } = await supabase.rpc("delete_meeting_diary", { p_diary_id: diary.id });
  if (error) throw error;
}
