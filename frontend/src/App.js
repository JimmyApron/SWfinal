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
        
        // 🔥 [치트키] 채널명 뒤에 현재 시간(타임스탬프)을 붙여 고유한 이름을 만듭니다.
        // 이렇게 하면 핫 리로드가 일어나도 Supabase가 절대 이전 채널과 헷갈려하지 않습니다!
        const uniqueChannelName = `realtime-notifications-${myUserId}-${Date.now()}`;

        // 1. [초기 안 읽은 알림 확인]
        const isWatchingChatNow = locationRef.current.search.includes("tab=chat");
        const { data } = await supabase
          .from("notifications")
          .select("*")
          .eq("receiverid", myUserId)
          .eq("isread", false)
          .order("createdat", { ascending: true });

        if (data && data.length > 0) {
          if (!isWatchingChatNow) {
            alert(data[0].message);
          }
          await supabase.from("notifications").update({ isread: true }).eq("id", data[0].id);
        }

        // 2. 🚀 매번 100% 깨끗하고 겹칠 리 없는 새 채널 도화지를 개설합니다.
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
            const isWatchingChatRightNow = locationRef.current.search.includes("tab=chat");
            const notificationType = payload.new.type;

            if (notificationType === "chat_new" && isWatchingChatRightNow) {
              await supabase.from("notifications").update({ isread: true }).eq("id", payload.new.id);
              return;
            }

            alert(payload.new.message);
            await supabase.from("notifications").update({ isread: true }).eq("id", payload.new.id);
          }
        );

        // 3. 최종 구독 승인
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

    // 🧼 컴포넌트가 다시 정렬되거나 꺼질 때, 열려있던 고유 채널을 깔끔하게 닫아줍니다.
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []); // 빈 배열 유지로 최초 1회만 실행

  return null;
}
function App() {
  return (
    <BrowserRouter>
      <NotificationListener />
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
      </Routes>
    </BrowserRouter>
  );
}

export default App;