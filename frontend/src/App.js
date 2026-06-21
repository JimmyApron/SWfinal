import "./App.css";
import { useEffect, useRef, useState } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { ThemeProvider } from "./context/ThemeContext";

import BottomNav from "./components/BottomNav";

import InviteCodePage from "./pages/auth/InviteCodePage";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import GuestLoginPage from "./pages/auth/GuestLoginPage";

import HomePage from "./pages/home/HomePage";
import ConfirmedScheduleDetailPage from "./pages/home/ConfirmedScheduleDetailPage";

import RoomCreatePage from "./pages/room/RoomCreatePage";
import RoomInvitePage from "./pages/room/RoomInvitePage";
import RoomDetailPage from "./pages/room/RoomDetailPage";
import ScheduleTab from "./pages/room/ScheduleTab";
import AvailableResultPage from "./pages/room/AvailableResultPage";

import LocationTab from "./pages/Location/LocationTab";
import ChatTab from "./pages/Chat/ChatTab";

import VoteCreatePage from "./pages/vote/VoteCreatePage";
import VoteListPage from "./pages/vote/VoteListPage";
import VoteDetailPage from "./pages/vote/VoteDetailPage";

import CalendarPage from "./pages/calendar/CalendarPage";
import FriendCalendarPage from "./pages/calendar/FriendCalendarPage";

import NotificationPage from "./pages/notification/NotificationPage";
import {
  getMyGuestNotifications,
  getMyNotifications,
  TAB_TYPE_MAP,
} from "./api/notificationApi";

import SettingsPage from "./pages/settings/SettingsPage";
import SettingEditPage from "./pages/settings/SettingEditPage";

const AUTH_PATHS = ["/", "/login", "/signup", "/guest"];

const NOTIFICATION_SETTING_COLUMNS = {
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
  vote_new: "votenotifenabled",
  vote_closed: "votenotifenabled",
  vote_reminder: "votenotifenabled",
  chat_new: "chatnotifenabled",
};

async function isRoomNotificationPopupAllowed(roomId, type) {
  const settingColumn = NOTIFICATION_SETTING_COLUMNS[type];
  if (!roomId || !settingColumn) return true;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const { data } = await supabase
        .from("room_members")
        .select(settingColumn)
        .eq("roomid", Number(roomId))
        .eq("userid", user.id)
        .maybeSingle();
      return data?.[settingColumn] !== false;
    }

    const guestId = localStorage.getItem("guest_id");
    if (!guestId) return true;

    const { data } = await supabase
      .from("room_guests")
      .select(settingColumn)
      .eq("roomid", Number(roomId))
      .eq("id", guestId)
      .maybeSingle();
    return data?.[settingColumn] !== false;
  } catch (error) {
    console.error("방 알림 설정 확인 실패:", error);
    return true;
  }
}

function hasRoomPopupSetting(roomId, type) {
  return Boolean(roomId && NOTIFICATION_SETTING_COLUMNS[type]);
}

async function isCurrentUserInRoom(roomId, userId) {
  if (!roomId || !userId) return false;

  const [{ data: member }, { data: guest }] = await Promise.all([
    supabase
      .from("room_members")
      .select("id")
      .eq("roomid", Number(roomId))
      .eq("userid", userId)
      .maybeSingle(),
    supabase
      .from("room_guests")
      .select("id")
      .eq("roomid", Number(roomId))
      .eq("id", userId)
      .maybeSingle(),
  ]);

  return Boolean(member || guest);
}

function Layout({ children }) {
  const location = useLocation();
  const showNav = !AUTH_PATHS.includes(location.pathname);
  const isRoomDetailPage = /^\/rooms\/[^/]+$/.test(location.pathname);
  const roomTab = new URLSearchParams(location.search).get("tab") || "schedule";
  const isRoomLocationTab =
    isRoomDetailPage && roomTab === "location";
  const isRoomChatTab = isRoomDetailPage && roomTab === "chat";
  const contentClassName = [
    showNav ? "app-content-with-bottom-nav" : "",
    isRoomLocationTab ? "app-content-room-location" : "",
    isRoomChatTab ? "app-content-room-chat" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <div className={contentClassName}>
        {children}
      </div>

      {showNav && <BottomNav />}
    </>
  );
}

