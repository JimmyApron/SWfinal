import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGoogleLogin } from "@react-oauth/google";
import { supabase } from "../../lib/supabaseClient";
import { getMyConfirmedSchedules } from "../../api/scheduleApi";
import {
  getPersonalEvents,
  createPersonalEvent,
  updatePersonalEvent,
  deletePersonalEvent,
} from "../../api/personalEventApi";
import { addEventToGoogleCalendar } from "../../api/googleCalendarApi";
import { getFriends } from "../../api/friendApi";
import {
  sendCalendarShareRequest,
  getAcceptedShares,
  removeCalendarShare,
  getSentPendingCalendarShares,
  cancelCalendarShareRequest,
} from "../../api/calendarShareApi";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTHS = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];
const PRESET_COLORS = [
  "#7c79ff",
  "#4285F4",
  "#f44",
  "#f90",
  "#4CAF50",
  "#e91e63",
  "#9c27b0",
  "#00bcd4",
];
const REMINDER_OPTIONS = [
  { value: "none", label: "알림 없음" },
  { value: "0", label: "일정 시작 전" },
  { value: "10", label: "10분 전" },
  { value: "60", label: "1시간 전" },
  { value: "1440", label: "1일 전" },
  { value: "custom", label: "직접 설정" },
];
const REPEAT_OPTIONS = [
  { value: "none", label: "없음" },
  { value: "daily", label: "매일" },
  { value: "weekly", label: "매주" },
  { value: "monthly", label: "매월" },
  { value: "yearly", label: "매년" },
];

const holidayCache = {};

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
      result[dateStr] = {
        name: item.dateName,
        public: item.isHoliday === "Y",
      };
    });

    holidayCache[cacheKey] = result;
    return result;
  } catch {
    holidayCache[cacheKey] = {};
    return {};
  }
}

