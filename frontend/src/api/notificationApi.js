import { supabase } from "../lib/supabaseClient";

export async function createNotification({
  roomId,
  receiverId,
  senderId,
  type,
  title,
  message,
  link,
}) {
  if (!receiverId) {
    console.warn("receiverId가 없어서 알림을 생성하지 않습니다.");
    return;
  }

  const { error } = await supabase.from("notifications").insert([
    {
      roomid: roomId != null ? Number(roomId) : null,
      receiverid: receiverId,
      senderid: senderId || null,
      type,
      title,
      message,
      link,
      isread: false,
    },
  ]);

  if (error) {
    console.error("알림 생성 실패:", error);
    console.error("알림 생성 실패 상세:", JSON.stringify(error, null, 2));
    throw new Error("알림 생성 실패");
  }
}

export async function createGuestNotification({
  roomId,
  guestId,
  type = "location_request",
  title = "위치 등록 요청",
  message,
  link,
}) {
  if (!guestId) {
    console.warn("guestId가 없어 게스트 알림을 생성하지 않습니다.");
    return;
  }

  const { error } = await supabase.from("notifications").insert([
    {
      roomid: roomId != null ? Number(roomId) : null,
      receiverid: guestId,
      senderid: null,
      type,
      title,
      message,
      link: link || (roomId ? `/rooms/${Number(roomId)}?tab=location` : null),
      isread: false,
    },
  ]);

  if (error) {
    console.error("게스트 알림 생성 실패:", error);
    console.error("게스트 알림 생성 실패 상세:", JSON.stringify(error, null, 2));
    throw new Error("게스트 알림 생성 실패");
  }
}

