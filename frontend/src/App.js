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

import SettingsPage from "./pages/settings/SettingsPage";
import SettingEditPage from "./pages/settings/SettingEditPage";

const AUTH_PATHS = ["/", "/login", "/signup", "/guest"];

function Layout({ children }) {
  const location = useLocation();
  const showNav = !AUTH_PATHS.includes(location.pathname);

  return (
    <>
      <div className={showNav ? "app-content-with-bottom-nav" : ""}>
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

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    const handleAppToast = (event) => {
      const nextToast = event.detail;
      if (!nextToast?.message) return;

      setToast({ message: nextToast.message, link: nextToast.link });
      setTimeout(() => setToast(null), 4000);
    };

    window.addEventListener("app-toast", handleAppToast);
    return () => window.removeEventListener("app-toast", handleAppToast);
  }, []);

  useEffect(() => {
    let isMounted = true;
    console.log("🚀 [App.js] NotificationListener 로드됨 (v1.3 - 탭별 팝업 조건 정교화)");

    const setupRealtimeNotification = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!isMounted) return;

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

        const channel = supabase
          .channel(`notifications-${myUserId}-${Date.now()}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "notifications",
              filter: `receiverid=eq.${myUserId}`,
            },
            (payload) => {
              const notif = payload.new;
              console.log("🚀 [App.js] 새 알림 수신:", notif);

              const isGlobalPopupEnabled = localStorage.getItem("global_popup_enabled") !== "false";
              const mutedRooms = JSON.parse(localStorage.getItem("muted_rooms") || "[]");
              const isRoomMuted = notif.roomid && mutedRooms.some(id => String(id) === String(notif.roomid));
              
              const currentPath = locationRef.current.pathname;
              const isCurrentlyInRoom = notif.roomid && currentPath.includes(`/rooms/${notif.roomid}`);

              // 현재 보고 있는 탭 확인 (URL 쿼리 스트링 기준)
              const searchParams = new URLSearchParams(locationRef.current.search);
              const currentTab = searchParams.get("tab") || "schedule";

              // 알림 타입별 관련 탭 매핑
              const typeToTabMap = {
                chat_new: "chat",
                vote_new: "vote",
                vote_closed: "vote",
                vote_reminder: "vote",
                schedule_confirmed: "schedule",
                schedule_cancelled: "schedule",
                schedule_new: "schedule",
                location_request: "location",
                middle_place_confirmed: "location",
                location_schedule_created: "location"
              };

              const targetTab = typeToTabMap[notif.type];
              // 현재 해당 방의 해당 탭을 보고 있는지 여부
              const isLookingAtRelevantTab = isCurrentlyInRoom && targetTab && currentTab === targetTab;

              // 팝업 결정 조건
              // 1. issilent가 명시적 true가 아닐 것
              // 2. 전역 팝업 설정이 켜져 있을 것
              // 3. 해당 방이 뮤트 상태가 아닐 것
              // 4. (핵심) 현재 그 방의 해당 탭을 직접 보고 있는 상황이 아니어야 함
              //    (예: 일정 탭을 보고 있는데 투표 알림이 오면 팝업 띄움 / 일정 탭을 보고 있는데 일정 알림이 오면 안 띄움)
              
              const showToast = 
                notif.issilent !== true && 
                isGlobalPopupEnabled && 
                !isRoomMuted && 
                (!isLookingAtRelevantTab || notif.type === "kick" || notif.type === "schedule_confirmed" || notif.type === "middle_place_confirmed" || notif.type === "location_schedule_created");

              if (showToast) {
                console.log("✅ [App.js] Toast 표시함");
                setToast({ message: notif.message, link: notif.link });
                setTimeout(() => { if (isMounted) setToast(null); }, 4000);
              } else {
                console.log("🤫 [App.js] Toast 표시 건너뜜 (사유: 해당 탭 시청 중 또는 설정 차단)");
                console.log(` - isLookingAtRelevantTab: ${isLookingAtRelevantTab}, issilent: ${notif.issilent}`);
              }
            }
          );

        channel.subscribe((status) => {
          if (!isMounted) return;
          console.log("🚀 [App.js] Realtime 상태:", status);
          if (status === "SUBSCRIBED") channelRef.current = channel;
        });
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
