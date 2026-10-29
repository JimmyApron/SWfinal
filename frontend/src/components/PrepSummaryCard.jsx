import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPrepData, setPrepCheck, updatePrepAssignment } from "../api/prepApi";
import { supabase } from "../lib/supabaseClient";
import "./PrepSummaryCard.css";

function PrepSummaryCard({
  schedule,
  attendees,
  absentees = [],
  isPast = false,
}) {
  const navigate = useNavigate();
  const [identity, setIdentity] = useState(null);
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyItemId, setBusyItemId] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!identity) return;
    const data = await getPrepData(schedule.id, identity);
    setItems(data.items);
    setAssignments(data.assignments);
    setChecks(data.checks);
  }, [schedule.id, identity]);

  useEffect(() => {
    let active = true;

    async function loadCardData() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        const guestId = localStorage.getItem("guest_id");
        const participant = authData.user?.id
          ? { id: String(authData.user.id), type: "member" }
          : guestId
            ? { id: String(guestId), type: "guest" }
            : null;
        if (active) setIdentity(participant);
        if (!participant) {
          return;
        }
        const data = await getPrepData(schedule.id, participant);
        if (!active) return;
        setItems(data.items);
        setAssignments(data.assignments);
        setChecks(data.checks);
      } catch (loadError) {
        console.error("준비물 요약 조회 실패:", loadError);
        if (active) setError("준비물 요약을 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadCardData();

    return () => {
      active = false;
    };
  }, [schedule.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`prep-summary-${schedule.id}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "prep_items",
          filter: `scheduleid=eq.${schedule.id}`,
        },
        () => refresh().catch((loadError) => setError(loadError.message))
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_assignments" },
        () => refresh().catch((loadError) => setError(loadError.message))
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_checks" },
        () => refresh().catch((loadError) => setError(loadError.message))
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("준비물 요약 realtime 구독 실패:", status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [schedule.id, refresh]);

  const activeParticipants = useMemo(
    () => attendees.filter((person) => !absentees.includes(String(person.participantId))),
    [attendees, absentees]
  );
  const isAttending = activeParticipants.some(
    (person) =>
      person.participantType === identity?.type &&
      String(person.participantId) === identity?.id
  );
  const personalItems = items
    .filter((item) => item.kind === "personal")
    .map((item) => ({
      ...item,
      checked: checks.some(
        (check) =>
          check.itemid === item.id &&
          check.memberid === identity?.id &&
          check.membertype === identity?.type &&
          check.checked
      ),
      isMine: false,
    }));
  const mineSharedItems = items
    .filter((item) => item.kind === "shared")
    .filter((item) =>
      assignments.some(
        (assignment) =>
          assignment.itemid === item.id &&
          assignment.memberid === identity?.id &&
          assignment.membertype === identity?.type &&
          assignment.status === "assigned"
      )
    )
    .map((item) => ({
      ...item,
      checked: assignments.some(
        (assignment) =>
          assignment.itemid === item.id &&
          assignment.memberid === identity?.id &&
          assignment.membertype === identity?.type &&
          assignment.status === "assigned" &&
          assignment.isdone
      ),
      isMine: true,
    }));
  const myItems = [...personalItems, ...mineSharedItems];
  const completedCount = myItems.filter((item) => item.checked).length;
  const vacantItems = items
    .filter((item) => item.kind === "shared")
    .filter(
      (item) =>
        !assignments.some(
          (assignment) =>
            assignment.itemid === item.id &&
            assignment.status === "assigned"
        )
    );
  const scheduleTime = schedule?.date
    ? new Date(`${schedule.date}T${schedule.starttime || "23:59:59"}`)
    : null;
  const readOnly = isPast || Boolean(scheduleTime && scheduleTime.getTime() < Date.now());

  const openChecklist = (openRecommend = false) =>
    navigate(`/schedules/${schedule.id}/prep`, { state: { schedule, openRecommend } });

  const toggleItem = async (event, item) => {
    event.stopPropagation();
    if (readOnly || !identity || !isAttending || busyItemId === item.id) return;

    const mine = assignments.find(
      (assignment) =>
        assignment.itemid === item.id &&
        assignment.memberid === identity.id &&
        assignment.membertype === identity.type &&
        assignment.status === "assigned"
    );
    setBusyItemId(item.id);
    setError("");
    try {
      if (item.kind === "personal") {
        await setPrepCheck(item.id, identity, !item.checked);
      } else if (mine) {
        await updatePrepAssignment(mine.id, identity, {
          isdone: !mine.isdone,
          doneat: mine.isdone ? null : new Date().toISOString(),
        });
      }
      await refresh();
    } catch (toggleError) {
      console.error("준비물 체크 변경 실패:", toggleError);
      setError(toggleError.message || "준비 상태를 저장하지 못했습니다.");
    } finally {
      setBusyItemId(null);
    }
  };

  return (
    <section
      className="prep-summary-card"
      onClick={() => openChecklist()}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") openChecklist();
      }}
      role="button"
      tabIndex={0}
      aria-label="나의 준비물 목록 열기"
    >
      <div className="prep-summary-card-heading">
        <div>
          <strong>🎒 나의 준비물</strong>
          <span className="prep-summary-card-badge">AI 추천</span>
        </div>
      </div>

      {loading ? (
        <p className="prep-summary-card-muted">준비물을 불러오는 중...</p>
      ) : items.length === 0 && !schedule.date ? (
        <p className="prep-summary-card-muted">
          날짜를 정하면 AI가 준비물을 추천해 드려요
        </p>
      ) : items.length === 0 ? (
        <button
          type="button"
          className="prep-summary-card-recommend"
          onClick={(event) => {
            event.stopPropagation();
            openChecklist(true);
          }}
          disabled={readOnly || !isAttending}
        >
          AI로 준비물 추천받기
        </button>
      ) : (
        <div className="prep-summary-card-items">
          {myItems.slice(0, 3).map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={readOnly || !isAttending || busyItemId === item.id}
              className={`prep-summary-card-item ${item.checked ? "checked" : ""}`}
              onClick={(event) => toggleItem(event, item)}
            >
              <span className="prep-summary-card-checkbox">{item.checked ? "✓" : ""}</span>
              <span className="prep-summary-card-name">{item.name}</span>
              {item.isMine && <span className="prep-summary-card-owner">내 담당</span>}
            </button>
          ))}
        </div>
      )}

      {!loading && items.length > 0 && (
        <button
          type="button"
          className="prep-summary-card-more"
          onClick={(event) => {
            event.stopPropagation();
            openChecklist();
          }}
        >
          준비물 전체보기 ({completedCount}/{myItems.length}) ›
        </button>
      )}

      {vacantItems.length > 0 && (
        <p className="prep-summary-card-warning">
          ⚠ 아직 아무도 안 맡은 것 {vacantItems.length} ·{" "}
          {vacantItems.map((item) => item.name).join(", ")}
        </p>
      )}
      {error && <p className="prep-summary-card-error">{error}</p>}
    </section>
  );
}

export default PrepSummaryCard;
