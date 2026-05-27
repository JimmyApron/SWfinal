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
      roomid: Number(roomId),
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
      roomid: Number(roomId),
      receiverid: guestId,
      senderid: null,
      type,
      title,
      message,
      link: link || `/rooms/${Number(roomId)}?tab=location`,
      isread: false,
    },
  ]);

  if (error) {
    console.error("게스트 알림 생성 실패:", error);
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
  let targetMembers = [];

  if (targetUserIds && targetUserIds.length > 0 ) {
    targetMembers = targetUserIds.map((userid) => ({userid}));
  } else {
    const { data: members, error: memberError } = await supabase
    .from("room_members")
    .select("userid")
    .eq("roomid", Number(roomId));

    if (memberError) {
      console.error("방 멤버 조회 실패:", memberError);
      console.error(
        "방 멤버 조회 실패 상세:",
        JSON.stringify(memberError, null, 2)
      );
      throw new Error("방 멤버 조회 실패");
    }

    console.log("알림 대상 조회 결과:", members);
    console.log("알림 보낸 사람 senderId:", senderId);

    targetMembers = (members || []).filter(
      (member) => member.userid && member.userid !== senderId
    );
  }

  console.log("최종 알림 대상:", targetMembers);

  if (targetMembers.length === 0) {
    console.warn("알림을 받을 대상이 없습니다.");
    return;
  }

  const rows = targetMembers.map((member) => ({
    roomid: Number(roomId),
    receiverid: member.userid,
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

export async function getMyNotifications(userId) {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("receiverid", userId)
    .order("createdat", { ascending: false });

  if (error) {
    console.error("알림 조회 실패:", error);
    console.error("알림 조회 실패 상세:", JSON.stringify(error, null, 2));
    throw new Error("알림 조회 실패");
  }

  return data || [];
}

export async function getMyGuestNotifications(guestId) {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("receiverid", guestId)
    .order("createdat", { ascending: false });

  if (error) {
    console.error("게스트 알림 조회 실패:", error);
    throw new Error("게스트 알림 조회 실패");
  }

  return (data || []).map((notification) => ({
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
  }
}

export async function getUnreadNotificationCount(userId) {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("receiverid", userId)
    .eq("isread", false);

  if (error) {
    console.error("안 읽은 알림 개수 조회 실패:", error);
    return 0;
  }

  return count || 0;
}

export async function getUnreadGuestNotificationCount(guestId) {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("receiverid", guestId)
    .eq("isread", false);

  if (error) {
    console.warn("읽지 않은 게스트 알림 수 조회 실패:", error);
    return 0;
  }

  return count || 0;
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
