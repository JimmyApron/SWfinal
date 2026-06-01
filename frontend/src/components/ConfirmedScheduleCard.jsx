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

  if (diff < 0) return "지난 일정입니다";

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `일정 ${days}일 ${hours}시간 전입니다`;
  if (hours > 0) return `일정 ${hours}시간 ${minutes}분 전입니다`;

  return `일정 ${minutes}분 전입니다`;
}

function ConfirmedScheduleCard({ schedule, onClick, actions }) {
  const dateLabel = !schedule.date
    ? null
    : schedule.isallday
    ? `${schedule.date} (하루종일)`
    : `${schedule.date} ${schedule.starttime ?? ""} ~${
        schedule.endtime ? ` ${schedule.endtime}` : ""
      }`;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 14px",
        marginBottom: "8px",
        border: "1px solid var(--card-border)",
        borderRadius: "12px",
        cursor: "pointer",
        backgroundColor: "var(--card-bg)",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <p style={{ margin: 0, fontSize: "12px", color: "var(--secondary-text)" }}>
        {schedule.roomname}
      </p>

      <p style={{ margin: "4px 0 0", fontWeight: "bold", color: "var(--text-color)", fontSize: "15px" }}>
        {schedule.title || dateLabel || "일정 미정"}
        {schedule.isAbsent && (
          <span
            style={{
              marginLeft: "6px",
              fontSize: "11px",
              color: "#fff",
              backgroundColor: "#bbb",
              borderRadius: "4px",
              padding: "1px 5px",
            }}
          >
            불참
          </span>
        )}
      </p>

      <p style={{ margin: "2px 0 0", fontSize: "13px", color: dateLabel ? "var(--text-color)" : "var(--secondary-text)" }}>
        {dateLabel || "일정 미정"}
      </p>

      {schedule.date && (
        <p
          style={{
            margin: "4px 0 0",
            fontSize: "12px",
            color: schedule.date === getTodayStr() ? "var(--accent-color)" : "#f90",
            fontWeight: schedule.date === getTodayStr() ? "bold" : "normal",
          }}
        >
          {getTimeUntil(schedule.date, schedule.starttime)}
        </p>
      )}

      <p
        style={{
          margin: "4px 0 0",
          fontSize: "13px",
          color: schedule.location ? "var(--accent-color)" : "var(--secondary-text)",
        }}
      >
        {schedule.location ? `📍 ${schedule.location}` : "위치 미정 (탭하여 설정)"}
      </p>

      {schedule.additionalLocations?.map((place) => (
        <p key={place.id} style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-color)" }}>
          추가장소: {place.placename}
        </p>
      ))}

      {actions && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

export default ConfirmedScheduleCard;
