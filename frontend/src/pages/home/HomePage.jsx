import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  getAdditionalConfirmedLocations,
  getMyConfirmedSchedules,
} from "../../api/scheduleApi";
import RoomListPage from "../room/RoomListPage";

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTimeUntil(date, starttime) {
  const today = getTodayStr();
  if (date === today) return "오늘 약속입니다";
  const target = new Date(`${date}T${starttime || "00:00:00"}`);
  const diff = target - new Date();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `일정 ${days}일 ${hours}시간 전입니다`;
  if (hours > 0) return `일정 ${hours}시간 ${minutes}분 전입니다`;
  return `일정 ${minutes}분 전입니다`;
}

function HomePage() {
  const navigate = useNavigate();
  const [confirmedSchedules, setConfirmedSchedules] = useState([]);

  useEffect(() => {
    const fetchSchedules = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      try {
        const data = await getMyConfirmedSchedules(user.id, {
          includeLocationOnly: true,
        });
        const additionalLocationEntries = await Promise.all(
          [...new Set(data.map((schedule) => schedule.roomid))].map(async (roomid) => [
            roomid,
            await getAdditionalConfirmedLocations(roomid),
          ])
        );
        const additionalLocationMap = new Map(additionalLocationEntries);
        setConfirmedSchedules(
          data.map((schedule) => ({
            ...schedule,
            additionalLocations: additionalLocationMap.get(schedule.roomid) || [],
          }))
        );
      } catch (error) {
        console.error("확정 일정 조회 실패:", error);
      }
    };
    fetchSchedules();
  }, []);

  return (
    <div className="home-container">
      <h1>홈</h1>

      <div style={{ marginBottom: "20px" }}>
        <h3 style={{ marginBottom: "8px" }}>확정된 일정</h3>
        {confirmedSchedules.filter((s) => !s.date || s.date >= getTodayStr()).length === 0 ? (
          <p style={{ color: "#aaa", fontSize: "14px" }}>확정된 일정이 없습니다</p>
        ) : (
          confirmedSchedules.filter((s) => !s.date || s.date >= getTodayStr()).map((s) => {
            const dateLabel = !s.date
              ? null
              : s.isallday
              ? `${s.date} (하루종일)`
              : `${s.date} ${s.starttime ?? ""} ~${s.endtime ? ` ${s.endtime}` : ""}`;
            return (
              <div
                key={s.id}
                onClick={() => navigate("/confirmed-schedule", { state: { schedule: s } })}
                style={{
                  padding: "12px 14px", marginBottom: "8px",
                  border: "1px solid #e0e0ff", borderRadius: "12px",
                  cursor: "pointer", backgroundColor: "#f9f9ff",
                }}
              >
                <p style={{ margin: 0, fontSize: "13px", color: "#888" }}>{s.roomname}</p>
                <p style={{ margin: "4px 0 0", fontWeight: "bold" }}>{s.title || dateLabel || "일정 미정"}</p>
                {dateLabel
                  ? <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#666" }}>{dateLabel}</p>
                  : <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#aaa" }}>일정 미정</p>
                }
                {s.date && (
                  <p style={{ margin: "4px 0 0", fontSize: "12px", color: s.date === getTodayStr() ? "#7c79ff" : "#f90", fontWeight: s.date === getTodayStr() ? "bold" : "normal" }}>
                    {getTimeUntil(s.date, s.starttime)}
                  </p>
                )}
                {s.location
                  ? <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#7c79ff" }}>📍 {s.location}</p>
                  : <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#aaa" }}>위치 미정 (탭하여 설정)</p>
                }
                {s.additionalLocations?.map((place) => (
                  <p key={place.id} style={{ margin: "4px 0 0", fontSize: "13px", color: "#666" }}>
                    추가장소: {place.placename}
                  </p>
                ))}
              </div>
            );
          })
        )}
      </div>

      <RoomListPage />

      <button onClick={() => navigate("/rooms/create")}>방 만들기</button>
      <button onClick={() => navigate("/rooms/invite")}>초대코드 입력하기</button>
    </div>
  );
}

export default HomePage;
