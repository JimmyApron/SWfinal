import { useState } from "react";
import { createRoom } from "../../api/roomApi";
import DatePicker from "react-multi-date-picker";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

function RoomCreatePage() {
  const navigate = useNavigate();

  const [roomName, setRoomName] = useState("");
  const [candidateDates, setCandidateDates] = useState([]);
  const [candidateStartTime, setCandidateStartTime] = useState("");
  const [candidateEndTime, setCandidateEndTime] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [candidates, setCandidates] = useState([]);

  const timeOptions = [];

  for (let hour = 0; hour < 24; hour++) {
    for (let minute of [0, 30]) {
      const h = String(hour).padStart(2, "0");
      const m = String(minute).padStart(2, "0");
      timeOptions.push(`${h}:${m}`);
    }
  }


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

    const newCandidates = candidateDates.map((date) => {
      const formattedDate =
        typeof date === "string" ? date : date.format("YYYY-MM-DD");

      return {
        date: formattedDate,
        startTime: isAllDay ? null : candidateStartTime,
        endTime: isAllDay ? null : candidateEndTime,
        isAllDay,
      };
    });

    setCandidates([...candidates, ...newCandidates]);

    setCandidateDates([]);
    setCandidateStartTime("");
    setCandidateEndTime("");
    setIsAllDay(false);
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
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        alert("로그인이 필요합니다.");
        return;
      }

      const result = await createRoom({
        roomName,
        userId: user.id,
        nickname: user.user_metadata.nickname,
        candidates,
      });

      alert("방이 생성되었습니다.");
      navigate(`/rooms/${result.room.id}`);
    } catch (error) {
      alert("방 생성 실패");
      console.error(error);
    }
  };

  return (
    <div>
      <h1>방 생성</h1>

      <input
        type="text"
        placeholder="방 이름"
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
      />

      <h2>약속 후보 날짜 추가</h2>

      <DatePicker
        multiple
        value={candidateDates}
        onChange={setCandidateDates}
        format="YYYY-MM-DD"
        minDate={new Date()}
        placeholder="후보 날짜 여러 개 선택"
      />

      <label>
        <input
          type="checkbox"
          checked={isAllDay}
          onChange={(e) => setIsAllDay(e.target.checked)}
        />
        하루종일 가능
      </label>

      {!isAllDay && (
        <div>
          <select 
            size={1}
            value={candidateStartTime}
            onChange={(e) => setCandidateStartTime(e.target.value)}
          >
            <option value="">시작 시간</option>
            {timeOptions.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>

          <select
            size={1}
            value={candidateEndTime}
            onChange={(e) => setCandidateEndTime(e.target.value)}
          >
            <option value="">종료 시간</option>
            {timeOptions.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </div>
      )}

      <button onClick={handleAddCandidate}>후보 추가</button>

      <h3>추가된 후보</h3>

      {candidates.map((candidate, index) => (
        <div key={index}>
          {candidate.date}{" "}
          {candidate.isAllDay
            ? "하루종일"
            : `${candidate.startTime} ~ ${candidate.endTime}`}
        </div>
      ))}

      <button onClick={handleCreateRoom}>방 만들기</button>
    </div>
  );
}

export default RoomCreatePage;