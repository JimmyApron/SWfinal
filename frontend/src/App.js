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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<InviteCodePage />} />

        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/guest" element={<GuestLoginPage />} />
        <Route path="/home" element={<HomePage />} />

        <Route path="/rooms/create" element={<RoomCreatePage />} />
        <Route path="/rooms/invite" element={<RoomInvitePage />} />
        <Route path="/rooms/:roomId" element={<RoomDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;