import "./App.css";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";

import InviteCodePage from "./pages/auth/InviteCodePage";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import GuestLoginPage from "./pages/auth/GuestLoginPage";
import HomePage from "./pages/home/HomePage";

import RoomCreatePage from "./pages/room/RoomCreatePage";
import RoomInvitePage from "./pages/room/RoomInvitePage";
import RoomDetailPage from "./pages/room/RoomDetailPage";

import CalendarPage from "./pages/calendar/CalendarPage";
import NotificationPage from "./pages/notification/NotificationPage";
import SettingsPage from "./pages/settings/SettingsPage";

import MapPage from "./components/map/MapPage";
import BottomNav from "./components/BottomNav";

function MainLayout() {
  return (
    <div className="app-layout">
      <main className="app-main">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
import ScheduleTab from "./pages/room/ScheduleTab";
import LocationTab from "./pages/Location/LocationTab";
import ChatTab from "./pages/Chat/ChatTab";

import AvailableResultPage from "./pages/room/AvailableResultPage";
import VoteCreatePage from "./pages/vote/VoteCreatePage";
import VoteListPage from "./pages/vote/VoteListPage";
import VoteDetailPage from "./pages/vote/VoteDetailPage";

import SettingsPage from "./pages/settings/SettingsPage";
import SettingEditPage from "./pages/settings/SettingEditPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 로그인 전 / 진입 전 화면: 하단바 없음 */}
        <Route path="/" element={<InviteCodePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/guest" element={<GuestLoginPage />} />

        {/* 로그인 후 / 비회원 입장 후 화면: 하단바 있음 */}
        <Route element={<MainLayout />}>
          <Route path="/home" element={<HomePage />} />

          <Route path="/rooms/create" element={<RoomCreatePage />} />
          <Route path="/rooms/invite" element={<RoomInvitePage />} />
          <Route path="/rooms/:roomId" element={<RoomDetailPage />} />
          <Route path="/rooms/:roomId/map" element={<MapPage />} />

          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        {/* 방 관련 기능 */}
        <Route path="/rooms/create" element={<RoomCreatePage />} />
        <Route path="/rooms/invite" element={<RoomInvitePage />} />
        <Route path="/rooms/:roomId" element={<RoomDetailPage />} />
        {/* 스케쥴 기능 */}
        <Route path="/rooms/:roomid/schedule" element={<ScheduleTab />} />
        <Route path="/rooms/:roomid/location" element={<LocationTab />} />
        <Route path="/rooms/:roomid/votes" element={<VoteListPage />} />
        <Route path="/rooms/:roomid/chat" element={<ChatTab />} />

        <Route path="/rooms/:roomid/available-result" element={<AvailableResultPage />} />
        <Route path="/rooms/:roomid/vote-create" element={<VoteCreatePage />} />
        <Route path="/rooms/:roomid/votes/:voteid" element={<VoteDetailPage />} />


        { /*설정 관련 기능 */}
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/edit" element={<SettingEditPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;