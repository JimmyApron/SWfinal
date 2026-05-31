import { useState, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  getTopAvailableTimes,
  sortAvailableTimes,
  getTopConsecutiveDays,
} from "../../utils/scheduleUtils";
// sortAvailableTimes는 당일 기본 정렬(사람 많은 순→오래 있는 순)에만 사용

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${dateStr} (${days[d.getDay()]})`;
}

function AvailableResultPage() {
  const { roomid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const availabilities = location.state?.availabilities || [];
  const candidates = location.state?.candidates || [];

  const [mode, setMode] = useState("당일"); // "당일" | "일별"
  const [nDays, setNDays] = useState(2);
  const [selectedTimes, setSelectedTimes] = useState([]);
  const [selectedMultiDays, setSelectedMultiDays] = useState([]);

  // 당일: 사람 많은 순 → 오래 있는 순 기준으로 자동 정렬
  const allBlocks = useMemo(() => getTopAvailableTimes(availabilities), [availabilities]);
  const topTimes = useMemo(() => sortAvailableTimes(allBlocks, "count"), [allBlocks]);

  // 일별: N일 연속 결과
  const consecutiveResults = useMemo(
    () => getTopConsecutiveDays(availabilities, candidates, nDays),
    [availabilities, candidates, nDays]
  );

  // 당일 선택 토글
  const makeKey = (t) => `${t.date}_${t.starttime}_${t.endtime}`;
  const handleSelectTime = (time) => {
    const key = makeKey(time);
    setSelectedTimes((prev) =>
      prev.some((s) => makeKey(s) === key)
        ? prev.filter((s) => makeKey(s) !== key)
        : [...prev, time]
    );
  };

  // 일별 선택 토글
  const makeMultiKey = (r) => r.dates.join("_");
  const handleSelectMultiDay = (result) => {
    const key = makeMultiKey(result);
    setSelectedMultiDays((prev) =>
      prev.some((s) => makeMultiKey(s) === key)
        ? prev.filter((s) => makeMultiKey(s) !== key)
        : [...prev, result]
    );
  };

  const handleGoVoteCreate = () => {
    if (mode === "당일") {
      if (selectedTimes.length === 0) { alert("투표로 만들 일정을 선택하세요."); return; }
      navigate(`/rooms/${roomid}/vote-create`, {
        state: { voteType: "date", selectedSchedules: selectedTimes, returnTab: "vote" },
      });
    } else {
      if (selectedMultiDays.length === 0) { alert("투표로 만들 일정을 선택하세요."); return; }
      // 각 연속 날짜 조합을 개별 날짜 옵션으로 변환
      const schedules = selectedMultiDays.flatMap((r) =>
        r.dates.map((date) => ({ date, starttime: null, endtime: null, isallday: true }))
      );
      navigate(`/rooms/${roomid}/vote-create`, {
        state: { voteType: "date", selectedSchedules: schedules, returnTab: "vote" },
      });
    }
  };

  const tabStyle = (active) => ({
    flex: 1,
    padding: "10px",
    border: "none",
    borderBottom: active ? "2px solid #7c79ff" : "2px solid transparent",
    backgroundColor: "transparent",
    color: active ? "#7c79ff" : "#888",
    fontWeight: active ? "bold" : "normal",
    fontSize: "15px",
    cursor: "pointer",
  });

  const chipStyle = (active) => ({
    padding: "6px 14px",
    border: `1px solid ${active ? "#7c79ff" : "#ddd"}`,
    borderRadius: "20px",
    backgroundColor: active ? "#f0f0ff" : "#fff",
    color: active ? "#7c79ff" : "#888",
    fontSize: "13px",
    cursor: "pointer",
    fontWeight: active ? "600" : "normal",
  });

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff", paddingBottom: "80px" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", padding: "16px", borderBottom: "1px solid #eee", gap: "12px" }}>
        <button onClick={() => navigate(-1)} style={{ border: "none", background: "none", fontSize: "22px", cursor: "pointer" }}>←</button>
        <h2 style={{ margin: 0, fontSize: "18px" }}>가능한 시간 결과</h2>
      </div>

      {/* 모드 탭 */}
      <div style={{ display: "flex", borderBottom: "1px solid #eee" }}>
        <button style={tabStyle(mode === "당일")} onClick={() => { setMode("당일"); setSelectedTimes([]); }}>당일</button>
        <button style={tabStyle(mode === "일별")} onClick={() => { setMode("일별"); setSelectedMultiDays([]); }}>일별</button>
      </div>

      <div style={{ padding: "16px" }}>
        {/* 당일 모드 */}
        {mode === "당일" && (
          <>
            <p style={{ margin: "0 0 12px", fontSize: "13px", color: "#888" }}>
              사람 많은 순 → 오래 있는 순으로 순위를 매깁니다.
            </p>

            {topTimes.length === 0 && (
              <p style={{ color: "#aaa", textAlign: "center", marginTop: "40px" }}>가능한 시간이 없습니다.</p>
            )}

            {topTimes.map((time, index) => {
              const checked = selectedTimes.some((s) => makeKey(s) === makeKey(time));
              const hours = Math.floor(time.duration / 60);
              const mins = time.duration % 60;
              return (
                <label
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    border: `1px solid ${checked ? "#7c79ff" : "#eee"}`,
                    borderRadius: "12px",
                    padding: "14px",
                    marginBottom: "10px",
                    backgroundColor: checked ? "#f5f5ff" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleSelectTime(time)}
                    style={{ marginTop: "3px", accentColor: "#7c79ff" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: "bold", fontSize: "15px" }}>{index + 1}순위</span>
                      <span style={{ fontSize: "12px", backgroundColor: "#7c79ff", color: "#fff", borderRadius: "10px", padding: "2px 8px" }}>
                        {time.availableCount}명 가능
                      </span>
                    </div>
                    <p style={{ margin: "6px 0 2px", fontSize: "14px", color: "#333" }}>{formatDate(time.date)}</p>
                    <p style={{ margin: 0, fontSize: "13px", color: "#666" }}>
                      {time.starttime} ~ {time.endtime}
                      <span style={{ marginLeft: "8px", color: "#7c79ff" }}>
                        ({hours > 0 ? `${hours}시간 ` : ""}{mins > 0 ? `${mins}분` : ""})
                      </span>
                    </p>
                  </div>
                </label>
              );
            })}
          </>
        )}

        {/* 일별 모드 */}
        {mode === "일별" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              <label style={{ fontSize: "14px", fontWeight: "600", color: "#333", whiteSpace: "nowrap" }}>며칠 연속?</label>
              <input
                type="number"
                min="2"
                max="30"
                value={nDays}
                onChange={(e) => {
                  const v = Math.max(2, Number(e.target.value));
                  setNDays(v);
                  setSelectedMultiDays([]);
                }}
                style={{
                  width: "70px",
                  padding: "8px 10px",
                  fontSize: "15px",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  outline: "none",
                  textAlign: "center",
                }}
              />
              <span style={{ fontSize: "14px", color: "#555" }}>일</span>
            </div>

            {consecutiveResults.length === 0 && (
              <p style={{ color: "#aaa", textAlign: "center", marginTop: "40px" }}>
                {candidates.length === 0
                  ? "후보 일정이 없습니다."
                  : `${nDays}일 연속 가능한 조합이 없습니다.`}
              </p>
            )}

            {consecutiveResults.map((result, index) => {
              const checked = selectedMultiDays.some((s) => makeMultiKey(s) === makeMultiKey(result));
              return (
                <label
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    border: `1px solid ${checked ? "#7c79ff" : "#eee"}`,
                    borderRadius: "12px",
                    padding: "14px",
                    marginBottom: "10px",
                    backgroundColor: checked ? "#f5f5ff" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleSelectMultiDay(result)}
                    style={{ marginTop: "3px", accentColor: "#7c79ff" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: "bold", fontSize: "15px" }}>{index + 1}순위</span>
                      <span style={{ fontSize: "12px", backgroundColor: "#7c79ff", color: "#fff", borderRadius: "10px", padding: "2px 8px" }}>
                        {result.availableCount}명 가능
                      </span>
                    </div>
                    <p style={{ margin: "6px 0 2px", fontSize: "14px", color: "#333" }}>
                      {formatDate(result.startDate)} ~ {formatDate(result.endDate)}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                      {result.dates.map((d) => (
                        <span key={d} style={{ fontSize: "12px", backgroundColor: "#f0f0ff", color: "#7c79ff", borderRadius: "6px", padding: "2px 7px" }}>
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                </label>
              );
            })}
          </>
        )}

        {/* 투표 만들기 버튼 */}
        {((mode === "당일" && topTimes.length > 0) ||
          (mode === "일별" && consecutiveResults.length > 0)) && (
          <button
            onClick={handleGoVoteCreate}
            style={{
              width: "100%",
              padding: "14px",
              marginTop: "8px",
              backgroundColor: "#7c79ff",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              fontSize: "15px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            선택한 일정으로 투표 만들기
          </button>
        )}
      </div>
    </div>
  );
}

export default AvailableResultPage;
