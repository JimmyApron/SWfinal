import { supabase } from "../lib/supabaseClient";
import { updateRoomLastActivity } from "./roomApi";

/**
 * 알림 타입별 설정 컬럼 매핑
 */
const TYPE_SETTING_MAP = {
  vote_closed: "votenotifenabled",
  vote_reminder: "votenotifenabled",
  vote_new: "votenotifenabled",
  schedule_confirmed: "schedulenotifenabled",
  schedule_cancelled: "schedulenotifenabled",
  schedule_new: "schedulenotifenabled",
  schedule_request: "schedulenotifenabled",
  location_request: "locationnotifenabled",
  member_departed: "locationnotifenabled",
  arrival_approaching: "locationnotifenabled",
  arrival_completed: "locationnotifenabled",
  middle_place_confirmed: "locationnotifenabled",
  location_schedule_created: "locationnotifenabled",
  chat_new: "chatnotifenabled",
  room_invite: "roomnotifenabled",
  room_invite_accepted: "roomnotifenabled",
  friend_request: "friendnotifenabled",
  friend_accepted: "friendnotifenabled",
  calendar_share_request: "calendarnotifenabled",
  calendar_share_accepted: "calendarnotifenabled",
};

/**
 * 수신자별 알림 설정(issilent 여부)을 조회합니다.
 */
async function getSettingsForReceivers(roomId, targetReceivers, type) {
  const settingColumn = TYPE_SETTING_MAP[type];

  // 설정 컬럼이 없거나 roomId가 없는 경우 기본적으로 Toast 표시 (issilent: false)
  if (!settingColumn) {
    return targetReceivers.map(r => ({ ...r, issilent: false }));
  }

  try {
    // 방 관련 설정인 경우 (room_members, room_guests)
    if (roomId && ["votenotifenabled", "schedulenotifenabled", "locationnotifenabled", "chatnotifenabled"].includes(settingColumn)) {
      return targetReceivers.map(receiver => ({ ...receiver, issilent: false }));
    } 
    
    // 방과 무관한 전역 설정인 경우 (예: profiles 테이블 - 현재는 컬럼이 없을 수 있음)
    // profiles에 해당 컬럼이 있는지 확인 로직이 필요할 수 있으나, 안전하게 false 반환
    return targetReceivers.map(r => ({ ...r, issilent: false }));
  } catch (error) {
    console.error("설정 조회 실패 (기본값 false 적용):", error);
    return targetReceivers.map(r => ({ ...r, issilent: false }));
  }
}

/**
 * 중복 알림 여부를 확인합니다.
 */
async function isDuplicateNotification(receiverId, type, roomId, link) {
  // 채팅 알림은 중복 체크를 거의 하지 않음 (5초 이내 동일인/동일방/동일링크인 경우만 방지)
  const isChat = type === "chat_new";
  const windowMs = isChat ? 5 * 1000 : 60 * 1000; // 채팅은 5초, 나머지는 1분

  let query = supabase
    .from("notifications")
    .select("id")
    .eq("receiverid", String(receiverId))
    .eq("type", type);

  if (roomId) query = query.eq("roomid", Number(roomId));
  if (link) query = query.eq("link", link);
  
  const startTime = new Date(Date.now() - windowMs).toISOString();
  query = query.gt("createdat", startTime);

  const { data, error } = await query.limit(1);
  if (error) return false;
  return data && data.length > 0;
}

/**
 * 단일 알림을 생성합니다.
 */
export async function createNotification({
  roomId,
  receiverId,
  senderId,
  type,
  title,
  message,
  link,
}) {
  if (!receiverId) return;

  const recId = String(receiverId);
  const rId = roomId != null ? Number(roomId) : null;

  // 중복 체크
  const isDup = await isDuplicateNotification(recId, type, rId, link);
  if (isDup) return;

  const receivers = await getSettingsForReceivers(rId, [{ receiverid: recId }], type);
  const issilent = receivers[0].issilent;

  // 방 이름 추가 로직
  let finalMessage = message;
  if (rId && type !== "room_invite" && !message.startsWith("[")) {
    try {
      const { data: roomData } = await supabase.from("rooms").select("roomname").eq("id", rId).single();
      if (roomData?.roomname) {
        finalMessage = `[${roomData.roomname}] ${message}`;
      }
    } catch (e) {
      console.error("방 이름 조회 실패:", e);
    }
  }

  const { error } = await supabase.from("notifications").insert([
    {
      roomid: rId,
      receiverid: recId,
      senderid: senderId ? String(senderId) : null,
      type,
      title,
      message: finalMessage,
      link,
      isread: false,
      issilent: issilent ?? false,
    },
  ]);

  if (error) {
    console.error("알림 생성 실패:", error);
    throw new Error("알림 생성 실패");
  }

  if (rId) {
    updateRoomLastActivity(rId).catch(err => console.error("활동 시간 갱신 실패:", err));
  }
}

