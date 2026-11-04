import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiImage, FiMapPin } from "react-icons/fi";
import { createLightningMeeting, getCalendarDiaryThumbnails, getMeetingDiaryProgress, getRoomDiaries, getRoomDiaryIdentity, getRoomMeetings } from "../../api/meetupDiaryApi";
import { createPersonalEvent, deletePersonalEvent, getRoomSharedEvents, updatePersonalEvent } from "../../api/personalEventApi";
import { supabase } from "../../lib/supabaseClient";
import { fetchHolidays } from "../calendar/CalendarPage";
import { getEventDayKeys } from "../../lib/eventRepeat";
import { createRoomTodo, deleteRoomTodo, getRoomTodoCompletions, getRoomTodos, setRoomTodoDone, updateRoomTodo } from "../../api/roomTodoApi";
import LocationPicker from "../../components/map/LocationPicker";
import RoomDriveBackupControl from "./RoomDriveBackupControl";
import RoomGoogleCalendarControl from "../../components/GoogleCalendarControl";
import { fetchGoogleCalendarEvents } from "../calendar/CalendarPage";
import { addEventToGoogleCalendar } from "../../api/googleCalendarApi";
import "./RoomCalendar.css";
import { isMeetingVisibleInSharedCalendar } from "../../utils/meetingCalendarVisibility";
import { getMeetingMembers } from "../../utils/meetingParticipants";

// 색은 일정이 아니라 사람에게 붙인다. 방 약속(#7c79ff)·개인 일정(회색)과 겹치지 않는 팀원 전용 팔레트
const MEMBER_COLORS = ["#f44336", "#ff9800", "#43a047", "#1e88e5", "#e91e63", "#8e24aa", "#00acc1", "#8d6e63"];
const DEFAULT_CUSTOM_REMINDER = { customReminderValue: "30", customReminderUnit: "min" };
const TODO_COLOR = "#1ABC9C";
const EMPTY_TODO_FORM = { title: "", date: "", duetime: "", repeat: "none", reminder: "none", ...DEFAULT_CUSTOM_REMINDER, requiredMode: "all", requiredCount: 1, assignees: [], memo: "" };
const EMPTY_EVENT_FORM = { shared: true, title: "", isallday: false, startdate: "", enddate: "", starttime: "", endtime: "", location: "", memo: "", reminder: "none", ...DEFAULT_CUSTOM_REMINDER, repeat: "none" };
const REMINDER_OPTIONS = [["none", "알림 없음"], ["0", "일정 시작 전"], ["10", "10분 전"], ["60", "1시간 전"], ["1440", "1일 전"], ["custom", "직접 설정"]];
const REMINDER_PRESETS = ["none", "0", "10", "60", "1440"];
const REMINDER_UNIT_MINUTES = { min: 1, hour: 60, day: 1440 };
// 저장된 분 단위 값을 폼 상태로 (프리셋이 아니면 "직접 설정" + 가장 큰 딱 맞는 단위)
const parseReminder = (saved) => {
  const value = String(saved ?? "none");
  if (REMINDER_PRESETS.includes(value)) return { reminder: value, ...DEFAULT_CUSTOM_REMINDER };
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return { reminder: "none", ...DEFAULT_CUSTOM_REMINDER };
  const unit = minutes % 1440 === 0 ? "day" : minutes % 60 === 0 ? "hour" : "min";
  return { reminder: "custom", customReminderValue: String(minutes / REMINDER_UNIT_MINUTES[unit]), customReminderUnit: unit };
};
const isReminderInvalid = (form) => form.reminder === "custom" && !(Number(form.customReminderValue) > 0);
const buildReminder = (form) => (form.reminder === "custom" ? String(Math.round(Number(form.customReminderValue) * REMINDER_UNIT_MINUTES[form.customReminderUnit])) : form.reminder);
const REPEAT_OPTIONS = [["none", "반복 없음"], ["daily", "매일"], ["weekly", "매주"], ["monthly", "매월"], ["yearly", "매년"]];
// 이 방에서 만든 일정만 반복을 펼쳐서 보여준다 (개인 일정의 반복은 방에 적용하지 않음)
const eventDays = (event, roomId, firstKey, lastKey) => getEventDayKeys((event.roomids || []).map(Number).includes(Number(roomId)) ? event : { ...event, roomids: [], roomid: null }, firstKey, lastKey);

const WEEKDAYS = ["\uC77C", "\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0"];
const pad = (value) => String(value).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const getTodayInSeoul = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

