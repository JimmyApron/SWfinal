import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getTopAvailableTimes } from "../../utils/scheduleUtils";

function AvailableResultPage() {
  const { roomid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const availabilities = location.state?.availabilities || [];
  const topTimes = getTopAvailableTimes(availabilities);

  const [selectedTimes, setSelectedTimes] = useState([]);

  const makeKey = (time) => {
    return `${time.date}_${time.starttime}_${time.endtime}`;
  };

  const handleSelectTime = (time) => {
    const key = makeKey(time);

    const alreadySelected = selectedTimes.some(
      (selected) => makeKey(selected) === key
    );

    if (alreadySelected) {
      setSelectedTimes(
        selectedTimes.filter((selected) => makeKey(selected) !== key)
      );
    } else {
      setSelectedTimes([...selectedTimes, time]);
    }
  };

  const handleGoVoteCreate = () => {
    if (selectedTimes.length === 0) {
      alert("투표로 만들 일정을 선택하세요.");
      return;
    }

    navigate(`/rooms/${roomid}/vote-create`, {
      state: {
        voteType: "date",
        selectedSchedules: selectedTimes,
        returnTab: "vote",
      },
    });
  };

  return (
    <div style={{ padding: "16px" }}>
      <h2>가능한 시간 결과</h2>

      {topTimes.length === 0 && <p>가능한 시간이 없습니다.</p>}

      {topTimes.map((time, index) => {
        const checked = selectedTimes.some(
          (selected) => makeKey(selected) === makeKey(time)
        );

        return (
          <label
            key={index}
            style={{
              display: "block",
              border: "1px solid #ddd",
              borderRadius: "10px",
              padding: "12px",
              marginBottom: "10px",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => handleSelectTime(time)}
            />

            <strong> {index + 1}순위</strong>
            <p>{time.date}</p>
            <p>
              {time.starttime} ~ {time.endtime}
            </p>
            <p>참여 가능 인원: {time.availableCount}명</p>
          </label>
        );
      })}

      {topTimes.length > 0 && (
        <button onClick={handleGoVoteCreate}>
          일정 투표하기
        </button>
      )}
    </div>
  );
}

export default AvailableResultPage;