/**
 * 게스트용 단일 알림을 생성합니다.
 */
export async function createGuestNotification({
  roomId,
  guestId,
  type = "location_request",
  title = "장소 등록 요청",
  message,
  link,
}) {
  return createNotification({
    roomId,
    receiverId: guestId,
    senderId: null,
    type,
    title,
    message,
    link: link || (roomId ? `/rooms/${Number(roomId)}?tab=location` : null),
  });
}

/**
 * 여러 수신자에게 알림을 생성합니다.
 */
export async function createRoomNotifications({
  roomId,
  senderId,
  type,
  title,
  message,
  link,
  targetUserIds,
  includeSender = false,
}) {
  if (!roomId) throw new Error("roomId가 필요합니다.");

  const rId = Number(roomId);

  // 방 이름 조회 및 메시지 머리말 추가
  let finalMessage = message;
  try {
    const { data: roomData } = await supabase.from("rooms").select("roomname").eq("id", rId).single();
    if (roomData?.roomname && !message.startsWith("[")) {
      finalMessage = `[${roomData.roomname}] ${message}`;
    }
  } catch (e) {
    console.error("방 이름 조회 실패:", e);
  }

  let targetReceivers = [];

  if (targetUserIds && targetUserIds.length > 0) {
    targetReceivers = targetUserIds
      .filter((id) => id && (includeSender || String(id) !== String(senderId)))
      .map((id) => ({ receiverid: String(id) }));
  } else {
    const [{ data: members }, { data: guests }] = await Promise.all([
      supabase.from("room_members").select("userid").eq("roomid", rId),
      supabase.from("room_guests").select("id").eq("roomid", rId),
    ]);

    const memberIds = (members || [])
      .filter((m) => m.userid && (includeSender || String(m.userid) !== String(senderId)))
      .map((m) => ({ receiverid: String(m.userid) }));

    const guestIds = (guests || [])
      .filter((g) => g.id && (includeSender || String(g.id) !== String(senderId)))
      .map((g) => ({ receiverid: String(g.id) }));

    targetReceivers = [...memberIds, ...guestIds];
  }

  const uniqueReceivers = Array.from(
    new Map(targetReceivers.map((r) => [r.receiverid, r])).values()
  );

  if (uniqueReceivers.length === 0) return;

  // 각 수신자별로 중복 체크 (개별적으로 거르기 위해 필터링)
  const nonDupReceivers = [];
  for (const r of uniqueReceivers) {
    const isDup = await isDuplicateNotification(r.receiverid, type, rId, link);
    if (!isDup) nonDupReceivers.push(r);
  }

  if (nonDupReceivers.length === 0) return;

  const receiversWithSettings = await getSettingsForReceivers(rId, nonDupReceivers, type);

  const rows = receiversWithSettings.map((r) => ({
    roomid: rId,
    receiverid: r.receiverid,
    senderid: senderId ? String(senderId) : null,
    type,
    title,
    message: finalMessage,
    link,
    isread: false,
    issilent: r.issilent ?? false,
  }));

  const { error } = await supabase.from("notifications").insert(rows);

  if (error) {
    console.error("방 전체 알림 생성 실패:", error);
    throw new Error("방 전체 알림 생성 실패");
  }

  updateRoomLastActivity(rId).catch(err => console.error("활동 시간 갱신 실패:", err));
}

async function getRoomParticipations(recipientId, isGuest) {
  const table = isGuest ? "room_guests" : "room_members";
  const idColumn = isGuest ? "id" : "userid";
  const joinedAtColumn = isGuest ? "createdat" : "joinedat";

  const { data, error } = await supabase
    .from(table)
    .select(`roomid, ${joinedAtColumn}`)
    .eq(idColumn, recipientId);

  if (error) {
    console.error("방 참여 정보 조회 실패:", error);
    throw new Error("방 참여 정보 조회 실패");
  }

  return (data || []).map((participation) => ({
    roomid: participation.roomid,
    joinedat: participation[joinedAtColumn],
  }));
}

function isNotificationAfterJoining(notification, participations) {
  const participation = participations.find(
    ({ roomid }) => Number(roomid) === Number(notification.roomid)
  );

  if (!participation) return false;
  if (!participation.joinedat || !notification.createdat) return false;

  return (
    new Date(notification.createdat).getTime() >=
    new Date(participation.joinedat).getTime()
  );
}

const NON_ROOM_NOTIFICATION_TYPES = [
  "room_invite", 
  "room_invite_accepted", 
  "friend_request", 
  "friend_accepted", 
  "calendar_share_request", 
  "calendar_share_accepted"
];

