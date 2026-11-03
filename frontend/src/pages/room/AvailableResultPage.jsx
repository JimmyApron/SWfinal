import { useState, useMemo, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  getTopAvailableTimes,
  sortAvailableTimes,
  getTopConsecutiveDays,
} from "../../utils/scheduleUtils";
import { supabase } from "../../lib/supabaseClient";
import { createRoomNotifications } from "../../api/notificationApi";
import { updateRoomLastActivity } from "../../api/roomApi";
import { getTodayStr } from "../../utils/scheduleUtils";
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

  const [confirmation, setConfirmation] = useState(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  const openConfirmation = (event, schedules) => {
    event.preventDefault();
    event.stopPropagation();
    setConfirmation(schedules);
    setTitle("");
    setError("");
  };

  const confirmSchedule = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    if (!title.trim()) { setError("일정 제목을 입력해 주세요."); return; }
    if (confirmation.some((schedule) => schedule.date < getTodayStr())) {
      setError("과거 날짜는 확정할 수 없어요. 최신 분석 결과를 확인해 주세요.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const { data, error: saveError } = await supabase.from("confirmed_schedules")
        .insert(confirmation.map((schedule) => ({
          roomid: Number(roomid), title: title.trim(), date: schedule.date,
          starttime: schedule.isallday ? null : schedule.starttime,
          endtime: schedule.isallday ? null : schedule.endtime,
          isallday: Boolean(schedule.isallday),
        }))).select("id");
      if (saveError) throw saveError;
      // 저장 후 부가 작업 실패로 같은 일정이 다시 생성되지 않게 한다.
      try {
        const { data: authData } = await supabase.auth.getUser();
        const results = await Promise.allSettled([
          updateRoomLastActivity(roomid),
          ...(data || []).map((schedule) => createRoomNotifications({
            roomId: Number(roomid), senderId: authData?.user?.id || localStorage.getItem("guest_id"),
            type: "schedule_confirmed", title: "🗓️ 일정 확정",
            message: `'${title.trim()}' 일정이 확정되었습니다.`,
            link: `/rooms/${roomid}?tab=schedule&scheduleId=${schedule.id}`,
          })),
        ]);
        results.filter((result) => result.status === "rejected")
          .forEach((result) => console.error("일정 확정 후 알림/활동 갱신 실패:", result.reason));
      } catch (notificationError) {
        console.error("일정 확정 후 알림 처리 실패:", notificationError);
      }
      navigate(`/rooms/${roomid}?tab=schedule${data?.[0]?.id ? `&scheduleId=${data[0].id}` : ""}`);
    } catch (saveError) {
      console.error("분석 결과 일정 확정 실패:", saveError);
      setError("일정을 확정하지 못했어요. 다시 시도해 주세요.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const confirmButtonStyle = {
    marginTop: "6px", padding: "5px 10px", minHeight: "28px", borderRadius: "999px",
    border: "1px solid #7c79ff", backgroundColor: "#fff", color: "#7c79ff",
    fontSize: "11px", fontWeight: "600", cursor: "pointer", whiteSpace: "nowrap",
  };

  // 당일: 사람 많은 순 → 오래 있는 순 기준으로 자동 정렬
  const allBlocks = useMemo(() => getTopAvailableTimes(availabilities), [availabilities]);
  const topTimes = useMemo(() => sortAvailableTimes(allBlocks, "count"), [allBlocks]);

  // 일별: N일 연속 결과 (가능 인원이 0명인 조합은 제외)
  const consecutiveResults = useMemo(
    () => getTopConsecutiveDays(availabilities, candidates, nDays).filter((r) => r.availableCount > 0),
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

      {confirmation && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <form onSubmit={confirmSchedule} role="dialog" aria-modal="true" aria-labelledby="confirm-schedule-title"
            style={{ width: "100%", maxWidth: "360px", maxHeight: "85vh", overflowY: "auto", padding: "22px", borderRadius: "18px", backgroundColor: "var(--card-bg, #fff)", color: "var(--text-color, #333)" }}>
            <h3 id="confirm-schedule-title" style={{ margin: "0 0 14px", fontSize: "18px" }}>일정 확정하기</h3>
            {confirmation.map((schedule) => (
              <p key={schedule.date} style={{ fontSize: "13px", margin: "6px 0" }}>
                {formatDate(schedule.date)} · {schedule.isallday ? "하루종일" : `${schedule.starttime} ~ ${schedule.endtime}`}
              </p>
            ))}
            {confirmation.length > 1 && <p style={{ fontSize: "12px", color: "var(--secondary-text)" }}>날짜별로 하루종일 일정 {confirmation.length}개를 확정합니다.</p>}
            <label htmlFor="direct-schedule-title" style={{ display: "block", fontSize: "13px", margin: "16px 0 6px" }}>일정 제목</label>
            <input id="direct-schedule-title" autoFocus maxLength={120} value={title} disabled={saving}
              onChange={(event) => setTitle(event.target.value)} placeholder="일정 제목을 입력해 주세요"
              style={{ boxSizing: "border-box", width: "100%", padding: "11px", border: "1px solid #ddd", borderRadius: "10px", fontSize: "14px" }} />
            {error && <p role="alert" style={{ color: "#dc2626", fontSize: "13px" }}>{error}</p>}
            <div style={{ display: "flex", gap: "8px", marginTop: "18px" }}>
              <button type="button" disabled={saving} onClick={() => setConfirmation(null)} style={{ flex: 1, padding: "11px", border: "1px solid #ddd", borderRadius: "999px", background: "transparent", color: "inherit", cursor: "pointer" }}>취소</button>
              <button type="submit" disabled={saving} style={{ flex: 1, padding: "11px", border: "none", borderRadius: "999px", background: "#7c79ff", color: "#fff", fontWeight: "600", cursor: saving ? "wait" : "pointer" }}>{saving ? "확정 중..." : "확정하기"}</button>
            </div>
          </form>
        </div>
      )}

      {/* 모드 탭 */}
      <div style={{ display: "flex", borderBottom: "1px solid #eee" }}>
        <button style={tabStyle(mode === "당일")} onClick={() => { setMode("당일"); setSelectedTimes([]); }}>당일</button>
        <button style={tabStyle(mode === "일별")} onClick={() => { setMode("일별"); setSelectedMultiDays([]); }}>일별</button>
      </div>

      <div style={{ padding: "16px" }}>
        {/* 당일 모드 */}
        {mode === "당일" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
              {topTimes.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    selectedTimes.length === topTimes.length
                      ? setSelectedTimes([])
                      : setSelectedTimes([...topTimes])
                  }
                  style={{ fontSize: "13px", color: "#7c79ff", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", padding: 0 }}
                >
                  {selectedTimes.length === topTimes.length ? "모두 해제" : "모두 선택"}
                </button>
              )}
            </div>

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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <p style={{ margin: 0, fontSize: "13px", color: "#666" }}>
                        {time.starttime} ~ {time.endtime}
                        <span style={{ marginLeft: "8px", color: "#7c79ff" }}>
                          ({hours > 0 ? `${hours}시간 ` : ""}{mins > 0 ? `${mins}분` : ""})
                        </span>
                      </p>
                      <button type="button" style={{ ...confirmButtonStyle, marginTop: 0, flexShrink: 0 }}
                        onClick={(event) => openConfirmation(event, [{ ...time, isallday: false }])}>
                        확정하기
                      </button>
                    </div>
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
              <label style={{ fontSize: "14px", fontWeight: "600", color: "#333", whiteSpace: "nowrap" }}>연속</label>
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
                  padding: "0 10px",
                  fontSize: "14px",
                  lineHeight: "20px",
                  height: "20px",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  outline: "none",
                  textAlign: "center",
                }}
              />
              <span style={{ fontSize: "14px", color: "#555" }}>일</span>
            </div>

            {consecutiveResults.length > 0 && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
                <button
                  type="button"
                  onClick={() =>
                    selectedMultiDays.length === consecutiveResults.length
                      ? setSelectedMultiDays([])
                      : setSelectedMultiDays([...consecutiveResults])
                  }
                  style={{ fontSize: "13px", color: "#7c79ff", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  {selectedMultiDays.length === consecutiveResults.length ? "모두 해제" : "모두 선택"}
                </button>
              </div>
            )}

            {consecutiveResults.length === 0 && (
              <p style={{ color: "#aaa", textAlign: "center", marginTop: "40px" }}>
                가능한 일정이 없습니다.
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", minWidth: 0 }}>
                        {result.dates.map((d) => (
                          <span key={d} style={{ fontSize: "12px", backgroundColor: "#f0f0ff", color: "#7c79ff", borderRadius: "6px", padding: "2px 7px" }}>
                            {d}
                          </span>
                        ))}
                      </div>
                      <button type="button" style={{ ...confirmButtonStyle, marginTop: 0, flexShrink: 0 }}
                        onClick={(event) => openConfirmation(event, result.dates.map((date) => ({ date, isallday: true })))}>
                        확정하기
                      </button>
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
