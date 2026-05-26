import "./App.css";
import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabaseClient"; 

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

import NotificationPage from "./pages/notification/NotificationPage";
import BottomNav from "./components/BottomNav";

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
        if (!user) return;

        const myUserId = user.id;
        const uniqueChannelName = `realtime-notifications-${myUserId}-${Date.now()}`;

        // 🎯 [1번 버그 박멸] 들어올 때 첫 알림 강제 자동 읽음 처리 코드를 안전하게 주석/삭제 처리했습니다.
        // 이 코드가 있으면 리로드할 때마다 알림 카운트가 한 개씩 깎여나갔던 거예요!

        channel = supabase.channel(uniqueChannelName);

        channel.on(
          "postgres_changes",
          { 
            event: "INSERT", 
            schema: "public", 
            table: "notifications", 
            filter: `receiverid=eq.${myUserId}` 
          },
          async (payload) => {
            // 🎯 [2번 버그 박멸] 알림이 올 때마다 화면 주소 상관없이 닥치는 대로 '읽음(isread: true)' 처리하던 무서운 코드를 완전히 삭제했습니다!
            // 이제 데이터베이스의 알림 상태를 프론트엔드 리스너가 강제로 바꾸지 않고 온전히 보존합니다.
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
    <BrowserRouter>
      <NotificationListener />
      <BottomNav />
      <Routes>
        <Route path="/" element={<InviteCodePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
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
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/edit" element={<SettingEditPage />} />
        {/* 🎯 아까 누락되었던 알림 페이지 연결 통로 완벽 복구 */}
        <Route path="/notifications" element={<NotificationPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;