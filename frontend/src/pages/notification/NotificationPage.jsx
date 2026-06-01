import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  getMyNotifications,
  getMyGuestNotifications,
  markNotificationAsRead,
  markGuestNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  deleteGuestNotification,
  deleteMyNotifications,
  deleteMyGuestNotifications,
  isNotificationVisibleToRecipient,
} from "../../api/notificationApi";
import { joinRoomById } from "../../api/roomApi";
import {
  acceptCalendarShare,
  rejectCalendarShare,
} from "../../api/calendarShareApi";
import { acceptFriendRequest, rejectFriendRequest } from "../../api/friendApi";
import { createNotification } from "../../api/notificationApi";

function NotificationPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isGuestUser, setIsGuestUser] = useState(false);

  const normalizeNotification = (notification) => ({
    ...notification,
    source: notification.source || (notification.guestid ? "guest" : "member"),
    title: notification.title || "알림",
    link:
      notification.link ||
      (notification.roomid ? `/rooms/${notification.roomid}` : null),
    isread: notification.isread ?? false,
  });

  useEffect(() => {
    let channel = null;
    let isMounted = true;

    const loadNotifications = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let userId = user?.id;
      let isGuest = false;

      if (!userId) {
        userId = localStorage.getItem("guest_id");
        isGuest = Boolean(userId);
      }

      console.log("현재 알림 조회 userId:", userId);

      if (!userId) {
        console.log("알림을 불러올 사용자 정보가 없습니다.");
        return;
      }

      if (!isMounted) return;

      setCurrentUserId(userId);
      setIsGuestUser(isGuest);

      // origin/feature/notification-2 기준 유지: 최신 알림 조회
      const data = isGuest
        ? await getMyGuestNotifications(userId)
        : await getMyNotifications(userId);

      if (!isMounted) return;

      console.log("불러온 알림 목록:", data);
      setNotifications((data || []).map(normalizeNotification));

      const channelName = `notification-page-${userId}-${Date.now()}`;

      channel = supabase.channel(channelName);

      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `receiverid=eq.${userId}`,
        },
        async (payload) => {
          console.log("알림 실시간 수신:", payload);

          if (payload.eventType === "INSERT") {
            const isVisible = await isNotificationVisibleToRecipient(
              payload.new,
              userId,
              isGuest
            );

            if (!isVisible) return;

            setNotifications((prev) => {
              const alreadyExists = prev.some(
                (item) => item.id === payload.new.id
              );

              if (alreadyExists) return prev;

              return [normalizeNotification(payload.new), ...prev];
            });
          }

          if (payload.eventType === "UPDATE") {
            setNotifications((prev) =>
              prev.map((item) =>
                item.id === payload.new.id
                  ? normalizeNotification(payload.new)
                  : item
              )
            );
          }

          if (payload.eventType === "DELETE") {
            setNotifications((prev) =>
              prev.filter((item) => item.id !== payload.old.id)
            );
          }
        }
      );

      channel.subscribe((status) => {
        console.log("NotificationPage realtime 상태:", status);
      });
    };

    loadNotifications();

    return () => {
      isMounted = false;

      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  const handleClickNotification = async (notification) => {
    try {
      if (notification.source === "guest" || isGuestUser) {
        await markGuestNotificationAsRead(notification.id);
      } else {
        await markNotificationAsRead(notification.id);
      }

      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notification.id ? { ...item, isread: true } : item
        )
      );

      if (notification.link) {
        navigate(notification.link);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeleteNotification = async (e, notificationId) => {
    e.stopPropagation();

    const confirmDelete = window.confirm("이 알림을 삭제할까요?");
    if (!confirmDelete) return;

    try {
      const targetNotification = notifications.find(
        (notification) => notification.id === notificationId
      );

      if (targetNotification?.source === "guest" || isGuestUser) {
        await deleteGuestNotification(notificationId);
      } else {
        await deleteNotification(notificationId);
      }

      setNotifications((prev) =>
        prev.filter((notification) => notification.id !== notificationId)
      );
    } catch (error) {
      console.error("알림 삭제 실패:", error);
      alert("알림 삭제에 실패했습니다.");
    }
  };

  const handleDeleteAllNotifications = async () => {
    if (!currentUserId) return;

    if (notifications.length === 0) {
      alert("삭제할 알림이 없습니다.");
      return;
    }

    const confirmDelete = window.confirm("전체 알림을 삭제할까요?");
    if (!confirmDelete) return;

    try {
      if (isGuestUser) {
        await deleteMyGuestNotifications(currentUserId);
      } else {
        await deleteMyNotifications(currentUserId);
      }

      setNotifications([]);
    } catch (error) {
      console.error("전체 알림 삭제 실패:", error);
      alert("전체 알림 삭제에 실패했습니다.");
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!currentUserId) return;

    const unreadNotifications = notifications.filter((n) => !n.isread);

    if (unreadNotifications.length === 0) {
      alert("읽지 않은 알림이 없습니다.");
      return;
    }

    try {
      // origin/feature/notification-2 기능 우선 유지
      await markAllNotificationsAsRead(currentUserId);

      setNotifications((prev) => prev.map((n) => ({ ...n, isread: true })));
    } catch (error) {
      console.error("전체 읽음 처리 실패:", error);
      alert("전체 읽음 처리에 실패했습니다.");
    }
  };

  const handleAcceptInvite = async (e, notification) => {
    e.stopPropagation();

    if (isGuestUser) {
      alert("게스트는 방 초대 수락 기능을 사용할 수 없습니다.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", user.id)
        .single();

      const nickname =
        profile?.nickname || user.user_metadata?.nickname || user.email;

      await joinRoomById(notification.roomid, user.id, nickname);

      // 초대한 사람에게 수락 알림 전송
      if (notification.senderid) {
        const { data: roomData } = await supabase
          .from("rooms")
          .select("roomname")
          .eq("id", notification.roomid)
          .maybeSingle();
        const roomName = roomData?.roomname || "방";

        await createNotification({
          receiverId: notification.senderid,
          senderId: user.id,
          type: "room_invite_accepted",
          title: "🏠 초대 수락",
          message: `${nickname}님이 [${roomName}]에 참가했습니다.`,
        });
      }

      await deleteNotification(notification.id);

      setNotifications((prev) =>
        prev.filter((n) => n.id !== notification.id)
      );

      alert("방에 참가했습니다!");
      navigate(`/rooms/${notification.roomid}`);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRejectInvite = async (e, notification) => {
    e.stopPropagation();

    try {
      if (notification.source === "guest" || isGuestUser) {
        await deleteGuestNotification(notification.id);
      } else {
        await deleteNotification(notification.id);
      }

      setNotifications((prev) =>
        prev.filter((n) => n.id !== notification.id)
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleAcceptFriendRequest = async (e, notification) => {
    e.stopPropagation();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    try {
      const { data: friendRow } = await supabase
        .from("friends")
        .select("id")
        .eq("userid", notification.senderid)
        .eq("friendid", user.id)
        .eq("status", "pending")
        .maybeSingle();

      if (!friendRow) {
        alert("이미 처리된 요청입니다.");
        setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
        return;
      }

      await acceptFriendRequest(friendRow.id, user.id, notification.senderid);

      const { data: myProfile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", user.id)
        .single();
      const myNickname = myProfile?.nickname || "알 수 없음";

      await createNotification({
        receiverId: notification.senderid,
        senderId: user.id,
        type: "friend_accepted",
        title: "친구 요청 수락",
        message: `${myNickname}님이 친구 요청을 수락했습니다. 이제 친구입니다!`,
      });

      await deleteNotification(notification.id);

      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));

      alert("친구 요청을 수락했습니다!");
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRejectFriendRequest = async (e, notification) => {
    e.stopPropagation();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    try {
      const { data: friendRow } = await supabase
        .from("friends")
        .select("id")
        .eq("userid", notification.senderid)
        .eq("friendid", user.id)
        .eq("status", "pending")
        .maybeSingle();

      if (friendRow) {
        await rejectFriendRequest(friendRow.id);
      }

      await deleteNotification(notification.id);

      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleAcceptCalendarShare = async (e, notification) => {
    e.stopPropagation();

    if (isGuestUser) {
      alert("게스트는 캘린더 공유 기능을 사용할 수 없습니다.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    try {
      await acceptCalendarShare(user.id, notification.senderid);

      const { data: myProfile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", user.id)
        .single();
      const myNickname = myProfile?.nickname || "알 수 없음";

      await createNotification({
        receiverId: notification.senderid,
        senderId: user.id,
        type: "calendar_share_accepted",
        title: "📅 캘린더 공개 수락",
        message: `${myNickname}님이 캘린더 공개 요청을 수락했습니다.`,
      });

      await deleteNotification(notification.id);

      setNotifications((prev) =>
        prev.filter((n) => n.id !== notification.id)
      );

      alert("캘린더 공유가 수락되었습니다.");
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRejectCalendarShare = async (e, notification) => {
    e.stopPropagation();

    if (isGuestUser) {
      alert("게스트는 캘린더 공유 기능을 사용할 수 없습니다.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    try {
      await rejectCalendarShare(notification.senderid, user.id);
      await deleteNotification(notification.id);

      setNotifications((prev) =>
        prev.filter((n) => n.id !== notification.id)
      );
    } catch (err) {
      console.error(err);
    }
  };

  if (!currentUserId) {
    return (
      <div style={{ padding: "20px", paddingBottom: "100px" }}>
        <h2>알림</h2>
        <p>사용자 정보를 불러오는 중입니다.</p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "20px",
        paddingBottom: "100px",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            style={{
              border: "none",
              background: "none",
              padding: 0,
              fontSize: "24px",
              cursor: "pointer",
              color: "#555",
            }}
          >
            &larr;
          </button>
          <h2 style={{ margin: 0 }}>알림</h2>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={handleMarkAllAsRead}
            style={{
              border: "none",
              borderRadius: "8px",
              padding: "8px 12px",
              backgroundColor: "#f2f2f2",
              cursor: "pointer",
            }}
          >
            전체 확인
          </button>

          <button
            type="button"
            onClick={handleDeleteAllNotifications}
            style={{
              border: "none",
              borderRadius: "8px",
              padding: "8px 12px",
              backgroundColor: "#f2f2f2",
              cursor: "pointer",
            }}
          >
            전체 삭제
          </button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <p>아직 도착한 알림이 없습니다.</p>
      ) : (
        <div>
          {notifications.map((notification) => (
            <div
              key={notification.id}
              onClick={() => handleClickNotification(notification)}
              style={{
                position: "relative",
                padding: "14px 44px 14px 14px",
                marginBottom: "10px",
                borderRadius: "12px",
                border: "1px solid #ddd",
                backgroundColor: notification.isread ? "#ffffff" : "#f0f4ff",
                cursor: "pointer",
              }}
            >
              <button
                type="button"
                onClick={(e) => handleDeleteNotification(e, notification.id)}
                aria-label="알림 삭제"
                style={{
                  position: "absolute",
                  top: "10px",
                  right: "10px",
                  width: "26px",
                  height: "26px",
                  border: "none",
                  borderRadius: "50%",
                  backgroundColor: "#eeeeee",
                  color: "#555",
                  fontSize: "16px",
                  fontWeight: "bold",
                  lineHeight: "26px",
                  textAlign: "center",
                  cursor: "pointer",
                }}
              >
                ×
              </button>

              <strong
                style={{
                  display: "block",
                  fontSize: "16px",
                  fontWeight: "800",
                  color: "#111111",
                  marginBottom: "4px",
                }}
              >
                {notification.title}
              </strong>

              <p style={{ margin: "6px 0" }}>{notification.message}</p>

              {notification.type === "room_invite" && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "flex",
                    gap: "8px",
                    marginTop: "10px",
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => handleAcceptInvite(e, notification)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      backgroundColor: "#7c79ff",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "13px",
                    }}
                  >
                    수락
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleRejectInvite(e, notification)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      backgroundColor: "#fff",
                      color: "#999",
                      border: "1px solid #ddd",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    거절
                  </button>
                </div>
              )}

              {notification.type === "friend_request" && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "flex",
                    gap: "8px",
                    marginTop: "10px",
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => handleAcceptFriendRequest(e, notification)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      backgroundColor: "#7c79ff",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "13px",
                    }}
                  >
                    수락
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleRejectFriendRequest(e, notification)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      backgroundColor: "#fff",
                      color: "#999",
                      border: "1px solid #ddd",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    거절
                  </button>
                </div>
              )}

              {(notification.type === "friend_accepted" ||
                notification.type === "calendar_share_accepted") && (
                <div style={{ marginTop: "6px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "3px 10px",
                      backgroundColor:
                        notification.type === "friend_accepted"
                          ? "#e8f5e9"
                          : "#fff8e1",
                      color:
                        notification.type === "friend_accepted"
                          ? "#388e3c"
                          : "#f57c00",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: "600",
                    }}
                  >
                    {notification.type === "friend_accepted"
                      ? "✓ 친구 완료"
                      : "✓ 공유 완료"}
                  </span>
                </div>
              )}

              {notification.type === "calendar_share_request" && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "flex",
                    gap: "8px",
                    marginTop: "10px",
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) =>
                      handleAcceptCalendarShare(e, notification)
                    }
                    style={{
                      flex: 1,
                      padding: "8px",
                      backgroundColor: "#f90",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "13px",
                    }}
                  >
                    수락
                  </button>

                  <button
                    type="button"
                    onClick={(e) =>
                      handleRejectCalendarShare(e, notification)
                    }
                    style={{
                      flex: 1,
                      padding: "8px",
                      backgroundColor: "#fff",
                      color: "#999",
                      border: "1px solid #ddd",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    거절
                  </button>
                </div>
              )}

              <small style={{ color: "#777" }}>
                {notification.createdat
                  ? new Date(notification.createdat).toLocaleString()
                  : ""}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NotificationPage;
