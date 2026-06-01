import "./App.css";
import { useEffect, useRef, useState } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";
import { ThemeProvider } from "./context/ThemeContext";

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
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const location = useLocation();
  const locationRef = useRef(location);
  const channelRef = useRef(null);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    let isMounted = true;

    const setupRealtimeNotification = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!isMounted) return;

        let myUserId = user?.id;

        // 로그인 유저가 아니면 게스트 id로 알림 수신
        if (!myUserId) {
          myUserId = localStorage.getItem("guest_id");
        }

        if (!myUserId) {
          console.log("알림 리스너 연결 생략: 로그인/게스트 정보 없음");
          return;
        }

        // 기존 채널이 있다면 제거해서 중복 구독 방지
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }

        const uniqueChannelName = `realtime-notifications-${myUserId}-${Date.now()}`;

        const channel = supabase
          .channel(uniqueChannelName)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "notifications",
              filter: `receiverid=eq.${myUserId}`,
            },
            async (payload) => {
              const newNotification = payload.new;

              // notification-2 기능: 내가 받을 알림만 실시간 수신 (issilent가 false인 경우만 Toast/알림 표시)
              if (newNotification.issilent !== true) {
                setToast({
                  message: newNotification.message,
                  link: newNotification.link,
                });

                // 4초 후 자동 닫기
                setTimeout(() => {
                  if (isMounted) setToast(null);
                }, 4000);
              }
            }
          );

        channel.subscribe((status) => {
          if (!isMounted) return;

          if (status === "SUBSCRIBED") {
            channelRef.current = channel;
          }
        });
      } catch (err) {
        console.error("실시간 알림 세팅 중 오류 발생:", err);
      }
    };

    setupRealtimeNotification();

    return () => {
      isMounted = false;

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      onClick={() => {
        if (toast.link) navigate(toast.link);
        setToast(null);
      }}
      style={{
        position: "fixed",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10000,
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        color: "#fff",
        padding: "14px 24px",
        borderRadius: "16px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        minWidth: "300px",
        maxWidth: "90vw",
        animation: "toastSlideIn 0.4s cubic-bezier(0.23, 1, 0.32, 1)",
      }}
    >
      <div style={{ fontSize: "14px", fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px" }}>
        🔔 <span style={{ color: "#7c79ff" }}>새 소식</span>
      </div>
      <div style={{ fontSize: "13px", opacity: 0.9, lineHeight: "1.4" }}>{toast.message}</div>
      <style>{`
        @keyframes toastSlideIn {
          from { transform: translate(-50%, -100%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `}</style>
    </div>
  );
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
      <ThemeProvider>
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
      </ThemeProvider>
    </GoogleOAuthProvider>
  );
}

export default App;