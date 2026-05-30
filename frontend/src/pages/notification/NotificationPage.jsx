import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  getMyNotifications,
  getMyGuestNotifications,
  markNotificationAsRead,
  markGuestNotificationAsRead,
  deleteNotification,
  deleteGuestNotification,
  deleteMyNotifications,
  deleteMyGuestNotifications,
  isNotificationVisibleToRecipient,
} from "../../api/notificationApi";
import { joinRoomById } from "../../api/roomApi";
import { acceptCalendarShare, rejectCalendarShare } from "../../api/calendarShareApi";

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

      setCurrentUserId(userId);
      setIsGuestUser(isGuest);

      // ========================================================
      // 🛡️ [무해한 안전 훅] 유저가 알림창을 열었을 때 배경에서 마감 투표 사냥하기
      // ========================================================
      try {
        const nowIso = new Date().toISOString();

        // 1. 내가 속한 방 번호들(roomid) 싹 긁어오기
        const { data: myRooms } = await supabase
          .from("room_members")
          .select("roomid")
          .eq("userid", userId);

        if (myRooms && myRooms.length > 0) {
          const roomIds = myRooms.map((r) => r.roomid);

          // 2. 그 방들 중에서 마감 시간은 지났는데 아직 안 닫힌(isclosed = false) 투표 싹 조회
          const { data: expiredVotes } = await supabase
            .from("votes")
            .select("id, roomid, title")
            .in("roomid", roomIds)
            .eq("endtimeenabled", true)
            .lte("endtime", nowIso)
            .eq("isclosed", false);

          if (expiredVotes && expiredVotes.length > 0) {
            for (const vote of expiredVotes) {
              // 해당 방의 멤버들 중 알림 켠 사람들 다 찾기
              const { data: activeMembers } = await supabase
                .from("room_members")
                .select("userid")
                .eq("roomid", vote.roomid)
                .eq("votenotifenabled", true);

              if (activeMembers && activeMembers.length > 0) {
                const closeNotifications = activeMembers.map((member) => ({
                  roomid: vote.roomid,
                  receiverid: member.userid,
                  type: "vote_closed",
                  title: "🔒 투표 마감 완료",
                  message: `🏁 [${vote.title}] 투표가 마감되었습니다! 최종 결과를 확인해 보세요.`,
                  isread: false,
                  link: `/rooms/${vote.roomid}/votes/${vote.id}`,
                }));

                // 마감 알림 적재
                await supabase.from("notifications").insert(closeNotifications);
              }

              const { data: activeGuests } = await supabase
                .from("room_guests")
                .select("id")
                .eq("roomid", vote.roomid)
                .eq("votenotifenabled", true);

              if (activeGuests && activeGuests.length > 0) {
                const closeGuestNotifications = activeGuests.map((guest) => ({
                  roomid: vote.roomid,
                  receiverid: guest.id,
                  type: "vote_closed",
                  title: "투표 마감 완료",
                  message: `[${vote.title}] 투표가 마감되었습니다. 최종 결과를 확인해 보세요.`,
                  isread: false,
                  link: `/rooms/${vote.roomid}/votes/${vote.id}`,
                }));

                await supabase
                  .from("notifications")
                  .insert(closeGuestNotifications);
              }

              // 3. 중복 방지를 위해 투표 쾅 닫기 (isclosed = true)
              await supabase
                .from("votes")
                .update({ isclosed: true })
                .eq("id", vote.id);

              console.log(`🏁 [${vote.title}] 투표 마감 알림 처리 완료!`);
            }
          }
        }
      } catch (checkError) {
        console.error("🔒 마감 투표 자동 체크 중 에러:", checkError);
      }

      // ========================================================
      // 🟢 최신 알림 데이터 불러오기 (기존 로직 유지)
      // ========================================================
      const data = isGuest
        ? await getMyGuestNotifications(userId)
        : await getMyNotifications(userId);
      console.log("불러온 알림 목록:", data);
      setNotifications(data);

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
          item.id === notification.id
            ? { ...item, isread: true }
            : item
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

  const handleAcceptInvite = async (e, notification) => {
    e.stopPropagation();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", user.id)
        .single();
      const nickname = profile?.nickname || user.user_metadata?.nickname || user.email;
      await joinRoomById(notification.roomid, user.id, nickname);
      await deleteNotification(notification.id);
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      alert("방에 참가했습니다!");
      navigate(`/rooms/${notification.roomid}`);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRejectInvite = async (e, notification) => {
    e.stopPropagation();
    try {
      await deleteNotification(notification.id);
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleAcceptCalendarShare = async (e, notification) => {
    e.stopPropagation();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
      await acceptCalendarShare(user.id, notification.senderid);
      await deleteNotification(notification.id);
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      alert("캘린더 공유가 수락되었습니다.");
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRejectCalendarShare = async (e, notification) => {
    e.stopPropagation();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
      await rejectCalendarShare(notification.senderid, user.id);
      await deleteNotification(notification.id);
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
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
    <div style={{ padding: "20px", paddingBottom: "100px", minHeight: "100vh", boxSizing: "border-box" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h2 style={{ margin: 0 }}>알림</h2>

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
                  marginBottom: "4px"     
                }}
              >
                {notification.title}
              </strong>

              <p style={{ margin: "6px 0" }}>{notification.message}</p>

              {notification.type === "room_invite" && (
                <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button
                    onClick={(e) => handleAcceptInvite(e, notification)}
                    style={{ flex: 1, padding: "8px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", fontSize: "13px" }}
                  >
                    수락
                  </button>
                  <button
                    onClick={(e) => handleRejectInvite(e, notification)}
                    style={{ flex: 1, padding: "8px", backgroundColor: "#fff", color: "#999", border: "1px solid #ddd", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}
                  >
                    거절
                  </button>
                </div>
              )}

              {notification.type === "calendar_share_request" && (
                <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <button
                    onClick={(e) => handleAcceptCalendarShare(e, notification)}
                    style={{ flex: 1, padding: "8px", backgroundColor: "#f90", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", fontSize: "13px" }}
                  >
                    수락
                  </button>
                  <button
                    onClick={(e) => handleRejectCalendarShare(e, notification)}
                    style={{ flex: 1, padding: "8px", backgroundColor: "#fff", color: "#999", border: "1px solid #ddd", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}
                  >
                    거절
                  </button>
                </div>
              )}

              <small style={{ color: "#777" }}>
                {new Date(notification.createdat).toLocaleString()}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NotificationPage;