function RoomCalendarTab({ roomId, participants = [], settingsOpen = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [month, setMonth] = useState(() => {
    const requestedDate = new URLSearchParams(window.location.search).get("date");
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return new Date(`${requestedDate}T12:00:00`);
    try { const saved = JSON.parse(sessionStorage.getItem(`room-calendar-state:${roomId}`) || "null"); if (saved?.month) return new Date(`${saved.month}T12:00:00`); } catch {}
    const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [openMonthPicker, setOpenMonthPicker] = useState(null);
  const activeYearOptionRef = useRef(null);
  const [identity, setIdentity] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [allMeetings, setAllMeetings] = useState([]);
  const [diaries, setDiaries] = useState([]);
  const [diariesLoaded, setDiariesLoaded] = useState(false);
  const [diaryCovers, setDiaryCovers] = useState({});
  const [selectedDate, setSelectedDate] = useState(() => {
    const requestedDate = new URLSearchParams(window.location.search).get("date");
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return requestedDate;
    try { return JSON.parse(sessionStorage.getItem(`room-calendar-state:${roomId}`) || "null")?.selectedDate || ""; } catch { return ""; }
  });
  const [selectedMeetingIndex, setSelectedMeetingIndex] = useState(() => { try { return JSON.parse(sessionStorage.getItem(`room-calendar-state:${roomId}`) || "null")?.selectedMeetingIndex || 0; } catch { return 0; } });
  const [meetingProgressById, setMeetingProgressById] = useState({});
  const [showLightning, setShowLightning] = useState(false);
  const [showDiarySavedToast, setShowDiarySavedToast] = useState(false);
  const [lightningTitle, setLightningTitle] = useState("");
  const [lightningTitleError, setLightningTitleError] = useState(false);
  const [lightningParticipantIds, setLightningParticipantIds] = useState([]);
  const [authUserId, setAuthUserId] = useState(null);
  const [lightningLocation, setLightningLocation] = useState("");
  const [lightningLocationAddress, setLightningLocationAddress] = useState("");
  const [lightningSelectedPlace, setLightningSelectedPlace] = useState(null);
  const [showLightningPlacePicker, setShowLightningPlacePicker] = useState(false);
  const [lightningStart, setLightningStart] = useState("");
  const [lightningEnd, setLightningEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingLightning, setSavingLightning] = useState(false);
  const lightningRequestIdRef = useRef(null);
  const sheetDragRef = useRef({ startY: null, offset: 0, pointerId: null });
  const suppressSheetClickRef = useRef(false);
  const sheetDismissTimerRef = useRef(null);
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [isSheetDragging, setIsSheetDragging] = useState(false);
  const [isSheetDismissing, setIsSheetDismissing] = useState(false);
  const [error, setError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [today, setToday] = useState(getTodayInSeoul);
  const firstDay = dateKey(month);
  const lastDay = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const [view, setView] = useState(() => { try { return JSON.parse(sessionStorage.getItem(`room-calendar-state:${roomId}`) || "null")?.view === "shared" ? "shared" : "diary"; } catch { return "diary"; } });
  const [sharedEvents, setSharedEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [googleVersion, setGoogleVersion] = useState(0);
  const [holidays, setHolidays] = useState({});
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [eventForm, setEventForm] = useState(EMPTY_EVENT_FORM);
  const [savingEvent, setSavingEvent] = useState(false);
  const [eventError, setEventError] = useState("");

  const loadSharedEvents = useCallback(async () => {
    if (!authUserId) { setSharedEvents([]); return; }
    try { setSharedEvents(await getRoomSharedEvents(roomId, authUserId, firstDay, lastDay)); }
    catch (loadError) { setError(loadError.message || "공용 캘린더를 불러오지 못했습니다."); }
  }, [authUserId, firstDay, lastDay, roomId]);
  useEffect(() => { loadSharedEvents(); }, [loadSharedEvents]);
  useEffect(() => {
    let active = true;
    fetchGoogleCalendarEvents(month.getFullYear(), month.getMonth()).then((events) => { if (active) setGoogleEvents(events); });
    return () => { active = false; };
  }, [month, googleVersion]);
  useEffect(() => { fetchHolidays(month.getFullYear(), month.getMonth()).then(setHolidays); }, [month]);

  useEffect(() => {
    if (openMonthPicker === "year") activeYearOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [openMonthPicker]);

  const load = useCallback(async ({ initialize = false } = {}) => {
    setLoading(true);
    setDiariesLoaded(false);
    setError("");
    try {
      let currentIdentity = identity;
      if (initialize || !currentIdentity) {
        const auth = await getRoomDiaryIdentity(roomId);
        currentIdentity = auth.identityId;
        setIdentity(currentIdentity);
        setAuthUserId(auth.user?.id || null);
        if (!auth.user) {
          setAuthMessage("\uBC29 \uACF5\uD1B5 \uCE98\uB9B0\uB354\uC640 \uAE30\uB85D\uC740 \uD68C\uC6D0 \uC778\uC99D\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uAE30\uC874 \uAC8C\uC2A4\uD2B8 \uACC4\uC815\uC758 guest_id\uB294 \uAE30\uB85D \uAD8C\uD55C \uD655\uC778\uC5D0 \uC0AC\uC6A9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
          setMeetings([]); setAllMeetings([]);
          setDiaries([]);
          return;
        }
        if (!currentIdentity) {
          setAuthMessage("\uD604\uC7AC \uACC4\uC815\uC740 \uC774 \uBC29\uC758 \uD65C\uC131 \uD68C\uC6D0\uC774 \uC544\uB2D9\uB2C8\uB2E4.");
          setMeetings([]); setAllMeetings([]);
          setDiaries([]);
          return;
        }
        setAuthMessage("");
      }
      const [monthMeetings, roomMeetings] = await Promise.all([
        getRoomMeetings(roomId, firstDay, lastDay),
        getRoomMeetings(roomId),
      ]);
      const visibleMonthMeetings = monthMeetings.filter((meeting) => meeting.source_type !== "lightning" || meeting.lifecycle_status !== "cancelled");
      const visibleRoomMeetings = roomMeetings.filter((meeting) => meeting.source_type !== "lightning" || meeting.lifecycle_status !== "cancelled");
      const monthDiaries = await getRoomDiaries(roomId, roomMeetings.map((meeting) => meeting.id));
      const monthMeetingIds = new Set(visibleMonthMeetings.map((meeting) => meeting.id));
      const visibleRoomDiaryIds = monthDiaries
        .filter((diary) => monthMeetingIds.has(diary.meeting_id) && diary.status === "published" && diary.visibility === "room")
        .map((diary) => diary.id);
      const thumbnails = await getCalendarDiaryThumbnails(visibleRoomDiaryIds);
      setMeetings(visibleMonthMeetings);
      setAllMeetings(visibleRoomMeetings);
      setDiaries(monthDiaries);
      setDiaryCovers(thumbnails);
      setDiariesLoaded(true);
    } catch (loadError) {
      setError(loadError.message || "캘린더를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [firstDay, identity, lastDay, roomId]);

  useEffect(() => () => window.clearTimeout(sheetDismissTimerRef.current), []);
  useEffect(() => { load({ initialize: true }); }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (identity) load(); }, [firstDay, identity, lastDay, load]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedDate = params.get("date");
    const requestedMeetingId = params.get("meetingId");
    if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return;
    setMonth(new Date(`${requestedDate}T12:00:00`));
    setSelectedDate(requestedDate);
    if (requestedMeetingId) {
      const sameDateMeetings = meetings.filter((meeting) => meeting.meeting_date === requestedDate);
      const index = sameDateMeetings.findIndex((meeting) => meeting.id === requestedMeetingId);
      if (index >= 0) setSelectedMeetingIndex(index);
    }
  }, [location.search, meetings]);
  useEffect(() => {
    const nextMidnight = new Date(`${today}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000;
    const midnightTimer = window.setTimeout(() => setToday(getTodayInSeoul()), Math.max(0, nextMidnight - Date.now()));
    const refresh = () => {
      setToday(getTodayInSeoul());
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearTimeout(midnightTimer); window.removeEventListener("pageshow", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load, today]);

  const meetingGroups = useMemo(() => meetings.reduce((groups, meeting) => {
    groups[meeting.meeting_date] = [...(groups[meeting.meeting_date] || []), meeting];
    return groups;
  }, {}), [meetings]);
  const firstPublicDiaryByDate = useMemo(() => {
    return diaries.reduce((records, diary) => {
      if (diary.status !== "published" || diary.visibility !== "room") return records;
      const meeting = meetingForDiary(diary, meetings);
      if (meeting && !records[meeting.meeting_date]) records[meeting.meeting_date] = diary;
      return records;
    }, {});
  }, [diaries, meetings]);
  const diaryCoversByDate = useMemo(() => Object.entries(firstPublicDiaryByDate).reduce((covers, [date, diary]) => {
    if (diaryCovers[diary.id]) covers[date] = diaryCovers[diary.id];
    return covers;
  }, {}), [diaryCovers, firstPublicDiaryByDate]);
  const diaryCountsByDate = useMemo(() => diaries.reduce((counts, diary) => {
    const date = meetingForDiary(diary, meetings)?.meeting_date;
    if (date) counts[date] = (counts[date] || 0) + 1;
    return counts;
  }, {}), [diaries, meetings]);
  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = first.getDay();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const weekCount = Math.ceil((offset + daysInMonth) / 7);
    return Array.from({ length: weekCount * 7 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index - offset + 1));
  }, [month]);
  const selectedMeetings = meetingGroups[selectedDate] || [];
  const selectedSharedMeetings = selectedMeetings.filter(isMeetingVisibleInSharedCalendar);
  const selectedDateHasLightning = selectedMeetings.some((meeting) => meeting.source_type === "lightning" && meeting.lifecycle_status !== "cancelled");
  const activeMeetingIndex = selectedMeetings.length ? selectedMeetingIndex % selectedMeetings.length : 0;
  const activeMeeting = selectedMeetings[activeMeetingIndex];
  const activeMeetingParticipants = getMeetingMembers(activeMeeting, participants);
  const activeMeetingProgress = activeMeeting ? meetingProgressById[activeMeeting.id] : null;
  const activeRecord = activeMeeting ? diaries.find((diary) => diary.meeting_id === activeMeeting.id && diary.author_identity_id === identity) : null;
  const isActiveRecordPublished = Boolean(diariesLoaded && activeRecord?.status === "published");
  const activePublishedMemberIds = new Set(activeMeetingProgress?.published_member_ids || []);
  const activeMeetingOrdinal = activeMeeting ? allMeetings.findIndex((meeting) => meeting.id === activeMeeting.id) + 1 : 0;
  const activeMeetingDiaryCount = activeMeetingProgress?.published_count;
  const selectedMeetingIdsKey = selectedMeetings.map((meeting) => meeting.id).join(",");
  const selectedDateLabel = selectedDate
    ? new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${selectedDate}T12:00:00`))
    : "";
  const canCreateLightning = Boolean(selectedDate && selectedDate <= today);
  const showEmptyDayPrompt = selectedMeetings.length === 0 && canCreateLightning;

  const [hiddenUserIds, setHiddenUserIds] = useState([]);
  const [customColors, setCustomColors] = useState({});
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorError, setColorError] = useState("");
  const loadCustomColors = useCallback(async () => {
    // calendarcolor 컬럼이 아직 없으면 조용히 자동 배정 색을 쓴다
    const { data, error: colorLoadError } = await supabase.from("room_members").select("userid, calendarcolor").eq("roomid", Number(roomId));
    if (colorLoadError) return;
    setCustomColors(Object.fromEntries((data || []).filter((row) => row.calendarcolor).map((row) => [String(row.userid), row.calendarcolor])));
  }, [roomId]);
  useEffect(() => { loadCustomColors(); }, [loadCustomColors]);
  // 직접 고른 색을 우선하고, 안 고른 팀원은 남은 색을 userid 순서로 자동 배정해 모든 화면에서 같게 보이게 한다
  const memberColorById = useMemo(() => {
    const ids = [...new Set([...participants.map((p) => String(p.userid || "")), authUserId ? String(authUserId) : ""].filter(Boolean))].sort();
    const result = {};
    const taken = new Set();
    ids.forEach((id) => { if (customColors[id]) { result[id] = customColors[id]; taken.add(customColors[id]); } });
    const free = MEMBER_COLORS.filter((color) => !taken.has(color));
    let next = 0;
    ids.forEach((id) => { if (!result[id]) { result[id] = free.length ? free[next % free.length] : MEMBER_COLORS[next % MEMBER_COLORS.length]; next += 1; } });
    return result;
  }, [authUserId, customColors, participants]);
  async function chooseMyColor(color) {
    setColorError("");
    const { error: updateError } = await supabase.from("room_members").update({ calendarcolor: color }).eq("roomid", Number(roomId)).eq("userid", authUserId);
    if (updateError) { setColorError(updateError.code === "23505" ? "방금 다른 팀원이 쓰기 시작한 색이에요. 다른 색을 골라 주세요." : "색상을 저장하지 못했어요."); await loadCustomColors(); return; }
    // 홈 캘린더에서도 같은 색으로 보이도록 이 방에서 만든 내 일정 색을 함께 맞춘다
    await supabase.from("personal_events").update({ color }).contains("roomids", [Number(roomId)]).eq("userid", authUserId);
    await loadCustomColors();
    await loadSharedEvents();
  }
  const eventColor = (item) => memberColorById[String(item.userid)] || MEMBER_COLORS[0];
  const eventsByDate = useMemo(() => sharedEvents.filter((event) => !hiddenUserIds.includes(String(event.userid))).reduce((groups, event) => {
    eventDays(event, roomId, firstDay, lastDay).forEach((day) => { (groups[day] ||= []).push(event); });
    return groups;
  }, {}), [firstDay, lastDay, hiddenUserIds, roomId, sharedEvents]);
  const selectedEvents = eventsByDate[selectedDate] || [];
  const googleByDate = useMemo(() => googleEvents.reduce((groups, event) => { (groups[event.date] ||= []).push(event); return groups; }, {}), [googleEvents]);
  const selectedGoogleEvents = googleByDate[selectedDate] || [];
  const selectedHoliday = holidays[selectedDate];
  const nicknameByUserId = useMemo(() => Object.fromEntries(participants.map((p) => [String(p.userid), p.nickname])), [participants]);
  const monthEventCount = sharedEvents.filter((event) => eventDays(event, roomId, firstDay, lastDay).length > 0).length;

  // ----- 공동 할 일 -----
  const [roomTodos, setRoomTodos] = useState([]);
  const [todoCompletions, setTodoCompletions] = useState([]);
  const [showTodoForm, setShowTodoForm] = useState(false);
  const [editingTodo, setEditingTodo] = useState(null);
  const [todoForm, setTodoForm] = useState(EMPTY_TODO_FORM);
  const [savingTodo, setSavingTodo] = useState(false);
  const [todoError, setTodoError] = useState("");
  const memberCount = Math.max(participants.length, 1);
  const loadTodos = useCallback(async () => {
    if (!authUserId) { setRoomTodos([]); setTodoCompletions([]); return; }
    try {
      const todos = await getRoomTodos(roomId, lastDay);
      setRoomTodos(todos);
      setTodoCompletions(await getRoomTodoCompletions(todos.map((todo) => todo.id), firstDay, lastDay));
    } catch (loadError) { setError(loadError.message || "공동 할 일을 불러오지 못했습니다."); }
  }, [authUserId, firstDay, lastDay, roomId]);
  useEffect(() => { loadTodos(); }, [loadTodos]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") loadTodos(); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [loadTodos]);
  useEffect(() => {
    if (!authUserId) return undefined;
    let timer = null;
    // 팀원이 완료 체크하거나 할 일을 바꾸면 바로 다시 불러온다 (연속 이벤트는 묶어서 한 번만)
    const scheduleReload = () => { window.clearTimeout(timer); timer = window.setTimeout(loadTodos, 150); };
    const channel = supabase
      .channel(`room-todos-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_todos", filter: `roomid=eq.${roomId}` }, scheduleReload)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_todo_completions", filter: `roomid=eq.${roomId}` }, scheduleReload)
      // Realtime 은 DELETE 에 필터를 못 걸어서, old 레코드의 roomid 로 직접 걸러낸다
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "room_todo_completions" }, (payload) => {
        if (payload.old?.roomid == null || String(payload.old.roomid) === String(roomId)) scheduleReload();
      })
      .subscribe();
    return () => { window.clearTimeout(timer); supabase.removeChannel(channel); };
  }, [authUserId, loadTodos, roomId]);
  const todosByDate = useMemo(() => roomTodos.reduce((groups, todo) => {
    getEventDayKeys({ ...todo, roomid: roomId }, firstDay, lastDay).forEach((day) => { (groups[day] ||= []).push(todo); });
    return groups;
  }, {}), [firstDay, lastDay, roomId, roomTodos]);
  // 담당자를 지정한 할 일은 담당자 안에서만 완료를 센다 (지정하지 않으면 방 멤버 누구나)
  const todoAssignees = (todo) => (todo.assignees || []).map(String);
  const todoPool = (todo) => todoAssignees(todo).length || memberCount;
  const canCompleteTodo = (todo) => todoAssignees(todo).length === 0 || todoAssignees(todo).includes(String(authUserId));
  const doneUserIds = (todo, date) => todoCompletions
    .filter((row) => row.todoid === todo.id && row.occurrencedate === date)
    .map((row) => String(row.userid))
    .filter((id) => todoAssignees(todo).length === 0 || todoAssignees(todo).includes(id));
  const todoNeeded = (todo) => Math.min(todo.requiredcount ?? todoPool(todo), todoPool(todo));
  const formPool = todoForm.assignees.length || memberCount;
  const memberLabel = (id) => (id === String(authUserId) ? "나" : nicknameByUserId[id] || "팀원");
  function toggleTodoAssignee(userId) {
    setTodoForm((current) => ({ ...current, assignees: current.assignees.includes(userId) ? current.assignees.filter((id) => id !== userId) : [...current.assignees, userId] }));
  }
  const isTodoComplete = (todo, date) => doneUserIds(todo, date).length >= todoNeeded(todo);
  const selectedTodos = todosByDate[selectedDate] || [];

  function openTodoForm(todo) {
    setTodoError("");
    setEditingTodo(todo || null);
    setTodoForm(todo
      ? { title: todo.title, date: todo.date, duetime: todo.duetime ? todo.duetime.slice(0, 5) : "", repeat: todo.repeat || "none", ...parseReminder(todo.reminder), requiredMode: todo.requiredcount ? "some" : "all", requiredCount: todo.requiredcount || 1, assignees: (todo.assignees || []).map(String), memo: todo.memo || "" }
      : { ...EMPTY_TODO_FORM, date: selectedDate || today });
    setShowTodoForm(true);
  }

  async function submitTodo(event) {
    event.preventDefault();
    if (savingTodo) return;
    if (!todoForm.title.trim()) { setTodoError("제목을 입력해 주세요."); return; }
    if (!todoForm.date) { setTodoError("날짜를 선택해 주세요."); return; }
    if (isReminderInvalid(todoForm)) { setTodoError("알림 시간을 1 이상으로 입력해 주세요."); return; }
    const payload = {
      title: todoForm.title.trim(),
      date: todoForm.date,
      duetime: todoForm.duetime || null,
      repeat: todoForm.repeat,
      reminder: buildReminder(todoForm),
      requiredcount: todoForm.requiredMode === "some" ? Math.min(Math.max(Number(todoForm.requiredCount) || 1, 1), formPool) : null,
      assignees: todoForm.assignees,
      memo: todoForm.memo.trim() || null,
    };
    setSavingTodo(true);
    setTodoError("");
    try {
      if (editingTodo) await updateRoomTodo(editingTodo.id, payload);
      else await createRoomTodo({ ...payload, roomid: Number(roomId), createdby: authUserId });
      setShowTodoForm(false);
      await loadTodos();
    } catch (saveError) { setTodoError(saveError.message); }
    finally { setSavingTodo(false); }
  }

  async function removeTodo(todo) {
    if (!window.confirm("공동 할 일을 삭제할까요? 팀원들의 완료 기록도 함께 사라져요.")) return;
    try { await deleteRoomTodo(todo.id); setShowTodoForm(false); await loadTodos(); }
    catch (deleteError) { setTodoError(deleteError.message); }
  }

  async function toggleTodoDone(todo, date) {
    const done = doneUserIds(todo, date).includes(String(authUserId));
    try { await setRoomTodoDone({ todoId: todo.id, date, userId: authUserId, done: !done }); await loadTodos(); }
    catch (toggleError) { setError(toggleError.message); }
  }

  useEffect(() => {
    sessionStorage.setItem(`room-calendar-state:${roomId}`, JSON.stringify({ month: dateKey(month), selectedDate, selectedMeetingIndex, view }));
  }, [month, roomId, selectedDate, selectedMeetingIndex, view]);

  function openEventForm(event) {
    setEventError("");
    setEditingEvent(event || null);
    setEventForm(event
      ? { shared: (event.roomids || []).map(Number).includes(Number(roomId)), title: event.title, isallday: Boolean(event.isallday), startdate: event.date, enddate: event.enddate || event.date, starttime: event.starttime || "", endtime: event.endtime || "", location: event.location || "", memo: event.memo || "", ...parseReminder(event.reminder), repeat: event.repeat || "none" }
      : { ...EMPTY_EVENT_FORM, startdate: selectedDate || today, enddate: selectedDate || today });
    setShowEventForm(true);
  }

  async function submitEvent(event) {
    event.preventDefault();
    if (savingEvent) return;
    if (!eventForm.title.trim()) { setEventError("제목을 입력해 주세요."); return; }
    if (!eventForm.startdate) { setEventError("날짜를 선택해 주세요."); return; }
    if (isReminderInvalid(eventForm)) { setEventError("알림 시간을 1 이상으로 입력해 주세요."); return; }
    if (eventForm.enddate && eventForm.enddate < eventForm.startdate) { setEventError("종료 날짜가 시작 날짜보다 앞일 수 없습니다."); return; }
    const payload = {
      title: eventForm.title.trim(),
      color: eventForm.shared || !editingEvent ? memberColorById[String(authUserId)] : editingEvent.color,
      roomids: [...(editingEvent?.roomids || []).map(Number).filter((id) => id !== Number(roomId)), ...(eventForm.shared ? [Number(roomId)] : [])],
      isallday: eventForm.isallday,
      date: eventForm.startdate,
      enddate: eventForm.enddate && eventForm.enddate !== eventForm.startdate ? eventForm.enddate : null,
      starttime: eventForm.isallday ? null : eventForm.starttime || null,
      endtime: eventForm.isallday ? null : eventForm.endtime || null,
      location: eventForm.location.trim() || null,
      memo: eventForm.memo.trim() || null,
      reminder: buildReminder(eventForm),
      repeat: eventForm.repeat,
    };
    setSavingEvent(true);
    setEventError("");
    try {
      if (editingEvent) await updatePersonalEvent(editingEvent.id, payload);
      else {
        await createPersonalEvent({ ...payload, userid: authUserId });
        // 홈 캘린더와 같은 "일정 자동 추가" 설정: 켜져 있으면 내 구글 캘린더에도 추가
        if (localStorage.getItem("google_calendar_auto_sync") === "true") {
          try { await addEventToGoogleCalendar({ title: payload.title, date: payload.date, starttime: payload.starttime, endtime: payload.endtime }); }
          catch (googleError) { setError(`일정은 저장됐지만 구글 캘린더 추가 실패: ${googleError.message}`); }
        }
      }
      setShowEventForm(false);
      await loadSharedEvents();
    } catch (saveError) { setEventError(saveError.message || "일정을 저장하지 못했습니다."); }
    finally { setSavingEvent(false); }
  }

  async function removeEvent(event) {
    if (!window.confirm("일정을 삭제할까요?")) return;
    try { await deletePersonalEvent(event.id); setShowEventForm(false); await loadSharedEvents(); }
    catch (deleteError) { setEventError(deleteError.message || "일정을 삭제하지 못했습니다."); }
  }

  useEffect(() => {
    if (!location.state?.diaryAutoSavedToast) return undefined;
    setShowDiarySavedToast(true);
    const { diaryAutoSavedToast, ...nextState } = location.state;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: nextState });
  }, [location.key, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!showDiarySavedToast) return undefined;
    const timer = window.setTimeout(() => setShowDiarySavedToast(false), 2600);
    return () => window.clearTimeout(timer);
  }, [showDiarySavedToast]);

  useEffect(() => {
    const meetingIds = selectedMeetingIdsKey ? selectedMeetingIdsKey.split(",") : [];
    if (meetingIds.length === 0 || !identity || !diariesLoaded) {
      setMeetingProgressById({});
      return undefined;
    }
    let active = true;
    setMeetingProgressById({});
    Promise.all(meetingIds.map(async (meetingId) => {
      try {
        return [meetingId, await getMeetingDiaryProgress(meetingId, selectedMeetings.find((meeting) => meeting.id === meetingId))];
      } catch (progressError) {
        if (active) setError(progressError.message || "기록 현황을 불러오지 못했습니다.");
        return [meetingId, null];
      }
    })).then((entries) => {
      if (active) setMeetingProgressById(Object.fromEntries(entries.filter(([, progress]) => progress)));
    });
    return () => { active = false; };
  }, [diariesLoaded, identity, selectedMeetingIdsKey]);

  function openMeetingRecords(meetingId) {
    navigate(`/rooms/${roomId}/meetings/${meetingId}/diary`, { state: { from: `${location.pathname}${location.search}` } });
  }

  function openDiaryEditor(meeting, selectedIndex) {
    const nextSelectedDate = meeting.meeting_date;
    const nextMeetingIndex = Number.isInteger(selectedIndex) && selectedIndex >= 0
      ? selectedIndex
      : (meetingGroups[nextSelectedDate] || []).findIndex((item) => item.id === meeting.id);
    sessionStorage.setItem(`room-calendar-state:${roomId}`, JSON.stringify({
      month: dateKey(month),
      selectedDate: nextSelectedDate,
      selectedMeetingIndex: Math.max(0, nextMeetingIndex),
    }));
    setSelectedDate(nextSelectedDate);
    setSelectedMeetingIndex(Math.max(0, nextMeetingIndex));
    navigate(`/rooms/${roomId}/meetings/${meeting.id}/diary/edit`, { state: { from: `${location.pathname}${location.search}` } });
  }

  function openLightningForm() {
    setLightningParticipantIds([]);
    setLightningTitleError(false);
    setLightningTitle(""); setLightningLocation(""); setLightningLocationAddress(""); setLightningSelectedPlace(null); setShowLightningPlacePicker(false); setLightningStart(""); setLightningEnd("");
    setError("");
    lightningRequestIdRef.current = null;
    setShowLightning(true);
  }

  function toggleLightningParticipant(userId) {
    setLightningParticipantIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  }

  async function refreshCalendar() { await load(); }

  function selectCalendarDate(date) {
    window.clearTimeout(sheetDismissTimerRef.current);
    sheetDismissTimerRef.current = null;
    suppressSheetClickRef.current = false;
    sheetDragRef.current = { startY: null, offset: 0, pointerId: null };
    setSheetDragOffset(0);
    setIsSheetDragging(false);
    setIsSheetDismissing(false);
    setSelectedDate(date);
    setSelectedMeetingIndex(0);
  }

  function dismissCalendarSheet() {
    if (isSheetDismissing) return;
    setIsSheetDismissing(true);
    sheetDismissTimerRef.current = window.setTimeout(() => {
      setSelectedDate("");
      setIsSheetDismissing(false);
      sheetDismissTimerRef.current = null;
    }, 220);
  }

  function startCalendarSheetDrag(event) {
    if (isSheetDismissing) return;
    sheetDragRef.current = { startY: event.clientY, offset: 0, pointerId: event.pointerId };
    suppressSheetClickRef.current = false;
    setIsSheetDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCalendarSheetDrag(event) {
    const drag = sheetDragRef.current;
    if (drag.startY === null || drag.pointerId !== event.pointerId) return;
    drag.offset = Math.max(0, event.clientY - drag.startY);
    setSheetDragOffset(drag.offset);
  }

  function endCalendarSheetDrag(event) {
    const drag = sheetDragRef.current;
    if (drag.startY === null || drag.pointerId !== event.pointerId) return;
    const offset = Math.max(0, event.clientY - drag.startY);
    const didMove = offset > 8;
    const shouldDismiss = offset > 72;
    sheetDragRef.current = { startY: null, offset: 0, pointerId: null };
    setIsSheetDragging(false);
    if (didMove) suppressSheetClickRef.current = true;
    if (shouldDismiss) dismissCalendarSheet();
    else setSheetDragOffset(0);
  }

  const submitLightning = async (event) => {
    event.preventDefault();
    if (!lightningTitle.trim()) {
      setLightningTitleError(true);
      return;
    }
    if (savingLightning) return;
    setLightningTitleError(false);
    setError("");
    try {
      setSavingLightning(true);
      lightningRequestIdRef.current ||= crypto.randomUUID();
      await createLightningMeeting({ roomId, date: selectedDate, title: lightningTitle.trim(), startTime: lightningStart, endTime: lightningEnd, location: lightningLocation.trim(), address: lightningLocationAddress.trim(), participantUserIds: lightningParticipantIds, requestId: lightningRequestIdRef.current });
      const date = new Date(`${selectedDate}T12:00:00`);
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      setSelectedMeetingIndex(0);
      await refreshCalendar();
      lightningRequestIdRef.current = null;
      setShowLightning(false);
    } catch (createError) { setError(createError.message || "\uBC88\uAC1C \uB9CC\uB0A8 \uB4F1\uB85D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."); }
    finally { setSavingLightning(false); }
  };

  return (
    <main className={`room-calendar-page ${settingsOpen ? "is-room-settings-open" : ""}`}>
      {authMessage && <div className="calendar-notice" role="status">{authMessage}</div>}
      {error && <div className="calendar-error" role="alert">{error}<button type="button" onClick={refreshCalendar}>&#xB2E4;&#xC2DC; &#xBD88;&#xB7EC;&#xC624;&#xAE30;</button></div>}
      <section className="room-calendar-card" aria-label="&#xBC29; &#xACF5;&#xD1B5; &#xC6D4;&#xAC04; &#xCE98;&#xB9B0;&#xB354">
        <div className="room-calendar-view-toggle" role="tablist" aria-label="캘린더 종류">
          <button type="button" role="tab" aria-selected={view === "shared"} className={view === "shared" ? "active" : ""} onClick={() => setView("shared")}>공용 캘린더</button>
          <button type="button" role="tab" aria-selected={view === "diary"} className={view === "diary" ? "active" : ""} onClick={() => setView("diary")}>일기 캘린더</button>
        </div>
        <div className="room-calendar-month-row"><header className="room-calendar-month"><button type="button" aria-label="&#xC774;&#xC804; &#xB2EC;" onClick={() => { setOpenMonthPicker(null); setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); }}>‹</button><div className="room-calendar-month-heading"><button type="button" className="room-calendar-period-button" aria-expanded={openMonthPicker === "year"} onClick={() => setOpenMonthPicker((open) => open === "year" ? null : "year")}>{month.getFullYear()}년</button><button type="button" className="room-calendar-period-button" aria-expanded={openMonthPicker === "month"} onClick={() => setOpenMonthPicker((open) => open === "month" ? null : "month")}>{month.getMonth() + 1}월</button>{openMonthPicker && <div className={`room-calendar-period-picker ${openMonthPicker}`} aria-label={openMonthPicker === "year" ? "연도 선택" : "월 선택"}>{openMonthPicker === "year" ? <div className="room-calendar-year-options">{Array.from({ length: new Date().getFullYear() + 11 - 1900 }, (_, index) => 1900 + index).map((year) => <button type="button" key={year} ref={year === month.getFullYear() ? activeYearOptionRef : null} className={year === month.getFullYear() ? "selected" : ""} aria-pressed={year === month.getFullYear()} onClick={() => { setMonth(new Date(year, month.getMonth(), 1)); setOpenMonthPicker(null); }}>{year}</button>)}</div> : <div className="room-calendar-month-options">{Array.from({ length: 12 }, (_, index) => index + 1).map((monthNumber) => <button type="button" key={monthNumber} className={monthNumber === month.getMonth() + 1 ? "selected" : ""} aria-pressed={monthNumber === month.getMonth() + 1} onClick={() => { setMonth(new Date(month.getFullYear(), monthNumber - 1, 1)); setOpenMonthPicker(null); }}>{monthNumber}월</button>)}</div>}</div>}</div><button type="button" aria-label="&#xB2E4;&#xC74C; &#xB2EC;" onClick={() => { setOpenMonthPicker(null); setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); }}>›</button></header>
          {view === "shared" ? <RoomGoogleCalendarControl onChange={() => setGoogleVersion((v) => v + 1)} /> : <RoomDriveBackupControl compact roomId={roomId} canBackup={Boolean(identity)} checkingMembership={loading} />}
        </div>
        {view === "diary"
          ? <div className="room-calendar-summary-row"><p className="room-calendar-summary">이번 달 {meetings.filter((meeting) => meeting.lifecycle_status !== "cancelled").length}건 만남이에요</p><button type="button" className="calendar-collection-button" disabled={!identity} onClick={() => navigate(`/rooms/${roomId}/diaries`, { state: { from: `${location.pathname}${location.search}` } })}>기록 모아보기</button></div>
          : <div className="room-calendar-summary-row"><p className="room-calendar-summary">이번 달 팀원 일정 {monthEventCount}건</p></div>}
        <div className="room-calendar-grid room-calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className={`room-calendar-grid room-calendar-days ${view === "shared" ? "is-shared" : ""}`}>{calendarDays.map((date) => {
          const key = dateKey(date);
          const dayMeetings = meetingGroups[key] || [];
          const outside = date.getMonth() !== month.getMonth();
          const hasLightning = dayMeetings.some((meeting) => meeting.source_type === "lightning" && meeting.lifecycle_status !== "cancelled");
          const hasScheduledMeeting = dayMeetings.some((meeting) => meeting.source_type !== "lightning" && meeting.lifecycle_status !== "cancelled");
          if (view === "shared") {
            const dayEvents = eventsByDate[key] || [];
            const dayTodos = todosByDate[key] || [];
            const holiday = holidays[key];
            const activeMeetings = dayMeetings.filter(isMeetingVisibleInSharedCalendar);
            const hasRoomMeeting = activeMeetings.length > 0;
            // 일정은 날짜 칸에 얇은 색 막대로 바로 표시하고, 공동 할 일은 점으로 표시한다 (이름은 날짜를 눌러 확인)
            const chips = [
              ...activeMeetings.map((meeting) => ({ key: `m-${meeting.id}`, label: meeting.title || (meeting.source_type === "lightning" ? "번개 만남" : "방 일정"), color: "#7c79ff" })),
              ...dayEvents.map((item) => ({ key: `e-${item.id}`, label: item.title, color: eventColor(item) })),
              ...(googleByDate[key] || []).map((item) => ({ key: `g-${item.id}`, label: item.title, color: "#4285F4" })),
            ];
            return <div className="room-calendar-day-wrap" key={key}>
              <button type="button" className={`room-calendar-day ${hasRoomMeeting ? "has-scheduled-meeting" : ""} ${outside ? "outside" : ""} ${selectedDate === key ? "selected" : ""} ${key === today ? "today" : ""}`} onClick={() => selectCalendarDate(key)}>
                <span className="room-calendar-day-number" style={holiday?.public || date.getDay() === 0 ? { color: "#f44" } : undefined}>{date.getDate()}</span>
                {holiday && <span className="room-calendar-holiday">{holiday.name}</span>}
                <span className="room-calendar-chips">
                  {chips.slice(0, 3).map((chip) => <span key={chip.key} className="room-calendar-chip" title={chip.label} style={{ background: chip.color }} />)}
                  {chips.length > 3 && <span className="room-calendar-chip-more">+{chips.length - 3}</span>}
                </span>
                {dayTodos.length > 0 && <span className="room-calendar-dots">
                  {dayTodos.slice(0, 3).map((todo) => <i key={todo.id} className={`room-todo-dot ${isTodoComplete(todo, key) ? "done" : ""}`} />)}
                </span>}
              </button>
            </div>;
          }
          return <div className="room-calendar-day-wrap" key={key}>
            <button type="button" className={`room-calendar-day ${diaryCoversByDate[key] ? "has-cover" : ""} ${hasScheduledMeeting ? "has-scheduled-meeting" : ""} ${outside ? "outside" : ""} ${selectedDate === key ? "selected" : ""} ${key === today ? "today" : ""}`} onClick={() => selectCalendarDate(key)}>
              <span className="room-calendar-day-number">{date.getDate()}</span>
              {diaryCoversByDate[key] && <CalendarDayThumbnail src={diaryCoversByDate[key]} />}
              {hasLightning && <span className="room-calendar-lightning" aria-label="Lightning meeting">&#x26A1;&#xFE0F;</span>}
              {diaryCountsByDate[key] > 0 && <small className="room-calendar-record-count-badge">{diaryCountsByDate[key]}</small>}
            </button>
          </div>;
        })}</div>
        {view === "shared" ? <><div className="room-calendar-legend room-member-legend">
          {Object.entries(memberColorById).map(([id, color]) => { const hidden = hiddenUserIds.includes(id); return <button type="button" key={id} className={hidden ? "hidden-member" : ""} aria-pressed={!hidden} onClick={() => setHiddenUserIds((current) => hidden ? current.filter((x) => x !== id) : [...current, id])}><b style={{ color }}>●</b>{id === String(authUserId) ? "나" : nicknameByUserId[id] || "팀원"}</button>; })}
          <span><i className="scheduled" />방 일정</span><span><b style={{ color: TODO_COLOR }}>✓</b>공동 할 일</span>
          <button type="button" className="room-color-edit" disabled={!authUserId} onClick={() => setShowColorPicker((open) => !open)}>내 색상 변경</button>
        </div>
        {showColorPicker && <div className="room-color-picker" role="group" aria-label="내 색상 선택">
          {MEMBER_COLORS.map((color) => { const owner = Object.entries(memberColorById).find(([, c]) => c === color)?.[0]; const mineColor = owner === String(authUserId); const takenByOther = owner && !mineColor; return <button type="button" key={color} className={mineColor ? "selected" : ""} disabled={takenByOther} style={{ background: color }} aria-label={takenByOther ? `${nicknameByUserId[owner] || "팀원"}님이 사용 중인 색` : `색상 ${color}`} aria-pressed={mineColor} title={takenByOther ? `${nicknameByUserId[owner] || "팀원"}님이 사용 중` : ""} onClick={() => chooseMyColor(color)} />; })}
          <p>다른 팀원이 쓰는 색은 고를 수 없어요.</p>{colorError && <p className="diary-error">{colorError}</p>}
        </div>}</> : <div className="room-calendar-legend"><span><i className="scheduled" />약속 있음</span><span><i className="record-image"><FiImage aria-hidden="true" /></i>기록 있음</span><span><b>&#x26A1;&#xFE0F;</b>번개 만남</span></div>}
      </section>
      {loading && <p className="calendar-loading">캘린더를 불러오는 중...</p>}
      {selectedDate && view === "shared" && <section
        className={`calendar-selected-section room-shared-day ${isSheetDragging ? "is-dragging" : ""} ${isSheetDismissing ? "is-dismissing" : ""}`}
        style={{ "--calendar-sheet-drag-y": `${sheetDragOffset}px` }}
        aria-label={`Selected date ${selectedDate}`}
      >
        <button type="button" className="calendar-sheet-handle" aria-label="날짜 상세 닫기"
          onClick={() => {
            if (suppressSheetClickRef.current) { suppressSheetClickRef.current = false; return; }
            dismissCalendarSheet();
          }}
          onPointerDown={startCalendarSheetDrag}
          onPointerMove={moveCalendarSheetDrag}
          onPointerUp={endCalendarSheetDrag}
          onPointerCancel={endCalendarSheetDrag}
        />
        <header className="calendar-selected-heading"><h2>{selectedDateLabel}</h2><div className="room-shared-actions"><button type="button" className="calendar-collection-button" disabled={!authUserId} onClick={() => openTodoForm()}>＋ 공동 할 일</button><button type="button" className="calendar-lightning-button" disabled={!authUserId} onClick={() => openEventForm()}>＋ 팀원 일정</button></div></header>
        {selectedHoliday && <p className="room-shared-holiday" style={{ color: selectedHoliday.public ? "#f44" : "#f90" }}>{selectedHoliday.public ? "🎌" : "📅"} {selectedHoliday.name}</p>}
        {selectedSharedMeetings.map((meeting) => <div className="room-shared-event" key={meeting.id} style={{ "--event-color": "#7c79ff" }}>
          <strong>📌 {meeting.title || (meeting.source_type === "lightning" ? "번개 만남" : "확정 일정")}</strong>
          <span>{meeting.start_time ? meeting.start_time.slice(0, 5) : "하루종일"}{meeting.location ? ` · ${meeting.location}` : ""}</span>
        </div>)}
        {selectedEvents.map((item) => {
          const mine = item.userid === authUserId;
          return <div className={`room-shared-event ${mine ? "mine" : ""}`} key={item.id} style={{ "--event-color": eventColor(item) }} onClick={mine ? () => openEventForm(item) : undefined}>
            <strong>{item.title}</strong>
            <span>{item.isallday || !item.starttime ? "하루종일" : `${item.starttime.slice(0, 5)}${item.endtime ? ` ~ ${item.endtime.slice(0, 5)}` : ""}`}{item.location ? ` · 📍 ${item.location}` : ""}</span>
            {item.memo && <span>{item.memo}</span>}
            <em>{mine ? (item.roomids?.length ? "나" : "나 · 🔒 나만 보기") : nicknameByUserId[String(item.userid)] || "팀원"}</em>
          </div>;
        })}
        {selectedGoogleEvents.map((item) => <div className="room-shared-event" key={`g-${item.id}`} style={{ "--event-color": "#4285F4" }}>
          <strong>📅 {item.title}</strong>
          <span>{item.starttime ? `${item.starttime}${item.endtime ? ` ~ ${item.endtime}` : ""}` : "하루종일"}</span>
          <em>내 구글 캘린더 · 나만 보기</em>
        </div>)}
        {selectedTodos.map((todo) => {
          const done = doneUserIds(todo, selectedDate);
          const mineDone = done.includes(String(authUserId));
          const complete = done.length >= todoNeeded(todo);
          return <div className={`room-todo-item ${complete ? "complete" : ""}`} key={todo.id}>
            <button type="button" className={`room-todo-check ${mineDone ? "checked" : ""}`} aria-pressed={mineDone} aria-label={mineDone ? "완료 취소" : "완료 체크"} disabled={!canCompleteTodo(todo)} title={canCompleteTodo(todo) ? "" : "담당자만 체크할 수 있어요"} onClick={() => toggleTodoDone(todo, selectedDate)}>{mineDone ? "✓" : ""}</button>
            <div className="room-todo-body">
              <strong>{todo.title}{todo.duetime ? <small> {todo.duetime.slice(0, 5)}</small> : null}</strong>
              <span>{todo.requiredcount ? `${todoNeeded(todo)}명이 하면 완료` : "모두 해야 완료"} · {done.length}/{todoNeeded(todo)}명 {complete ? "완료 ✓" : "진행 중"}</span>
              {todoAssignees(todo).length > 0 && <span>담당: {todoAssignees(todo).map(memberLabel).join(", ")}</span>}
              {done.length > 0 && <span>완료: {done.map(memberLabel).join(", ")}</span>}
              {todo.memo && <span>{todo.memo}</span>}
            </div>
            {authUserId && <button type="button" className="room-todo-edit" onClick={() => openTodoForm(todo)}>수정</button>}
          </div>;
        })}
        {!selectedHoliday && selectedEvents.length === 0 && selectedSharedMeetings.length === 0 && selectedTodos.length === 0 && selectedGoogleEvents.length === 0 && <div className="calendar-empty-meeting"><p>등록된 일정이 없습니다.</p></div>}
      </section>}
      {selectedDate && view === "diary" && <section
        className={`calendar-selected-section ${showEmptyDayPrompt ? "has-empty-day-prompt" : ""} ${isSheetDragging ? "is-dragging" : ""} ${isSheetDismissing ? "is-dismissing" : ""}`}
        style={{ "--calendar-sheet-drag-y": `${sheetDragOffset}px` }}
        aria-label={`Selected date ${selectedDate}`}
      >
        <button type="button" className="calendar-sheet-handle" aria-label="날짜 상세 닫기"
          onClick={() => {
            if (suppressSheetClickRef.current) { suppressSheetClickRef.current = false; return; }
            dismissCalendarSheet();
          }}
          onPointerDown={startCalendarSheetDrag}
          onPointerMove={moveCalendarSheetDrag}
          onPointerUp={endCalendarSheetDrag}
          onPointerCancel={endCalendarSheetDrag}
        />
        <header className="calendar-selected-heading"><h2>{selectedDateLabel}</h2>{activeMeeting && <span className="calendar-meeting-badge">{activeMeeting.source_type === "lightning" && <span aria-hidden="true">&#x26A1;&#xFE0F;</span>}{activeMeeting.source_type === "lightning" ? "\uBC88\uAC1C" : "\uC57D\uC18D"}&#xB7; {activeMeetingOrdinal}&#xBC88;&#xC9F8; &#xB9CC;&#xB0A8;</span>}{showEmptyDayPrompt && <span className="calendar-empty-day-badge">&#xC57D;&#xC18D; &#xC5C6;&#xC74C;</span>}{activeMeeting && !selectedDateHasLightning && canCreateLightning && identity && <button type="button" className="calendar-lightning-button" onClick={openLightningForm}>&#xFF0B; &#xBC88;&#xAC1C; &#xB9CC;&#xB0A8; &#xB4F1;&#xB85D;</button>}</header>
        {selectedMeetings.length === 0 && (showEmptyDayPrompt
          ? <div className="calendar-empty-day-prompt"><span className="calendar-empty-day-icon" aria-hidden="true">&#x26A1;&#xFE0F;</span><strong>&#xC774; &#xB0A0; &#xCE5C;&#xAD6C;&#xB4E4;&#xC744; &#xB9CC;&#xB0AC;&#xB098;&#xC694;?</strong><p>&#xC571;&#xC5D0;&#xC11C; &#xC815;&#xD558;&#xC9C0; &#xC54A;&#xC740; &#xBC88;&#xAC1C; &#xB9CC;&#xB0A8;&#xB3C4; &#xAE30;&#xB85D;&#xD560; &#xC218; &#xC788;&#xC5B4;&#xC694;</p><button type="button" className="calendar-empty-day-cta" disabled={!identity} onClick={openLightningForm}>&#x26A1;&#xFE0F; &#xBC88;&#xAC1C; &#xB9CC;&#xB0A8; &#xAE30;&#xB85D;&#xD558;&#xAE30;</button></div>
          : <div className="calendar-empty-meeting"><p>&#xB4F1;&#xB85D;&#xB41C; &#xB9CC;&#xB0A8;&#xC774; &#xC5C6;&#xC2B5;&#xB2C8;&#xB2E4;.</p></div>)}
        {selectedMeetings.length > 0 && <div className={`calendar-meeting-carousel ${selectedMeetings.length > 1 ? "has-multiple" : "single"} ${!isActiveRecordPublished && activeMeeting?.meeting_date <= today ? "has-record-hint" : ""}`}>
          {selectedMeetings.length > 1 && <button type="button" className="calendar-meeting-arrow previous" aria-label="&#xC774;&#xC804; &#xB9CC;&#xB0A8;" onClick={() => setSelectedMeetingIndex((activeMeetingIndex - 1 + selectedMeetings.length) % selectedMeetings.length)}>&#x2039;</button>}
          {activeMeeting && <article key={activeMeeting.id} className={`calendar-meeting-card ${isActiveRecordPublished ? "is-complete" : ""}`}>
              <div className="calendar-meeting-summary">
              <button type="button" className="calendar-meeting-summary-open" disabled={activeMeeting.meeting_date > today} onClick={() => openMeetingRecords(activeMeeting.id)} aria-label={`${activeMeeting.title || "\uC57D\uC18D"} \uAE30\uB85D \uC0C1\uC138 \uBCF4\uAE30`} />
              <div className="calendar-meeting-summary-main">
                <div className="calendar-meeting-info">
                  <strong>{activeMeeting.title || (activeMeeting.source_type === "lightning" ? "\uBC88\uAC1C \uB9CC\uB0A8" : "\uD655\uC815 \uC77C\uC815")}</strong>
                  <span>{activeMeeting.start_time ? new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(`2000-01-01T${activeMeeting.start_time}`)) : "\uD558\uB8E8 \uC885\uC77C"}{activeMeeting.location && <>{" \u00B7 "}<FiMapPin className="calendar-meeting-place-icon" aria-hidden="true" />{" "}{activeMeeting.location}</>}</span>
                  {activeMeeting.lifecycle_status === "cancelled" && <em>취소된 일정</em>}
                </div>
                {activeMeeting.meeting_date <= today && <span className="calendar-meeting-chevron" aria-hidden="true">&#x203A;</span>}
              </div>
              <div className="calendar-meeting-participants">
                <div className="calendar-participant-avatars" aria-label={`참여 인원 ${activeMeetingParticipants.length}명`}>
                  {activeMeetingParticipants.slice(0, 4).map((participant) => <span className={`calendar-participant-avatar ${activePublishedMemberIds.has(String(participant.userid)) ? "written" : "unwritten"}`} key={participant.userid || participant.id} title={participant.nickname}>
                    {participant.profiles?.profileimageurl ? <img src={participant.profiles.profileimageurl} alt="" /> : participant.nickname?.trim()?.slice(0, 1) || "?"}
                  </span>)}
                  {activeMeetingParticipants.length > 4 && <span className="calendar-participant-avatar calendar-participant-more">+{activeMeetingParticipants.length - 4}</span>}
                </div>
                <span className="calendar-record-count">{activeMeetingDiaryCount ?? "\u2014"}/{activeMeetingProgress?.target_count ?? activeMeetingParticipants.length}&#xBA85; &#xAE30;&#xB85D;</span>
                {isActiveRecordPublished && <span className="calendar-record-complete-label">&#x2713; &#xB0B4; &#xAE30;&#xB85D; &#xC791;&#xC131; &#xC644;&#xB8CC;</span>}
              </div>
              </div>
              {activeMeeting.meeting_date > today && <div className="calendar-upcoming-record"><button type="button" disabled>&#xAE30;&#xB85D;&#xC740; {new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(`${activeMeeting.meeting_date}T12:00:00+09:00`))}&#xBD80;&#xD130; &#xC791;&#xC131;&#xD560; &#xC218; &#xC788;&#xC5B4;&#xC694;</button></div>}
              {!isActiveRecordPublished && activeMeeting.meeting_date <= today && <button type="button" className="calendar-record-cta" disabled={!identity} onClick={() => openDiaryEditor(activeMeeting, activeMeetingIndex)}>&#xAE30;&#xB85D; &#xC4F0;&#xAE30;</button>}
          </article>}
          {!isActiveRecordPublished && activeMeeting?.meeting_date <= today && <p className="calendar-record-hint">오늘의 만남은 어떠셨나요? 하루의 기록을 남겨보세요.</p>}
          {selectedMeetings.length > 1 && <button type="button" className="calendar-meeting-arrow next" aria-label="Next meeting" onClick={() => setSelectedMeetingIndex((activeMeetingIndex + 1) % selectedMeetings.length)}>&#x203A;</button>}
          {selectedMeetings.length > 1 && <span className="calendar-meeting-position">{activeMeetingIndex + 1} / {selectedMeetings.length}</span>}
        </div>}
      </section>}
      {showDiarySavedToast && <div className="diary-autosave-toast" role="status">쓰던 글은 자동 저장됐어요. 언제든 이어 쓸 수 있어요.</div>}
      {showTodoForm && <div className="diary-modal"><form className="diary-sheet" onSubmit={submitTodo}>
        <header className="diary-sheet-header"><div><p className="diary-eyebrow">공동 할 일</p><h2>{editingTodo ? "할 일 수정" : "할 일 추가"}</h2></div><button type="button" className="diary-icon-button" onClick={() => setShowTodoForm(false)} aria-label="닫기">&times;</button></header>
        <label className="diary-field-label" htmlFor="room-todo-title">할 일</label>
        <input id="room-todo-title" className="diary-select" value={todoForm.title} maxLength={120} placeholder="예) 회비 계좌 이체하기" onChange={(e) => setTodoForm({ ...todoForm, title: e.target.value })} />
        <div className="lightning-time-row room-todo-times"><label>날짜<input type="date" value={todoForm.date} onChange={(e) => setTodoForm({ ...todoForm, date: e.target.value })} /></label><label>시간 (선택)<input type="time" value={todoForm.duetime} onChange={(e) => setTodoForm({ ...todoForm, duetime: e.target.value })} /></label></div>
        <fieldset className="room-todo-required"><legend>몇 명이 하면 끝나나요?</legend>
          <label><input type="radio" name="room-todo-required" checked={todoForm.requiredMode === "all"} onChange={() => setTodoForm({ ...todoForm, requiredMode: "all" })} /> 모두 해야 해요 ({formPool}명)</label>
          <label><input type="radio" name="room-todo-required" checked={todoForm.requiredMode === "some"} onChange={() => setTodoForm({ ...todoForm, requiredMode: "some" })} /> <input type="number" min="1" max={formPool} value={todoForm.requiredCount} disabled={todoForm.requiredMode !== "some"} onChange={(e) => setTodoForm({ ...todoForm, requiredCount: e.target.value })} /> 명이 하면 돼요</label>
          <div className="room-todo-assignees">
            <span>담당자 <small>(선택 · 지정하지 않으면 누구나)</small></span>
            <div className="lightning-member-options">{participants.filter((participant) => participant.userid).map((participant) => { const id = String(participant.userid); const selected = todoForm.assignees.includes(id); return <button type="button" key={id} className={`lightning-member-option ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => toggleTodoAssignee(id)}><span className="lightning-member-avatar">{participant.profiles?.profileimageurl ? <img src={participant.profiles.profileimageurl} alt="" /> : participant.nickname?.trim()?.slice(0, 1) || "?"}</span><span>{memberLabel(id)}</span>{selected && <b aria-hidden="true">&#x2713;</b>}</button>; })}</div>
          </div>
        </fieldset>
        <label className="diary-field-label" htmlFor="room-todo-repeat">반복</label>
        <select id="room-todo-repeat" className="diary-select room-form-select" value={todoForm.repeat} onChange={(e) => setTodoForm({ ...todoForm, repeat: e.target.value })}>{REPEAT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <ReminderField id="room-todo-reminder" form={todoForm} setForm={setTodoForm} />
        <label className="diary-field-label" htmlFor="room-todo-memo">메모</label>
        <textarea id="room-todo-memo" className="diary-select room-memo-textarea" placeholder="메모 입력" rows={3} maxLength={300} value={todoForm.memo} onChange={(e) => setTodoForm({ ...todoForm, memo: e.target.value })} />
        <p className="lightning-place-edit-hint">시간을 정하지 않으면 알림은 오전 9시 기준이에요. 알림과 반복은 방 멤버 모두에게 적용돼요.</p>
        {todoError && <p className="diary-error">{todoError}</p>}
        <div className="room-form-actions">
          {editingTodo && <button type="button" className="calendar-collection-button" onClick={() => removeTodo(editingTodo)}>삭제</button>}
          <button type="submit" className="diary-publish-button" disabled={savingTodo}>{savingTodo ? "저장 중..." : "저장"}</button>
        </div>
      </form></div>}
      {showEventForm && <div className="diary-modal"><form className="diary-sheet" onSubmit={submitEvent}>
        <header className="diary-sheet-header"><div><p className="diary-eyebrow">팀원 일정</p><h2>{editingEvent ? "일정 수정" : "일정 추가"}</h2></div><button type="button" className="diary-icon-button" onClick={() => setShowEventForm(false)} aria-label="닫기">&times;</button></header>
        <label className="diary-field-label" htmlFor="room-event-title">제목</label>
        <input id="room-event-title" className="diary-select" value={eventForm.title} maxLength={120} placeholder="일정 제목" onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} />
        <div className="room-form-share">
          <span>공용 캘린더 공개</span>
          <button type="button" role="switch" aria-checked={eventForm.shared} aria-label="공용 캘린더 공개" className={`room-tool-switch ${eventForm.shared ? "on" : ""}`} onClick={() => setEventForm({ ...eventForm, shared: !eventForm.shared })}><i /></button>
        </div>
        <p className="room-event-color-hint"><i style={{ background: memberColorById[String(authUserId)] }} /> 내 색상으로 표시돼요</p>
        <div className="room-form-allday">
          <button type="button" role="switch" aria-checked={eventForm.isallday} aria-label="하루종일" className={`room-tool-switch ${eventForm.isallday ? "on" : ""}`} onClick={() => setEventForm({ ...eventForm, isallday: !eventForm.isallday })}><i /></button>
          <span>하루종일</span>
        </div>
        <div className="lightning-time-row"><label>시작 날짜<input type="date" value={eventForm.startdate} onChange={(e) => setEventForm({ ...eventForm, startdate: e.target.value, enddate: eventForm.enddate < e.target.value ? e.target.value : eventForm.enddate })} /></label><label>종료 날짜<input type="date" value={eventForm.enddate} min={eventForm.startdate} onChange={(e) => setEventForm({ ...eventForm, enddate: e.target.value })} /></label></div>
        {!eventForm.isallday && <div className="lightning-time-row"><label>시작 시간<input type="time" value={eventForm.starttime} onChange={(e) => setEventForm({ ...eventForm, starttime: e.target.value })} /></label><label>종료 시간<input type="time" value={eventForm.endtime} onChange={(e) => setEventForm({ ...eventForm, endtime: e.target.value })} /></label></div>}
        <label className="diary-field-label" htmlFor="room-event-location">장소 <span className="lightning-optional-label">(선택)</span></label>
        <input id="room-event-location" className="diary-select" value={eventForm.location} maxLength={200} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} />
        <ReminderField id="room-event-reminder" form={eventForm} setForm={setEventForm} />
        <label className="diary-field-label" htmlFor="room-event-repeat">반복</label>
        <select id="room-event-repeat" className="diary-select room-form-select" value={eventForm.repeat} onChange={(e) => setEventForm({ ...eventForm, repeat: e.target.value })}>
          {REPEAT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="diary-field-label" htmlFor="room-event-memo">메모</label>
        <textarea id="room-event-memo" className="diary-select room-memo-textarea" placeholder="메모 입력" rows={3} maxLength={300} value={eventForm.memo} onChange={(e) => setEventForm({ ...eventForm, memo: e.target.value })} />
        <p className="lightning-place-edit-hint">{eventForm.shared ? "내가 등록한 일정은 홈 캘린더에도 표시되고, 알림과 반복은 방 멤버 모두에게 적용돼요." : "끄면 이 방 팀원에게는 보이지 않고 나만 볼 수 있어요. 홈 캘린더에는 그대로 남아요."}</p>
        {eventError && <p className="diary-error">{eventError}</p>}
        <div className="room-form-actions">
          {editingEvent && <button type="button" className="calendar-collection-button" onClick={() => removeEvent(editingEvent)}>삭제</button>}
          <button type="submit" className="diary-publish-button" disabled={savingEvent}>{savingEvent ? "저장 중..." : "저장"}</button>
        </div>
      </form></div>}
      {showLightning && <div className="diary-modal"><form className={`diary-sheet lightning-sheet ${showLightningPlacePicker ? "is-place-picker" : ""}`} onSubmit={showLightningPlacePicker ? (event) => event.preventDefault() : submitLightning}>
        {showLightningPlacePicker ? <>
          <header className="diary-sheet-header lightning-place-header"><button type="button" className="lightning-place-back" onClick={() => setShowLightningPlacePicker(false)} aria-label="번개 만남 화면으로 돌아가기">‹</button><h2>장소 선택</h2><button type="button" className="diary-icon-button" onClick={() => setShowLightning(false)} aria-label="닫기">&times;</button></header>
          <div className="lightning-place-picker" onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}>
            <LocationPicker
              initialPlace={lightningSelectedPlace}
              prefillKeywordFromInitialPlace={false}
              includeAddressSearch
              mapHeight="min(38dvh, 290px)"
              onSelect={(name, address, place) => {
                const selectedName = (name || place?.name || address || place?.address || "").trim();
                if (!selectedName) return;
                const selectedAddress = (address || place?.address || "").trim();
                setLightningLocation(selectedName);
                setLightningLocationAddress(selectedAddress);
                setLightningSelectedPlace({ ...place, name: selectedName, address: selectedAddress });
                setShowLightningPlacePicker(false);
              }}
            />
          </div>
        </> : <>
        <header className="diary-sheet-header"><div><p className="diary-eyebrow">{selectedDate ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${selectedDate}T12:00:00`)) : ""}</p><h2>&#x26A1;&#xFE0F; &#xBC88;&#xAC1C; &#xB9CC;&#xB0A8; &#xAE30;&#xB85D;&#xD558;&#xAE30;</h2></div><button type="button" className="diary-icon-button" onClick={() => setShowLightning(false)} aria-label="&#xB2EB;&#xAE30;">&times;</button></header>
        <div className="lightning-time-row"><label htmlFor="lightning-start">&#xC2DC;&#xC791; &#xC2DC;&#xAC04;<input id="lightning-start" type="time" value={lightningStart} onChange={(event) => setLightningStart(event.target.value)} /></label><label htmlFor="lightning-end">&#xC885;&#xB8CC; &#xC2DC;&#xAC04;<input id="lightning-end" type="time" value={lightningEnd} onChange={(event) => setLightningEnd(event.target.value)} /></label></div>
        <label className="diary-field-label" htmlFor="lightning-title">&#xC774;&#xB984; <span className="lightning-required-mark" aria-label="Required">*</span></label><input id="lightning-title" className="diary-select" value={lightningTitle} onChange={(event) => { setLightningTitle(event.target.value); if (event.target.value.trim()) setLightningTitleError(false); }} maxLength={120} placeholder="&#xD568;&#xAED8;&#xD55C; &#xB9CC;&#xB0A8;" />{lightningTitleError && <p className="lightning-field-error">&#xC774;&#xB984;&#xC744; &#xC785;&#xB825;&#xD574; &#xC8FC;&#xC138;&#xC694;.</p>}
        <label className="diary-field-label" htmlFor="lightning-location">&#xC7A5;&#xC18C; <span className="lightning-optional-label">(&#xC120;&#xD0DD;)</span></label><div className="lightning-place-row"><input id="lightning-location" className="diary-select" value={lightningLocation} onChange={(event) => { setLightningLocation(event.target.value); setLightningLocationAddress(""); setLightningSelectedPlace(null); }} maxLength={200} placeholder="&#xC7A5;&#xC18C;&#xB97C; &#xC785;&#xB825;&#xD574; &#xC8FC;&#xC138;&#xC694;" /><button type="button" className="lightning-place-button" onClick={() => setShowLightningPlacePicker(true)}>지도에서 선택</button></div>
        <fieldset className="lightning-members"><legend>&#xAC19;&#xC774; &#xB9CC;&#xB09C; &#xC0AC;&#xB78C; <span className="lightning-optional-label">(&#xC120;&#xD0DD;)</span></legend><p className="lightning-participant-hint">선택하지 않으면 나 혼자 만난 기록으로 저장돼요.</p><div className="lightning-member-options">{participants.filter((participant) => String(participant.userid || "") !== authUserId).map((participant, index) => { const userId = String(participant.userid || ""); const selected = lightningParticipantIds.includes(userId); return <button type="button" key={userId || participant.id || index} className={`lightning-member-option ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => userId && userId !== authUserId && toggleLightningParticipant(userId)} disabled={!userId}><span className="lightning-member-avatar">{participant.profiles?.profileimageurl ? <img src={participant.profiles.profileimageurl} alt="" /> : participant.nickname?.trim()?.slice(0, 1) || "?"}</span><span>{participant.nickname || "Member"}</span>{selected && <b aria-hidden="true">&#x2713;</b>}</button>; })}</div></fieldset>
        {error && <p className="diary-error">{error}</p>}<button type="submit" className="diary-publish-button" disabled={savingLightning || !selectedDate}>{savingLightning ? "\uB4F1\uB85D\uC911..." : "\uAE30\uB85D\uD558\uAE30"}</button>
        </>}
      </form></div>}
    </main>
  );
}

function ReminderField({ id, form, setForm }) {
  return <>
    <label className="diary-field-label" htmlFor={id}>알림</label>
    <select id={id} className="diary-select room-form-select" value={form.reminder} onChange={(e) => setForm({ ...form, reminder: e.target.value })}>
      {REMINDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {form.reminder === "custom" && <div className="room-reminder-custom">
      <input type="number" min="1" className="diary-select" aria-label="알림 시간" value={form.customReminderValue} onChange={(e) => setForm({ ...form, customReminderValue: e.target.value })} />
      <select className="diary-select room-form-select" aria-label="알림 단위" value={form.customReminderUnit} onChange={(e) => setForm({ ...form, customReminderUnit: e.target.value })}>
        <option value="min">분 전</option>
        <option value="hour">시간 전</option>
        <option value="day">일 전</option>
      </select>
    </div>}
  </>;
}

function meetingForDiary(diary, meetings) { return meetings.find((meeting) => meeting.id === diary.meeting_id); }

function CalendarDayThumbnail({ src }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) return null;
  return <img className="room-calendar-day-cover" src={src} alt="&#xC774; &#xB0A0;&#xC9DC;&#xC758; &#xAE30;&#xB85D; &#xC0AC;&#xC9C4;" onError={() => setFailed(true)} />;
}

export default RoomCalendarTab;
