import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  getMyNotifications,
  markNotificationAsRead,
  deleteNotification,
  deleteMyNotifications,
} from "../../api/notificationApi";

function NotificationPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);

  useEffect(() => {
    let channel = null;

    const loadNotifications = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let userId = user?.id;

      if (!userId) {
        userId = localStorage.getItem("guest_id");
      }

      console.log("현재 알림 조회 userId:", userId);

      if (!userId) {
        console.log("알림을 불러올 사용자 정보가 없습니다.");
        return;
      }

      setCurrentUserId(userId);

      const data = await getMyNotifications(userId);
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
        (payload) => {
          console.log("알림 실시간 수신:", payload);

          if (payload.eventType === "INSERT") {
            setNotifications((prev) => {
              const alreadyExists = prev.some(
                (item) => item.id === payload.new.id
              );

              if (alreadyExists) return prev;

              return [payload.new, ...prev];
            });
          }

          if (payload.eventType === "UPDATE") {
            setNotifications((prev) =>
              prev.map((item) =>
                item.id === payload.new.id ? payload.new : item
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
      await markNotificationAsRead(notification.id);

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
      await deleteNotification(notificationId);

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
      await deleteMyNotifications(currentUserId);
      setNotifications([]);
    } catch (error) {
      console.error("전체 알림 삭제 실패:", error);
      alert("전체 알림 삭제에 실패했습니다.");
    }
  };

  if (!currentUserId) {
    return (
      <div style={{ padding: "20px" }}>
        <h2>알림</h2>
        <p>사용자 정보를 불러오는 중입니다.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", paddingBottom: "90px" }}>
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

              <strong>{notification.title}</strong>

              <p style={{ margin: "6px 0" }}>{notification.message}</p>

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