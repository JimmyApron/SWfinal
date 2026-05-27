import "./App.css";
import { useEffect, useRef } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";

import BottomNav from "./components/BottomNav";

import InviteCodePage from "./pages/auth/InviteCodePage";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
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
  const location = useLocation();
  const locationRef = useRef(location);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    let channel = null;

    const setupRealtimeNotification = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        let myUserId = user?.id;

        if (!myUserId) {
          myUserId = localStorage.getItem("guest_id");
        }

        if (!myUserId) return;

        const uniqueChannelName = `realtime-notifications-${myUserId}-${Date.now()}`;

        channel = supabase.channel(uniqueChannelName);

        channel.on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `receiverid=eq.${myUserId}`,
          },
          async (payload) => {
            console.log("🔔 [실시간 새 알림 도착 완료]:", payload.new.message);
          }
        );

        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log(`📡 [실시간 알림 연결 성공] 채널명: ${uniqueChannelName}`);
          }
        });
      } catch (err) {
        console.error("실시간 알림 세팅 중 오류 발생:", err);
      }
    };

    setupRealtimeNotification();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  return null;
}

function App() {
  return (
    <GoogleOAuthProvider clientId={process.env.REACT_APP_GOOGLE_CLIENT_ID}>
      <BrowserRouter>
        <NotificationListener />
        <Layout>
          <Routes>
            {/* 첫 대문 화면 */}
            <Route path="/" element={<InviteCodePage />} />

            {/* 인증 및 진입 파이프라인 */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/guest" element={<GuestLoginPage />} />
            <Route path="/home" element={<HomePage />} />

            {/* 방 관련 기능 */}
            <Route path="/rooms/create" element={<RoomCreatePage />} />
            <Route path="/rooms/invite" element={<RoomInvitePage />} />
            <Route path="/rooms/:roomId" element={<RoomDetailPage />} />

            {/* 방 내부 탭 기능 */}
            <Route path="/rooms/:roomid/schedule" element={<ScheduleTab />} />
            <Route path="/rooms/:roomid/location" element={<LocationTab />} />
            <Route path="/rooms/:roomid/votes" element={<VoteListPage />} />
            <Route path="/rooms/:roomid/chat" element={<ChatTab />} />

            <Route
              path="/rooms/:roomid/available-result"
              element={<AvailableResultPage />}
            />
            <Route
              path="/rooms/:roomid/vote-create"
              element={<VoteCreatePage />}
            />
            <Route
              path="/rooms/:roomid/votes/:voteid"
              element={<VoteDetailPage />}
            />

            {/* 확정 일정 상세 */}
            <Route
              path="/confirmed-schedule"
              element={<ConfirmedScheduleDetailPage />}
            />

            {/* 캘린더 / 알림 */}
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/notifications" element={<NotificationPage />} />

            {/* 설정 관련 기능 */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/edit" element={<SettingEditPage />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}

export default App;
