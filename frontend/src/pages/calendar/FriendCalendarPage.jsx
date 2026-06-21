import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(year, month, day) { return `${year}-${pad(month + 1)}-${pad(day)}`; }

function FriendCalendarPage() {
  const navigate = useNavigate();
  const { friendId } = useParams();
  const location = useLocation();
  const nicknameFromState = location.state?.nickname;

  const today = new Date();
  const [current, setCurrent] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [nickname, setNickname] = useState(nicknameFromState || "");
  const [events, setEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [confirmedSchedules, setConfirmedSchedules] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const touchStartX = useRef(null);

  const { year, month } = current;

  useEffect(() => {
    const load = async () => {
      if (!nicknameFromState) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("nickname")
          .eq("id", friendId)
          .single();
        if (profile) setNickname(profile.nickname);
      }

      const [{ data: personalData }, { data: googleData }, { data: memberships }] = await Promise.all([
        supabase.from("personal_events").select("*").eq("userid", friendId),
        supabase.from("google_events").select("*").eq("userid", friendId),
        supabase.from("room_members").select("roomid, rooms(roomname)").eq("userid", friendId),
      ]);

      setEvents(personalData || []);
      setGoogleEvents(googleData || []);

      if (memberships && memberships.length > 0) {
        const roomIds = memberships.map((m) => m.roomid);
        const { data: scheduleData } = await supabase
          .from("confirmed_schedules")
          .select("*")
          .in("roomid", roomIds)
          .order("date", { ascending: true });

        const schedules = (scheduleData || []).map((s) => {
          const m = memberships.find((mb) => mb.roomid === s.roomid);
          return { ...s, roomname: m?.rooms?.roomname || "" };
        });
        setConfirmedSchedules(schedules);
      }
    };
    load();
  }, [friendId, nicknameFromState]);

  const eventMap = {};
  events.forEach((e) => {
    const start = new Date(e.date + "T00:00:00");
    const end = e.enddate ? new Date(e.enddate + "T00:00:00") : start;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (!eventMap[key]) eventMap[key] = [];
      eventMap[key].push({ ...e, isGoogle: false });
    }
  });
  googleEvents.forEach((e) => {
    if (!eventMap[e.date]) eventMap[e.date] = [];
    eventMap[e.date].push({ ...e, isGoogle: true });
  });
  const confirmedMap = {};
  confirmedSchedules.forEach((s) => {
    if (!confirmedMap[s.date]) confirmedMap[s.date] = [];
    confirmedMap[s.date].push(s);
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

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const selectedKey = selectedDay ? dateKey(year, month, selectedDay) : null;
  const selectedEvents = selectedKey ? (eventMap[selectedKey] || []) : [];
  const selectedConfirmed = selectedKey ? (confirmedMap[selectedKey] || []) : [];

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-color)", color: "var(--text-color)", paddingBottom: "80px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderBottom: "1px solid var(--border-color)" }}>
        <button
          onClick={() => navigate(-1)}
          style={{ border: "none", background: "none", fontSize: "22px", cursor: "pointer", color: "var(--secondary-text)", padding: 0 }}
        >
          ‹
        </button>
        <span style={{ fontSize: "17px", fontWeight: "bold" }}>
          {nickname ? `${nickname}님의 캘린더` : "캘린더"}
        </span>
      </div>

      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 20px" }}>
        <button onClick={prevMonth} style={{ border: "none", background: "none", fontSize: "24px", cursor: "pointer", color: "var(--secondary-text)" }}>‹</button>
        <span style={{ fontSize: "17px", fontWeight: "bold", margin: "0 12px" }}>{year}년 {month + 1}월</span>
        <button onClick={nextMonth} style={{ border: "none", background: "none", fontSize: "24px", cursor: "pointer", color: "var(--secondary-text)" }}>›</button>
      </div>

      {/* Weekday row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "4px 4px 4px" }}>
        {WEEKDAYS.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: "12px", fontWeight: "bold", color: i === 0 ? "#f44" : i === 6 ? "#7c79ff" : "#888" }}>{d}</div>
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
          const dayEvents = key ? (eventMap[key] || []) : [];
          const dayConfirmed = key ? (confirmedMap[key] || []) : [];
          const isSun = col === 0;
          const isSat = col === 6;
          const isSelected = selectedDay === d;
          const textColor = isToday(d) ? "#fff" : isSun ? "#f44" : isSat ? "#7c79ff" : "var(--text-color)";

          return (
            <div
              key={i}
              onClick={() => d && setSelectedDay(isSelected ? null : d)}
              style={{ minHeight: "60px", padding: "4px 2px", display: "flex", flexDirection: "column", alignItems: "center", cursor: d ? "pointer" : "default", backgroundColor: isSelected ? "color-mix(in srgb, var(--accent-color) 18%, var(--card-bg))" : "transparent", borderRadius: "8px" }}
            >
              {d && (
                <>
                  <div style={{ width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", backgroundColor: isToday(d) ? "#7c79ff" : "transparent", color: textColor, fontSize: "13px", fontWeight: isToday(d) ? "bold" : "normal" }}>
                    {d}
                  </div>
                  <div style={{ display: "flex", gap: "2px", marginTop: "2px", flexWrap: "wrap", justifyContent: "center" }}>
                    {dayConfirmed.slice(0, 1).map((_, ci) => (
                      <div key={`c${ci}`} style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#7c79ff" }} />
                    ))}
                    {dayEvents.slice(0, 2).map((e, ei) => (
                      <div key={`e${ei}`} style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: e.isGoogle ? "#4285F4" : (e.color || "#f90") }} />
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selectedDay && (selectedEvents.length > 0 || selectedConfirmed.length > 0) && (
        <div style={{ margin: "12px 16px", padding: "14px", backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: "12px" }}>
          <p style={{ margin: "0 0 8px", fontWeight: "bold", fontSize: "14px", color: "var(--text-color)" }}>{month + 1}월 {selectedDay}일</p>
          {selectedConfirmed.map((s, i) => (
            <div key={`sc${i}`} style={{ margin: "4px 0 0", fontSize: "13px", color: "#7c79ff", display: "flex", alignItems: "flex-start", gap: "4px" }}>
              <span>📌</span>
              <div>
                <span style={{ fontWeight: "500" }}>{s.title || s.date}</span>
                {!s.isallday && s.starttime && <span style={{ color: "var(--secondary-text)", marginLeft: "6px" }}>{s.starttime}{s.endtime ? ` ~ ${s.endtime}` : ""}</span>}
                {s.isallday && <span style={{ color: "var(--secondary-text)", marginLeft: "6px" }}>(하루종일)</span>}
                {s.roomname && <span style={{ color: "var(--secondary-text)", fontSize: "12px", marginLeft: "4px" }}>· {s.roomname}</span>}
              </div>
            </div>
          ))}
          {selectedEvents.map((e, i) => (
            <div key={i} style={{ margin: "4px 0 0", fontSize: "13px", color: e.isGoogle ? "#4285F4" : (e.color || "#f90"), display: "flex", alignItems: "flex-start", gap: "4px" }}>
              <span>{e.isGoogle ? "📅" : "●"}</span>
              <div>
                <span style={{ fontWeight: "500" }}>{e.title}</span>
                {!e.isallday && e.starttime && <span style={{ color: "var(--secondary-text)", marginLeft: "6px" }}>{e.starttime}{e.endtime ? ` ~ ${e.endtime}` : ""}</span>}
                {e.isallday && <span style={{ color: "var(--secondary-text)", marginLeft: "6px" }}>(하루종일)</span>}
                {e.location && <div style={{ fontSize: "12px", color: "var(--secondary-text)" }}>📍 {e.location}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FriendCalendarPage;
