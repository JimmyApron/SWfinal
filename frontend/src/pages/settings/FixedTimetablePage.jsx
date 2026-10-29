import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaChevronLeft } from "react-icons/fa";
import { supabase } from "../../lib/supabaseClient";
import { getFixedTimetable, getFixedTimetableConflicts, saveFixedTimetable, recognizeTimetableImage } from "../../api/fixedTimetableApi";
import { TIME_SLOTS, blocksToCells, cellsToBlocks } from "../../utils/fixedTimetableUtils";
import "./SettingsPage.css";
import "./FixedTimetablePage.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function FixedTimetablePage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState(null);
  const [cells, setCells] = useState(new Set());
  const [savedCells, setSavedCells] = useState(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const dragModeRef = useRef(null); // "add" | "remove" | null
  const recognitionAbortRef = useRef(null);
  const lastRecognizedFileRef = useRef(null);
  const ignoreNextPopstateRef = useRef(false);
  const skipSavedNavigationWarningRef = useRef(false);
  const isDirty = cells.size !== savedCells.size || [...cells].some((key) => !savedCells.has(key));

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
        const loadedCells = blocksToCells(await getFixedTimetable(user.id));
        setCells(loadedCells);
        setSavedCells(loadedCells);
      } catch (error) {
        console.error(error);
        alert("고정 시간표를 불러오지 못했어요.");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [navigate]);

  useEffect(() => () => recognitionAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!isDirty) return undefined;
    const warnBeforeUnload = (event) => {
      if (skipSavedNavigationWarningRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmInternalNavigation = (event) => {
      if (skipSavedNavigationWarningRef.current) return;
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const next = new URL(anchor.href, window.location.href);
      if (next.origin === window.location.origin && (next.pathname !== window.location.pathname || next.search !== window.location.search) &&
          !window.confirm("변경한 내용이 저장되지 않았어요. 나가시겠어요?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const confirmBackNavigation = () => {
      if (skipSavedNavigationWarningRef.current) return;
      if (ignoreNextPopstateRef.current) {
        ignoreNextPopstateRef.current = false;
        return;
      }
      if (window.confirm("변경한 내용이 저장되지 않았어요. 나가시겠어요?")) return;
      ignoreNextPopstateRef.current = true;
      window.history.forward();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", confirmInternalNavigation, true);
    window.addEventListener("popstate", confirmBackNavigation);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", confirmInternalNavigation, true);
      window.removeEventListener("popstate", confirmBackNavigation);
    };
  }, [isDirty]);

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

    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      alert(file.size > 10 * 1024 * 1024
        ? "이미지는 10MB 이하로 선택해 주세요."
        : "JPG, PNG, WEBP 이미지 파일을 선택해 주세요.");
      return;
    }
    const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (lastRecognizedFileRef.current === fileKey) {
      alert("이미 반영한 이미지예요. 결과를 확인하거나 다른 이미지를 선택해 주세요.");
      return;
    }

    const controller = new AbortController();
    recognitionAbortRef.current = controller;
    setIsRecognizing(true);
    try {
      const result = await recognizeTimetableImage(file, { signal: controller.signal });
      const classes = Array.isArray(result.classes) ? result.classes : [];
      setCells((prev) => new Set([...prev, ...blocksToCells(classes)]));
      lastRecognizedFileRef.current = fileKey;
      alert(result.partial
        ? "일부 시간대만 인식됐어요. 누락된 내용이 없는지 확인해 주세요."
        : "시간표를 인식했어요. 내용을 확인한 후 저장해 주세요.");
    } catch (error) {
      if (error.name !== "AbortError") alert(error.message || "시간표를 인식하지 못했어요. 직접 입력하거나 다른 이미지를 사용해 주세요.");
    } finally {
      if (recognitionAbortRef.current === controller) recognitionAbortRef.current = null;
      setIsRecognizing(false);
    }
  };

  const handleSave = async () => {
    if (!isDirty) {
      alert("변경된 내용이 없어요.");
      return;
    }
    if (cells.size === 0 && savedCells.size > 0 &&
        !window.confirm("모든 고정 시간대를 삭제할까요? 기존 모임의 가능 시간 선택은 자동으로 변경되지 않아요.")) return;

    setIsSaving(true);
    try {
      const blocks = cellsToBlocks(cells);
      const result = await saveFixedTimetable(userId, blocks);
      skipSavedNavigationWarningRef.current = true;
      setSavedCells(new Set(cells));
      let message = savedCells.size ? "변경된 시간표가 저장됐어요." : "고정 시간표가 저장됐어요.";
      let conflicts = { confirmed: [], availability: [] };
      try {
        conflicts = await getFixedTimetableConflicts(userId, blocks);
        if (conflicts.confirmed.length) {
          const list = conflicts.confirmed.map((row) => `• ${row.roomname}: ${row.title || "확정 일정"} (${row.date})`).join("\n");
          message += `\n\n확정된 약속과 겹치는 시간이 있어요. 기존 약속을 확인해 주세요.\n${list}`;
        }
        if (conflicts.availability.length) {
          const names = [...new Set(conflicts.availability.map((row) => `${row.roomname} (${row.date})`))].join(", ");
          message += `\n\n새 고정 시간표와 겹치는 모임 가능 시간 선택이 있어요. 직접 변경하기 전까지 기존 선택은 유지됩니다.\n${names}`;
        }
      } catch (error) {
        console.error("시간표 충돌 확인 실패:", error);
        message += "\n\n일정 충돌을 확인하지 못했어요. 모임 일정을 확인해 주세요.";
      }
      if (!result.changed) message = "변경된 내용이 없어 저장하지 않았어요.";
      alert(message);
      if (conflicts?.availability?.length && window.confirm("겹친 기존 가능 시간 선택을 확인하러 이동할까요?")) {
        navigate(`/rooms/${conflicts.availability[0].roomid}?tab=schedule`);
      } else {
        navigate(-1);
      }
    } catch (error) {
      console.error(error);
      alert(error.message || "고정 시간표 저장에 실패했어요.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="loading-container">불러오는 중입니다...</div>;

  return (
    <div className="settings-page">
      <div className="settings-content">
        <header className="settings-header">
          <button type="button" className="back-button" onClick={() => {
            if (!isDirty || skipSavedNavigationWarningRef.current || window.confirm("변경한 내용이 저장되지 않았어요. 나가시겠어요?")) navigate(-1);
          }} aria-label="이전 화면으로 돌아가기">
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
