import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";

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

function App() {
  return (
    <BrowserRouter>
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

        <Route path="/rooms/:roomid/schedule" element={<ScheduleTab />} />
        <Route path="/rooms/:roomid/location" element={<LocationTab />} />
        <Route path="/rooms/:roomid/votes" element={<VoteListPage />} />
        <Route path="/rooms/:roomid/chat" element={<ChatTab />} />

        <Route path="/rooms/:roomid/available-result" element={<AvailableResultPage />} />
        <Route path="/rooms/:roomid/vote-create" element={<VoteCreatePage />} />
        <Route path="/rooms/:roomid/votes/:voteid" element={<VoteDetailPage />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;