function NotificationListener() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const location = useLocation();
  const locationRef = useRef(location);
  const channelRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const recentToastRef = useRef({ key: "", time: 0 });
  const shownNotificationIdsRef = useRef(new Set());

  const displayToast = (message, link) => {
    const key = `${message || ""}|${link || ""}`;
    const now = Date.now();
    if (recentToastRef.current.key === key && now - recentToastRef.current.time < 2000) {
      return;
    }

    recentToastRef.current = { key, time: now };
    setToast({ message, link });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    const handleAppToast = async (event) => {
      const nextToast = event.detail;
      if (!nextToast?.message) return;

      const isGlobalPopupEnabled = localStorage.getItem("global_popup_enabled") !== "false";
      const mutedRooms = JSON.parse(localStorage.getItem("muted_rooms") || "[]");
      const isRoomMuted = nextToast.roomId && mutedRooms.some(id => String(id) === String(nextToast.roomId));
      const isSettingAllowed = await isRoomNotificationPopupAllowed(nextToast.roomId, nextToast.type);
      const usesRoomSetting = hasRoomPopupSetting(nextToast.roomId, nextToast.type);

      if (usesRoomSetting) {
        if (!isSettingAllowed) return;
      } else if (!isGlobalPopupEnabled || isRoomMuted) {
        return;
      }

      displayToast(nextToast.message, nextToast.link);
    };

    const handlePopupSettingEnabled = async (event) => {
      const { roomId, tabName } = event.detail || {};
      const tabTypes = TAB_TYPE_MAP[tabName] || [];
      if (!roomId || tabTypes.length === 0) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        const guestId = localStorage.getItem("guest_id");
        const userId = user?.id || guestId;
        if (!userId) return;

        const notifications = user?.id
          ? await getMyNotifications(userId)
          : await getMyGuestNotifications(userId);

        (notifications || [])
          .filter((notif) =>
            Number(notif.roomid) === Number(roomId) &&
            tabTypes.includes(notif.type) &&
            notif.id
          )
          .forEach((notif) => shownNotificationIdsRef.current.add(notif.id));
      } catch (error) {
        console.error("팝업 설정 ON 기존 알림 처리 실패:", error);
      }
    };

    window.addEventListener("app-toast", handleAppToast);
    window.addEventListener("popup-setting-enabled", handlePopupSettingEnabled);
    return () => {
      window.removeEventListener("app-toast", handleAppToast);
      window.removeEventListener("popup-setting-enabled", handlePopupSettingEnabled);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    console.log("🚀 [App.js] NotificationListener 로드됨 (v1.3 - 탭별 팝업 조건 정교화)");

    const setupRealtimeNotification = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!isMounted) return;

        const isGuestUser = !user?.id && Boolean(localStorage.getItem("guest_id"));
        let myUserId = user?.id || localStorage.getItem("guest_id");

        if (!myUserId) {
          console.log("🚀 [App.js] currentReceiverId 없음 - 알림 구독 생략");
          return;
        }

        console.log("🚀 [App.js] currentReceiverId:", myUserId);

        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        const shouldShowNotificationToast = async (notif) => {
          const isGlobalPopupEnabled = localStorage.getItem("global_popup_enabled") !== "false";
          const mutedRooms = JSON.parse(localStorage.getItem("muted_rooms") || "[]");
          const isRoomMuted = notif.roomid && mutedRooms.some(id => String(id) === String(notif.roomid));
          const isSettingAllowed = await isRoomNotificationPopupAllowed(notif.roomid, notif.type);
          const usesRoomSetting = hasRoomPopupSetting(notif.roomid, notif.type);

          return usesRoomSetting
            ? isSettingAllowed
            : notif.issilent !== true &&
              isGlobalPopupEnabled &&
              !isRoomMuted;
        };

        const handleIncomingNotification = async (notif) => {
          if (!notif || String(notif.receiverid) !== String(myUserId)) return;
          if (notif.id && shownNotificationIdsRef.current.has(notif.id)) return;

          const showToast = await shouldShowNotificationToast(notif);
          if (notif.id) shownNotificationIdsRef.current.add(notif.id);
          if (!showToast) return;

          displayToast(notif.message, notif.link);
        };

        try {
          const initialNotifications = isGuestUser
            ? await getMyGuestNotifications(myUserId)
            : await getMyNotifications(myUserId);
          shownNotificationIdsRef.current = new Set(
            (initialNotifications || []).map((notif) => notif.id).filter(Boolean)
          );
        } catch (error) {
          console.error("초기 팝업 알림 목록 조회 실패:", error);
        }

        const channel = supabase
          .channel(`notifications-${myUserId}-${Date.now()}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "notifications",
            },
            async (payload) => {
              const notif = payload.new;
              console.log("🚀 [App.js] 새 알림 수신:", notif);
              await handleIncomingNotification(notif);
            }
          )
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "confirmed_schedules",
            },
            async (payload) => {
              const schedule = payload.new;
              const roomId = schedule?.roomid;
              if (!roomId) return;

              const isParticipant = await isCurrentUserInRoom(roomId, myUserId);
              if (!isParticipant) return;

              const isSettingAllowed = await isRoomNotificationPopupAllowed(
                roomId,
                "schedule_confirmed"
              );
              if (!isSettingAllowed) return;

              const { data: roomData } = await supabase
                .from("rooms")
                .select("roomname")
                .eq("id", Number(roomId))
                .maybeSingle();

              const roomName = roomData?.roomname || "방";
              const scheduleTitle = schedule?.title?.trim()
                ? `'${schedule.title}' `
                : "";
              const message = `[${roomName}] 방에 ${scheduleTitle}일정이 확정되었습니다.`;

              displayToast(message, `/rooms/${roomId}?tab=schedule`);
            }
          );

        channel.subscribe((status) => {
          if (!isMounted) return;
          console.log("🚀 [App.js] Realtime 상태:", status);
          if (status === "SUBSCRIBED") channelRef.current = channel;
        });

        pollIntervalRef.current = setInterval(async () => {
          try {
            const notifications = isGuestUser
              ? await getMyGuestNotifications(myUserId)
              : await getMyNotifications(myUserId);
            const recentNotifications = (notifications || [])
              .sort((a, b) => new Date(a.createdat) - new Date(b.createdat))
              .slice(-20);

            for (const notif of recentNotifications) {
              await handleIncomingNotification(notif);
            }
          } catch (error) {
            console.error("팝업 알림 백업 조회 실패:", error);
          }
        }, 3000);
      } catch (err) {
        console.error("실시간 알림 세팅 중 오류:", err);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setupRealtimeNotification();
    });

    setupRealtimeNotification();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      onClick={() => { if (toast.link) navigate(toast.link); setToast(null); }}
      style={{
        position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
        zIndex: 10000, backgroundColor: "rgba(0,0,0,0.9)", color: "#fff",
        padding: "14px 24px", borderRadius: "16px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        cursor: "pointer", display: "flex", flexDirection: "column", gap: "4px",
        minWidth: "300px", maxWidth: "90vw", animation: "toastSlideIn 0.4s ease-out",
      }}
    >
      <div style={{ fontSize: "14px", fontWeight: "bold", color: "#7c79ff" }}>🔔 새 알림</div>
      <div style={{ fontSize: "13px", lineHeight: "1.4" }}>{toast.message}</div>
      <style>{`
        @keyframes toastSlideIn {
          from { transform: translate(-50%, -100%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function App() {
  const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <ThemeProvider>
        <BrowserRouter>
          <NotificationListener />
          <Layout>
            <Routes>
              <Route path="/" element={<InviteCodePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/guest" element={<GuestLoginPage />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/rooms/create" element={<RoomCreatePage />} />
              <Route path="/rooms/invite" element={<RoomInvitePage />} />
              <Route path="/rooms/:roomId" element={<RoomDetailPage />} />
              <Route path="/rooms/:roomid/schedule" element={<ScheduleTab />} />
              <Route path="/rooms/:roomid/location" element={<LocationTab />} />
              <Route path="/rooms/:roomid/votes" element={<VoteListPage />} />
              <Route path="/rooms/:roomid/chat" element={<ChatTab />} />
              <Route path="/rooms/:roomid/available-result" element={<AvailableResultPage />} />
              <Route path="/rooms/:roomid/vote-create" element={<VoteCreatePage />} />
              <Route path="/rooms/:roomid/votes/:voteid" element={<VoteDetailPage />} />
              <Route path="/confirmed-schedule" element={<ConfirmedScheduleDetailPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/calendar/friend/:friendId" element={<FriendCalendarPage />} />
              <Route path="/notifications" element={<NotificationPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/edit" element={<SettingEditPage />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </ThemeProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
