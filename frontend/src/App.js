import "./App.css";
import { useEffect } from "react";
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
  useEffect(() => {
    const channel = supabase
      .channel("notifications-listener")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
        },
        (payload) => {
          console.log("새 알림:", payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return null;
}

function App() {
  const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("auth event:", event, session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
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

            {/* 캘린더 / 친구 캘린더 / 알림 */}
            <Route path="/calendar" element={<CalendarPage />} />
            <Route
              path="/calendar/friend/:friendId"
              element={<FriendCalendarPage />}
            />
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