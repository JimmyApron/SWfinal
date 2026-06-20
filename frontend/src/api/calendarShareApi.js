import { supabase } from "../lib/supabaseClient";
import { createNotification } from "./notificationApi";

export async function sendCalendarShareRequest(senderId, receiverId, senderNickname) {
  const { data: existing } = await supabase
    .from("calendar_shares")
    .select("id, status")
    .or(`and(senderid.eq.${senderId},receiverid.eq.${receiverId}),and(senderid.eq.${receiverId},receiverid.eq.${senderId})`)
    .maybeSingle();

  if (existing) {
    if (existing.status === "accepted") throw new Error("이미 캘린더를 공유 중입니다.");
    throw new Error("이미 공유 요청을 보냈거나 받은 상태입니다.");
  }

  const { data: inserted, error } = await supabase
    .from("calendar_shares")
    .insert([{ senderid: senderId, receiverid: receiverId, status: "pending" }])
    .select("id")
    .single();

  if (error) throw new Error("공유 요청 실패");

  await createNotification({
    roomId: null,
    receiverId: receiverId,
    senderId: senderId,
    type: "calendar_share_request",
    title: "📅 캘린더 공개 요청",
    message: `${senderNickname}님이 캘린더 공개를 요청했습니다`,
    link: null,
  });

  return inserted?.id ?? null;
}

export async function getAcceptedShares(userId) {
  const { data, error } = await supabase
    .from("calendar_shares")
    .select("id, senderid, receiverid")
    .eq("status", "accepted")
    .or(`senderid.eq.${userId},receiverid.eq.${userId}`);

  if (error) throw new Error("공유 목록 조회 실패");

  const friendIds = (data || []).map((r) =>
    r.senderid === userId ? r.receiverid : r.senderid
  );
  if (!friendIds.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, nickname, profileimageurl")
    .in("id", friendIds);

  return (profiles || []).map((p) => ({
    ...p,
    shareId: (data || []).find((r) => r.senderid === p.id || r.receiverid === p.id)?.id,
  }));
}

export async function acceptCalendarShare(myId, friendId) {
  const { error } = await supabase
    .from("calendar_shares")
    .update({ status: "accepted" })
    .eq("senderid", friendId)
    .eq("receiverid", myId);

  if (error) throw new Error("공유 수락 실패");
}

export async function getSentPendingCalendarShares(userId) {
  const { data, error } = await supabase
    .from("calendar_shares")
    .select("id, receiverid")
    .eq("senderid", userId)
    .eq("status", "pending");

  if (error) throw new Error("보낸 공유 요청 조회 실패");

  const rows = data || [];
  if (!rows.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, nickname, profileimageurl")
    .in("id", rows.map((r) => r.receiverid));

  return rows.map((row) => {
    const profile = (profiles || []).find((p) => p.id === row.receiverid) || {};
    return { shareId: row.id, receiverId: row.receiverid, ...profile };
  });
}

export async function getReceivedPendingCalendarShares(userId) {
  const { data, error } = await supabase
    .from("calendar_shares")
    .select("id, senderid")
    .eq("receiverid", userId)
    .eq("status", "pending");

  if (error) throw new Error("받은 공유 요청 조회 실패");

  const rows = data || [];
  if (!rows.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, nickname, profileimageurl")
    .in("id", rows.map((r) => r.senderid));

  return rows.map((row) => {
    const profile = (profiles || []).find((p) => p.id === row.senderid) || {};
    return { shareId: row.id, senderId: row.senderid, ...profile };
  });
}

export async function cancelCalendarShareRequest(shareId, senderId, receiverId) {
  const { error } = await supabase
    .from("calendar_shares")
    .delete()
    .eq("id", shareId);

  if (error) throw new Error("공유 요청 취소 실패");

  // 상대방에게 보낸 알림도 삭제
  await supabase
    .from("notifications")
    .delete()
    .eq("type", "calendar_share_request")
    .eq("senderid", senderId)
    .eq("receiverid", receiverId);
}

export async function rejectCalendarShare(friendId, myId) {
  const { error } = await supabase
    .from("calendar_shares")
    .delete()
    .eq("senderid", friendId)
    .eq("receiverid", myId);

  if (error) throw new Error("공유 거절 실패");
}

export async function removeCalendarShare(userId, friendId) {
  await supabase
    .from("calendar_shares")
    .delete()
    .or(`and(senderid.eq.${userId},receiverid.eq.${friendId}),and(senderid.eq.${friendId},receiverid.eq.${userId})`);
}

export async function getSharedFriendsPersonalEvents(userId) {
  const { data: shares } = await supabase
    .from("calendar_shares")
    .select("senderid, receiverid")
    .eq("status", "accepted")
    .or(`senderid.eq.${userId},receiverid.eq.${userId}`);

  if (!shares || !shares.length) return [];

  const friendIds = shares.map((r) =>
    r.senderid === userId ? r.receiverid : r.senderid
  );

  const { data: events } = await supabase
    .from("personal_events")
    .select("*")
    .in("userid", friendIds);

  if (!events || !events.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, nickname")
    .in("id", friendIds);

  const profileMap = {};
  (profiles || []).forEach((p) => { profileMap[p.id] = p.nickname; });

  return events.map((e) => ({
    ...e,
    friendNickname: profileMap[e.userid] || "친구",
  }));
}
