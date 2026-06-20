import { useState } from "react";
import DatePicker from "react-multi-date-picker";
import { createRoom } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";

const timeSlots = [];
for (let hour = 0; hour < 24; hour++) {
  for (const minute of [0, 30]) {
    timeSlots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
}

const labelStyle = { fontSize: "13px", fontWeight: "700", color: "#1F2933" };

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #E5E7EB",
  borderRadius: "10px",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const primaryButtonStyle = {
  flex: 1,
  padding: "12px",
  backgroundColor: "#7C5CFF",
  color: "#fff",
  border: "none",
  borderRadius: "10px",
  fontSize: "14px",
  fontWeight: "700",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  flex: 1,
  padding: "12px",
  backgroundColor: "#F5F5F5",
  color: "#333",
  border: "none",
  borderRadius: "10px",
  fontSize: "14px",
  fontWeight: "700",
  cursor: "pointer",
};

function RoomCreateForm({ onCreated, onCancel }) {
  const [roomName, setRoomName] = useState("");
  const [candidateDates, setCandidateDates] = useState([]);
  const [candidateStartTime, setCandidateStartTime] = useState("");
  const [candidateEndTime, setCandidateEndTime] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [saving, setSaving] = useState(false);

  const handleAddCandidate = () => {
    if (candidateDates.length === 0) {
      alert("후보 날짜를 1개 이상 선택하세요.");
      return;
    }

    if (!isAllDay) {
      if (candidateStartTime === "" || candidateEndTime === "") {
        alert("시작 시간과 종료 시간을 입력하세요.");
        return;
      }

      if (candidateStartTime >= candidateEndTime) {
        alert("시작 시간은 종료 시간보다 빨라야 합니다.");
        return;
      }
    }

    const newCandidates = candidateDates.map((date) => ({
      date: typeof date === "string" ? date : date.format("YYYY-MM-DD"),
      startTime: isAllDay ? null : candidateStartTime,
      endTime: isAllDay ? null : candidateEndTime,
      isAllDay,
    }));

    const existingDates = candidates.map((candidate) => candidate.date);
    const duplicatedDate = newCandidates.find((candidate) =>
      existingDates.includes(candidate.date)
    );

    if (duplicatedDate) {
      alert(`${duplicatedDate.date} 날짜는 이미 추가된 후보입니다.`);
      return;
    }

    setCandidates([...candidates, ...newCandidates]);
    setCandidateDates([]);
    setCandidateStartTime("");
    setCandidateEndTime("");
    setIsAllDay(false);
  };

  const handleRemoveCandidate = (index) => {
    setCandidates((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateRoom = async () => {
    if (roomName.trim() === "") {
      alert("방 이름을 입력하세요.");
      return;
    }

    if (candidates.length === 0) {
      alert("약속 후보 날짜를 1개 이상 추가하세요.");
      return;
    }

    try {
      setSaving(true);

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        alert("로그인이 필요합니다.");
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        console.error("프로필 조회 실패:", profileError);
        alert("프로필 정보를 불러오지 못했습니다.");
        return;
      }

      const result = await createRoom({
        roomName,
        userId: user.id,
        nickname: profileData?.nickname || "이름없는회원",
        candidates,
      });

      onCreated?.(result.room.id);
    } catch (error) {
      alert("방 생성 실패");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label style={labelStyle}>방 이름</label>
        <input
          type="text"
          placeholder="방 이름을 입력하세요"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label style={labelStyle}>약속 후보 날짜</label>
        <DatePicker
          multiple
          value={candidateDates}
          onChange={setCandidateDates}
          format="YYYY-MM-DD"
          minDate={new Date()}
          containerStyle={{ width: "100%" }}
          render={(value, openCalendar) => (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {candidateDates.map((d, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "7px 14px",
                    backgroundColor: "#F0ECFF",
                    color: "#7C5CFF",
                    borderRadius: "20px",
                    fontSize: "12px",
                    fontWeight: "600",
                    border: "1px solid #7C5CFF",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.format ? d.format("MM.DD") : String(d).slice(5)}
                </div>
              ))}
              <button
                type="button"
                onClick={openCalendar}
                style={{
                  padding: "7px 14px",
                  backgroundColor: "#FFFFFF",
                  border: "1px dashed #D1D5DB",
                  borderRadius: "20px",
                  fontSize: "12px",
                  fontWeight: "600",
                  color: "#6B7280",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                + 날짜 선택
              </button>
            </div>
          )}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label style={labelStyle}>하루종일</label>
        <div
          onClick={() => setIsAllDay((prev) => !prev)}
          style={{
            width: "44px",
            height: "22px",
            backgroundColor: isAllDay ? "#7C5CFF" : "#E5E7EB",
            borderRadius: "11px",
            position: "relative",
            cursor: "pointer",
            transition: "background-color 0.2s",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: "18px",
              height: "18px",
              backgroundColor: "#FFFFFF",
              borderRadius: "50%",
              position: "absolute",
              top: "2px",
              left: isAllDay ? "24px" : "2px",
              transition: "left 0.2s",
            }}
          />
        </div>
      </div>

      {!isAllDay && (
        <div style={{ display: "flex", gap: "10px" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: "11px", color: "#6B7280", marginBottom: "5px", fontWeight: "600" }}>
              시작 시간
            </label>
            <select
              value={candidateStartTime}
              onChange={(e) => setCandidateStartTime(e.target.value)}
              style={{ ...inputStyle, backgroundColor: "#F9FAFB" }}
            >
              <option value="">시작</option>
              {timeSlots.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: "11px", color: "#6B7280", marginBottom: "5px", fontWeight: "600" }}>
              종료 시간
            </label>
            <select
              value={candidateEndTime}
              onChange={(e) => setCandidateEndTime(e.target.value)}
              style={{ ...inputStyle, backgroundColor: "#F9FAFB" }}
            >
              <option value="">종료</option>
              {timeSlots.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleAddCandidate}
        style={{
          width: "100%",
          padding: "10px",
          backgroundColor: "#F0ECFF",
          color: "#7C5CFF",
          border: "none",
          borderRadius: "10px",
          fontSize: "13px",
          fontWeight: "700",
          cursor: "pointer",
        }}
      >
        + 후보 추가
      </button>

      {candidates.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={labelStyle}>추가된 후보 ({candidates.length})</label>
          {candidates.map((candidate, index) => (
            <div
              key={`${candidate.date}-${index}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 10px",
                backgroundColor: "#F9FAFB",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#4B5563",
              }}
            >
              <span>
                {candidate.date}{" "}
                {candidate.isAllDay ? "하루종일" : `${candidate.startTime} ~ ${candidate.endTime}`}
              </span>
              <button
                type="button"
                onClick={() => handleRemoveCandidate(index)}
                style={{ border: "none", background: "none", color: "#EF4444", fontSize: "12px", cursor: "pointer", padding: "2px 4px" }}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
        {onCancel && (
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
            취소
          </button>
        )}
        <button type="button" onClick={handleCreateRoom} disabled={saving} style={primaryButtonStyle}>
          {saving ? "생성 중..." : "방 만들기"}
        </button>
      </div>
    </div>
  );
}

export default RoomCreateForm;
