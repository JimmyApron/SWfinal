import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendarAlt } from "react-icons/fa";
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
import { getTodos, createTodo, toggleTodo, updateTodo, deleteTodo } from "../../api/todoApi";
import {
  sendCalendarShareRequest,
  getAcceptedShares,
  removeCalendarShare,
  getSentPendingCalendarShares,
  getReceivedPendingCalendarShares,
  cancelCalendarShareRequest,
  acceptCalendarShare,
  rejectCalendarShare,
} from "../../api/calendarShareApi";
import LocationPicker from "../../components/map/LocationPicker";
import GoogleCalendarControl from "../../components/GoogleCalendarControl";
import { getEventDayKeys } from "../../lib/eventRepeat";
import { getMyRoomTodos, getRoomTodoCompletions, setRoomTodoDone } from "../../api/roomTodoApi";

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
];
// 할일(todo) 전용 색상(민트) — 일정 색상 목록(PRESET_COLORS)에서는 제외해서 겹치지 않게 한다
const TODO_COLOR = "#1ABC9C";
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

export async function fetchHolidays(year, month) {
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

export async function fetchGoogleCalendarEvents(year, month) {
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

const TODO_REMINDER_PRESETS = ["none", "0", "10", "60", "1440"];
const TODO_UNIT_MINUTES = { min: 1, hour: 60, day: 1440 };

// 저장된 분 단위 값을 폼 상태로 (프리셋이 아니면 "직접 설정" + 딱 맞는 가장 큰 단위)
function parseTodoReminder(saved) {
  const value = String(saved || "none");
  if (TODO_REMINDER_PRESETS.includes(value)) return { reminder: value, value: "30", unit: "min" };
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return { reminder: "none", value: "30", unit: "min" };
  const unit = minutes % 1440 === 0 ? "day" : minutes % 60 === 0 ? "hour" : "min";
  return { reminder: "custom", value: String(minutes / TODO_UNIT_MINUTES[unit]), unit };
}

function buildTodoReminder(reminder, value, unit) {
  return reminder === "custom" ? String(Math.round(Number(value) * TODO_UNIT_MINUTES[unit])) : reminder;
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
  shareToRoom: false,
  roomids: [],
};

function CalendarPage() {
  const navigate = useNavigate();
  const today = new Date();

  const [current, setCurrent] = useState(() => {
    try {
      const saved = sessionStorage.getItem("calendar_current");
      if (saved) return JSON.parse(saved);
    } catch {}
    return { year: today.getFullYear(), month: today.getMonth() };
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
  const [showFabMenu, setShowFabMenu] = useState(false);
  const [showTodoModal, setShowTodoModal] = useState(false);
  const [todoTitle, setTodoTitle] = useState("");
  const [todoDueDate, setTodoDueDate] = useState("");
  const [todoDueTime, setTodoDueTime] = useState("");
  const [todoNoDeadline, setTodoNoDeadline] = useState(false);
  const [todoReminder, setTodoReminder] = useState("none");
  const [todoCustomValue, setTodoCustomValue] = useState("30");
  const [todoCustomUnit, setTodoCustomUnit] = useState("min");
  const [todos, setTodos] = useState([]);
  const [roomTodos, setRoomTodos] = useState([]);
  const [myRooms, setMyRooms] = useState([]);
  const [roomTodoDone, setRoomTodoDoneRows] = useState([]);
  const [roomMeta, setRoomMeta] = useState({});
  const [editingTodo, setEditingTodo] = useState(null);
  const [editTodoTitle, setEditTodoTitle] = useState("");
  const [editTodoDueDate, setEditTodoDueDate] = useState("");
  const [editTodoDueTime, setEditTodoDueTime] = useState("");
  const [editTodoReminder, setEditTodoReminder] = useState("none");
  const [editTodoCustomValue, setEditTodoCustomValue] = useState("30");
  const [editTodoCustomUnit, setEditTodoCustomUnit] = useState("min");
  const [editTodoNoDeadline, setEditTodoNoDeadline] = useState(false);
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
  const [googleVersion, setGoogleVersion] = useState(0);

  const [sharingFriends, setSharingFriends] = useState([]);
  const [friendListForShare, setFriendListForShare] = useState([]);
  const [sentCalendarShareRequests, setSentCalendarShareRequests] = useState([]);
  const [receivedCalendarShareRequests, setReceivedCalendarShareRequests] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const touchStartX = useRef(null);

  const { year, month } = current;

  const toggleSkip = (key, value, setter) => {
    const next = !value;
    localStorage.setItem(key, String(next));
    setter(next);
  };

  // 구글 캘린더 "자동 추가"를 켤 때 기존 일정 일괄 추가
  const handleGoogleAutoSyncEnabled = async () => {
    if (!currentUser) return;

    // 켤 때 기존 일정 일괄 추가
    try {
      const [confirmedList, personalList] = await Promise.all([
        getMyConfirmedSchedules(currentUser.id, { includeAll: true }),
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

  const loadCalendarShareData = useCallback(async () => {
    if (!currentUser) return;

    try {
      const [sharing, friends, sentPending, receivedPending] = await Promise.all([
        getAcceptedShares(currentUser.id),
        getFriends(currentUser.id),
        getSentPendingCalendarShares(currentUser.id),
        getReceivedPendingCalendarShares(currentUser.id),
      ]);

      setSharingFriends(sharing);
      setSentCalendarShareRequests(sentPending);
      setReceivedCalendarShareRequests(receivedPending);

      const sharingIds = new Set(sharing.map((s) => s.id));
      const sentIds = new Set(sentPending.map((s) => s.receiverId));
      const receivedIds = new Set(receivedPending.map((s) => s.senderId));
      setFriendListForShare(
        friends.filter((f) => !sharingIds.has(f.id) && !sentIds.has(f.id) && !receivedIds.has(f.id))
      );
    } catch (e) {
      console.error(e);
    }
  }, [currentUser]);

  const handleOpenSidePanel = async () => {
    setShowSidePanel(true);
    await loadCalendarShareData();
  };

  useEffect(() => {
    if (!currentUser) return;

    const channel = supabase
      .channel(`calendar-shares-${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_shares",
          filter: `receiverid=eq.${currentUser.id}`,
        },
        loadCalendarShareData
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_shares",
          filter: `senderid=eq.${currentUser.id}`,
        },
        loadCalendarShareData
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, loadCalendarShareData]);

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

  const handleAcceptCalendarShareRequest = async (req) => {
    try {
      await acceptCalendarShare(currentUser.id, req.senderId);
      setReceivedCalendarShareRequests((prev) => prev.filter((r) => r.shareId !== req.shareId));
      await loadCalendarShareData();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRejectCalendarShareRequest = async (req) => {
    try {
      await rejectCalendarShare(req.senderId, currentUser.id);
      setReceivedCalendarShareRequests((prev) => prev.filter((r) => r.shareId !== req.shareId));
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
      if (user) {
        getTodos(user.id).then(setTodos).catch(() => {});
      }
    });
  }, []);

  const loadRoomTodos = useCallback(async () => {
    if (!currentUser) return;
    try {
      const first = dateKey(year, month, 1);
      const last = dateKey(year, month, new Date(year, month + 1, 0).getDate());
      const list = (await getMyRoomTodos(last)).filter((t) => !t.assignees?.length || t.assignees.map(String).includes(String(currentUser.id)));
      setRoomTodos(list);
      setRoomTodoDoneRows(await getRoomTodoCompletions(list.map((t) => t.id), first, last));
      const roomIds = [...new Set(list.map((t) => t.roomid))];
      if (!roomIds.length) return;
      const [{ data: rooms }, { data: members }] = await Promise.all([
        supabase.from("rooms").select("id, roomname").in("id", roomIds),
        supabase.from("room_members").select("roomid").in("roomid", roomIds),
      ]);
      const meta = {};
      roomIds.forEach((id) => { meta[id] = { name: "", memberCount: 0 }; });
      (rooms || []).forEach((r) => { meta[r.id].name = r.roomname || ""; });
      (members || []).forEach((m) => { if (meta[m.roomid]) meta[m.roomid].memberCount += 1; });
      setRoomMeta(meta);
    } catch {
      // 공동 할 일 테이블이 없거나 조회 실패여도 홈 캘린더는 그대로 동작
    }
  }, [currentUser, year, month]);

  useEffect(() => { loadRoomTodos(); }, [loadRoomTodos]);

  useEffect(() => {
    if (!currentUser) return;
    supabase
      .from("room_members")
      .select("roomid, rooms(roomname)")
      .eq("userid", currentUser.id)
      .then(({ data }) => {
        setMyRooms((data || []).map((m) => ({ id: m.roomid, name: m.rooms?.roomname || "이름 없는 방" })));
      });
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return undefined;
    let timer = null;
    const reload = () => { window.clearTimeout(timer); timer = window.setTimeout(loadRoomTodos, 150); };
    const channel = supabase
      .channel(`home-room-todos-${currentUser.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_todos" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_todo_completions" }, reload)
      .subscribe();
    return () => { window.clearTimeout(timer); supabase.removeChannel(channel); };
  }, [currentUser, loadRoomTodos]);

  useEffect(() => {
    sessionStorage.setItem("calendar_current", JSON.stringify(current));
  }, [current]);

  useEffect(() => {
    fetchHolidays(year, month).then(setHolidays);
  }, [year, month]);

  useEffect(() => {
    if (!currentUser) return;

    getMyConfirmedSchedules(currentUser.id, { includeAll: true })
      .then(async (data) => {
        if (!data || !data.length) { setSchedules([]); return; }
        const roomIds = [...new Set(data.map((s) => s.roomid))];
        const { data: members } = await supabase
          .from("room_members")
          .select("roomid")
          .in("roomid", roomIds);
        const countMap = {};
        (members || []).forEach((m) => {
          countMap[m.roomid] = (countMap[m.roomid] || 0) + 1;
        });
        setSchedules(data.map((s) => ({ ...s, memberCount: countMap[s.roomid] || 0 })));
      })
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
  }, [year, month, currentUser, googleVersion]);

  const scheduleMap = {};

  schedules.forEach((s) => {
    if (!scheduleMap[s.date]) scheduleMap[s.date] = [];
    scheduleMap[s.date].push(s);
  });

  const todoMap = {};

  todos.forEach((t) => {
    if (t.duedate) {
      if (!todoMap[t.duedate]) todoMap[t.duedate] = [];
      todoMap[t.duedate].push(t);
    }
  });

  const roomTodoMap = {};
  const roomFirstKey = dateKey(year, month, 1);
  const roomLastKey = dateKey(year, month, new Date(year, month + 1, 0).getDate());
  roomTodos.forEach((t) => {
    getEventDayKeys(t, roomFirstKey, roomLastKey).forEach((key) => {
      if (!roomTodoMap[key]) roomTodoMap[key] = [];
      roomTodoMap[key].push(t);
    });
  });
  const roomTodoDoneIds = (t, key) => roomTodoDone
    .filter((r) => r.todoid === t.id && r.occurrencedate === key)
    .map((r) => String(r.userid))
    .filter((id) => !t.assignees?.length || t.assignees.map(String).includes(id));
  const roomTodoPool = (t) => t.assignees?.length || roomMeta[t.roomid]?.memberCount || 1;
  const roomTodoNeeded = (t) => Math.max(1, Math.min(t.requiredcount ?? roomTodoPool(t), roomTodoPool(t)));

  const handleRoomTodoToggle = async (t, key) => {
    const done = roomTodoDoneIds(t, key).includes(String(currentUser.id));
    try {
      await setRoomTodoDone({ todoId: t.id, date: key, userId: currentUser.id, done: !done });
      await loadRoomTodos();
    } catch (e) {
      alert(e.message);
    }
  };

  const personalMap = {};

  const monthFirstKey = dateKey(year, month, 1);
  const monthLastKey = dateKey(year, month, new Date(year, month + 1, 0).getDate());

  personalEvents.forEach((e) => {
    getEventDayKeys(e, monthFirstKey, monthLastKey, { personal: true }).forEach((key) => {
      if (!personalMap[key]) personalMap[key] = [];
      personalMap[key].push(e);
    });
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

  const handleTodoCreate = async () => {
    if (!todoTitle.trim() || !currentUser) return;
    if (!todoNoDeadline && todoReminder === "custom" && !(Number(todoCustomValue) > 0)) {
      alert("알림 시간을 1 이상으로 입력하세요.");
      return;
    }
    try {
      const newTodo = await createTodo({
        userId: currentUser.id,
        title: todoTitle.trim(),
        duedate: todoDueDate || null,
        duetime: todoNoDeadline ? null : todoDueTime || null,
        reminder: todoNoDeadline ? "none" : buildTodoReminder(todoReminder, todoCustomValue, todoCustomUnit),
      });
      setTodos((prev) => [newTodo, ...prev]);
      setTodoTitle("");
      setTodoDueDate("");
      setTodoDueTime("");
      setTodoNoDeadline(false);
      setTodoReminder("none");
      setTodoCustomValue("30");
      setTodoCustomUnit("min");
      setShowTodoModal(false);
    } catch (e) {
      alert(e.message);
    }
  };

  const handleTodoToggle = async (todo) => {
    try {
      await toggleTodo(todo.id, !todo.iscompleted);
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, iscompleted: !t.iscompleted } : t))
      );
    } catch (e) {
      alert(e.message);
    }
  };

  const handleTodoDelete = async (id) => {
    if (!window.confirm("할일을 삭제할까요?")) return;
    try {
      await deleteTodo(id);
      setTodos((prev) => prev.filter((t) => t.id !== id));
      setEditingTodo(null);
    } catch (e) {
      alert(e.message);
    }
  };

  const openEditTodo = (todo) => {
    setEditingTodo(todo);
    setEditTodoTitle(todo.title);
    setEditTodoDueDate(todo.duedate || "");
    setEditTodoDueTime(todo.duetime || "");
    const parsed = parseTodoReminder(todo.reminder);
    setEditTodoReminder(parsed.reminder);
    setEditTodoCustomValue(parsed.value);
    setEditTodoCustomUnit(parsed.unit);
    setEditTodoNoDeadline(!todo.duedate);
  };

  const handleTodoUpdate = async () => {
    if (!editTodoTitle.trim() || !editingTodo) return;
    if (!editTodoNoDeadline && editTodoReminder === "custom" && !(Number(editTodoCustomValue) > 0)) {
      alert("알림 시간을 1 이상으로 입력하세요.");
      return;
    }
    const nextReminder = editTodoNoDeadline ? "none" : buildTodoReminder(editTodoReminder, editTodoCustomValue, editTodoCustomUnit);
    try {
      await updateTodo(editingTodo.id, {
        title: editTodoTitle.trim(),
        duedate: editTodoDueDate || null,
        duetime: editTodoNoDeadline ? null : editTodoDueTime || null,
        reminder: nextReminder,
      });
      setTodos((prev) =>
        prev.map((t) =>
          t.id === editingTodo.id
            ? {
                ...t,
                title: editTodoTitle.trim(),
                duedate: editTodoNoDeadline ? null : editTodoDueDate || null,
                duetime: editTodoNoDeadline ? null : editTodoDueTime || null,
                reminder: nextReminder,
              }
            : t
        )
      );
      setEditingTodo(null);
    } catch (e) {
      alert(e.message);
    }
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
      shareToRoom: Boolean(event.roomids?.length),
      roomids: (event.roomids || []).map(String),
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

    if (form.shareToRoom && form.roomids.length === 0) {
      alert("공유할 방을 선택하세요.");
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

      // 공용 캘린더 공유: 토글을 켜면 선택한 방에 연결, 끄면 연결 해제 (컬럼을 쓰지 않는 일반 저장에는 포함하지 않음)
      if (form.shareToRoom) payload.roomids = form.roomids.map(Number);
      else if (editingEvent?.roomids?.length) payload.roomids = [];

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
  const selectedTodos = selectedKey ? todoMap[selectedKey] || [] : [];
  const selectedHoliday = selectedKey ? holidays[selectedKey] : null;
  const selectedRoomTodos = selectedKey ? roomTodoMap[selectedKey] || [] : [];

  const hasSelectedContent =
    selectedHoliday ||
    selectedSchedules.length > 0 ||
    selectedPersonal.length > 0 ||
    selectedGoogle.length > 0 ||
    selectedTodos.length > 0 ||
    selectedRoomTodos.length > 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--bg-color)",
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
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          style={{
            width: "32px",
            border: "none",
            background: "none",
            padding: 0,
            fontSize: "24px",
            cursor: "pointer",
            color: "#555",
          }}
        >
          &larr;
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          <button
            onClick={prevMonth}
            style={{
              border: "none",
              background: "none",
              fontSize: "24px",
              cursor: "pointer",
              color: "var(--secondary-text)",
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
              color: "var(--secondary-text)",
            }}
          >
            ›
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            onClick={handleOpenSidePanel}
            style={{
              border: "none",
              background: "none",
              fontSize: "22px",
              cursor: "pointer",
              color: "var(--secondary-text)",
              lineHeight: 1,
            }}
          >
            ⋮
          </button>
        </div>
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
              color: i === 0 ? "#f44" : i === 6 ? "#7c79ff" : "var(--secondary-text)",
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
          const dayTodos = key ? todoMap[key] || [] : [];
          const isSun = col === 0;
          const isSat = col === 6;
          const isSelected = d != null && selectedDay === d;

          const textColor = isToday(d)
            ? "#fff"
            : holiday?.public || isSun
            ? "#f44"
            : isSat
            ? "#7c79ff"
            : "var(--text-color)";

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
                backgroundColor: isSelected
                  ? "color-mix(in srgb, var(--accent-color) 18%, var(--card-bg))"
                  : "transparent",
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

                  {/* 일정: 얇은 색 막대 (최대 3개) */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      width: "100%",
                      marginTop: "3px",
                    }}
                  >
                    {[
                      ...daySchedules.map((s2) => ({ id: `s${s2.id}`, color: "#7c79ff" })),
                      ...dayPersonal.map((e, pi) => ({ id: `p${e.id ?? pi}`, color: e.color || "#7c79ff" })),
                      ...dayGoogle.map((g) => ({ id: `g${g.id}`, color: "#4285F4" })),
                    ]
                      .slice(0, 3)
                      .map((bar) => (
                        <div
                          key={bar.id}
                          style={{
                            width: "100%",
                            height: "3px",
                            borderRadius: "2px",
                            backgroundColor: bar.color,
                          }}
                        />
                      ))}
                  </div>

                  {/* 할일: 점 (개인 할일은 채움, 방 공동 할 일은 테두리) */}
                  {(dayTodos.length > 0 || (roomTodoMap[key] || []).length > 0) && (
                    <div
                      style={{
                        display: "flex",
                        gap: "3px",
                        marginTop: "auto",
                        paddingBottom: "2px",
                        justifyContent: "center",
                      }}
                    >
                      {[
                        ...dayTodos.map((t) => ({ id: `t${t.id}`, room: false })),
                        ...(roomTodoMap[key] || []).map((t) => ({ id: `r${t.id}`, room: true })),
                      ]
                        .slice(0, 3)
                        .map((dot) => (
                          <div
                            key={dot.id}
                            style={{
                              width: "5px",
                              height: "5px",
                              boxSizing: "border-box",
                              borderRadius: "50%",
                              ...(dot.room
                                ? { border: `1.5px solid ${TODO_COLOR}` }
                                : { backgroundColor: TODO_COLOR }),
                            }}
                          />
                        ))}
                    </div>
                  )}
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
            backgroundColor: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              fontWeight: "bold",
              fontSize: "14px",
              color: "var(--text-color)",
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

          {selectedSchedules.map((s) => {
            const attendees = (s.memberCount || 0) - (s.absentees?.length || 0);
            return (
              <div
                key={s.id}
                onClick={() =>
                  navigate("/confirmed-schedule", {
                    state: { schedule: s },
                  })
                }
                style={{
                  margin: "4px 0 0",
                  padding: "8px 10px",
                  fontSize: "13px",
                  color: "#7c79ff",
                  backgroundColor: "color-mix(in srgb, var(--accent-color) 18%, var(--card-bg))",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: "600" }}>
                  📌 {s.title || s.date}{" "}
                  {s.starttime
                    ? `(${s.starttime.slice(0, 5)})${
                        s.endtime ? `~(${s.endtime.slice(0, 5)})` : ""
                      }`
                    : "(하루종일)"}
                </div>
                {[s.roomname, s.location, s.memberCount > 0 ? `${attendees}명 참여` : null]
                  .filter(Boolean).length > 0 && (
                  <div style={{ fontSize: "12px", color: "var(--secondary-text)", marginTop: "3px" }}>
                    {[s.roomname, s.location, s.memberCount > 0 ? `${attendees}명 참여` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </div>
            );
          })}

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

          {[...selectedTodos].sort((a, b) => {
            if (a.iscompleted !== b.iscompleted) return Number(a.iscompleted) - Number(b.iscompleted);
            if (a.iscompleted) return new Date(b.completedat || 0) - new Date(a.completedat || 0);
            return 0;
          }).map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                margin: "6px 0 0",
              }}
            >
              <button
                onClick={() => handleTodoToggle(t)}
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  border: `2px solid ${t.iscompleted ? TODO_COLOR : "#ddd"}`,
                  backgroundColor: t.iscompleted ? TODO_COLOR : "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                {t.iscompleted && <span style={{ color: "#fff", fontSize: "11px", lineHeight: 1 }}>✓</span>}
              </button>

              <span
                onClick={() => openEditTodo(t)}
                style={{
                  flex: 1,
                  fontSize: "13px",
                  color: t.iscompleted ? "#bbb" : "#333",
                  textDecoration: t.iscompleted ? "line-through" : "none",
                  cursor: "pointer",
                }}
              >
                {t.title}
                {t.duetime && !t.iscompleted && (
                  <span style={{ marginLeft: "5px", fontSize: "11px", color: "#aaa" }}>{t.duetime}</span>
                )}
                {t.reminder && t.reminder !== "none" && !t.iscompleted && (
                  <span style={{ marginLeft: "3px", fontSize: "11px", color: TODO_COLOR }}>🔔</span>
                )}
              </span>
            </div>
          ))}

          {selectedRoomTodos.map((t) => {
            const done = roomTodoDoneIds(t, selectedKey);
            const mineDone = done.includes(String(currentUser?.id));
            const needed = roomTodoNeeded(t);
            const complete = done.length >= needed;
            return (
              <div
                key={`room-${t.id}`}
                style={{ display: "flex", alignItems: "center", gap: "8px", margin: "6px 0 0" }}
              >
                <button
                  onClick={() => handleRoomTodoToggle(t, selectedKey)}
                  aria-label={mineDone ? "완료 취소" : "완료 체크"}
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    border: `2px solid ${TODO_COLOR}`,
                    backgroundColor: mineDone ? TODO_COLOR : "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  {mineDone && <span style={{ color: "#fff", fontSize: "11px", lineHeight: 1 }}>✓</span>}
                </button>
                <span
                  onClick={() => navigate(`/rooms/${t.roomid}?tab=calendar&date=${selectedKey}`)}
                  style={{
                    flex: 1,
                    fontSize: "13px",
                    color: complete ? "#bbb" : "#333",
                    textDecoration: complete ? "line-through" : "none",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ marginRight: "5px", fontSize: "11px", color: TODO_COLOR }}>
                    [{roomMeta[t.roomid]?.name || "방"}]
                  </span>
                  {t.title}
                  {t.duetime && !complete && (
                    <span style={{ marginLeft: "5px", fontSize: "11px", color: "#aaa" }}>{t.duetime.slice(0, 5)}</span>
                  )}
                  <span style={{ marginLeft: "5px", fontSize: "11px", color: "#aaa" }}>
                    {done.length}/{needed}명
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* FAB 메뉴 */}
      {showFabMenu && (
        <>
          <div
            onClick={() => setShowFabMenu(false)}
            style={{ position: "fixed", inset: 0, zIndex: 99 }}
          />
          {/* 일정 버튼 */}
          <div
            style={{
              position: "fixed",
              bottom: "210px",
              right: "20px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              zIndex: 101,
            }}
          >
            <span style={{ fontSize: "13px", color: "var(--text-color)", backgroundColor: "var(--card-bg)", padding: "3px 8px", borderRadius: "10px", boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }}>일정</span>
            <button
              onClick={() => {
                setShowFabMenu(false);
                openCreateForm(selectedDay ? dateKey(year, month, selectedDay) : "");
              }}
              style={{
                width: "46px",
                height: "46px",
                borderRadius: "50%",
                backgroundColor: "#7c79ff",
                color: "#fff",
                border: "none",
                fontSize: "22px",
                cursor: "pointer",
                boxShadow: "0 3px 10px rgba(124,121,255,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FaCalendarAlt color="#fff" size={18} />
            </button>
          </div>
          {/* 할일 버튼 */}
          <div
            style={{
              position: "fixed",
              bottom: "148px",
              right: "20px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              zIndex: 101,
            }}
          >
            <span style={{ fontSize: "13px", color: "var(--text-color)", backgroundColor: "var(--card-bg)", padding: "3px 8px", borderRadius: "10px", boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }}>할일</span>
            <button
              onClick={() => {
                setShowFabMenu(false);
                setTodoTitle("");
                setTodoDueDate(selectedDay
                  ? dateKey(year, month, selectedDay)
                  : `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
                setTodoDueTime("");
                setTodoNoDeadline(false);
                setTodoReminder("none");
                setShowTodoModal(true);
              }}
              style={{
                width: "46px",
                height: "46px",
                borderRadius: "50%",
                backgroundColor: TODO_COLOR,
                color: "#fff",
                border: "none",
                fontSize: "22px",
                cursor: "pointer",
                boxShadow: "0 3px 10px rgba(141,110,99,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✓
            </button>
          </div>
        </>
      )}

      {/* + / X FAB */}
      <button
        onClick={() => setShowFabMenu((v) => !v)}
        style={{
          position: "fixed",
          bottom: "80px",
          right: "20px",
          width: "52px",
          height: "52px",
          borderRadius: "50%",
          backgroundColor: showFabMenu ? "#555" : "#7c79ff",
          color: "#fff",
          border: "none",
          fontSize: showFabMenu ? "22px" : "28px",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          zIndex: 102,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background-color 0.2s",
        }}
      >
        {showFabMenu ? "✕" : "+"}
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
              backgroundColor: "var(--card-bg)",
              color: "var(--text-color)",
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
                      border: selected ? "2px solid #7c79ff" : "1px solid var(--border-color)",
                      backgroundColor: selected ? "color-mix(in srgb, var(--accent-color) 18%, var(--card-bg))" : "var(--card-bg)",
                      color: selected ? "#7c79ff" : "var(--text-color)",
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
                backgroundColor: "var(--btn-bg)",
                color: "var(--btn-text)",
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
              backgroundColor: "var(--bg-color)",
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
                  color: "var(--secondary-text)",
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
                color: "var(--text-color)",
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
                      borderBottom: "1px solid var(--border-color)",
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
                          backgroundColor: "color-mix(in srgb, var(--accent-color) 14%, var(--card-bg))",
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
                  color: "var(--secondary-text)",
                  marginBottom: "8px",
                }}
              >
                공개 중인 친구가 없습니다
              </p>
            )}

            {receivedCalendarShareRequests.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: "var(--secondary-text)",
                  }}
                >
                  받은 공개 요청
                </p>
                {receivedCalendarShareRequests.map((req) => (
                  <div
                    key={req.shareId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "7px 0",
                      borderBottom: "1px solid var(--border-color)",
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
                    <button
                      onClick={() => handleAcceptCalendarShareRequest(req)}
                      style={{
                        fontSize: "11px",
                        color: "#fff",
                        border: "none",
                        backgroundColor: "#7c79ff",
                        borderRadius: "6px",
                        padding: "3px 8px",
                        cursor: "pointer",
                      }}
                    >
                      수락
                    </button>
                    <button
                      onClick={() => handleRejectCalendarShareRequest(req)}
                      style={{
                        fontSize: "11px",
                        color: "var(--secondary-text)",
                        border: "1px solid var(--border-color)",
                        background: "none",
                        borderRadius: "6px",
                        padding: "3px 8px",
                        cursor: "pointer",
                      }}
                    >
                      거절
                    </button>
                  </div>
                ))}
              </div>
            )}

            {sentCalendarShareRequests.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: "var(--secondary-text)",
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
                      borderBottom: "1px solid var(--border-color)",
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
                    <span style={{ fontSize: "11px", color: "var(--secondary-text)" }}>대기 중</span>
                    <button
                      onClick={() => handleCancelCalendarShareRequest(req)}
                      style={{
                        fontSize: "11px",
                        color: "var(--secondary-text)",
                        border: "1px solid var(--border-color)",
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

            <GoogleCalendarControl
              panel
              onChange={() => setGoogleVersion((v) => v + 1)}
              onAutoSyncEnabled={handleGoogleAutoSyncEnabled}
              autoSyncLabel="확정 일정 자동 추가"
              connectedHint="내 구글 캘린더 일정이 캘린더에 표시돼요."
            />
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
              backgroundColor: "var(--bg-color)",
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
                  color: "var(--secondary-text)",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {friendListForShare.length === 0 ? (
                <p
                  style={{
                    color: "var(--secondary-text)",
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
                      borderBottom: "1px solid var(--border-color)",
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

      {/* 할일 모달 */}
      {showTodoModal && (
        <>
          <div
            onClick={() => setShowTodoModal(false)}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 200 }}
          />
          <div
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: "var(--card-bg)",
              color: "var(--text-color)",
              borderRadius: "20px 20px 0 0",
              padding: "24px 20px 88px",
              zIndex: 201,
              boxShadow: "0 -4px 20px rgba(0,0,0,0.12)",
            }}
          >
            {/* 헤더 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>할일 추가</span>
              <button
                onClick={() => setShowTodoModal(false)}
                style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", color: "#aaa" }}
              >✕</button>
            </div>

            {/* 할일 제목 */}
            <input
              type="text"
              placeholder="할일 내용을 입력하세요"
              value={todoTitle}
              onChange={(e) => setTodoTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTodoCreate()}
              autoFocus
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "15px",
                border: "1px solid var(--border-color)",
                borderRadius: "10px",
                boxSizing: "border-box",
                marginBottom: "12px",
                outline: "none",
              }}
            />

            {/* 마감일/시간 */}
            <div style={{ marginBottom: "10px" }}>
              <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--secondary-text)", display: "block", marginBottom: "8px" }}>마감</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="date"
                  value={todoDueDate}
                  onChange={(e) => setTodoDueDate(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "9px 10px",
                    fontSize: "14px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    outline: "none",
                  }}
                />
                <input
                  type="time"
                  value={todoDueTime}
                  onChange={(e) => setTodoDueTime(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "9px 10px",
                    fontSize: "14px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    outline: "none",
                  }}
                />
              </div>
            </div>

            {/* 알림 */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--secondary-text)", whiteSpace: "nowrap" }}>알림</span>
              <select className="select-inset"
                value={todoReminder}
                onChange={(e) => setTodoReminder(e.target.value)}
                style={{
                  flex: 1,
                  padding: "9px 10px",
                  fontSize: "14px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  outline: "none",
                  backgroundColor: "var(--input-bg)",
                  color: "var(--text-color)",
                }}
              >
                <option value="none">알림 없음</option>
                <option value="0">마감 정시</option>
                <option value="10">10분 전</option>
                <option value="60">1시간 전</option>
                <option value="1440">1일 전</option>
                <option value="custom">직접 설정</option>
              </select>
            </div>

            {todoReminder === "custom" && (
              <div style={{ display: "flex", gap: "8px", margin: "-8px 0 16px" }}>
                <input
                  type="number"
                  min="1"
                  aria-label="알림 시간"
                  value={todoCustomValue}
                  onChange={(e) => setTodoCustomValue(e.target.value)}
                  style={{ flex: 1, minWidth: 0, padding: "9px 10px", fontSize: "14px", border: "1px solid var(--border-color)", borderRadius: "8px", outline: "none", backgroundColor: "var(--input-bg)", color: "var(--text-color)" }}
                />
                <select
                  className="select-inset"
                  aria-label="알림 단위"
                  value={todoCustomUnit}
                  onChange={(e) => setTodoCustomUnit(e.target.value)}
                  style={{ flex: 1, minWidth: 0, padding: "9px 10px", fontSize: "14px", border: "1px solid var(--border-color)", borderRadius: "8px", outline: "none", backgroundColor: "var(--input-bg)", color: "var(--text-color)" }}
                >
                  <option value="min">분 전</option>
                  <option value="hour">시간 전</option>
                  <option value="day">일 전</option>
                </select>
              </div>
            )}

            {/* 추가 버튼 */}
            <button
              onClick={handleTodoCreate}
              disabled={!todoTitle.trim()}
              style={{
                width: "100%",
                padding: "13px",
                backgroundColor: todoTitle.trim() ? TODO_COLOR : "#eee",
                color: todoTitle.trim() ? "#fff" : "#aaa",
                border: "none",
                borderRadius: "10px",
                fontSize: "15px",
                fontWeight: "bold",
                cursor: todoTitle.trim() ? "pointer" : "default",
              }}
            >
              추가
            </button>

          </div>
        </>
      )}

      {/* 할일 수정 모달 */}
      {editingTodo && (
        <>
          <div
            onClick={() => setEditingTodo(null)}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 300 }}
          />
          <div
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: "var(--card-bg)",
              color: "var(--text-color)",
              borderRadius: "20px 20px 0 0",
              padding: "24px 20px 88px",
              zIndex: 301,
              boxShadow: "0 -4px 20px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>할일 수정</span>
              <button onClick={() => setEditingTodo(null)} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", color: "#aaa" }}>✕</button>
            </div>

            <input
              type="text"
              value={editTodoTitle}
              onChange={(e) => setEditTodoTitle(e.target.value)}
              autoFocus
              style={{ width: "100%", padding: "12px", fontSize: "15px", border: "1px solid var(--border-color)", borderRadius: "10px", boxSizing: "border-box", marginBottom: "12px", outline: "none", backgroundColor: "var(--input-bg)", color: "var(--text-color)" }}
            />

            <div style={{ marginBottom: "10px" }}>
              <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--secondary-text)", display: "block", marginBottom: "8px" }}>마감</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <input type="date" value={editTodoDueDate} onChange={(e) => setEditTodoDueDate(e.target.value)} style={{ flex: 1, padding: "9px 10px", fontSize: "14px", border: "1px solid var(--border-color)", borderRadius: "8px", outline: "none", backgroundColor: "var(--input-bg)", color: "var(--text-color)" }} />
                <input type="time" value={editTodoDueTime} onChange={(e) => setEditTodoDueTime(e.target.value)} style={{ flex: 1, padding: "9px 10px", fontSize: "14px", border: "1px solid var(--border-color)", borderRadius: "8px", outline: "none", backgroundColor: "var(--input-bg)", color: "var(--text-color)" }} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--secondary-text)", whiteSpace: "nowrap" }}>알림</span>
              <select className="select-inset" value={editTodoReminder} onChange={(e) => setEditTodoReminder(e.target.value)} style={{ flex: 1, padding: "9px 10px", fontSize: "14px", border: "1px solid var(--border-color)", borderRadius: "8px", outline: "none", backgroundColor: "var(--input-bg)", color: "var(--text-color)" }}>
                <option value="none">알림 없음</option>
                <option value="0">마감 정시</option>
                <option value="10">10분 전</option>
                <option value="60">1시간 전</option>
                <option value="1440">1일 전</option>
                <option value="custom">직접 설정</option>
              </select>
            </div>

            {editTodoReminder === "custom" && (
              <div style={{ display: "flex", gap: "8px", margin: "-8px 0 16px" }}>
                <input
                  type="number"
                  min="1"
                  aria-label="알림 시간"
                  value={editTodoCustomValue}
                  onChange={(e) => setEditTodoCustomValue(e.target.value)}
                  style={{ flex: 1, minWidth: 0, padding: "9px 10px", fontSize: "14px", border: "1px solid var(--border-color)", borderRadius: "8px", outline: "none", backgroundColor: "var(--input-bg)", color: "var(--text-color)" }}
                />
                <select
                  className="select-inset"
                  aria-label="알림 단위"
                  value={editTodoCustomUnit}
                  onChange={(e) => setEditTodoCustomUnit(e.target.value)}
                  style={{ flex: 1, minWidth: 0, padding: "9px 10px", fontSize: "14px", border: "1px solid var(--border-color)", borderRadius: "8px", outline: "none", backgroundColor: "var(--input-bg)", color: "var(--text-color)" }}
                >
                  <option value="min">분 전</option>
                  <option value="hour">시간 전</option>
                  <option value="day">일 전</option>
                </select>
              </div>
            )}

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => handleTodoDelete(editingTodo.id)}
                style={{ flex: 1, padding: "13px", backgroundColor: "var(--card-bg)", color: "#f44", border: "1px solid #f44", borderRadius: "10px", fontSize: "15px", cursor: "pointer" }}
              >삭제</button>
              <button
                onClick={handleTodoUpdate}
                disabled={!editTodoTitle.trim()}
                style={{ flex: 2, padding: "13px", backgroundColor: editTodoTitle.trim() ? TODO_COLOR : "#eee", color: editTodoTitle.trim() ? "#fff" : "#aaa", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: "bold", cursor: editTodoTitle.trim() ? "pointer" : "default" }}
              >저장</button>
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
              backgroundColor: "var(--bg-color)",
              borderRadius: "20px 20px 0 0",
              width: "100%",
              maxHeight: "calc(100vh - 0px)",
              overflowY: "auto",
              padding: "24px 20px 80px",
              boxSizing: "border-box",
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
                  color: "var(--secondary-text)",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            {/* 제목 */}
            <label
              htmlFor="home-event-title"
              style={{
                display: "block",
                margin: "0 0 8px",
                fontSize: "12px",
                fontWeight: 800,
                color: "var(--secondary-text)",
              }}
            >
              제목
            </label>
            <input
              id="home-event-title"
              placeholder="일정 제목"
              maxLength={120}
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  title: e.target.value,
                }))
              }
              style={{
                width: "100%",
                padding: "11px 12px",
                fontSize: "13px",
                border: "1px solid var(--border-color)",
                borderRadius: "11px",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: "16px",
                backgroundColor: "var(--card-bg)",
                color: "var(--text-color)",
              }}
            />

            {/* 공용 캘린더 공개 (방 폼과 같은 디자인) */}
            <div style={{ marginBottom: "16px" }}>
              <div className="room-form-share" style={{ margin: 0, color: "var(--text-color)" }}>
                <span>공용 캘린더 공개</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.shareToRoom}
                  aria-label="공용 캘린더 공개"
                  disabled={myRooms.length === 0}
                  className={`room-tool-switch ${form.shareToRoom ? "on" : ""}`}
                  style={myRooms.length === 0 ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      shareToRoom: !f.shareToRoom,
                      roomids: !f.shareToRoom ? (f.roomids.length ? f.roomids : [String(myRooms[0].id)]) : f.roomids,
                    }))
                  }
                >
                  <i />
                </button>
              </div>

              {myRooms.length === 0 && (
                <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--secondary-text)" }}>
                  참여 중인 방이 없어서 공유할 수 없어요.
                </p>
              )}

              {form.shareToRoom && myRooms.length > 0 && (
                <>
                  {myRooms.length > 1 && (
                    <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      {myRooms.map((r) => {
                        const checked = form.roomids.includes(String(r.id));
                        return (
                          <label
                            key={r.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "14px",
                              color: "var(--text-color)",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setForm((f) => ({
                                  ...f,
                                  roomids: checked
                                    ? f.roomids.filter((id) => id !== String(r.id))
                                    : [...f.roomids, String(r.id)],
                                }))
                              }
                            />
                            {r.name}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--secondary-text)" }}>
                    {myRooms.length === 1 ? `${myRooms[0].name} 방의 ` : "선택한 방들의 "}
                    팀원에게 보이고, 알림과 반복이 팀원 모두에게 적용돼요.
                  </p>
                </>
              )}
            </div>

            {/* 색상 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "13px", color: "var(--secondary-text)" }}>
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
                          ? "3px solid var(--text-color)"
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
                  backgroundColor: form.isallday ? "#7c79ff" : "var(--btn-bg)",
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
                    backgroundColor: "var(--toggle-thumb-bg, var(--text-color))",
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
                    color: "var(--secondary-text)",
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
                    border: "1px solid var(--border-color)",
                    borderRadius: "10px",
                    fontSize: "15px",
                    boxSizing: "border-box",
                    backgroundColor: "var(--bg-color)",
                    color: "var(--text-color)",
                  }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: "13px",
                    color: "var(--secondary-text)",
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
                    border: "1px solid var(--border-color)",
                    borderRadius: "10px",
                    fontSize: "15px",
                    boxSizing: "border-box",
                    backgroundColor: "var(--bg-color)",
                    color: "var(--text-color)",
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
                      color: "var(--secondary-text)",
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
                      border: "1px solid var(--border-color)",
                      borderRadius: "10px",
                      fontSize: "15px",
                      boxSizing: "border-box",
                      backgroundColor: "var(--bg-color)",
                      color: "var(--text-color)",
                    }}
                  />
                </div>

                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: "13px",
                      color: "var(--secondary-text)",
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
                      border: "1px solid var(--border-color)",
                      borderRadius: "10px",
                      fontSize: "15px",
                      boxSizing: "border-box",
                      backgroundColor: "var(--bg-color)",
                      color: "var(--text-color)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* 장소 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "var(--secondary-text)" }}>
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
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  fontSize: "15px",
                  boxSizing: "border-box",
                  backgroundColor: "var(--bg-color)",
                  color: "var(--text-color)",
                }}
              />

              <LocationPicker
                onSelect={(name, address) =>
                  setForm((f) => ({
                    ...f,
                    location: name || address,
                  }))
                }
              />
            </div>

            {/* 알림 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "var(--secondary-text)" }}>
                알림
              </p>

              <select className="select-inset"
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
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  fontSize: "15px",
                  backgroundColor: "var(--bg-color)",
                  color: "var(--text-color)",
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
                      border: "1px solid var(--border-color)",
                      borderRadius: "10px",
                      fontSize: "15px",
                      backgroundColor: "var(--bg-color)",
                      color: "var(--text-color)",
                    }}
                  />

                  <select className="select-inset"
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
                      border: "1px solid var(--border-color)",
                      borderRadius: "10px",
                      fontSize: "15px",
                      backgroundColor: "var(--bg-color)",
                      color: "var(--text-color)",
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
                <span style={{ fontSize: "14px", color: "var(--text-color)" }}>
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
                    backgroundColor: skipEnabled ? "#7c79ff" : "var(--btn-bg)",
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
                      backgroundColor: "var(--toggle-thumb-bg, var(--text-color))",
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
                    backgroundColor: "var(--card-bg)",
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
                      <span style={{ fontSize: "14px", color: "var(--secondary-text)" }}>
                        {label}
                      </span>

                      <div
                        onClick={() => toggleSkip(key, value, setter)}
                        style={{
                          width: "44px",
                          height: "24px",
                          borderRadius: "12px",
                          cursor: "pointer",
                          backgroundColor: value ? "#7c79ff" : "var(--btn-bg)",
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
                            backgroundColor: "var(--toggle-thumb-bg, var(--text-color))",
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
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "var(--secondary-text)" }}>
                반복
              </p>

              <select className="select-inset"
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
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  fontSize: "15px",
                  backgroundColor: "var(--bg-color)",
                  color: "var(--text-color)",
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
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "var(--secondary-text)" }}>
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
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  fontSize: "15px",
                  boxSizing: "border-box",
                  resize: "none",
                  backgroundColor: "var(--bg-color)",
                  color: "var(--text-color)",
                }}
              />
            </div>

            {/* 저장/삭제 (공용 캘린더 폼과 같은 버튼) */}
            <div className="room-form-actions">
              {editingEvent && (
                <button
                  type="button"
                  className="calendar-collection-button"
                  onClick={() => handleDelete(editingEvent.id)}
                >
                  삭제
                </button>
              )}

              <button
                type="button"
                className="diary-publish-button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarPage;
