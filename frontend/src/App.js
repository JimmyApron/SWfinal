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
      </Routes>
    </BrowserRouter>
  );
}

export default App;