export async function getVisibleNotifications(recipientId, isGuest, unreadOnly = false) {
  const participations = await getRoomParticipations(recipientId, isGuest);

  let nonRoomQuery = supabase
    .from("notifications")
    .select("*")
    .eq("receiverid", recipientId)
    .in("type", NON_ROOM_NOTIFICATION_TYPES);

  if (unreadOnly) {
    nonRoomQuery = nonRoomQuery.or("isread.is.null,isread.eq.false");
  }

  const { data: nonRoomData, error: nonRoomError } = await nonRoomQuery;
  if (nonRoomError) throw new Error("비룸 알림 조회 실패");

  const nonRoomNotifications = nonRoomData || [];

  if (participations.length === 0) {
    return nonRoomNotifications.sort((a, b) => new Date(b.createdat) - new Date(a.createdat));
  }

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("receiverid", recipientId)
    .not("type", "in", `(${NON_ROOM_NOTIFICATION_TYPES.join(",")})`)
    .in("roomid", participations.map(({ roomid }) => roomid))
    .order("createdat", { ascending: false });

  if (unreadOnly) {
    query = query.or("isread.is.null,isread.eq.false");
  }

  const { data, error } = await query;
  if (error) throw new Error("알림 조회 실패");

  const regularNotifications = (data || []).filter((notification) =>
    isNotificationAfterJoining(notification, participations)
  );

  return [...nonRoomNotifications, ...regularNotifications].sort(
    (a, b) => new Date(b.createdat) - new Date(a.createdat)
  );
}

export async function isNotificationVisibleToRecipient(notification, recipientId, isGuest) {
  if (!notification || !recipientId) return false;
  if (
    (NON_ROOM_NOTIFICATION_TYPES.includes(notification.type) || notification.type === "chat_new") &&
    String(notification.receiverid) === String(recipientId)
  ) {
    return true;
  }
  const participations = await getRoomParticipations(recipientId, isGuest);
  return isNotificationAfterJoining(notification, participations);
}

export async function getMyNotifications(userId) {
  return getVisibleNotifications(userId, false);
}

export async function getMyGuestNotifications(guestId) {
  const data = await getVisibleNotifications(guestId, true);
  return data.map((n) => ({
    ...n,
    source: "guest",
    title: n.title || "알림",
    link: n.link || (n.roomid ? `/rooms/${n.roomid}` : null),
    isread: n.isread ?? false,
  }));
}

export const TAB_TYPE_MAP = {
  schedule: ["schedule_confirmed", "schedule_cancelled", "schedule_new", "schedule_request"],
  location: [
    "location_request",
    "member_departed",
    "arrival_approaching",
    "arrival_completed",
    "middle_place_confirmed",
    "location_schedule_created",
  ],
  vote: ["vote_closed", "vote_reminder", "vote_new"],
  chat: ["chat_new"],
};

export async function markNotificationsAsReadInRoom(roomId, userId) {
  if (!roomId || !userId) return;
  await supabase
    .from("notifications")
    .update({ isread: true })
    .eq("roomid", Number(roomId))
    .eq("receiverid", userId)
    .or("isread.is.null,isread.eq.false");
}

export async function markNotificationsAsReadInRoomByType(roomId, userId, types) {
  if (!roomId || !userId || !types || types.length === 0) return;
  await supabase
    .from("notifications")
    .update({ isread: true })
    .eq("roomid", Number(roomId))
    .eq("receiverid", userId)
    .in("type", types)
    .or("isread.is.null,isread.eq.false");
}

export async function markNotificationAsRead(notificationId) {
  await supabase.from("notifications").update({ isread: true }).eq("id", notificationId);
}

export async function markGuestNotificationAsRead(notificationId) {
  await supabase.from("notifications").update({ isread: true }).eq("id", notificationId);
}

export async function markAllNotificationsAsRead(userId) {
  if (!userId) return;
  await supabase
    .from("notifications")
    .update({ isread: true })
    .eq("receiverid", userId)
    .or("isread.is.null,isread.eq.false");
}

export async function getUnreadNotificationCount(userId) {
  try {
    const notifications = await getVisibleNotifications(userId, false, true);
    return notifications.length;
  } catch (error) {
    return 0;
  }
}

export async function getUnreadGuestNotificationCount(guestId) {
  try {
    const notifications = await getVisibleNotifications(guestId, true, true);
    return notifications.length;
  } catch (error) {
    return 0;
  }
}

export async function deleteNotification(notificationId) {
  await supabase.from("notifications").delete().eq("id", notificationId);
}

export async function deleteGuestNotification(notificationId) {
  await supabase.from("notifications").delete().eq("id", notificationId);
}

export async function deleteMyNotifications(userId) {
  await supabase.from("notifications").delete().eq("receiverid", userId);
}

export async function deleteFriendRequestNotification(senderId, receiverId) {
  await supabase
    .from("notifications")
    .delete()
    .eq("type", "friend_request")
    .eq("senderid", senderId)
    .eq("receiverid", receiverId);
}

export async function deleteMyGuestNotifications(guestId) {
  await supabase.from("notifications").delete().eq("receiverid", guestId);
}
