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
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
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
import {
  getMyGuestNotifications,
  getMyNotifications,
  TAB_TYPE_MAP,
} from "./api/notificationApi";
import { getPersonalEvents } from "./api/personalEventApi";

import SettingsPage from "./pages/settings/SettingsPage";
import SettingEditPage from "./pages/settings/SettingEditPage";

const AUTH_PATHS = ["/", "/login", "/signup", "/guest", "/reset-password"];
const PERSONAL_REMINDER_POPUP_WINDOW_MS = 60 * 1000;
const PERSONAL_REMINDER_CHECK_INTERVAL_MS = 30 * 1000;
const holidayCache = {};

const NOTIFICATION_SETTING_COLUMNS = {
  schedule_confirmed: "schedulenotifenabled",
  schedule_cancelled: "schedulenotifenabled",
  schedule_new: "schedulenotifenabled",
  schedule_request: "schedulenotifenabled",
  location_request: "locationnotifenabled",
  member_departed: "locationnotifenabled",
  arrival_approaching: "locationnotifenabled",
  arrival_completed: "locationnotifenabled",
  middle_place_confirmed: "locationnotifenabled",
  location_schedule_created: "locationnotifenabled",
  vote_new: "votenotifenabled",
  vote_closed: "votenotifenabled",
  vote_reminder: "votenotifenabled",
  chat_new: "chatnotifenabled",
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function getLocalDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function fetchHolidays(year, month) {
  const cacheKey = `${year}-${month}`;
  if (holidayCache[cacheKey]) return holidayCache[cacheKey];

  const serviceKey = process.env.REACT_APP_HOLIDAY_API_KEY;
  const mm = String(month + 1).padStart(2, "0");
  const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?serviceKey=${serviceKey}&solYear=${year}&solMonth=${mm}&_type=json&numOfRows=20`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    const raw = json?.response?.body?.items?.item;

    if (!raw) {
      holidayCache[cacheKey] = {};
      return {};
    }

    const items = Array.isArray(raw) ? raw : [raw];
    const result = {};

    items.forEach((item) => {
      const d = String(item.locdate);
      const dateStr = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      const name = item.dateName || "";
      const isAlternativeHoliday = /대체|임시/.test(name);
      result[dateStr] = {
        name,
        public: item.isHoliday === "Y" && !isAlternativeHoliday,
        alternative: isAlternativeHoliday,
      };
    });

    holidayCache[cacheKey] = result;
    return result;
  } catch {
    holidayCache[cacheKey] = {};
    return {};
  }
}

function getPersonalEventStartAt(event) {
  if (!event?.date) return null;
  const time = event.starttime || "00:00";
  const startAt = new Date(`${event.date}T${time.slice(0, 5)}:00`);
  return Number.isNaN(startAt.getTime()) ? null : startAt;
}

function getPersonalEventReminderAt(event) {
  if (!event?.reminder || event.reminder === "none") return null;

  const reminderMinutes = Number(event.reminder);
  if (!Number.isFinite(reminderMinutes) || reminderMinutes < 0) return null;

  const startAt = getPersonalEventStartAt(event);
  if (!startAt) return null;

  return new Date(startAt.getTime() - reminderMinutes * 60 * 1000);
}

function getPersonalEventReminderKey(event, reminderAt) {
  return `personal-event:${event.id || `${event.userid || ""}:${event.title}:${event.date}:${event.starttime || ""}`}:${reminderAt.getTime()}`;
}

function getPersonalEventReminderMessage(event) {
  const startLabel = event.starttime ? ` ${event.starttime}` : "";
  return `[개인 일정] ${event.title}${startLabel} 일정이 곧 시작됩니다.`;
}

async function shouldSkipPersonalReminderDate(reminderAt) {
  if (localStorage.getItem("notif_skip_enabled") !== "true") return false;

  const skipSunday = localStorage.getItem("notif_skip_sunday") !== "false";
  const skipSaturday = localStorage.getItem("notif_skip_saturday") !== "false";
  const skipHoliday = localStorage.getItem("notif_skip_holiday") !== "false";
  const skipAltHoliday = localStorage.getItem("notif_skip_alt_holiday") !== "false";

  const day = reminderAt.getDay();
  if (skipSunday && day === 0) return true;
  if (skipSaturday && day === 6) return true;

  const reminderDateKey = getLocalDateKey(reminderAt);
  const holidays = await fetchHolidays(reminderAt.getFullYear(), reminderAt.getMonth());
  const holiday = holidays?.[reminderDateKey];

  if (!holiday) return false;
  if (skipHoliday && holiday.public) return true;
  if (skipAltHoliday && holiday.alternative) return true;

  return false;
}

function getCachedRoomPopupSetting(roomId, settingColumn) {
  if (!roomId || !settingColumn) return null;

  try {
    const settings = JSON.parse(localStorage.getItem("room_popup_settings") || "{}");
    const value = settings?.[String(roomId)]?.[settingColumn];
    return typeof value === "boolean" ? value : null;
  } catch {
    return null;
  }
}

async function isRoomNotificationPopupAllowed(roomId, type) {
  const settingColumn = NOTIFICATION_SETTING_COLUMNS[type];
  if (!roomId || !settingColumn) return true;

  const cachedSetting = getCachedRoomPopupSetting(roomId, settingColumn);
  if (cachedSetting !== null) return cachedSetting;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const { data } = await supabase
        .from("room_members")
        .select(settingColumn)
        .eq("roomid", Number(roomId))
        .eq("userid", user.id)
        .maybeSingle();
      return data?.[settingColumn] !== false;
    }

    const guestId = localStorage.getItem("guest_id");
    if (!guestId) return true;

    const { data } = await supabase
      .from("room_guests")
      .select(settingColumn)
      .eq("roomid", Number(roomId))
      .eq("id", guestId)
      .maybeSingle();
    return data?.[settingColumn] !== false;
  } catch (error) {
    console.error("방 알림 설정 확인 실패:", error);
    return true;
  }
}

function hasRoomPopupSetting(roomId, type) {
  return Boolean(roomId && NOTIFICATION_SETTING_COLUMNS[type]);
}

function getNotificationCreatedAt(notif) {
  const createdAt = notif?.createdat ? new Date(notif.createdat).getTime() : Date.now();
  return Number.isNaN(createdAt) ? Date.now() : createdAt;
}

function getStoredPopupCutoffs(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function isBeforePopupResumeCutoff(notif) {
  const createdAt = getNotificationCreatedAt(notif);
  const roomId = notif?.roomid ? String(notif.roomid) : null;
  if (!roomId) return false;

  const roomCutoffs = getStoredPopupCutoffs("popup_room_enabled_at");
  const roomCutoff = Number(roomCutoffs[roomId] || 0);
  if (roomCutoff && createdAt < roomCutoff) return true;

  const settingColumn = NOTIFICATION_SETTING_COLUMNS[notif?.type];
  if (!settingColumn) return false;

  const tabCutoffs = getStoredPopupCutoffs("popup_tab_enabled_at");
  const tabCutoff = Number(tabCutoffs?.[roomId]?.[settingColumn] || 0);
  return Boolean(tabCutoff && createdAt < tabCutoff);
}

function Layout({ children }) {
  const location = useLocation();
  const showNav = !AUTH_PATHS.includes(location.pathname);
  const isRoomDetailPage = /^\/rooms\/[^/]+$/.test(location.pathname);
  const roomTab = new URLSearchParams(location.search).get("tab") || "schedule";
  const isRoomLocationTab =
    isRoomDetailPage && roomTab === "location";
  const isRoomChatTab = isRoomDetailPage && roomTab === "chat";
  const contentClassName = [
    showNav ? "app-content-with-bottom-nav" : "",
    isRoomLocationTab ? "app-content-room-location" : "",
    isRoomChatTab ? "app-content-room-chat" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <div className={contentClassName}>
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
  const pollIntervalRef = useRef(null);
  const recentToastRef = useRef({ key: "", time: 0 });
  const shownNotificationIdsRef = useRef(new Set());
  const shownPersonalReminderKeysRef = useRef(new Set());
  const notificationListenerStartedAtRef = useRef(Date.now());

  const displayToast = (message, link, options = {}) => {
    const key = options.id
      ? `id:${options.id}`
      : `${options.type || "toast"}|${message || ""}|${link || ""}`;
    const now = Date.now();

    if (recentToastRef.current.key === key && now - recentToastRef.current.time < 2000) {
      return;
    }

    recentToastRef.current = { key, time: now };
    setToast({ message, link });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    const handleAppToast = async (event) => {
      const nextToast = event.detail;
      if (!nextToast?.message) return;

      const isGlobalPopupEnabled = localStorage.getItem("global_popup_enabled") !== "false";
      const mutedRooms = JSON.parse(localStorage.getItem("muted_rooms") || "[]");
      const isRoomMuted = nextToast.roomId && mutedRooms.some(id => String(id) === String(nextToast.roomId));
      const isSettingAllowed = await isRoomNotificationPopupAllowed(nextToast.roomId, nextToast.type);
      const usesRoomSetting = hasRoomPopupSetting(nextToast.roomId, nextToast.type);

      if (!isGlobalPopupEnabled) return;
      if (isRoomMuted) return;

      if (usesRoomSetting) {
        if (!isSettingAllowed) return;
      }

      displayToast(nextToast.message, nextToast.link, {
        id: nextToast.id,
        type: nextToast.type,
      });
    };

    const handlePopupSettingEnabled = async (event) => {
      const { roomId, tabName, allRooms, allTabs } = event.detail || {};
      const enabledAt = Date.now();
      const tabTypes = tabName ? TAB_TYPE_MAP[tabName] || [] : [];
      const settingColumn = tabName ? NOTIFICATION_SETTING_COLUMNS[tabTypes[0]] : null;

      if (allRooms) {
        localStorage.setItem("popup_global_enabled_at", String(enabledAt));
      } else if (roomId && allTabs) {
        const roomCutoffs = getStoredPopupCutoffs("popup_room_enabled_at");
        roomCutoffs[String(roomId)] = enabledAt;
        localStorage.setItem("popup_room_enabled_at", JSON.stringify(roomCutoffs));
      } else if (roomId && settingColumn) {
        const tabCutoffs = getStoredPopupCutoffs("popup_tab_enabled_at");
        const roomKey = String(roomId);
        tabCutoffs[roomKey] = {
          ...(tabCutoffs[roomKey] || {}),
          [settingColumn]: enabledAt,
        };
        localStorage.setItem("popup_tab_enabled_at", JSON.stringify(tabCutoffs));
      }

      if (!allRooms && !roomId) return;
      if (!allRooms && !allTabs && tabTypes.length === 0) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        const guestId = localStorage.getItem("guest_id");
        const userId = user?.id || guestId;
        if (!userId) return;

        const notifications = user?.id
          ? await getMyNotifications(userId)
          : await getMyGuestNotifications(userId);

        const existingIds = (notifications || [])
          .filter((notif) => {
            if (!notif.id) return false;
            if (allRooms) return true;
            if (Number(notif.roomid) !== Number(roomId)) return false;
            if (allTabs) return true;
            return tabTypes.includes(notif.type);
          })
          .map((notif) => notif.id);

        existingIds.forEach((id) => shownNotificationIdsRef.current.add(id));
      } catch (error) {
        console.error("팝업 설정 ON 기존 알림 처리 실패:", error);
      }
    };

    window.addEventListener("app-toast", handleAppToast);
    window.addEventListener("popup-setting-enabled", handlePopupSettingEnabled);
    return () => {
      window.removeEventListener("app-toast", handleAppToast);
      window.removeEventListener("popup-setting-enabled", handlePopupSettingEnabled);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    console.log("🚀 [App.js] NotificationListener 로드됨 (v1.3 - 탭별 팝업 조건 정교화)");

    const setupRealtimeNotification = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!isMounted) return;

        const isGuestUser = !user?.id && Boolean(localStorage.getItem("guest_id"));
        let myUserId = user?.id || localStorage.getItem("guest_id");

        if (channelRef.current) {
          supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        if (!myUserId) {
          console.log("🚀 [App.js] currentReceiverId 없음 - 알림 구독 생략");
          return;
        }

        console.log("🚀 [App.js] currentReceiverId:", myUserId);
        notificationListenerStartedAtRef.current = Date.now();

        const shouldShowNotificationToast = async (notif) => {
          const isGlobalPopupEnabled = localStorage.getItem("global_popup_enabled") !== "false";
          const mutedRooms = JSON.parse(localStorage.getItem("muted_rooms") || "[]");
          const isRoomMuted = notif.roomid && mutedRooms.some(id => String(id) === String(notif.roomid));
          const isSettingAllowed = await isRoomNotificationPopupAllowed(notif.roomid, notif.type);
          const usesRoomSetting = hasRoomPopupSetting(notif.roomid, notif.type);

          if (!isGlobalPopupEnabled) return false;
          if (isRoomMuted) return false;
          if (isBeforePopupResumeCutoff(notif)) return false;

          if (usesRoomSetting && !isSettingAllowed) return false;

          return usesRoomSetting ? true : notif.issilent !== true;
        };

        const handleIncomingNotification = async (notif) => {
          if (!notif || String(notif.receiverid) !== String(myUserId)) return;

          if (
            notif.id &&
            shownNotificationIdsRef.current.has(notif.id)
          ) {
            return;
          }

          const showToast = await shouldShowNotificationToast(notif);
          if (notif.id) shownNotificationIdsRef.current.add(notif.id);
          if (!showToast) return;

          displayToast(notif.message, notif.link, {
            id: notif.id,
            type: notif.type,
          });
        };

        try {
          const initialNotifications = isGuestUser
            ? await getMyGuestNotifications(myUserId)
            : await getMyNotifications(myUserId);
          shownNotificationIdsRef.current = new Set(
            (initialNotifications || [])
              .map((notif) => notif.id)
              .filter(Boolean)
          );
        } catch (error) {
          console.error("초기 팝업 알림 목록 조회 실패:", error);
        }

        const channel = supabase
          .channel(`notifications-${myUserId}-${Date.now()}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "notifications",
            },
            async (payload) => {
              const notif = payload.new;
              console.log("🚀 [App.js] 새 알림 수신:", notif);
              await handleIncomingNotification(notif);
            }
          )

        channel.subscribe((status) => {
          if (!isMounted) return;
          console.log("🚀 [App.js] Realtime 상태:", status);
          if (status === "SUBSCRIBED") channelRef.current = channel;
        });

        pollIntervalRef.current = setInterval(async () => {
          try {
            const notifications = isGuestUser
              ? await getMyGuestNotifications(myUserId)
              : await getMyNotifications(myUserId);
            const recentNotifications = (notifications || [])
              .filter((notif) => getNotificationCreatedAt(notif) >= notificationListenerStartedAtRef.current)
              .sort((a, b) => new Date(a.createdat) - new Date(b.createdat))
              .slice(-20);

            for (const notif of recentNotifications) {
              await handleIncomingNotification(notif);
            }
          } catch (error) {
            console.error("팝업 알림 백업 조회 실패:", error);
          }
        }, 3000);
      } catch (err) {
        console.error("실시간 알림 세팅 중 오류:", err);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setupRealtimeNotification();
    });
    const handleGuestSessionChanged = () => {
      setupRealtimeNotification();
    };

    window.addEventListener("guest-session-changed", handleGuestSessionChanged);
    setupRealtimeNotification();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      window.removeEventListener("guest-session-changed", handleGuestSessionChanged);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let intervalId = null;

    const checkPersonalEventReminders = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!isMounted || !user?.id) return;

        const events = await getPersonalEvents(user.id);
        if (!isMounted) return;

        const now = Date.now();

        for (const event of events || []) {
          const reminderAt = getPersonalEventReminderAt(event);
          if (!reminderAt) continue;

          const reminderTime = reminderAt.getTime();
          if (reminderTime > now) continue;
          if (now - reminderTime > PERSONAL_REMINDER_POPUP_WINDOW_MS) continue;

          const reminderKey = getPersonalEventReminderKey(event, reminderAt);
          if (shownPersonalReminderKeysRef.current.has(reminderKey)) continue;

          shownPersonalReminderKeysRef.current.add(reminderKey);

          if (await shouldSkipPersonalReminderDate(reminderAt)) continue;
          if (!isMounted) return;

          window.dispatchEvent(new CustomEvent("app-toast", {
            detail: {
              id: reminderKey,
              type: "personal_event_reminder",
              message: getPersonalEventReminderMessage(event),
              link: "/calendar",
            },
          }));
        }
      } catch (error) {
        console.error("개인 일정 알림 확인 실패:", error);
      }
    };

    checkPersonalEventReminders();
    intervalId = setInterval(checkPersonalEventReminders, PERSONAL_REMINDER_CHECK_INTERVAL_MS);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      shownPersonalReminderKeysRef.current = new Set();
      checkPersonalEventReminders();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      onClick={() => { if (toast.link) navigate(toast.link); setToast(null); }}
      style={{
        position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
        zIndex: 10000, backgroundColor: "rgba(0,0,0,0.9)", color: "#fff",
        padding: "14px 24px", borderRadius: "16px", boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        cursor: "pointer", display: "flex", flexDirection: "column", gap: "4px",
        minWidth: "300px", maxWidth: "90vw", animation: "toastSlideIn 0.4s ease-out",
      }}
    >
      <div style={{ fontSize: "14px", fontWeight: "bold", color: "#7c79ff" }}>🔔 새 알림</div>
      <div style={{ fontSize: "13px", lineHeight: "1.4" }}>{toast.message}</div>
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

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <ThemeProvider>
        <BrowserRouter>
          <NotificationListener />
          <Layout>
            <Routes>
              <Route path="/" element={<InviteCodePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
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
              <Route path="/rooms/:roomid/confirmed-schedule" element={<ConfirmedScheduleDetailPage />} />
              <Route path="/confirmed-schedule" element={<ConfirmedScheduleDetailPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/calendar/friend/:friendId" element={<FriendCalendarPage />} />
              <Route path="/notifications" element={<NotificationPage />} />
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
