import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import RoomCreatePage from "./pages/RoomCreatePage";
import RoomInvitePage from "./pages/RoomInvitePage";

function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* 로그인 */}
        <Route path="/" element={<LoginPage />} />

        {/* 회원가입 */}
        <Route path="/signup" element={<SignupPage />} />

        {/* 방 만들기 */}
        <Route path="/room-create" element={<RoomCreatePage />} />

        {/* 초대코드 방 입장 */}
        <Route path="/room-invite" element={<RoomInvitePage />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;