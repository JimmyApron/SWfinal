import { supabase } from "../lib/supabaseClient";
import { createNotification } from "./notificationApi";

async function getProfiles(userIds) {
  if (!userIds.length) return [];
  const { data } = await supabase
    .from("profiles")
    .select("id, nickname, profileimageurl")
    .in("id", userIds);
  return data || [];
}

export async function sendFriendRequest(userId, email) {
  const trimmed = email.trim().toLowerCase();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, nickname")
    .eq("email", trimmed)
    .maybeSingle();

  if (profileError) throw new Error("프로필 조회 실패");
  if (!profile) throw new Error("해당 이메일의 사용자를 찾을 수 없습니다.");
  if (profile.id === userId) throw new Error("자기 자신은 추가할 수 없습니다.");

  const { data: existing } = await supabase
    .from("friends")
    .select("id, status")
    .or(`and(userid.eq.${userId},friendid.eq.${profile.id}),and(userid.eq.${profile.id},friendid.eq.${userId})`)
    .maybeSingle();

  if (existing) {
    if (existing.status === "accepted") throw new Error("이미 친구입니다.");
    throw new Error("이미 친구 요청을 보냈거나 받은 상태입니다.");
  }

  const { error } = await supabase
    .from("friends")
    .insert([{ userid: userId, friendid: profile.id, status: "pending" }]);

  if (error) throw new Error("친구 요청 실패");

  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("id", userId)
    .maybeSingle();
  const senderNickname = senderProfile?.nickname || "알 수 없음";

  await createNotification({
    receiverId: profile.id,
    senderId: userId,
    type: "friend_request",
    title: "친구 요청",
    message: `${senderNickname}님이 친구 요청을 보냈습니다.`,
  });
}

export async function getFriends(userId) {
  const { data, error } = await supabase
    .from("friends")
    .select("friendid")
    .eq("userid", userId)
    .eq("status", "accepted");

  if (error) throw new Error("친구 목록 조회 실패");

  const ids = (data || []).map((r) => r.friendid);
  return getProfiles(ids);
}

export async function getPendingRequests(userId) {
  const { data, error } = await supabase
    .from("friends")
    .select("id, userid")
    .eq("friendid", userId)
    .eq("status", "pending");

  if (error) throw new Error("친구 요청 조회 실패");

  const rows = data || [];
  if (!rows.length) return [];

  const profiles = await getProfiles(rows.map((r) => r.userid));
  return rows.map((row) => {
    const profile = profiles.find((p) => p.id === row.userid) || {};
    return { requestId: row.id, ...profile };
  });
}

export async function acceptFriendRequest(requestId, myId, friendId) {
  const { error: updateError } = await supabase
    .from("friends")
    .update({ status: "accepted" })
    .eq("id", requestId);

  if (updateError) throw new Error("요청 수락 실패");

  const { error: insertError } = await supabase
    .from("friends")
    .insert([{ userid: myId, friendid: friendId, status: "accepted" }]);

  if (insertError) throw new Error("친구 등록 실패");
}

export async function rejectFriendRequest(requestId) {
  const { error } = await supabase
    .from("friends")
    .delete()
    .eq("id", requestId);

  if (error) throw new Error("요청 거절 실패");
}

export async function removeFriend(userId, friendId) {
  await supabase.from("friends").delete().eq("userid", userId).eq("friendid", friendId);
  await supabase.from("friends").delete().eq("userid", friendId).eq("friendid", userId);
}

export async function checkFriendStatus(userId, friendId) {
  const { data } = await supabase
    .from("friends")
    .select("id, status, userid")
    .or(`and(userid.eq.${userId},friendid.eq.${friendId}),and(userid.eq.${friendId},friendid.eq.${userId})`)
    .limit(1)
    .maybeSingle();
  return data; // null | { id, status: 'pending' | 'accepted', userid }
}

export async function getSentRequests(userId) {
  const { data, error } = await supabase
    .from("friends")
    .select("id, friendid")
    .eq("userid", userId)
    .eq("status", "pending");

  if (error) throw new Error("보낸 요청 조회 실패");

  const rows = data || [];
  if (!rows.length) return [];

  const profiles = await getProfiles(rows.map((r) => r.friendid));
  return rows.map((row) => {
    const profile = profiles.find((p) => p.id === row.friendid) || {};
    return { requestId: row.id, ...profile };
  });
}

export async function cancelFriendRequest(requestId) {
  const { error } = await supabase
    .from("friends")
    .delete()
    .eq("id", requestId);

  if (error) throw new Error("친구 요청 취소 실패");
}

export async function sendFriendRequestById(userId, friendId) {
  if (userId === friendId) throw new Error("자기 자신은 추가할 수 없습니다.");

  const { data: existing } = await supabase
    .from("friends")
    .select("id, status")
    .or(`and(userid.eq.${userId},friendid.eq.${friendId}),and(userid.eq.${friendId},friendid.eq.${userId})`)
    .limit(1)
    .maybeSingle();

  if (existing) {
    if (existing.status === "accepted") throw new Error("이미 친구입니다.");
    throw new Error("이미 친구 요청을 보냈거나 받은 상태입니다.");
  }

  const { error } = await supabase
    .from("friends")
    .insert([{ userid: userId, friendid: friendId, status: "pending" }]);

  if (error) throw new Error("친구 요청 실패");

  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("id", userId)
    .maybeSingle();
  const senderNickname = senderProfile?.nickname || "알 수 없음";

  await createNotification({
    receiverId: friendId,
    senderId: userId,
    type: "friend_request",
    title: "친구 요청",
    message: `${senderNickname}님이 친구 요청을 보냈습니다.`,
  });
}