async function fetchGoogleCalendarEvents(year, month) {
  const token = localStorage.getItem("google_calendar_token");
  const expiry = Number(localStorage.getItem("google_calendar_token_expiry") || 0);

  if (!token || Date.now() > expiry) return [];

  const timeMin = new Date(year, month, 1).toISOString();
  const timeMax = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
    timeMin
  )}&timeMax=${encodeURIComponent(
    timeMax
  )}&singleEvents=true&orderBy=startTime&maxResults=100`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem("google_calendar_token");
        localStorage.removeItem("google_calendar_token_expiry");
      }
      return [];
    }

    const json = await res.json();

    return (json.items || []).map((item) => ({
      id: item.id,
      title: item.summary || "(제목 없음)",
      date: (item.start?.date || item.start?.dateTime || "").slice(0, 10),
      starttime: item.start?.dateTime ? item.start.dateTime.slice(11, 16) : null,
      endtime: item.end?.dateTime ? item.end.dateTime.slice(11, 16) : null,
      isGoogle: true,
    }));
  } catch {
    return [];
  }
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateKey(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

const EMPTY_FORM = {
  title: "",
  color: "#7c79ff",
  isallday: false,
  startdate: "",
  enddate: "",
  starttime: "",
  endtime: "",
  location: "",
  reminder: "none",
  customReminderValue: "30",
  customReminderUnit: "min",
  repeat: "none",
  memo: "",
};

function CalendarPage() {
  const navigate = useNavigate();
  const today = new Date();

  const [current, setCurrent] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });
  const [showPicker, setShowPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(today.getFullYear());
  const [schedules, setSchedules] = useState([]);
  const [personalEvents, setPersonalEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [holidays, setHolidays] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingEvent, setEditingEvent] = useState(null);
  const [saving, setSaving] = useState(false);

  const [skipEnabled, setSkipEnabled] = useState(
    localStorage.getItem("notif_skip_enabled") === "true"
  );
  const [skipHoliday, setSkipHoliday] = useState(
    localStorage.getItem("notif_skip_holiday") !== "false"
  );
  const [skipAltHoliday, setSkipAltHoliday] = useState(
    localStorage.getItem("notif_skip_alt_holiday") !== "false"
  );
  const [skipSaturday, setSkipSaturday] = useState(
    localStorage.getItem("notif_skip_saturday") !== "false"
  );
  const [skipSunday, setSkipSunday] = useState(
    localStorage.getItem("notif_skip_sunday") !== "false"
  );

  const [showSidePanel, setShowSidePanel] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(
    !!localStorage.getItem("google_calendar_token")
  );
  const [googleAutoSync, setGoogleAutoSync] = useState(
    localStorage.getItem("google_calendar_auto_sync") === "true"
  );

  const [sharingFriends, setSharingFriends] = useState([]);
  const [friendListForShare, setFriendListForShare] = useState([]);
  const [sentCalendarShareRequests, setSentCalendarShareRequests] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const touchStartX = useRef(null);

  const { year, month } = current;

  const toggleSkip = (key, value, setter) => {
    const next = !value;
    localStorage.setItem(key, String(next));
    setter(next);
  };

  const googleLogin = useGoogleLogin({
    scope: "https://www.googleapis.com/auth/calendar.events",
    onSuccess: (tokenResponse) => {
      const expiry = Date.now() + tokenResponse.expires_in * 1000;

      localStorage.setItem("google_calendar_token", tokenResponse.access_token);
      localStorage.setItem("google_calendar_token_expiry", String(expiry));

      setGoogleConnected(true);
      alert("구글 캘린더가 연결되었습니다!");
    },
    onError: () => {
      alert("구글 캘린더 연결에 실패했습니다.");
    },
  });

  const handleGoogleDisconnect = () => {
    localStorage.removeItem("google_calendar_token");
    localStorage.removeItem("google_calendar_token_expiry");
    localStorage.removeItem("google_calendar_auto_sync");

    setGoogleConnected(false);
    setGoogleAutoSync(false);
  };

  const handleAutoSyncToggle = async () => {
    const next = !googleAutoSync;
    localStorage.setItem("google_calendar_auto_sync", String(next));
    setGoogleAutoSync(next);

    if (!next || !currentUser) return;

    // 켤 때 기존 일정 일괄 추가
    try {
      const [confirmedList, personalList] = await Promise.all([
        getMyConfirmedSchedules(currentUser.id),
        getPersonalEvents(currentUser.id),
      ]);

      const allEvents = [
        ...confirmedList
          .filter((s) => s.date)
          .map((s) => ({
            title: s.title || s.roomname || "확정 일정",
            date: s.date,
            starttime: s.starttime,
            endtime: s.endtime,
          })),
        ...personalList
          .filter((e) => e.date)
          .map((e) => ({
            title: e.title,
            date: e.date,
            starttime: e.starttime,
            endtime: e.endtime,
          })),
      ];

      if (allEvents.length === 0) return;

      let successCount = 0;
      for (const event of allEvents) {
        try {
          await addEventToGoogleCalendar(event);
          successCount++;
        } catch {
          // 개별 실패는 스킵
        }
      }

      alert(`기존 일정 ${successCount}개가 구글 캘린더에 추가됐습니다.`);
    } catch (e) {
      alert("기존 일정 동기화 실패: " + e.message);
    }
  };

  const handleOpenSidePanel = async () => {
    setShowSidePanel(true);

    if (!currentUser) return;

    try {
      const [sharing, friends, sentPending] = await Promise.all([
        getAcceptedShares(currentUser.id),
        getFriends(currentUser.id),
        getSentPendingCalendarShares(currentUser.id),
      ]);

      setSharingFriends(sharing);
      setSentCalendarShareRequests(sentPending);

      const sharingIds = new Set(sharing.map((s) => s.id));
      const sentIds = new Set(sentPending.map((s) => s.receiverId));
      setFriendListForShare(friends.filter((f) => !sharingIds.has(f.id) && !sentIds.has(f.id)));
    } catch (e) {
      console.error(e);
    }
  };

  const handleShareRequest = async (friend) => {
    if (!currentUser) return;

    setShareLoading(true);

    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", currentUser.id)
        .single();

      const senderNickname = profile?.nickname || currentUser.email;

      const newShareId = await sendCalendarShareRequest(currentUser.id, friend.id, senderNickname);

      setFriendListForShare((prev) => prev.filter((f) => f.id !== friend.id));
      setSentCalendarShareRequests((prev) => [
        ...prev,
        {
          shareId: newShareId,
          receiverId: friend.id,
          id: friend.id,
          nickname: friend.nickname,
          profileimageurl: friend.profileimageurl,
        },
      ]);

      alert(`${friend.nickname}님에게 캘린더 공유 요청을 보냈습니다.`);
    } catch (e) {
      alert(e.message);
    } finally {
      setShareLoading(false);
    }
  };

  const handleCancelCalendarShareRequest = async (req) => {
    try {
      await cancelCalendarShareRequest(req.shareId, currentUser.id, req.receiverId);
      setSentCalendarShareRequests((prev) => prev.filter((r) => r.shareId !== req.shareId));
      setFriendListForShare((prev) => [...prev, { id: req.receiverId, nickname: req.nickname, profileimageurl: req.profileimageurl }]);
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRemoveShare = async (friend) => {
    if (!window.confirm(`${friend.nickname}님과의 캘린더 공유를 취소할까요?`)) {
      return;
    }

    try {
      await removeCalendarShare(currentUser.id, friend.id);

      setSharingFriends((prev) => prev.filter((f) => f.id !== friend.id));
      setFriendListForShare((prev) => [...prev, friend]);
    } catch (e) {
      alert(e.message);
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUser(user);
    });
  }, []);

  useEffect(() => {
    fetchHolidays(year, month).then(setHolidays);
  }, [year, month]);

  useEffect(() => {
    if (!currentUser) return;

    getMyConfirmedSchedules(currentUser.id)
      .then(setSchedules)
      .catch(() => {});

    getPersonalEvents(currentUser.id)
      .then(setPersonalEvents)
      .catch(() => {});
  }, [currentUser]);

  useEffect(() => {
    const loadAndSyncGoogle = async () => {
      const events = await fetchGoogleCalendarEvents(year, month);
      setGoogleEvents(events);

      if (currentUser && events.length > 0) {
        const rows = events.map((e) => ({
          id: e.id,
          userid: currentUser.id,
          title: e.title,
          date: e.date,
          starttime: e.starttime || null,
          endtime: e.endtime || null,
        }));

        await supabase.from("google_events").upsert(rows, {
          onConflict: "userid,id",
        });
      }
    };

    loadAndSyncGoogle();
  }, [year, month, currentUser]);

  const scheduleMap = {};

  schedules.forEach((s) => {
    if (!scheduleMap[s.date]) scheduleMap[s.date] = [];
    scheduleMap[s.date].push(s);
  });

  const personalMap = {};

  personalEvents.forEach((e) => {
    const start = new Date(e.date + "T00:00:00");
    const end = e.enddate ? new Date(e.enddate + "T00:00:00") : start;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
        d.getDate()
      )}`;

      if (!personalMap[key]) personalMap[key] = [];
      personalMap[key].push(e);
    }
  });

  const googleMap = {};

  googleEvents.forEach((e) => {
    if (!googleMap[e.date]) googleMap[e.date] = [];
    googleMap[e.date].push(e);
  });

  const prevMonth = () => {
    setSelectedDay(null);

    setCurrent(({ year: y, month: m }) =>
      m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 }
    );
  };

  const nextMonth = () => {
    setSelectedDay(null);

    setCurrent(({ year: y, month: m }) =>
      m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 }
    );
  };

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;

    const diff = touchStartX.current - e.changedTouches[0].clientX;

    if (Math.abs(diff) > 50) {
      diff > 0 ? nextMonth() : prevMonth();
    }

    touchStartX.current = null;
  };

  const openCreateForm = (dateStr) => {
    setEditingEvent(null);
    setForm({
      ...EMPTY_FORM,
      startdate: dateStr || "",
      enddate: dateStr || "",
    });
    setShowForm(true);
  };

  const openEditForm = (event) => {
    setEditingEvent(event);

    const presets = ["none", "0", "10", "60", "1440"];
    const savedReminder = event.reminder || "none";
    const isCustom = !presets.includes(savedReminder);

    setForm({
      title: event.title,
      color: event.color,
      isallday: event.isallday,
      startdate: event.date,
      enddate: event.enddate || event.date,
      starttime: event.starttime || "",
      endtime: event.endtime || "",
      location: event.location || "",
      reminder: isCustom ? "custom" : savedReminder,
      customReminderValue: isCustom ? savedReminder : "30",
      customReminderUnit: "min",
      repeat: event.repeat || "none",
      memo: event.memo || "",
    });

    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      alert("제목을 입력하세요.");
      return;
    }

    if (!form.startdate) {
      alert("날짜를 선택하세요.");
      return;
    }

    if (form.enddate && form.enddate < form.startdate) {
      alert("종료 날짜가 시작 날짜보다 앞일 수 없습니다.");
      return;
    }

    setSaving(true);

    try {
      let reminderValue = form.reminder;

      if (form.reminder === "custom") {
        const multiplier =
          form.customReminderUnit === "min"
            ? 1
            : form.customReminderUnit === "hour"
            ? 60
            : 1440;

        reminderValue = String(Number(form.customReminderValue) * multiplier);
      }

      const payload = {
        title: form.title.trim(),
        color: form.color,
        isallday: form.isallday,
        date: form.startdate,
        enddate:
          form.enddate && form.enddate !== form.startdate ? form.enddate : null,
        starttime: form.isallday ? null : form.starttime || null,
        endtime: form.isallday ? null : form.endtime || null,
        location: form.location.trim() || null,
        reminder: reminderValue,
        repeat: form.repeat,
        memo: form.memo.trim() || null,
      };

      if (editingEvent) {
        await updatePersonalEvent(editingEvent.id, payload);

        setPersonalEvents((prev) =>
          prev.map((e) => (e.id === editingEvent.id ? { ...e, ...payload } : e))
        );
      } else {
        await createPersonalEvent({
          ...payload,
          userid: currentUser.id,
        });

        const updated = await getPersonalEvents(currentUser.id);
        setPersonalEvents(updated);

        // 자동 추가 기능 유지
        if (localStorage.getItem("google_calendar_auto_sync") === "true") {
          try {
            await addEventToGoogleCalendar({
              title: payload.title,
              date: payload.date,
              starttime: payload.starttime,
              endtime: payload.endtime,
            });
          } catch (googleErr) {
            alert("일정은 저장됐지만 구글 캘린더 추가 실패: " + googleErr.message);
          }
        }
      }

      setShowForm(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("일정을 삭제할까요?")) return;

    await deletePersonalEvent(id);

    setPersonalEvents((prev) => prev.filter((e) => e.id !== id));
    setShowForm(false);
  };

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const isToday = (d) =>
    d === today.getDate() &&
    month === today.getMonth() &&
    year === today.getFullYear();

  const selectedKey = selectedDay ? dateKey(year, month, selectedDay) : null;
  const selectedSchedules = selectedKey ? scheduleMap[selectedKey] || [] : [];
  const selectedPersonal = selectedKey ? personalMap[selectedKey] || [] : [];
  const selectedGoogle = selectedKey ? googleMap[selectedKey] || [] : [];
  const selectedHoliday = selectedKey ? holidays[selectedKey] : null;

  const hasSelectedContent =
    selectedHoliday ||
    selectedSchedules.length > 0 ||
    selectedPersonal.length > 0 ||
    selectedGoogle.length > 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#fff",
        paddingBottom: "80px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid #eee",
        }}
      >
        <div style={{ width: "32px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          <button
            onClick={prevMonth}
            style={{
              border: "none",
              background: "none",
              fontSize: "24px",
              cursor: "pointer",
              color: "#555",
            }}
          >
            ‹
          </button>

          <button
            onClick={() => {
              setPickerYear(year);
              setShowPicker(true);
            }}
            style={{
              border: "none",
              background: "none",
              fontSize: "18px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            {year}년 {month + 1}월
          </button>

          <button
            onClick={nextMonth}
            style={{
              border: "none",
              background: "none",
              fontSize: "24px",
              cursor: "pointer",
              color: "#555",
            }}
          >
            ›
          </button>
        </div>

        <button
          onClick={handleOpenSidePanel}
          style={{
            border: "none",
            background: "none",
            fontSize: "22px",
            cursor: "pointer",
            color: "#555",
            lineHeight: 1,
          }}
        >
          ⋮
        </button>
      </div>

      {/* Weekday row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          padding: "8px 4px 4px",
        }}
      >
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              fontSize: "12px",
              fontWeight: "bold",
              color: i === 0 ? "#f44" : i === 6 ? "#7c79ff" : "#888",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          padding: "0 2px",
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {cells.map((d, i) => {
          const col = i % 7;
          const key = d ? dateKey(year, month, d) : null;
          const holiday = key ? holidays[key] : null;
          const daySchedules = key ? scheduleMap[key] || [] : [];
          const dayPersonal = key ? personalMap[key] || [] : [];
          const dayGoogle = key ? googleMap[key] || [] : [];
          const isSun = col === 0;
          const isSat = col === 6;
          const isSelected = selectedDay === d;

          const textColor = isToday(d)
            ? "#fff"
            : holiday?.public || isSun
            ? "#f44"
            : isSat
            ? "#7c79ff"
            : "#222";

          return (
            <div
              key={i}
              onClick={() => d && setSelectedDay(isSelected ? null : d)}
              style={{
                minHeight: "60px",
                padding: "4px 2px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                cursor: d ? "pointer" : "default",
                backgroundColor: isSelected ? "#f0f0ff" : "transparent",
                borderRadius: "8px",
              }}
            >
              {d && (
                <>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "50%",
                      backgroundColor: isToday(d) ? "#7c79ff" : "transparent",
                      color: textColor,
                      fontSize: "13px",
                      fontWeight: isToday(d) ? "bold" : "normal",
                    }}
                  >
                    {d}
                  </div>

                  {holiday && (
                    <p
                      style={{
                        margin: "1px 0 0",
                        fontSize: "9px",
                        lineHeight: 1.2,
                        color: holiday.public ? "#f44" : "#f90",
                        textAlign: "center",
                        wordBreak: "keep-all",
                        maxWidth: "100%",
                        overflow: "hidden",
                      }}
                    >
                      {holiday.name}
                    </p>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: "2px",
                      marginTop: "2px",
                      flexWrap: "wrap",
                      justifyContent: "center",
                    }}
                  >
                    {daySchedules.slice(0, 1).map((_, si) => (
                      <div
                        key={`s${si}`}
                        style={{
                          width: "5px",
                          height: "5px",
                          borderRadius: "50%",
                          backgroundColor: "#7c79ff",
                        }}
                      />
                    ))}

                    {dayPersonal.slice(0, 2).map((e, pi) => (
                      <div
                        key={`p${pi}`}
                        style={{
                          width: "5px",
                          height: "5px",
                          borderRadius: "50%",
                          backgroundColor: e.color || "#7c79ff",
                        }}
                      />
                    ))}

                    {dayGoogle.slice(0, 1).map((_, gi) => (
                      <div
                        key={`g${gi}`}
                        style={{
                          width: "5px",
                          height: "5px",
                          borderRadius: "50%",
                          backgroundColor: "#4285F4",
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selectedDay && hasSelectedContent && (
        <div
          style={{
            margin: "12px 16px",
            padding: "14px",
            backgroundColor: "#f9f9ff",
            borderRadius: "12px",
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              fontWeight: "bold",
              fontSize: "14px",
              color: "#555",
            }}
          >
            {month + 1}월 {selectedDay}일
          </p>

          {selectedHoliday && (
            <p
              style={{
                margin: "0 0 6px",
                fontSize: "13px",
                color: selectedHoliday.public ? "#f44" : "#f90",
              }}
            >
              {selectedHoliday.public ? "🎌" : "📅"} {selectedHoliday.name}
            </p>
          )}

          {selectedSchedules.map((s) => (
            <p
              key={s.id}
              style={{
                margin: "4px 0 0",
                fontSize: "13px",
                color: "#7c79ff",
              }}
            >
              📌 {s.title || s.date}{" "}
              {s.starttime
                ? `${s.starttime} ~${s.endtime ? ` ${s.endtime}` : ""}`
                : "(하루종일)"}
              {s.roomname && (
                <span style={{ color: "#aaa", fontSize: "12px" }}>
                  {" "}
                  · {s.roomname}
                </span>
              )}
            </p>
          ))}

          {selectedPersonal.map((e) => (
            <div
              key={e.id}
              onClick={() => openEditForm(e)}
              style={{
                margin: "4px 0 0",
                fontSize: "13px",
                color: e.color,
                cursor: "pointer",
                display: "flex",
                alignItems: "flex-start",
                gap: "4px",
              }}
            >
              <span>●</span>
              <div>
                <span style={{ fontWeight: "500" }}>{e.title}</span>

                {!e.isallday && e.starttime && (
                  <span style={{ color: "#888", marginLeft: "6px" }}>
                    {e.starttime}
                    {e.endtime ? ` ~ ${e.endtime}` : ""}
                  </span>
                )}

                {e.isallday && (
                  <span style={{ color: "#aaa", marginLeft: "6px" }}>
                    (하루종일)
                  </span>
                )}

                {e.location && (
                  <div style={{ fontSize: "12px", color: "#aaa" }}>
                    📍 {e.location}
                  </div>
                )}

                {e.memo && (
                  <div style={{ fontSize: "12px", color: "#aaa" }}>
                    {e.memo}
                  </div>
                )}
              </div>
            </div>
          ))}

          {selectedGoogle.map((e) => (
            <p
              key={e.id}
              style={{
                margin: "4px 0 0",
                fontSize: "13px",
                color: "#4285F4",
              }}
            >
              📅 {e.title}{" "}
              {e.starttime
                ? `${e.starttime} ~${e.endtime ? ` ${e.endtime}` : ""}`
                : "(하루종일)"}
            </p>
          ))}
        </div>
      )}

      {/* + FAB */}
      <button
        onClick={() =>
          openCreateForm(selectedDay ? dateKey(year, month, selectedDay) : "")
        }
        style={{
          position: "fixed",
          bottom: "80px",
          right: "20px",
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          backgroundColor: "#7c79ff",
          color: "#fff",
          border: "none",
          fontSize: "28px",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(124,121,255,0.4)",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        +
      </button>

      {/* Year/Month picker modal */}
      {showPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: "16px",
              padding: "24px",
              width: "300px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "20px",
              }}
            >
              <button
                onClick={() => setPickerYear((y) => y - 1)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: "22px",
                  cursor: "pointer",
                }}
              >
                ‹
              </button>

              <span style={{ fontSize: "18px", fontWeight: "bold" }}>
                {pickerYear}년
              </span>

              <button
                onClick={() => setPickerYear((y) => y + 1)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: "22px",
                  cursor: "pointer",
                }}
              >
                ›
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "8px",
              }}
            >
              {MONTHS.map((label, i) => {
                const selected = pickerYear === year && i === month;

                return (
                  <button
                    key={i}
                    onClick={() => {
                      setCurrent({ year: pickerYear, month: i });
                      setSelectedDay(null);
                      setShowPicker(false);
                    }}
                    style={{
                      padding: "10px 0",
                      borderRadius: "10px",
                      fontSize: "14px",
                      cursor: "pointer",
                      border: selected ? "2px solid #7c79ff" : "1px solid #eee",
                      backgroundColor: selected ? "#f0f0ff" : "#fff",
                      color: selected ? "#7c79ff" : "#333",
                      fontWeight: selected ? "bold" : "normal",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setShowPicker(false)}
              style={{
                width: "100%",
                marginTop: "16px",
                padding: "12px",
                border: "none",
                borderRadius: "10px",
                backgroundColor: "#f5f5f5",
                fontSize: "15px",
                cursor: "pointer",
              }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Side panel */}
      {showSidePanel && (
        <>
          <div
            onClick={() => setShowSidePanel(false)}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.3)",
              zIndex: 200,
            }}
          />

          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "280px",
              backgroundColor: "#fff",
              zIndex: 201,
              boxShadow: "-2px 0 12px rgba(0,0,0,0.15)",
              padding: "24px 20px",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "28px",
              }}
            >
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>
                캘린더 설정
              </span>

              <button
                onClick={() => setShowSidePanel(false)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  color: "#aaa",
                }}
              >
                ✕
              </button>
            </div>

            {/* 캘린더 공개 */}
            <p
              style={{
                margin: "0 0 12px",
                fontSize: "14px",
                fontWeight: "600",
                color: "#333",
              }}
            >
              캘린더 공개
            </p>

            {sharingFriends.length > 0 ? (
              <div style={{ marginBottom: "12px" }}>
                {sharingFriends.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "8px 0",
                      borderBottom: "1px solid #f5f5f5",
                    }}
                  >
                    {f.profileimageurl ? (
                      <img
                        src={f.profileimageurl}
                        alt={f.nickname}
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          backgroundColor: "#fff3e0",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "16px",
                        }}
                      >
                        👤
                      </div>
                    )}

                    <span
                      onClick={() =>
                        navigate(`/calendar/friend/${f.id}`, {
                          state: { nickname: f.nickname },
                        })
                      }
                      style={{
                        flex: 1,
                        fontSize: "13px",
                        fontWeight: "600",
                        color: "#7c79ff",
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      {f.nickname}
                    </span>

                    <button
                      onClick={() => handleRemoveShare(f)}
                      style={{
                        fontSize: "11px",
                        color: "#f44",
                        border: "1px solid #f44",
                        background: "none",
                        borderRadius: "6px",
                        padding: "3px 8px",
                        cursor: "pointer",
                      }}
                    >
                      공개 취소
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p
                style={{
                  fontSize: "13px",
                  color: "#aaa",
                  marginBottom: "8px",
                }}
              >
                공개 중인 친구가 없습니다
              </p>
            )}

            {sentCalendarShareRequests.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: "#888",
                  }}
                >
                  보낸 공유 요청
                </p>
                {sentCalendarShareRequests.map((req) => (
                  <div
                    key={req.shareId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "7px 0",
                      borderBottom: "1px solid #f5f5f5",
                    }}
                  >
                    {req.profileimageurl ? (
                      <img
                        src={req.profileimageurl}
                        alt={req.nickname}
                        style={{ width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover" }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "50%",
                          backgroundColor: "#e0e0ff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "14px",
                        }}
                      >
                        👤
                      </div>
                    )}
                    <span style={{ flex: 1, fontSize: "13px" }}>{req.nickname}</span>
                    <span style={{ fontSize: "11px", color: "#aaa" }}>대기 중</span>
                    <button
                      onClick={() => handleCancelCalendarShareRequest(req)}
                      style={{
                        fontSize: "11px",
                        color: "#999",
                        border: "1px solid #ddd",
                        background: "none",
                        borderRadius: "6px",
                        padding: "3px 8px",
                        cursor: "pointer",
                      }}
                    >
                      취소
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowShareModal(true)}
              style={{
                width: "100%",
                padding: "9px",
                backgroundColor: "#7c79ff",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontSize: "13px",
                cursor: "pointer",
                marginBottom: "20px",
                fontWeight: "600",
              }}
            >
              공개 요청
            </button>

            <hr style={{ margin: "0 0 20px" }} />

            {/* 구글 캘린더 연동 */}
            <p
              style={{
                margin: "0 0 10px",
                fontSize: "14px",
                fontWeight: "600",
                color: "#333",
              }}
            >
              구글 캘린더 연동
            </p>

            {googleConnected ? (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "12px",
                  }}
                >
                  <span style={{ fontSize: "14px", color: "#4CAF50" }}>
                    ✓ 연결됨
                  </span>

                  <button
                    onClick={handleGoogleDisconnect}
                    style={{
                      fontSize: "13px",
                      color: "#f44",
                      border: "1px solid #f44",
                      background: "none",
                      borderRadius: "8px",
                      padding: "4px 12px",
                      cursor: "pointer",
                    }}
                  >
                    연결 해제
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "6px",
                  }}
                >
                  <span style={{ fontSize: "14px", color: "#333" }}>
                    확정 일정 자동 추가
                  </span>

                  <div
                    onClick={handleAutoSyncToggle}
                    style={{
                      width: "44px",
                      height: "24px",
                      borderRadius: "12px",
                      cursor: "pointer",
                      backgroundColor: googleAutoSync ? "#7c79ff" : "#ccc",
                      position: "relative",
                      transition: "background-color 0.2s",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        backgroundColor: "#fff",
                        position: "absolute",
                        top: "2px",
                        left: googleAutoSync ? "22px" : "2px",
                        transition: "left 0.2s",
                      }}
                    />
                  </div>
                </div>

                <p style={{ fontSize: "11px", color: "#aaa", margin: 0 }}>
                  켜면 캘린더에 등록한 일정이 구글 캘린더에 자동으로 추가됩니다
                </p>
              </div>
            ) : (
              <button
                onClick={() => googleLogin()}
                style={{
                  fontSize: "14px",
                  color: "#fff",
                  backgroundColor: "#4285F4",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  cursor: "pointer",
                }}
              >
                Google 캘린더 연결
              </button>
            )}
          </div>
        </>
      )}

      {/* 공개 요청 모달 */}
      {showShareModal && (
        <>
          <div
            onClick={() => setShowShareModal(false)}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.4)",
              zIndex: 400,
            }}
          />

          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              backgroundColor: "#fff",
              borderRadius: "16px",
              padding: "24px",
              width: "300px",
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              zIndex: 401,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>
                공개 요청
              </span>

              <button
                onClick={() => setShowShareModal(false)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  color: "#aaa",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {friendListForShare.length === 0 ? (
                <p
                  style={{
                    color: "#aaa",
                    textAlign: "center",
                    fontSize: "14px",
                    marginTop: "20px",
                  }}
                >
                  요청할 수 있는 친구가 없습니다
                </p>
              ) : (
                friendListForShare.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 0",
                      borderBottom: "1px solid #f5f5f5",
                    }}
                  >
                    {f.profileimageurl ? (
                      <img
                        src={f.profileimageurl}
                        alt={f.nickname}
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "50%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "50%",
                          backgroundColor: "#e0e0ff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "17px",
                        }}
                      >
                        👤
                      </div>
                    )}

                    <span style={{ flex: 1, fontSize: "14px" }}>
                      {f.nickname}
                    </span>

                    <button
                      onClick={() => handleShareRequest(f)}
                      disabled={shareLoading}
                      style={{
                        padding: "5px 12px",
                        backgroundColor: "#7c79ff",
                        color: "#fff",
                        border: "none",
                        borderRadius: "8px",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      요청
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Event form modal */}
      {showForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: "20px 20px 0 0",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "24px 20px 80px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <h3 style={{ margin: 0 }}>
                {editingEvent ? "일정 수정" : "일정 추가"}
              </h3>

              <button
                onClick={() => setShowForm(false)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: "20px",
                  color: "#aaa",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            {/* 제목 */}
            <input
              placeholder="제목"
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  title: e.target.value,
                }))
              }
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "16px",
                border: "none",
                borderBottom: `2px solid ${form.color}`,
                outline: "none",
                boxSizing: "border-box",
                marginBottom: "16px",
              }}
            />

            {/* 색상 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "13px", color: "#888" }}>
                색상
              </p>

              <div style={{ display: "flex", gap: "10px" }}>
                {PRESET_COLORS.map((c) => (
                  <div
                    key={c}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        color: c,
                      }))
                    }
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      backgroundColor: c,
                      cursor: "pointer",
                      border:
                        form.color === c
                          ? "3px solid #333"
                          : "3px solid transparent",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* 하루종일 */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "16px",
                fontSize: "15px",
              }}
            >
              <div
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    isallday: !f.isallday,
                  }))
                }
                style={{
                  width: "44px",
                  height: "24px",
                  borderRadius: "12px",
                  cursor: "pointer",
                  backgroundColor: form.isallday ? "#7c79ff" : "#ccc",
                  position: "relative",
                  transition: "background-color 0.2s",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    backgroundColor: "#fff",
                    position: "absolute",
                    top: "2px",
                    left: form.isallday ? "22px" : "2px",
                    transition: "left 0.2s",
                  }}
                />
              </div>
              하루종일
            </label>

            {/* 날짜 */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              <div style={{ flex: 1 }}>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: "13px",
                    color: "#888",
                  }}
                >
                  시작 날짜
                </p>

                <input
                  type="date"
                  value={form.startdate}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      startdate: e.target.value,
                      enddate:
                        f.enddate < e.target.value ? e.target.value : f.enddate,
                    }))
                  }
                  style={{
                    width: "100%",
                    padding: "10px",
                    border: "1px solid #ddd",
                    borderRadius: "10px",
                    fontSize: "15px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: "13px",
                    color: "#888",
                  }}
                >
                  종료 날짜
                </p>

                <input
                  type="date"
                  value={form.enddate}
                  min={form.startdate}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      enddate: e.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    padding: "10px",
                    border: "1px solid #ddd",
                    borderRadius: "10px",
                    fontSize: "15px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            {/* 시간 */}
            {!form.isallday && (
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: "13px",
                      color: "#888",
                    }}
                  >
                    시작 시간
                  </p>

                  <input
                    type="time"
                    value={form.starttime}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        starttime: e.target.value,
                      }))
                    }
                    style={{
                      width: "100%",
                      padding: "10px",
                      border: "1px solid #ddd",
                      borderRadius: "10px",
                      fontSize: "15px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: "13px",
                      color: "#888",
                    }}
                  >
                    종료 시간
                  </p>

                  <input
                    type="time"
                    value={form.endtime}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        endtime: e.target.value,
                      }))
                    }
                    style={{
                      width: "100%",
                      padding: "10px",
                      border: "1px solid #ddd",
                      borderRadius: "10px",
                      fontSize: "15px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            )}

            {/* 장소 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>
                장소
              </p>

              <input
                placeholder="장소 입력"
                value={form.location}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    location: e.target.value,
                  }))
                }
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "10px",
                  fontSize: "15px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* 알림 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>
                알림
              </p>

              <select
                value={form.reminder}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    reminder: e.target.value,
                  }))
                }
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "10px",
                  fontSize: "15px",
                  backgroundColor: "#fff",
                }}
              >
                {REMINDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              {form.reminder === "custom" && (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <input
                    type="number"
                    min="1"
                    value={form.customReminderValue}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        customReminderValue: e.target.value,
                      }))
                    }
                    style={{
                      flex: 1,
                      padding: "10px",
                      border: "1px solid #ddd",
                      borderRadius: "10px",
                      fontSize: "15px",
                    }}
                  />

                  <select
                    value={form.customReminderUnit}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        customReminderUnit: e.target.value,
                      }))
                    }
                    style={{
                      flex: 1,
                      padding: "10px",
                      border: "1px solid #ddd",
                      borderRadius: "10px",
                      fontSize: "15px",
                      backgroundColor: "#fff",
                    }}
                  >
                    <option value="min">분 전</option>
                    <option value="hour">시간 전</option>
                    <option value="day">일 전</option>
                  </select>
                </div>
              )}
            </div>

            {/* 알림 받지 않는 날 */}
            <div style={{ marginBottom: "16px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "6px",
                }}
              >
                <span style={{ fontSize: "14px", color: "#333" }}>
                  알림 받지 않는 날 설정
                </span>

                <div
                  onClick={() =>
                    toggleSkip("notif_skip_enabled", skipEnabled, setSkipEnabled)
                  }
                  style={{
                    width: "44px",
                    height: "24px",
                    borderRadius: "12px",
                    cursor: "pointer",
                    backgroundColor: skipEnabled ? "#7c79ff" : "#ccc",
                    position: "relative",
                    transition: "background-color 0.2s",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      backgroundColor: "#fff",
                      position: "absolute",
                      top: "2px",
                      left: skipEnabled ? "22px" : "2px",
                      transition: "left 0.2s",
                    }}
                  />
                </div>
              </div>

              {skipEnabled && (
                <div
                  style={{
                    backgroundColor: "#f9f9ff",
                    borderRadius: "10px",
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {[
                    {
                      label: "공휴일",
                      value: skipHoliday,
                      key: "notif_skip_holiday",
                      setter: setSkipHoliday,
                    },
                    {
                      label: "대체 및 임시 공휴일",
                      value: skipAltHoliday,
                      key: "notif_skip_alt_holiday",
                      setter: setSkipAltHoliday,
                    },
                    {
                      label: "토요일",
                      value: skipSaturday,
                      key: "notif_skip_saturday",
                      setter: setSkipSaturday,
                    },
                    {
                      label: "일요일",
                      value: skipSunday,
                      key: "notif_skip_sunday",
                      setter: setSkipSunday,
                    },
                  ].map(({ label, value, key, setter }) => (
                    <div
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ fontSize: "14px", color: "#555" }}>
                        {label}
                      </span>

                      <div
                        onClick={() => toggleSkip(key, value, setter)}
                        style={{
                          width: "44px",
                          height: "24px",
                          borderRadius: "12px",
                          cursor: "pointer",
                          backgroundColor: value ? "#7c79ff" : "#ccc",
                          position: "relative",
                          transition: "background-color 0.2s",
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            width: "20px",
                            height: "20px",
                            borderRadius: "50%",
                            backgroundColor: "#fff",
                            position: "absolute",
                            top: "2px",
                            left: value ? "22px" : "2px",
                            transition: "left 0.2s",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 반복 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>
                반복
              </p>

              <select
                value={form.repeat}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    repeat: e.target.value,
                  }))
                }
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "10px",
                  fontSize: "15px",
                  backgroundColor: "#fff",
                }}
              >
                {REPEAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 메모 */}
            <div style={{ marginBottom: "24px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>
                메모
              </p>

              <textarea
                placeholder="메모 입력"
                value={form.memo}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    memo: e.target.value,
                  }))
                }
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "10px",
                  fontSize: "15px",
                  boxSizing: "border-box",
                  resize: "none",
                }}
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%",
                padding: "14px",
                backgroundColor: form.color,
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                fontSize: "16px",
                cursor: "pointer",
                marginBottom: "8px",
              }}
            >
              {saving ? "저장 중..." : "저장"}
            </button>

            {editingEvent && (
              <button
                onClick={() => handleDelete(editingEvent.id)}
                style={{
                  width: "100%",
                  padding: "12px",
                  backgroundColor: "#fff",
                  color: "#f44",
                  border: "1px solid #f44",
                  borderRadius: "12px",
                  fontSize: "15px",
                  cursor: "pointer",
                }}
              >
                삭제
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarPage;