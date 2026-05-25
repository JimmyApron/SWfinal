import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";
import { getMyConfirmedSchedules } from "../../api/scheduleApi";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

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
    console.log("공휴일 API 응답:", json);
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
      result[dateStr] = { name: item.dateName, public: item.isHoliday === "Y" };
    });
    holidayCache[cacheKey] = result;
    return result;
  } catch (e) {
    console.error("공휴일 API 오류:", e);
    holidayCache[cacheKey] = {};
    return {};
  }
}

function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(year, month, day) { return `${year}-${pad(month + 1)}-${pad(day)}`; }

function CalendarPage() {
  const today = new Date();
  const [current, setCurrent] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [showPicker, setShowPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(today.getFullYear());
  const [schedules, setSchedules] = useState([]);
  const [holidays, setHolidays] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const touchStartX = useRef(null);

  const { year, month } = current;

  // 공휴일 로드
  useEffect(() => {
    fetchHolidays(year, month).then(setHolidays);
  }, [year, month]);

  // 확정 일정 로드
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      try {
        const data = await getMyConfirmedSchedules(user.id);
        setSchedules(data);
      } catch {}
    };
    load();
  }, []);

  const scheduleMap = {};
  schedules.forEach((s) => {
    if (!scheduleMap[s.date]) scheduleMap[s.date] = [];
    scheduleMap[s.date].push(s);
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

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) diff > 0 ? nextMonth() : prevMonth();
    touchStartX.current = null;
  };

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const selectedSchedules = selectedDay ? (scheduleMap[dateKey(year, month, selectedDay)] || []) : [];
  const selectedHoliday = selectedDay ? holidays[dateKey(year, month, selectedDay)] : null;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff", paddingBottom: "80px" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 20px", borderBottom: "1px solid #eee",
      }}>
        <button onClick={prevMonth} style={{ border: "none", background: "none", fontSize: "24px", cursor: "pointer", color: "#555" }}>‹</button>
        <button
          onClick={() => { setPickerYear(year); setShowPicker(true); }}
          style={{ border: "none", background: "none", fontSize: "18px", fontWeight: "bold", cursor: "pointer" }}
        >
          {year}년 {month + 1}월
        </button>
        <button onClick={nextMonth} style={{ border: "none", background: "none", fontSize: "24px", cursor: "pointer", color: "#555" }}>›</button>
      </div>

      {/* Weekday row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "8px 4px 4px" }}>
        {WEEKDAYS.map((d, i) => (
          <div key={d} style={{
            textAlign: "center", fontSize: "12px", fontWeight: "bold",
            color: i === 0 ? "#f44" : i === 6 ? "#7c79ff" : "#888",
          }}>{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 2px" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {cells.map((d, i) => {
          const col = i % 7;
          const key = d ? dateKey(year, month, d) : null;
          const holiday = key ? holidays[key] : null;
          const daySchedules = key ? (scheduleMap[key] || []) : [];
          const isSun = col === 0;
          const isSat = col === 6;
          const isSelected = selectedDay === d;

          const textColor = isToday(d)
            ? "#fff"
            : (holiday?.public || isSun) ? "#f44"
            : isSat ? "#7c79ff"
            : "#222";

          return (
            <div
              key={i}
              onClick={() => d && setSelectedDay(isSelected ? null : d)}
              style={{
                minHeight: "60px", padding: "4px 2px",
                display: "flex", flexDirection: "column", alignItems: "center",
                cursor: d ? "pointer" : "default",
                backgroundColor: isSelected ? "#f0f0ff" : "transparent",
                borderRadius: "8px",
              }}
            >
              {d && (
                <>
                  <div style={{
                    width: "28px", height: "28px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: "50%",
                    backgroundColor: isToday(d) ? "#7c79ff" : "transparent",
                    color: textColor,
                    fontSize: "13px",
                    fontWeight: isToday(d) ? "bold" : "normal",
                  }}>
                    {d}
                  </div>
                  {holiday && (
                    <p style={{
                      margin: "1px 0 0", fontSize: "9px", lineHeight: 1.2,
                      color: holiday.public ? "#f44" : "#f90",
                      textAlign: "center", wordBreak: "keep-all",
                      maxWidth: "100%", overflow: "hidden",
                    }}>
                      {holiday.name}
                    </p>
                  )}
                  {daySchedules.length > 0 && (
                    <div style={{ display: "flex", gap: "2px", marginTop: "2px", flexWrap: "wrap", justifyContent: "center" }}>
                      {daySchedules.slice(0, 3).map((_, si) => (
                        <div key={si} style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#7c79ff" }} />
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
      {selectedDay && (selectedHoliday || selectedSchedules.length > 0) && (
        <div style={{ margin: "12px 16px", padding: "14px", backgroundColor: "#f9f9ff", borderRadius: "12px" }}>
          <p style={{ margin: "0 0 8px", fontWeight: "bold", fontSize: "14px", color: "#555" }}>
            {month + 1}월 {selectedDay}일
          </p>
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
        </div>
      )}

      {/* Year/Month picker modal */}
      {showPicker && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
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
                  <button
                    key={i}
                    onClick={() => { setCurrent({ year: pickerYear, month: i }); setSelectedDay(null); setShowPicker(false); }}
                    style={{
                      padding: "10px 0", borderRadius: "10px", fontSize: "14px", cursor: "pointer",
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
              style={{ width: "100%", marginTop: "16px", padding: "12px", border: "none", borderRadius: "10px", backgroundColor: "#f5f5f5", fontSize: "15px", cursor: "pointer" }}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CalendarPage;
