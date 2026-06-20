import { FaCalendarAlt, FaClock, FaMapMarkerAlt, FaBell } from "react-icons/fa";
import { getTodayStr } from "../utils/scheduleUtils";

const isValidReminder = (value) => {
  if (value === null || value === undefined || value === "" || isNaN(value)) return false;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0;
};

function getTimeUntil(date, starttime) {
  if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  
  const today = getTodayStr();
  if (date === today) return "오늘 약속";

  const target = new Date(`${date}T${starttime || "00:00:00"}`);
  if (isNaN(target.getTime())) return null;

  const diff = target - new Date();
  if (diff < 0) return "지난 일정";

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}일 ${hours}시간 전`;
  if (hours > 0) return `${hours}시간 ${minutes}분 전`;

  return `${minutes}분 전`;
}

function formatDateDisplay(dateStr) {
  if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${y}.${m}.${d} (${days[date.getDay()]})`;
}

function ConfirmedScheduleCard({ schedule, onClick, actions }) {
  const dateLabel = formatDateDisplay(schedule.date);
  const timeLabel = schedule.isallday
    ? "하루종일"
    : `${schedule.starttime ?? ""} ~${
        schedule.endtime ? ` ${schedule.endtime}` : ""
      }`;

  const timeUntil = getTimeUntil(schedule.date, schedule.starttime);
  
  // 알림 표시 여부 결정
  // 1. timeUntil이 정상 계산되어야 함 (startTime, date 기반)
  // 2. prompt에서 언급된 필드들이 있다면 유효성 검사 (null, undefined, NaN, 빈 문자열 방지)
  const isTimeValid = (val) => val !== null && val !== undefined && val !== "" && !Number.isNaN(val);
  
  const showReminder = 
    timeUntil !== null && 
    isTimeValid(schedule.date) && 
    (schedule.isallday || isTimeValid(schedule.starttime));

  return (
    <div
      onClick={onClick}
      style={{
        padding: "16px",
        marginBottom: "12px",
        borderRadius: "16px",
        cursor: "pointer",
        backgroundColor: "#FFFFFF",
        width: "100%",
        boxSizing: "border-box",
        boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
        border: "1px solid #E5E7EB",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {/* 왼쪽 아이콘 영역 */}
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "12px",
            backgroundColor: "#F0ECFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#7C5CFF",
            flexShrink: 0,
          }}
        >
          {schedule.isallday ? <FaCalendarAlt size={18} /> : <FaClock size={18} />}
        </div>

        {/* 중앙 정보 영역 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
            <p
              style={{
                margin: 0,
                fontWeight: "700",
                color: "#1F2933",
                fontSize: "15px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {schedule.title || "일정 미정"}
              {schedule.isAbsent && (
                <span
                  style={{
                    marginLeft: "6px",
                    fontSize: "10px",
                    color: "#6B7280",
                    backgroundColor: "#F3F4F6",
                    borderRadius: "4px",
                    padding: "2px 6px",
                    fontWeight: "500",
                    verticalAlign: "middle",
                  }}
                >
                  불참
                </span>
              )}
            </p>
          </div>
          <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#6B7280" }}>
            {dateLabel}{dateLabel && timeLabel ? " · " : ""}{timeLabel}
          </p>
        </div>
      </div>

      {/* 구분선 */}
      <div style={{ height: "1px", backgroundColor: "#F3F4F6", margin: "0 -4px" }} />

      {/* 하단 정보 영역 */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", color: schedule.location ? "#4B5563" : "#9CA3AF", flex: 1, minWidth: 0 }}>
          <FaMapMarkerAlt size={12} color={schedule.location ? "#7C5CFF" : "#9CA3AF"} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {schedule.location || "장소 미정"}
          </span>
        </div>
        
        {showReminder && (
          <>
            <div style={{ width: "1px", height: "12px", backgroundColor: "#E5E7EB" }} />
            <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#F59E0B", fontWeight: "500" }}>
              <FaBell size={12} />
              <span>{timeUntil} 알림</span>
            </div>
          </>
        )}
      </div>

      {schedule.additionalLocations && schedule.additionalLocations.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "-4px" }}>
          {schedule.additionalLocations.map((place) => (
            <span
              key={place.id}
              style={{
                fontSize: "11px",
                backgroundColor: "#F9FAFB",
                color: "#6B7280",
                padding: "2px 8px",
                borderRadius: "6px",
                border: "1px solid #E5E7EB",
              }}
            >
              #{place.placename}
            </span>
          ))}
        </div>
      )}

      {actions && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{ display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}


export default ConfirmedScheduleCard;
