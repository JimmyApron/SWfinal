import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaChevronLeft } from "react-icons/fa";
import { supabase } from "../../lib/supabaseClient";
import { getFixedTimetable, saveFixedTimetable, recognizeTimetableImage } from "../../api/fixedTimetableApi";
import { TIME_SLOTS, blocksToCells, cellsToBlocks } from "../../utils/fixedTimetableUtils";
import "./SettingsPage.css";
import "./FixedTimetablePage.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function FixedTimetablePage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState(null);
  const [cells, setCells] = useState(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const dragModeRef = useRef(null); // "add" | "remove" | null

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          alert("고정 시간표는 로그인한 회원만 사용할 수 있어요.");
          navigate("/settings", { replace: true });
          return;
        }
        setUserId(user.id);
        setCells(blocksToCells(await getFixedTimetable(user.id)));
      } catch (error) {
        console.error(error);
        alert("고정 시간표를 불러오지 못했어요.");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [navigate]);

  const applyToCell = (key) => {
    const mode = dragModeRef.current;
    if (!mode) return;
    setCells((prev) => {
      if (mode === "add" ? prev.has(key) : !prev.has(key)) return prev;
      const next = new Set(prev);
      if (mode === "add") next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handlePointerDown = (event, key) => {
    event.preventDefault();
    dragModeRef.current = cells.has(key) ? "remove" : "add";
    applyToCell(key);
  };

  // 터치는 처음 누른 칸이 포인터를 계속 잡고 있어서, 좌표로 현재 칸을 찾는다.
  const handlePointerMove = (event) => {
    if (!dragModeRef.current) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const key = target?.dataset?.key;
    if (key) applyToCell(key);
  };

  const stopDrag = () => {
    dragModeRef.current = null;
  };

  // 인식 결과는 바로 저장하지 않고 격자에 칠해서 보여준다. 확인·수정 후 저장하면 된다.
  const handleImageSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsRecognizing(true);
    try {
      const classes = await recognizeTimetableImage(file);
      setCells((prev) => new Set([...prev, ...blocksToCells(classes)]));
      alert(`수업 ${classes.length}개를 불러왔어요. 시간이 맞는지 확인하고 저장해 주세요.`);
    } catch (error) {
      alert(error.message);
    } finally {
      setIsRecognizing(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveFixedTimetable(userId, cellsToBlocks(cells));
      alert("고정 시간표가 저장되었어요.");
      navigate(-1);
    } catch (error) {
      console.error(error);
      alert("고정 시간표 저장에 실패했어요.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="loading-container">불러오는 중입니다...</div>;

  return (
    <div className="settings-page">
      <div className="settings-content">
        <header className="settings-header">
          <button type="button" className="back-button" onClick={() => navigate(-1)} aria-label="이전 화면으로 돌아가기">
            <FaChevronLeft />
          </button>
          <h2 className="settings-title">고정 시간표</h2>
        </header>

        <p className="fixed-tt-desc">
          수업·알바처럼 매주 반복되는 <b>못 하는 시간</b>을 드래그해서 칠해 주세요.
          방 시간표에서 가능한 시간을 고를 때, 칠한 시간을 뺀 나머지가 자동으로 선택돼요.
        </p>

        <label className={`fixed-tt-upload${isRecognizing ? " is-disabled" : ""}`}>
          {isRecognizing ? "시간표 읽는 중..." : "📷 시간표 사진으로 불러오기"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleImageSelected}
            disabled={isRecognizing}
            hidden
          />
        </label>

        <div
          className="fixed-tt-grid"
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrag}
          onPointerLeave={stopDrag}
          onPointerCancel={stopDrag}
        >
          <div className="fixed-tt-row fixed-tt-head">
            <div className="fixed-tt-time" />
            {WEEKDAYS.map((day) => (
              <div key={day} className="fixed-tt-day">{day}</div>
            ))}
          </div>
          {TIME_SLOTS.map((time) => (
            <div key={time} className="fixed-tt-row">
              <div className="fixed-tt-time">{time.endsWith(":00") ? time : ""}</div>
              {WEEKDAYS.map((_, weekday) => {
                const key = `${weekday}-${time}`;
                return (
                  <div
                    key={key}
                    data-key={key}
                    className={`fixed-tt-cell${cells.has(key) ? " is-busy" : ""}`}
                    onPointerDown={(event) => handlePointerDown(event, key)}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="fixed-tt-actions">
          <button type="button" className="fixed-tt-reset" onClick={() => setCells(new Set())}>
            전체 지우기
          </button>
          <button type="button" className="fixed-tt-save" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default FixedTimetablePage;