export async function createRoomNotifications({
  roomId,
  senderId,
  type,
  title,
  message,
  link,
  targetUserIds,
}) {
  if (!roomId) {
    throw new Error("roomId가 필요합니다.");
  }

  let targetReceivers = [];

  if (targetUserIds && targetUserIds.length > 0) {
    targetReceivers = targetUserIds
      .filter((id) => id && id !== senderId)
      .map((receiverid) => ({ receiverid }));
  } else {
    const [{ data: members, error: memberError }, { data: guests, error: guestError }] =
      await Promise.all([
        supabase
          .from("room_members")
          .select("userid")
          .eq("roomid", Number(roomId)),
        supabase
          .from("room_guests")
          .select("id")
          .eq("roomid", Number(roomId)),
      ]);

    if (memberError) {
      console.error("방 멤버 조회 실패:", memberError);
      console.error("방 멤버 조회 실패 상세:", JSON.stringify(memberError, null, 2));
      throw new Error("방 멤버 조회 실패");
    }

    if (guestError) {
      console.error("방 게스트 조회 실패:", guestError);
      console.error("방 게스트 조회 실패 상세:", JSON.stringify(guestError, null, 2));
      throw new Error("방 게스트 조회 실패");
    }

    const memberReceivers = (members || [])
      .filter((member) => member.userid && member.userid !== senderId)
      .map((member) => ({ receiverid: member.userid }));

    const guestReceivers = (guests || [])
      .filter((guest) => guest.id && guest.id !== senderId)
      .map((guest) => ({ receiverid: guest.id }));

    targetReceivers = [...memberReceivers, ...guestReceivers];
  }

  const uniqueReceivers = Array.from(
    new Map(targetReceivers.map((receiver) => [receiver.receiverid, receiver])).values()
  );

  console.log("최종 알림 대상:", uniqueReceivers);

  if (uniqueReceivers.length === 0) {
    console.warn("알림을 받을 대상이 없습니다.");
    return;
  }

  const rows = uniqueReceivers.map((receiver) => ({
    roomid: Number(roomId),
    receiverid: receiver.receiverid,
    senderid: senderId || null,
    type,
    title,
    message,
    link,
    isread: false,
  }));

  console.log("notifications insert rows:", rows);

  const { error } = await supabase.from("notifications").insert(rows);

  if (error) {
    console.error("방 전체 알림 생성 실패:", error);
    console.error("방 전체 알림 생성 실패 상세:", JSON.stringify(error, null, 2));
    throw new Error("방 전체 알림 생성 실패");
  }
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

async function getVisibleNotifications(recipientId, isGuest, unreadOnly = false) {
  const participations = await getRoomParticipations(recipientId, isGuest);

  // room_invite는 방에 들어가기 전 받는 알림이라 참여 시간 필터에서 제외
  let inviteQuery = supabase
    .from("notifications")
    .select("*")
    .eq("receiverid", recipientId)
    .eq("type", "room_invite");

  if (unreadOnly) {
    inviteQuery = inviteQuery.eq("isread", false);
  }

  const { data: inviteData, error: inviteError } = await inviteQuery;

  if (inviteError) {
    console.error("초대 알림 조회 실패:", inviteError);
    throw new Error("초대 알림 조회 실패");
  }

  const inviteNotifications = inviteData || [];

  if (participations.length === 0) {
    return inviteNotifications.sort(
      (a, b) => new Date(b.createdat) - new Date(a.createdat)
    );
  }

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("receiverid", recipientId)
    .neq("type", "room_invite")
    .in(
      "roomid",
      participations.map(({ roomid }) => roomid)
    )
    .order("createdat", { ascending: false });

  if (unreadOnly) {
    query = query.eq("isread", false);
  }

  const { data, error } = await query;

  if (error) {
    console.error("알림 조회 실패:", error);
    throw new Error("알림 조회 실패");
  }

  const regularNotifications = (data || []).filter((notification) =>
    isNotificationAfterJoining(notification, participations)
  );

  return [...inviteNotifications, ...regularNotifications].sort(
    (a, b) => new Date(b.createdat) - new Date(a.createdat)
  );
}

export async function isNotificationVisibleToRecipient(
  notification,
  recipientId,
  isGuest
) {
  if (!notification || !recipientId) return false;

  // 방 초대는 아직 방 참여 정보가 없어도 보여야 함
  if (
    notification.type === "room_invite" &&
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

  return data.map((notification) => ({
    ...notification,
    source: "guest",
    title: notification.title || "알림",
    link:
      notification.link ||
      (notification.roomid ? `/rooms/${notification.roomid}` : null),
    isread: notification.isread ?? false,
  }));
}

export async function markNotificationAsRead(notificationId) {
  const { error } = await supabase
    .from("notifications")
    .update({ isread: true })
    .eq("id", notificationId);

  if (error) {
    console.error("알림 읽음 처리 실패:", error);
    console.error("알림 읽음 처리 실패 상세:", JSON.stringify(error, null, 2));
    throw new Error("알림 읽음 처리 실패");
  }
}

export async function markGuestNotificationAsRead(notificationId) {
  const { error } = await supabase
    .from("notifications")
    .update({ isread: true })
    .eq("id", notificationId);

  if (error) {
    console.warn("게스트 알림 읽음 처리 실패:", error);
    throw new Error("게스트 알림 읽음 처리 실패");
  }
}

export async function markAllNotificationsAsRead(userId) {
  if (!userId) {
    throw new Error("userId가 필요합니다.");
  }

  const { error } = await supabase
    .from("notifications")
    .update({ isread: true })
    .eq("receiverid", userId)
    .eq("isread", false);

  if (error) {
    console.error("전체 알림 읽음 처리 실패:", error);
    console.error("전체 알림 읽음 처리 실패 상세:", JSON.stringify(error, null, 2));
    throw new Error("전체 알림 읽음 처리 실패");
  }
}

export async function getUnreadNotificationCount(userId) {
  try {
    const notifications = await getVisibleNotifications(userId, false, true);
    return notifications.length;
  } catch (error) {
    console.error("안 읽은 알림 개수 조회 실패:", error);
    return 0;
  }
}

export async function getUnreadGuestNotificationCount(guestId) {
  try {
    const notifications = await getVisibleNotifications(guestId, true, true);
    return notifications.length;
  } catch (error) {
    console.warn("읽지 않은 게스트 알림 수 조회 실패:", error);
    return 0;
  }
}

export async function deleteNotification(notificationId) {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId);

  if (error) {
    console.error("알림 삭제 실패:", error);
    console.error("알림 삭제 실패 상세:", JSON.stringify(error, null, 2));
    throw new Error("알림 삭제 실패");
  }
}

export async function deleteGuestNotification(notificationId) {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId);

  if (error) {
    console.error("게스트 알림 삭제 실패:", error);
    throw new Error("게스트 알림 삭제 실패");
  }
}

export async function deleteMyNotifications(userId) {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("receiverid", userId);

  if (error) {
    console.error("전체 알림 삭제 실패:", error);
    console.error("전체 알림 삭제 실패 상세:", JSON.stringify(error, null, 2));
    throw new Error("전체 알림 삭제 실패");
  }
}

export async function deleteMyGuestNotifications(guestId) {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("receiverid", guestId);

  if (error) {
    console.error("전체 게스트 알림 삭제 실패:", error);
    throw new Error("전체 게스트 알림 삭제 실패");
  }
}