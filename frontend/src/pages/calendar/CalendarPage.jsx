import { useState, useRef, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { getMyConfirmedSchedules } from "../../api/scheduleApi";
import { getPersonalEvents, createPersonalEvent, updatePersonalEvent, deletePersonalEvent } from "../../api/personalEventApi";
import { addEventToGoogleCalendar } from "../../api/googleCalendarApi";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
const PRESET_COLORS = ["#7c79ff","#4285F4","#f44","#f90","#4CAF50","#e91e63","#9c27b0","#00bcd4"];
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
    if (!raw) { holidayCache[cacheKey] = {}; return {}; }
    const items = Array.isArray(raw) ? raw : [raw];
    const result = {};
    items.forEach((item) => {
      const d = String(item.locdate);
      const dateStr = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      result[dateStr] = { name: item.dateName, public: item.isHoliday === "Y" };
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
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=100`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(year, month, day) { return `${year}-${pad(month + 1)}-${pad(day)}`; }

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
  const today = new Date();
  const [current, setCurrent] = useState({ year: today.getFullYear(), month: today.getMonth() });
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
  const [skipEnabled, setSkipEnabled] = useState(localStorage.getItem('notif_skip_enabled') === 'true');
  const [skipHoliday, setSkipHoliday] = useState(localStorage.getItem('notif_skip_holiday') !== 'false');
  const [skipAltHoliday, setSkipAltHoliday] = useState(localStorage.getItem('notif_skip_alt_holiday') !== 'false');
  const [skipSaturday, setSkipSaturday] = useState(localStorage.getItem('notif_skip_saturday') !== 'false');
  const [skipSunday, setSkipSunday] = useState(localStorage.getItem('notif_skip_sunday') !== 'false');

  const toggleSkip = (key, value, setter) => {
    const next = !value;
    localStorage.setItem(key, String(next));
    setter(next);
  };
  const touchStartX = useRef(null);

  const { year, month } = current;

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUser(user));
  }, []);

  useEffect(() => {
    fetchHolidays(year, month).then(setHolidays);
  }, [year, month]);

  useEffect(() => {
    if (!currentUser) return;
    getMyConfirmedSchedules(currentUser.id).then(setSchedules).catch(() => {});
    getPersonalEvents(currentUser.id).then(setPersonalEvents).catch(() => {});
  }, [currentUser]);

  useEffect(() => {
    fetchGoogleCalendarEvents(year, month).then(setGoogleEvents);
  }, [year, month]);

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
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    setCurrent(({ year: y, month: m }) => m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 });
  };
  const nextMonth = () => {
    setSelectedDay(null);
    setCurrent(({ year: y, month: m }) => m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 });
  };

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) diff > 0 ? nextMonth() : prevMonth();
    touchStartX.current = null;
  };

  const openCreateForm = (dateStr) => {
    setEditingEvent(null);
    setForm({ ...EMPTY_FORM, startdate: dateStr || "", enddate: dateStr || "" });
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
    if (!form.title.trim()) { alert("제목을 입력하세요."); return; }
    if (!form.startdate) { alert("날짜를 선택하세요."); return; }
    if (form.enddate && form.enddate < form.startdate) { alert("종료 날짜가 시작 날짜보다 앞일 수 없습니다."); return; }
    setSaving(true);
    try {
      let reminderValue = form.reminder;
      if (form.reminder === "custom") {
        const multiplier = form.customReminderUnit === "min" ? 1 : form.customReminderUnit === "hour" ? 60 : 1440;
        reminderValue = String(Number(form.customReminderValue) * multiplier);
      }
      const payload = {
        title: form.title.trim(),
        color: form.color,
        isallday: form.isallday,
        date: form.startdate,
        enddate: form.enddate && form.enddate !== form.startdate ? form.enddate : null,
        starttime: form.isallday ? null : (form.starttime || null),
        endtime: form.isallday ? null : (form.endtime || null),
        location: form.location.trim() || null,
        reminder: reminderValue,
        repeat: form.repeat,
        memo: form.memo.trim() || null,
      };
      if (editingEvent) {
        await updatePersonalEvent(editingEvent.id, payload);
        setPersonalEvents((prev) => prev.map((e) => e.id === editingEvent.id ? { ...e, ...payload } : e));
      } else {
        await createPersonalEvent({ ...payload, userid: currentUser.id });
        const updated = await getPersonalEvents(currentUser.id);
        setPersonalEvents(updated);
        if (localStorage.getItem("google_calendar_auto_sync") === "true") {
          try {
            await addEventToGoogleCalendar({ title: payload.title, date: payload.date, starttime: payload.starttime, endtime: payload.endtime });
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
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const selectedKey = selectedDay ? dateKey(year, month, selectedDay) : null;
  const selectedSchedules = selectedKey ? (scheduleMap[selectedKey] || []) : [];
  const selectedPersonal = selectedKey ? (personalMap[selectedKey] || []) : [];
  const selectedGoogle = selectedKey ? (googleMap[selectedKey] || []) : [];
  const selectedHoliday = selectedKey ? holidays[selectedKey] : null;
  const hasSelectedContent = selectedHoliday || selectedSchedules.length > 0 || selectedPersonal.length > 0 || selectedGoogle.length > 0;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff", paddingBottom: "80px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #eee" }}>
        <button onClick={prevMonth} style={{ border: "none", background: "none", fontSize: "24px", cursor: "pointer", color: "#555" }}>‹</button>
        <button onClick={() => { setPickerYear(year); setShowPicker(true); }} style={{ border: "none", background: "none", fontSize: "18px", fontWeight: "bold", cursor: "pointer" }}>
          {year}년 {month + 1}월
        </button>
        <button onClick={nextMonth} style={{ border: "none", background: "none", fontSize: "24px", cursor: "pointer", color: "#555" }}>›</button>
      </div>

      {/* Weekday row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "8px 4px 4px" }}>
        {WEEKDAYS.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: "12px", fontWeight: "bold", color: i === 0 ? "#f44" : i === 6 ? "#7c79ff" : "#888" }}>{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 2px" }} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {cells.map((d, i) => {
          const col = i % 7;
          const key = d ? dateKey(year, month, d) : null;
          const holiday = key ? holidays[key] : null;
          const daySchedules = key ? (scheduleMap[key] || []) : [];
          const dayPersonal = key ? (personalMap[key] || []) : [];
          const dayGoogle = key ? (googleMap[key] || []) : [];
          const isSun = col === 0;
          const isSat = col === 6;
          const isSelected = selectedDay === d;
          const textColor = isToday(d) ? "#fff" : (holiday?.public || isSun) ? "#f44" : isSat ? "#7c79ff" : "#222";

          return (
            <div
              key={i}
              onClick={() => d && setSelectedDay(isSelected ? null : d)}
              style={{ minHeight: "60px", padding: "4px 2px", display: "flex", flexDirection: "column", alignItems: "center", cursor: d ? "pointer" : "default", backgroundColor: isSelected ? "#f0f0ff" : "transparent", borderRadius: "8px" }}
            >
              {d && (
                <>
                  <div style={{ width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", backgroundColor: isToday(d) ? "#7c79ff" : "transparent", color: textColor, fontSize: "13px", fontWeight: isToday(d) ? "bold" : "normal" }}>
                    {d}
                  </div>
                  {holiday && (
                    <p style={{ margin: "1px 0 0", fontSize: "9px", lineHeight: 1.2, color: holiday.public ? "#f44" : "#f90", textAlign: "center", wordBreak: "keep-all", maxWidth: "100%", overflow: "hidden" }}>
                      {holiday.name}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "2px", marginTop: "2px", flexWrap: "wrap", justifyContent: "center" }}>
                    {daySchedules.slice(0, 1).map((_, si) => (
                      <div key={`s${si}`} style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#7c79ff" }} />
                    ))}
                    {dayPersonal.slice(0, 2).map((e, pi) => (
                      <div key={`p${pi}`} style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: e.color || "#7c79ff" }} />
                    ))}
                    {dayGoogle.slice(0, 1).map((_, gi) => (
                      <div key={`g${gi}`} style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#4285F4" }} />
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
        <div style={{ margin: "12px 16px", padding: "14px", backgroundColor: "#f9f9ff", borderRadius: "12px" }}>
          <p style={{ margin: "0 0 8px", fontWeight: "bold", fontSize: "14px", color: "#555" }}>{month + 1}월 {selectedDay}일</p>
          {selectedHoliday && (
            <p style={{ margin: "0 0 6px", fontSize: "13px", color: selectedHoliday.public ? "#f44" : "#f90" }}>
              {selectedHoliday.public ? "🎌" : "📅"} {selectedHoliday.name}
            </p>
          )}
          {selectedSchedules.map((s) => (
            <p key={s.id} style={{ margin: "4px 0 0", fontSize: "13px", color: "#7c79ff" }}>
              📌 {s.title || s.date} {s.starttime ? `${s.starttime} ~${s.endtime ? ` ${s.endtime}` : ""}` : "(하루종일)"}
              {s.roomname && <span style={{ color: "#aaa", fontSize: "12px" }}> · {s.roomname}</span>}
            </p>
          ))}
          {selectedPersonal.map((e) => (
            <div key={e.id} onClick={() => openEditForm(e)} style={{ margin: "4px 0 0", fontSize: "13px", color: e.color, cursor: "pointer", display: "flex", alignItems: "flex-start", gap: "4px" }}>
              <span>●</span>
              <div>
                <span style={{ fontWeight: "500" }}>{e.title}</span>
                {!e.isallday && e.starttime && <span style={{ color: "#888", marginLeft: "6px" }}>{e.starttime}{e.endtime ? ` ~ ${e.endtime}` : ""}</span>}
                {e.isallday && <span style={{ color: "#aaa", marginLeft: "6px" }}>(하루종일)</span>}
                {e.location && <div style={{ fontSize: "12px", color: "#aaa" }}>📍 {e.location}</div>}
                {e.memo && <div style={{ fontSize: "12px", color: "#aaa" }}>{e.memo}</div>}
              </div>
            </div>
          ))}
          {selectedGoogle.map((e) => (
            <p key={e.id} style={{ margin: "4px 0 0", fontSize: "13px", color: "#4285F4" }}>
              📅 {e.title} {e.starttime ? `${e.starttime} ~${e.endtime ? ` ${e.endtime}` : ""}` : "(하루종일)"}
            </p>
          ))}
        </div>
      )}

      {/* + FAB */}
      <button
        onClick={() => openCreateForm(selectedDay ? dateKey(year, month, selectedDay) : "")}
        style={{ position: "fixed", bottom: "80px", right: "20px", width: "52px", height: "52px", borderRadius: "50%", backgroundColor: "#7c79ff", color: "#fff", border: "none", fontSize: "28px", cursor: "pointer", boxShadow: "0 4px 12px rgba(124,121,255,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        +
      </button>

      {/* Year/Month picker modal */}
      {showPicker && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "24px", width: "300px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <button onClick={() => setPickerYear((y) => y - 1)} style={{ border: "none", background: "none", fontSize: "22px", cursor: "pointer" }}>‹</button>
              <span style={{ fontSize: "18px", fontWeight: "bold" }}>{pickerYear}년</span>
              <button onClick={() => setPickerYear((y) => y + 1)} style={{ border: "none", background: "none", fontSize: "22px", cursor: "pointer" }}>›</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
              {MONTHS.map((label, i) => {
                const selected = pickerYear === year && i === month;
                return (
                  <button key={i} onClick={() => { setCurrent({ year: pickerYear, month: i }); setSelectedDay(null); setShowPicker(false); }}
                    style={{ padding: "10px 0", borderRadius: "10px", fontSize: "14px", cursor: "pointer", border: selected ? "2px solid #7c79ff" : "1px solid #eee", backgroundColor: selected ? "#f0f0ff" : "#fff", color: selected ? "#7c79ff" : "#333", fontWeight: selected ? "bold" : "normal" }}>
                    {label}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setShowPicker(false)} style={{ width: "100%", marginTop: "16px", padding: "12px", border: "none", borderRadius: "10px", backgroundColor: "#f5f5f5", fontSize: "15px", cursor: "pointer" }}>
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Event form modal */}
      {showForm && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ backgroundColor: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxHeight: "90vh", overflowY: "auto", padding: "24px 20px 80px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ margin: 0 }}>{editingEvent ? "일정 수정" : "일정 추가"}</h3>
              <button onClick={() => setShowForm(false)} style={{ border: "none", background: "none", fontSize: "20px", color: "#aaa", cursor: "pointer" }}>✕</button>
            </div>

            {/* 제목 */}
            <input
              placeholder="제목"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              style={{ width: "100%", padding: "12px", fontSize: "16px", border: "none", borderBottom: `2px solid ${form.color}`, outline: "none", boxSizing: "border-box", marginBottom: "16px" }}
            />

            {/* 색상 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "13px", color: "#888" }}>색상</p>
              <div style={{ display: "flex", gap: "10px" }}>
                {PRESET_COLORS.map((c) => (
                  <div key={c} onClick={() => setForm((f) => ({ ...f, color: c }))}
                    style={{ width: "28px", height: "28px", borderRadius: "50%", backgroundColor: c, cursor: "pointer", border: form.color === c ? "3px solid #333" : "3px solid transparent" }} />
                ))}
              </div>
            </div>

            {/* 하루종일 */}
            <label style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", fontSize: "15px" }}>
              <div onClick={() => setForm((f) => ({ ...f, isallday: !f.isallday }))}
                style={{ width: "44px", height: "24px", borderRadius: "12px", cursor: "pointer", backgroundColor: form.isallday ? "#7c79ff" : "#ccc", position: "relative", transition: "background-color 0.2s", flexShrink: 0 }}>
                <div style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "#fff", position: "absolute", top: "2px", left: form.isallday ? "22px" : "2px", transition: "left 0.2s" }} />
              </div>
              하루종일
            </label>

            {/* 날짜 */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>시작 날짜</p>
                <input type="date" value={form.startdate}
                  onChange={(e) => setForm((f) => ({ ...f, startdate: e.target.value, enddate: f.enddate < e.target.value ? e.target.value : f.enddate }))}
                  style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px", boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>종료 날짜</p>
                <input type="date" value={form.enddate} min={form.startdate}
                  onChange={(e) => setForm((f) => ({ ...f, enddate: e.target.value }))}
                  style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px", boxSizing: "border-box" }} />
              </div>
            </div>

            {/* 시간 */}
            {!form.isallday && (
              <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>시작 시간</p>
                  <input type="time" value={form.starttime} onChange={(e) => setForm((f) => ({ ...f, starttime: e.target.value }))}
                    style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>종료 시간</p>
                  <input type="time" value={form.endtime} onChange={(e) => setForm((f) => ({ ...f, endtime: e.target.value }))}
                    style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px", boxSizing: "border-box" }} />
                </div>
              </div>
            )}

            {/* 장소 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>장소</p>
              <input placeholder="장소 입력" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px", boxSizing: "border-box" }} />
            </div>

            {/* 알림 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>알림</p>
              <select value={form.reminder} onChange={(e) => setForm((f) => ({ ...f, reminder: e.target.value }))}
                style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px", backgroundColor: "#fff" }}>
                {REMINDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {form.reminder === "custom" && (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <input
                    type="number" min="1" value={form.customReminderValue}
                    onChange={(e) => setForm((f) => ({ ...f, customReminderValue: e.target.value }))}
                    style={{ flex: 1, padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px" }}
                  />
                  <select value={form.customReminderUnit} onChange={(e) => setForm((f) => ({ ...f, customReminderUnit: e.target.value }))}
                    style={{ flex: 1, padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px", backgroundColor: "#fff" }}>
                    <option value="min">분 전</option>
                    <option value="hour">시간 전</option>
                    <option value="day">일 전</option>
                  </select>
                </div>
              )}
            </div>

            {/* 알림 받지 않는 날 */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontSize: "14px", color: "#333" }}>알림 받지 않는 날 설정</span>
                <div onClick={() => toggleSkip('notif_skip_enabled', skipEnabled, setSkipEnabled)}
                  style={{ width: "44px", height: "24px", borderRadius: "12px", cursor: "pointer", backgroundColor: skipEnabled ? "#7c79ff" : "#ccc", position: "relative", transition: "background-color 0.2s", flexShrink: 0 }}>
                  <div style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "#fff", position: "absolute", top: "2px", left: skipEnabled ? "22px" : "2px", transition: "left 0.2s" }} />
                </div>
              </div>
              {skipEnabled && (
                <div style={{ backgroundColor: "#f9f9ff", borderRadius: "10px", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  {[
                    { label: "공휴일", value: skipHoliday, key: 'notif_skip_holiday', setter: setSkipHoliday },
                    { label: "대체 및 임시 공휴일", value: skipAltHoliday, key: 'notif_skip_alt_holiday', setter: setSkipAltHoliday },
                    { label: "토요일", value: skipSaturday, key: 'notif_skip_saturday', setter: setSkipSaturday },
                    { label: "일요일", value: skipSunday, key: 'notif_skip_sunday', setter: setSkipSunday },
                  ].map(({ label, value, key, setter }) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "14px", color: "#555" }}>{label}</span>
                      <div onClick={() => toggleSkip(key, value, setter)}
                        style={{ width: "44px", height: "24px", borderRadius: "12px", cursor: "pointer", backgroundColor: value ? "#7c79ff" : "#ccc", position: "relative", transition: "background-color 0.2s", flexShrink: 0 }}>
                        <div style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "#fff", position: "absolute", top: "2px", left: value ? "22px" : "2px", transition: "left 0.2s" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 반복 */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>반복</p>
              <select value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value }))}
                style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px", backgroundColor: "#fff" }}>
                {REPEAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* 메모 */}
            <div style={{ marginBottom: "24px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "13px", color: "#888" }}>메모</p>
              <textarea placeholder="메모 입력" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                rows={3}
                style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "15px", boxSizing: "border-box", resize: "none" }} />
            </div>

            <button onClick={handleSave} disabled={saving}
              style={{ width: "100%", padding: "14px", backgroundColor: form.color, color: "#fff", border: "none", borderRadius: "12px", fontSize: "16px", cursor: "pointer", marginBottom: "8px" }}>
              {saving ? "저장 중..." : "저장"}
            </button>

            {editingEvent && (
              <button onClick={() => handleDelete(editingEvent.id)}
                style={{ width: "100%", padding: "12px", backgroundColor: "#fff", color: "#f44", border: "1px solid #f44", borderRadius: "12px", fontSize: "15px", cursor: "pointer" }}>
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
