import "./App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";

import InviteCodePage from "./pages/auth/InviteCodePage";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import GuestLoginPage from "./pages/auth/GuestLoginPage";
import HomePage from "./pages/home/HomePage";

import RoomCreatePage from "./pages/room/RoomCreatePage";
import RoomInvitePage from "./pages/room/RoomInvitePage";
import RoomDetailPage from "./pages/room/RoomDetailPage";
import ScheduleTab from "./pages/room/ScheduleTab";
import LocationTab from "./pages/Location/LocationTab";
import ChatTab from "./pages/Chat/ChatTab";

import AvailableResultPage from "./pages/room/AvailableResultPage";
import VoteCreatePage from "./pages/vote/VoteCreatePage";
import VoteListPage from "./pages/vote/VoteListPage";
import VoteDetailPage from "./pages/vote/VoteDetailPage";

import SettingsPage from "./pages/settings/SettingsPage";
import SettingEditPage from "./pages/settings/SettingEditPage";

import CalendarPage from "./pages/calendar/CalendarPage";
import NotificationPage from "./pages/notification/NotificationPage";
import BottomNav from "./components/BottomNav";

function AppContent() {
  const location = useLocation();

  const hideBottomNavPaths = ["/", "/login", "/signup", "/guest"];

  const shouldShowBottomNav = !hideBottomNavPaths.includes(location.pathname);

  return (
    <>
      <div className={shouldShowBottomNav ? "app-content-with-bottom-nav" : ""}>
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

          {/* 스케쥴 기능 */}
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

          {/* 캘린더 / 알림 */}
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/notifications" element={<NotificationPage />} />

          {/* 설정 관련 기능 */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/edit" element={<SettingEditPage />} />
        </Routes>
      </div>

      {shouldShowBottomNav && <BottomNav />}
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;