import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  PREP_EVENT_CATEGORIES,
  addPrepItem,
  addPrepSeat,
  claimPrepItem,
  deletePrepItem,
  getPrepContext,
  getPrepData,
  getPrepSchedule,
  getPrepWeather,
  handlePrepRequest,
  recommendPrepItems,
  removePrepAssignment,
  requestPrepAssignment,
  savePrepContext,
  setPrepCheck,
  updatePrepAssignment,
  updatePrepItem,
} from "../../api/prepApi";
import { createNotification } from "../../api/notificationApi";
import { getCurrentPosition } from "../../services/geolocationService";
import { getWeatherEmoji, PREP_BASIS_ICONS } from "../../utils/weatherEmoji";
import "./PrepChecklistPage.css";

const QUICK_NOTES = ["1개 가져갈게요", "집에 있어요", "사갈게요", "빌려올게요"];

function getIdentityKey(participant) {
  return `${participant.type}:${participant.id}`;
}

function isSchedulePast(schedule) {
  if (!schedule?.date) return false;
  const start = schedule.starttime
    ? new Date(`${schedule.date}T${schedule.starttime}`)
    : new Date(`${schedule.date}T23:59:59`);
  return start.getTime() < Date.now();
}

function formatScheduleDate(schedule) {
  if (!schedule?.date) return "날짜 미정";
  const date = new Date(`${schedule.date}T00:00:00`);
  const dateText = `${date.getMonth() + 1}/${date.getDate()} (${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]})`;
  if (!schedule.starttime) return `${dateText} 하루종일`;
  const [hour, minute] = schedule.starttime.split(":").map(Number);
  const time = `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${String(minute || 0).padStart(2, "0")}`;
  return `${dateText} ${time}`;
}

function formatWeather(weather, air) {
  if (!weather) return "";
  const temperature =
    weather.temperatureMin != null && weather.temperatureMax != null
      ? `최고 ${weather.temperatureMax}° · 최저 ${weather.temperatureMin}°C`
      : weather.temperature != null
        ? `${weather.temperature}°C`
        : "";
  const details = [
    weather.description,
    `강수 ${weather.precipitationProbability}%`,
    temperature,
    air?.level ? `미세먼지 ${air.level}` : "",
  ].filter(Boolean);
  return details.join(" · ");
}

function Avatar({ participant, done = false }) {
  return (
    <span className="prep-avatar-wrap" title={participant.nickname}>
      <span className="prep-avatar">
        {participant.profileimageurl ? (
          <img src={participant.profileimageurl} alt="" />
        ) : (
          participant.nickname?.slice(0, 1) || "?"
        )}
      </span>
      {done && <span className="prep-avatar-done">✓</span>}
    </span>
  );
}

const SHEET_CLOSE_DISTANCE = 110;

// 손잡이를 아래로 끌어내리면 시트가 따라 내려가고, 충분히 내리면 닫힌다.
function SheetGrabber({ onClose }) {
  const dragRef = useRef(null);

  const getSheet = (event) => event.currentTarget.closest(".prep-sheet");

  const handlePointerDown = (event) => {
    const sheet = getSheet(event);
    if (!sheet) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sheet.style.transition = "none";
    dragRef.current = { startY: event.clientY, offset: 0 };
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    const sheet = getSheet(event);
    if (!drag || !sheet) return;
    drag.offset = Math.max(0, event.clientY - drag.startY);
    sheet.style.transform = `translateY(${drag.offset}px)`;
  };

  const handlePointerEnd = (event) => {
    const drag = dragRef.current;
    const sheet = getSheet(event);
    dragRef.current = null;
    if (!drag || !sheet) return;
    sheet.style.transition = "transform 0.2s ease";
    if (drag.offset > SHEET_CLOSE_DISTANCE) {
      onClose();
    } else {
      sheet.style.transform = "";
    }
  };

  return (
    <div
      className="prep-sheet-grabber-area"
      role="button"
      aria-label="아래로 끌어서 닫기"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div className="prep-sheet-grabber" />
    </div>
  );
}

function PrepChecklistPage() {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { scheduleId } = useParams();
  const [schedule, setSchedule] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [absentees, setAbsentees] = useState([]);
  const [identity, setIdentity] = useState(null);
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [checks, setChecks] = useState([]);
  const [tab, setTab] = useState("personal");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [weather, setWeather] = useState(null);
  const [weatherBasis, setWeatherBasis] = useState("none");
  const [weatherSource, setWeatherSource] = useState(null);
  const [air, setAir] = useState(null);
  const [weatherError, setWeatherError] = useState("");
  const [editingItem, setEditingItem] = useState(null);
  const [addingKind, setAddingKind] = useState(null);
  const [requestTarget, setRequestTarget] = useState(null);
  const [requestNote, setRequestNote] = useState("");
  const [claimItem, setClaimItem] = useState(null);
  const [claimNote, setClaimNote] = useState("");
  const [claimAssignmentId, setClaimAssignmentId] = useState(null);
  const [detailItemId, setDetailItemId] = useState(null);
  const [prepContext, setPrepContext] = useState({ category: null, note: "" });
  const [contextSheet, setContextSheet] = useState(null);
  const [contextDraft, setContextDraft] = useState({ category: null, note: "" });
  const [form, setForm] = useState({
    name: "",
    kind: "personal",
    neededCount: 1,
    memo: "",
    selfAssign: false,
  });
  const [editForm, setEditForm] = useState({ name: "", memo: "" });

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const refreshPrep = useCallback(async () => {
    if (!identity) return;
    const data = await getPrepData(scheduleId, identity);
    setItems(data.items);
    setAssignments(data.assignments);
    setChecks(data.checks);
  }, [scheduleId, identity]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const [{ data: authData, error: authError }, context] = await Promise.all([
          supabase.auth.getUser(),
          getPrepSchedule(scheduleId),
        ]);
        if (authError) throw authError;
        if (!active) return;

        const guestId = localStorage.getItem("guest_id");
        const currentIdentity = authData.user?.id
          ? { id: String(authData.user.id), type: "member" }
          : guestId
            ? { id: String(guestId), type: "guest" }
            : null;

        if (!currentIdentity) {
          setPageError("로그인하거나 게스트로 입장한 뒤 이용해 주세요.");
          return;
        }

        setIdentity(currentIdentity);
        setSchedule(context.schedule);
        setAttendees(context.attendees);
        setAbsentees(context.absentees);
        const [data, contextData, weatherData] = await Promise.all([
          getPrepData(scheduleId, currentIdentity),
          getPrepContext(scheduleId).catch((error) => {
            console.error("약속 종류 조회 실패:", error);
            return { category: null, note: "" };
          }),
          getPrepWeather(scheduleId).catch((error) => {
            console.error("준비물 화면 날씨 조회 실패:", error);
            if (active) {
              const hasCoordinates =
                context.schedule.locationlat != null &&
                context.schedule.locationlng != null &&
                Number.isFinite(Number(context.schedule.locationlat)) &&
                Number.isFinite(Number(context.schedule.locationlng));
              setWeatherBasis(hasCoordinates ? "place" : "none");
              setWeatherError(error.message || "날씨를 불러오지 못했습니다.");
            }
            return null;
          }),
        ]);
        if (!active) return;
        setItems(data.items);
        setAssignments(data.assignments);
        setChecks(data.checks);
        setPrepContext(contextData);
        if (routeLocation.state?.openRecommend && data.items.length === 0) {
          setContextDraft(contextData);
          setContextSheet("recommend");
        }
        if (weatherData) {
          setWeather(weatherData.weather);
          setWeatherBasis(weatherData.weatherBasis || "none");
          setWeatherSource(weatherData.weatherSource || null);
          setAir(weatherData.air || null);
        }
      } catch (error) {
        if (active) setPageError(error.message || "준비물 화면을 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [scheduleId]);

  useEffect(() => {
    const channel = supabase
      .channel(`prep-${scheduleId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_items", filter: `scheduleid=eq.${scheduleId}` },
        () => refreshPrep().catch((error) => setPageError(error.message))
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_assignments" },
        () => refreshPrep().catch((error) => setPageError(error.message))
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_checks" },
        () => refreshPrep().catch((error) => setPageError(error.message))
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_contexts", filter: `scheduleid=eq.${scheduleId}` },
        () => getPrepContext(scheduleId).then(setPrepContext).catch((error) => console.error(error))
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("준비물 realtime 구독 실패:", status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [scheduleId, refreshPrep]);

  const activeAttendees = useMemo(
    () => attendees.filter((person) => !absentees.includes(person.id)),
    [attendees, absentees]
  );
  const currentPerson = activeAttendees.find(
    (person) => identity && getIdentityKey(person) === getIdentityKey(identity)
  );
  const identityForActions = currentPerson;
  const detailItem = items.find((item) => item.id === detailItemId) || null;
  const itemAssignments = detailItem
    ? assignments.filter((assignment) => assignment.itemid === detailItem.id)
    : [];
  const detailsPeople = useMemo(() => {
    const attendeesByKey = new Map(
      attendees.map((person) => [getIdentityKey(person), person])
    );
    return assignments.map((assignment) => ({
      ...assignment,
      participant:
        attendeesByKey.get(`${assignment.membertype}:${assignment.memberid}`) || {
          id: String(assignment.memberid),
          type: assignment.membertype,
          nickname: "참여자",
        },
      requester: attendeesByKey.get(
        `${assignment.requestedbytype}:${assignment.requestedby}`
      ),
    }));
  }, [assignments, attendees]);
  const detailPeople = detailItem
    ? detailsPeople.filter((assignment) => assignment.itemid === detailItem.id)
    : [];
  const summaryItems = useMemo(() => {
    if (!identity) return [];
    const personal = items
      .filter((item) => item.kind === "personal")
      .map((item) => ({
        ...item,
        checked: checks.some(
          (check) =>
            check.itemid === item.id &&
            check.memberid === identity.id &&
            check.membertype === identity.type &&
            check.checked
        ),
        assigned: false,
      }));
    const shared = items
      .filter((item) => item.kind === "shared")
      .filter((item) =>
        assignments.some(
          (assignment) =>
            assignment.itemid === item.id &&
            assignment.memberid === identity.id &&
            assignment.membertype === identity.type &&
            assignment.status === "assigned"
        )
      )
      .map((item) => ({
        ...item,
        checked: assignments.some(
          (assignment) =>
            assignment.itemid === item.id &&
            assignment.memberid === identity.id &&
            assignment.membertype === identity.type &&
            assignment.status === "assigned" &&
            assignment.isdone
        ),
        assigned: true,
      }));
    return [...personal, ...shared];
  }, [items, checks, assignments, identity]);
  const doneCount = summaryItems.filter((item) => item.checked).length;
  const detailMine = identity
    ? detailPeople.find(
        (assignment) =>
          assignment.memberid === identity.id &&
          assignment.membertype === identity.type &&
          assignment.status === "assigned"
      )
    : null;
  const isPast = isSchedulePast(schedule);
  const isReadOnly = isPast || !currentPerson;

  const runAction = async (action, successMessage = "") => {
    try {
      setBusy(true);
      setPageError("");
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (error) {
      setPageError(error.message || "요청을 처리하지 못했습니다.");
    } finally {
      try {
        await refreshPrep();
      } catch (error) {
        setPageError(error.message || "최신 준비물 목록을 불러오지 못했습니다.");
      }
      setBusy(false);
    }
  };

  const handleTogglePersonal = (item) => {
    if (isReadOnly || !identityForActions) return;
    const checked = checks.some(
      (check) =>
        check.itemid === item.id &&
        check.memberid === identityForActions.id &&
        check.membertype === identityForActions.type &&
        check.checked
    );
    runAction(() => setPrepCheck(item.id, identityForActions, !checked));
  };

  const handleClaim = (item) => {
    const own = assignments.find(
      (assignment) =>
        assignment.itemid === item.id &&
        assignment.memberid === identity?.id &&
        assignment.membertype === identity?.type
    );
    const occupied = assignments.filter(
      (assignment) =>
        assignment.itemid === item.id &&
        ["assigned", "requested"].includes(assignment.status)
    ).length;
    if (own || occupied >= item.neededcount) return;
    setClaimItem(item);
    setClaimNote("");
    setClaimAssignmentId(null);
  };

  const submitClaim = async () => {
    if (!claimItem || isReadOnly) return;
    await runAction(
      () => claimAssignmentId
        ? updatePrepAssignment(claimAssignmentId, identityForActions, { note: claimNote.trim() || null })
        : claimPrepItem(claimItem.id, identityForActions, claimNote),
      claimAssignmentId ? "메모를 수정했습니다." : "담당자로 등록했습니다."
    );
    setClaimItem(null);
    setClaimAssignmentId(null);
  };

  const handleCancelAssignment = (assignment) => {
    if (isReadOnly) return;
    const leave = async () => {
      await removePrepAssignment(assignment.id, identityForActions);
      if (assignment.status === "assigned") {
        const item = items.find((candidate) => candidate.id === assignment.itemid);
        const others = activeAttendees.filter(
          (person) => getIdentityKey(person) !== getIdentityKey(identityForActions)
        );
        await Promise.all(
          others.map((person) =>
            createNotification({
              roomId: schedule.roomid,
              receiverId: person.id,
              senderId: identityForActions.id,
              type: "prep_assignment_vacated",
              title: "준비물 담당 자리가 생겼어요",
              message: `"${item?.name || "준비물"}" 담당 자리가 비었습니다.`,
              link: `/schedules/${schedule.id}/prep?vacatedAssignmentId=${assignment.id}`,
            })
          )
        );
      }
    };
    runAction(leave, "담당을 취소했습니다.");
  };

  const handleRequestSubmit = async () => {
    if (!requestTarget || !detailItem || isReadOnly) return;
    const send = async () => {
      const request = await requestPrepAssignment(
        detailItem.id,
        requestTarget,
        identityForActions,
        requestNote
      );
      const requester = activeAttendees.find(
        (person) => getIdentityKey(person) === getIdentityKey(identityForActions)
      );
      await createNotification({
        roomId: schedule.roomid,
        receiverId: requestTarget.id,
        senderId: identityForActions.id,
        type: "prep_assignment_request",
        title: "준비물 부탁이 도착했어요",
        message: `${requester?.nickname || "멤버"}님이 "${detailItem.name}" 준비를 부탁했어요.${requestNote ? ` 메모: ${requestNote}` : ""}`,
        link: `/schedules/${schedule.id}/prep?assignmentId=${request.id}`,
      });
    };
    await runAction(send, "부탁을 보냈습니다.");
    setRequestTarget(null);
    setRequestNote("");
  };

  const handleRequestDecision = (assignment, accepted) => {
    if (isReadOnly) return;
    const decide = async () => {
      const result = await handlePrepRequest(assignment.id, identityForActions, accepted);
      if (!result.requestedby) return;
      const person = activeAttendees.find(
        (candidate) =>
          candidate.id === String(result.requestedby) &&
          candidate.type === result.requestedbytype
      );
      if (person) {
        await createNotification({
          roomId: schedule.roomid,
          receiverId: person.id,
          senderId: identityForActions.id,
          type: "prep_assignment_response",
          title: accepted ? "준비물 부탁을 수락했어요" : "준비물 부탁을 거절했어요",
          message: `"${result.prep_items?.name || "준비물"}" 부탁을 ${accepted ? "수락" : "거절"}했습니다.`,
          link: `/schedules/${schedule.id}/prep?responseAssignmentId=${assignment.id}`,
        });
      }
    };
    runAction(decide, accepted ? "부탁을 수락했습니다." : "부탁을 거절했습니다.");
  };

  const handleAddItem = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !addingKind || isReadOnly) return;
    const count = Math.max(1, Math.min(Number(form.neededCount) || 1, activeAttendees.length || 1));
    const create = async () => {
      const item = await addPrepItem({
        scheduleId: schedule.id,
        roomId: schedule.roomid,
        name: form.name,
        kind: addingKind,
        neededCount: count,
        memo: form.memo,
        createdBy: identityForActions,
      });
      if (addingKind === "shared" && form.selfAssign) {
        await claimPrepItem(item.id, identityForActions);
      }
    };
    await runAction(create, "준비물을 추가했습니다.");
    setAddingKind(null);
    setForm({ name: "", kind: "personal", neededCount: 1, memo: "", selfAssign: false });
  };

  const openEdit = (item) => {
    setEditingItem(item);
    setEditForm({
      name: item.name || "",
      memo: item.memo || "",
    });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editingItem || !editForm.name.trim()) return;
    await runAction(
      () => updatePrepItem(editingItem.id, editForm),
      "준비물을 수정했습니다."
    );
    setEditingItem(null);
  };

  const confirmDelete = async (item) => {
    if (!window.confirm(`"${item.name}" 준비물을 삭제할까요?`)) return;
    await runAction(() => deletePrepItem(item.id), "준비물을 삭제했습니다.");
    setDetailItemId(null);
  };

  const handleAddSeat = (item) => {
    if (isReadOnly || item.neededcount >= activeAttendees.length) return;
    runAction(() => addPrepSeat(item.id, item.neededcount), "담당 자리를 추가했습니다.");
  };

  const openContextSheet = (mode) => {
    if (isReadOnly) return;
    setContextDraft(prepContext);
    setContextSheet(mode);
  };

  const submitContext = async (recommendAfter) => {
    if (!identityForActions) return;
    const changed =
      (contextDraft.category || null) !== (prepContext.category || null) ||
      (contextDraft.note || "").trim() !== (prepContext.note || "").trim();
    try {
      setBusy(true);
      setPageError("");
      if (changed) {
        await savePrepContext(scheduleId, contextDraft, identityForActions);
        setPrepContext({ category: contextDraft.category, note: contextDraft.note.trim() });
      }
      setContextSheet(null);
      if (recommendAfter) {
        setBusy(false);
        await handleRecommend(false);
      } else if (changed && items.length > 0) {
        setNotice("약속 종류가 바뀌었어요. ↻ AI 다시 추천을 눌러 반영해 보세요.");
      }
    } catch (error) {
      setPageError(error.message || "약속 종류를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const skipContextAndRecommend = async () => {
    setContextSheet(null);
    await handleRecommend(false);
  };

  const handleRecommend = async (regenerate) => {
    if (!schedule || isReadOnly || busy) return;
    try {
      setBusy(true);
      setPageError("");
      setNotice("");
      setWeatherError("");
      // 확정/함께 가고 싶은 장소가 없을 때만 현재 위치를 요청한다(권한 거부·실패 시 날씨 없이 추천).
      let userLocation = null;
      const basisCheck = await getPrepWeather(schedule.id).catch(() => null);
      if (basisCheck?.needsLocation) {
        userLocation = await getCurrentPosition().catch((error) => {
          console.error("현재 위치를 가져오지 못해 날씨 없이 추천합니다:", error.message);
          return null;
        });
      }
      const result = await recommendPrepItems(schedule.id, regenerate, userLocation);
      setWeather(result.weather || null);
      setWeatherBasis(result.weatherBasis || "none");
      setWeatherSource(result.weatherSource || null);
      setAir(result.air || null);
      await refreshPrep();
      setNotice(
        result.weatherWarning ||
          (result.items?.length
            ? "AI 추천 준비물을 반영했습니다."
            : "기존 준비물과 이름이 같은 추천 항목은 추가하지 않았습니다.")
      );
    } catch (error) {
      setPageError(error.message || "AI 추천을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const openAdd = (kind) => {
    setForm({
      name: "",
      kind,
      neededCount: 1,
      memo: "",
      selfAssign: false,
    });
    setAddingKind(kind);
  };

  const claimSummary = claimItem
    ? (() => {
        const occupied = assignments.filter(
          (a) => a.itemid === claimItem.id && ["assigned", "requested"].includes(a.status)
        );
        const names = occupied
          .map((a) => attendees.find((p) => p.id === String(a.memberid) && p.type === a.membertype)?.nickname)
          .filter(Boolean);
        return `항목 메모: ${claimItem.memo || "없음"} · ${claimItem.neededcount}명 중 ${occupied.length}명 담당 중${names.length ? `(${names.join(", ")})` : ""}`;
      })()
    : "";

  const memberByKey = useMemo(
    () => new Map(attendees.map((person) => [getIdentityKey(person), person])),
    [attendees]
  );

  if (loading) {
    return <main className="prep-page"><p className="prep-loading">준비물을 불러오는 중...</p></main>;
  }

  return (
    <main className="prep-page">
      <header className="prep-header">
        <button type="button" onClick={() => navigate(-1)} aria-label="뒤로" className="prep-back">←</button>
        <h1>준비물</h1>
      </header>

      {schedule && (
        <div className="prep-info">
          <p className="prep-schedule-line">
            {schedule.title || "모임"} · {formatScheduleDate(schedule)} · {schedule.location || "장소 미정"}
          </p>
          {weather && (
            <p className="prep-weather-line">
              {getWeatherEmoji(weather)} {formatWeather(weather, air)}
              {weatherSource?.label ? ` · ${weatherSource.label} 기준` : ""}
            </p>
          )}
          <button type="button" className="prep-context-edit" disabled={isReadOnly} onClick={() => openContextSheet("edit")}>
            ✎ {prepContext.category ? PREP_EVENT_CATEGORIES.find((c) => c.value === prepContext.category)?.label.replace(/^\S+\s/, "") : "약속 종류"}
            {prepContext.note ? ` · ${prepContext.note}` : ""}
          </button>
        </div>
      )}
      {weatherError && <p className="prep-weather-error">{weatherError}</p>}
      {weatherBasis === "none" && schedule?.date && (
        <p className="prep-location-hint">📍 장소를 정하면 그곳 날씨로 다시 추천해 드려요</p>
      )}
      {isPast && <p className="prep-readonly">지난 일정은 읽기 전용입니다.</p>}
      {!isPast && !currentPerson && <p className="prep-readonly">불참 처리된 참여자는 준비물에 변경할 수 없습니다.</p>}
      {pageError && <p className="prep-error" role="alert">{pageError}</p>}
      {notice && <p className="prep-notice" role="status">{notice}</p>}

      <section className="prep-summary">
        <div className="prep-summary-title">
          <strong>나의 준비 · {doneCount}/{summaryItems.length} 완료</strong>
          <span>{summaryItems.length ? Math.round((doneCount / summaryItems.length) * 100) : 0}%</span>
        </div>
        <div className="prep-progress"><span style={{ width: `${summaryItems.length ? (doneCount / summaryItems.length) * 100 : 0}%` }} /></div>
      </section>

      <div className="prep-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "personal"} className={tab === "personal" ? "active" : ""} onClick={() => setTab("personal")}>
          각자 챙길 것 {items.filter((item) => item.kind === "personal").length}
        </button>
        <button type="button" role="tab" aria-selected={tab === "shared"} className={tab === "shared" ? "active" : ""} onClick={() => setTab("shared")}>
          같이 준비할 것 {items.filter((item) => item.kind === "shared").length}
        </button>
      </div>

      {items.length === 0 && (
        <section className="prep-empty-recommend">
          <p>AI가 일정과 날씨에 맞는 준비물을 추천해 드려요.</p>
          <button type="button" className="prep-primary" disabled={busy || isReadOnly} onClick={() => openContextSheet("recommend")}>
            {busy ? "추천 중..." : "AI로 준비물 추천받기"}
          </button>
        </section>
      )}

      {tab === "personal" ? (
        <section className="prep-list">
          <p className="prep-list-help">모두에게 같은 목록 · 체크는 나만 보여요</p>
          {items.filter((item) => item.kind === "personal").map((item) => {
            const checked = checks.some(
              (check) =>
                check.itemid === item.id &&
                check.memberid === identity?.id &&
                check.membertype === identity?.type &&
                check.checked
            );
            return (
              <label className={`prep-personal-row ${checked ? "is-done" : ""}`} key={item.id}>
                <input type="checkbox" checked={checked} disabled={isReadOnly || busy} onChange={() => handleTogglePersonal(item)} />
                <span className="prep-personal-text"><strong>{item.name}</strong>{item.reason && <small>{item.basis && PREP_BASIS_ICONS[item.basis] ? `${PREP_BASIS_ICONS[item.basis]} ` : ""}{item.reason}</small>}{item.memo && <small>{item.memo}</small>}</span>
                {item.source === "ai" && <span className="prep-ai-badge">AI</span>}
                <button type="button" className="prep-item-delete" aria-label={`${item.name} 삭제`} disabled={isReadOnly || busy} onClick={(event) => { event.preventDefault(); confirmDelete(item); }}>삭제</button>
              </label>
            );
          })}
          {!items.some((item) => item.kind === "personal") && <p className="prep-empty">각자 챙길 준비물이 아직 없습니다.</p>}
          <div className="prep-actions">
            <button type="button" className="prep-outline" disabled={isReadOnly} onClick={() => openAdd("personal")}>＋ 각자 챙길 것 추가</button>
            <button type="button" className="prep-outline" disabled={isReadOnly || busy} onClick={() => handleRecommend(true)}>{busy ? "추천 중..." : "↻ AI 다시 추천"}</button>
          </div>
        </section>
      ) : (
        <section className="prep-list">
          <p className="prep-list-help">항목마다 필요한 인원이 정해져 있어요 · 자리가 남은 항목이 위에 보여요</p>
          {items.filter((item) => item.kind === "shared").sort((a, b) => {
            const availableA = a.neededcount - assignments.filter((x) => x.itemid === a.id && ["assigned", "requested"].includes(x.status)).length;
            const availableB = b.neededcount - assignments.filter((x) => x.itemid === b.id && ["assigned", "requested"].includes(x.status)).length;
            return availableB - availableA;
          }).map((item) => {
            const occupied = assignments.filter(
              (assignment) => assignment.itemid === item.id && ["assigned", "requested"].includes(assignment.status)
            );
            const mine = occupied.find(
              (assignment) => assignment.memberid === identity?.id && assignment.membertype === identity?.type
            );
            const openSeats = Math.max(0, item.neededcount - occupied.length);
            const people = occupied.map((assignment) => ({
              assignment,
              participant: memberByKey.get(`${assignment.membertype}:${assignment.memberid}`) || { id: String(assignment.memberid), type: assignment.membertype, nickname: "참여자" },
            }));
            return (
              <article className="prep-shared-row" key={item.id}>
                <button type="button" className="prep-shared-main" onClick={() => setDetailItemId(item.id)}>
                  <span className="prep-shared-heading">
                    <strong>{item.name}</strong>
                    <span className={occupied.length === item.neededcount ? "prep-count full" : "prep-count"}>{occupied.length}/{item.neededcount}명</span>
                  </span>
                  {item.memo && <small>{item.memo}</small>}
                  {item.reason && <small>{item.basis && PREP_BASIS_ICONS[item.basis] ? `${PREP_BASIS_ICONS[item.basis]} ` : ""}{item.reason}</small>}
                  <span className="prep-assignee-list">
                    {people.map(({ assignment, participant }) => (
                      <span className={`prep-assignee ${assignment.status === "requested" ? "requested" : ""}`} key={assignment.id}>
                        <Avatar participant={participant} done={assignment.status === "assigned" && assignment.isdone} />
                        {assignment.status === "requested" && <small>부탁 대기</small>}
                      </span>
                    ))}
                    {Array.from({ length: openSeats }).map((_, index) => <span className="prep-empty-seat" key={`empty-${index}`}>＋</span>)}
                  </span>
                </button>
                {!assignments.some(
                  (assignment) =>
                    assignment.itemid === item.id &&
                    assignment.status === "assigned"
                ) && <p className="prep-unassigned">⚠ 아직 담당자가 없어요 · 전날 알림</p>}
                <div className="prep-shared-actions">
                  {mine?.status === "assigned" ? (
                    <button type="button" disabled={isReadOnly || busy} className="prep-outline compact" onClick={() => handleCancelAssignment(mine)}>맡음 · 취소</button>
                  ) : mine?.status === "requested" ? (
                    <button type="button" disabled={isReadOnly || busy} className="prep-outline compact" onClick={() => handleRequestDecision(mine, true)}>부탁 수락</button>
                  ) : openSeats > 0 ? (
                    <button type="button" disabled={isReadOnly || busy} className="prep-primary compact" onClick={() => handleClaim(item)}>내가 할게요</button>
                  ) : <span className="prep-full-label">✓ 다 정해졌어요</span>}
                </div>
              </article>
            );
          })}
          {!items.some((item) => item.kind === "shared") && <p className="prep-empty">같이 준비할 항목이 아직 없습니다.</p>}
          <button type="button" className="prep-outline prep-add-wide" disabled={isReadOnly} onClick={() => openAdd("shared")}>＋ 같이 준비할 것 추가</button>
        </section>
      )}

      {addingKind && (
        <div className="prep-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddingKind(null); }}>
          <form className="prep-sheet" onSubmit={handleAddItem}>
            <SheetGrabber onClose={() => setAddingKind(null)} />
            <div className="prep-sheet-title"><h2>준비물 추가</h2></div>
            <label>이름<input autoFocus maxLength={60} value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required placeholder="예: 돗자리" /></label>
            <label>누가 챙기나요?
              <select value={form.kind} onChange={(event) => { setForm((prev) => ({ ...prev, kind: event.target.value })); setAddingKind(event.target.value); }}>
                <option value="personal">각자 챙기기</option><option value="shared">같이 준비하기</option>
              </select>
            </label>
            {form.kind === "shared" && (
              <>
                <label>필요한 사람 수
                  <span className="prep-stepper">
                    <button type="button" disabled={form.neededCount <= 1} onClick={() => setForm((prev) => ({ ...prev, neededCount: Math.max(1, prev.neededCount - 1) }))}>−</button>
                    <strong>{form.neededCount}명</strong>
                    <button type="button" disabled={form.neededCount >= activeAttendees.length} onClick={() => setForm((prev) => ({ ...prev, neededCount: Math.min(activeAttendees.length, prev.neededCount + 1) }))}>＋</button>
                  </span>
                </label>
                <label className="prep-check-label"><input type="checkbox" checked={form.selfAssign} onChange={(event) => setForm((prev) => ({ ...prev, selfAssign: event.target.checked }))} /> 나도 담당할게요</label>
              </>
            )}
            <label>메모 (선택)<textarea maxLength={160} value={form.memo} onChange={(event) => setForm((prev) => ({ ...prev, memo: event.target.value }))} placeholder="예: 큰 사이즈로" /></label>
            <button type="submit" className="prep-primary prep-submit" disabled={busy || !form.name.trim()}>추가하기</button>
          </form>
        </div>
      )}

      {claimItem && (
        <div className="prep-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setClaimItem(null); }}>
          <section className="prep-sheet">
            <SheetGrabber onClose={() => { setClaimItem(null); setClaimAssignmentId(null); }} />
            <div className="prep-sheet-title"><h2>{claimItem.name} {claimAssignmentId ? "메모 수정" : "담당하기"}</h2></div>
            <p className="prep-sheet-description">{claimSummary}</p>
            <label>메모 (선택) · 다른 멤버에게 보여요
              <input maxLength={30} value={claimNote} onChange={(event) => setClaimNote(event.target.value)} />
            </label>
            <span className="prep-char-count">{claimNote.length}/30</span>
            <div className="prep-note-chips">{QUICK_NOTES.map((note) => <button type="button" key={note} onClick={() => setClaimNote(note)}>{note}</button>)}</div>
            <button type="button" className="prep-primary prep-submit" disabled={busy} onClick={submitClaim}>{claimAssignmentId ? "저장" : "내가 할게요"}</button>
          </section>
        </div>
      )}

      {detailItem && (
        <div className="prep-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailItemId(null); }}>
          <section className="prep-sheet prep-detail-sheet">
            <SheetGrabber onClose={() => setDetailItemId(null)} />
            <div className="prep-sheet-title">
              <h2>{detailItem.name}</h2>
              <div><button type="button" disabled={isReadOnly} onClick={() => openEdit(detailItem)}>항목 수정</button><button type="button" disabled={isReadOnly} onClick={() => confirmDelete(detailItem)}>삭제</button></div>
            </div>
            <p className="prep-sheet-description">{detailItem.memo || "메모 없음"} · 필요 {detailItem.neededcount}명 중 {itemAssignments.filter((a) => ["assigned", "requested"].includes(a.status)).length}명 담당</p>
            {detailPeople.map((entry) => (
              <div className="prep-detail-person" key={entry.id}>
                <Avatar participant={entry.participant} done={entry.status === "assigned" && entry.isdone} />
                <div className="prep-detail-person-info">
                  <strong>{entry.participant.nickname}{entry.memberid === identity?.id && entry.membertype === identity?.type ? <small> 내 담당 · <button type="button" disabled={isReadOnly} onClick={() => { setDetailItemId(null); setClaimItem(detailItem); setClaimNote(entry.note || ""); setClaimAssignmentId(entry.id); }}>수정</button></small> : null}</strong>
                  <span>메모: {entry.note || "없음"}</span>
                </div>
                <span className={`prep-assignment-state ${entry.status === "requested" ? "waiting" : entry.isdone ? "done" : ""}`}>
                  {entry.status === "requested" ? "부탁 보냄 · 대기" : entry.isdone ? "✓ 챙겼어요" : "준비 전"}
                </span>
                {entry.status === "requested" && entry.memberid === identity?.id && entry.membertype === identity?.type && (
                  <div className="prep-inline-actions">
                    <button type="button" disabled={busy || isReadOnly} onClick={() => handleRequestDecision(entry, true)}>수락</button>
                    <button type="button" disabled={busy || isReadOnly} onClick={() => handleRequestDecision(entry, false)}>거절</button>
                  </div>
                )}
              </div>
            ))}
            {Array.from({ length: Math.max(0, detailItem.neededcount - itemAssignments.filter((a) => ["assigned", "requested"].includes(a.status)).length) }).map((_, index) => (
              <div className="prep-vacant-row" key={`vacant-${index}`}>
                <span className="prep-empty-seat">＋</span><strong>빈자리</strong>
                <button type="button" disabled={isReadOnly || busy} onClick={() => { setRequestTarget({}); setRequestNote(""); }}>부탁하기</button>
                {!itemAssignments.some((a) => a.memberid === identity?.id && a.membertype === identity?.type) && (
                  <button type="button" className="prep-primary compact" disabled={isReadOnly || busy} onClick={() => handleClaim(detailItem)}>내가 할게요</button>
                )}
              </div>
            ))}
            {!isReadOnly && detailItem.neededcount < activeAttendees.length && (
              <button type="button" className="prep-outline prep-add-seat" disabled={busy} onClick={() => handleAddSeat(detailItem)}>＋ 담당 자리 추가 (필요 {detailItem.neededcount}명 → {detailItem.neededcount + 1}명)</button>
            )}
            {detailMine && !isReadOnly && (
              <div className="prep-detail-footer">
                <button type="button" className="prep-outline" disabled={busy} onClick={() => handleCancelAssignment(detailMine)}>담당 그만하기</button>
                <button type="button" className="prep-primary" disabled={busy} onClick={() => runAction(() => updatePrepAssignment(detailMine.id, identityForActions, { isdone: !detailMine.isdone, doneat: detailMine.isdone ? null : new Date().toISOString() }))}>{detailMine.isdone ? "준비 완료 취소" : "✓ 준비 완료"}</button>
              </div>
            )}
          </section>
        </div>
      )}

      {requestTarget && detailItem && (
        <div className="prep-overlay prep-overlay-top" onMouseDown={(event) => { if (event.target === event.currentTarget) setRequestTarget(null); }}>
          <section className="prep-sheet prep-request-sheet">
            <SheetGrabber onClose={() => setRequestTarget(null)} />
            <div className="prep-sheet-title"><h2>{detailItem.name} · 부탁하기</h2></div>
            <p className="prep-sheet-description">빈자리 {Math.max(0, detailItem.neededcount - itemAssignments.filter((a) => ["assigned", "requested"].includes(a.status)).length)}개 · 부탁받은 친구가 수락하면 담당이 돼요</p>
            <strong>누구에게 부탁할까요?</strong>
            <div className="prep-request-list">
              {activeAttendees.filter((person) => {
                if (getIdentityKey(person) === getIdentityKey(identityForActions)) return false;
                return !itemAssignments.some((a) => a.memberid === person.id && a.membertype === person.type);
              }).map((person) => {
                const selected = requestTarget.id === person.id && requestTarget.type === person.type;
                const currentlyAssigned = assignments
                  .filter(
                    (assignment) =>
                      assignment.memberid === person.id &&
                      assignment.membertype === person.type &&
                      assignment.status === "assigned"
                  )
                  .map((assignment) =>
                    items.find((item) => item.id === assignment.itemid)?.name
                  )
                  .filter(Boolean);
                return <button type="button" className={selected ? "selected" : ""} key={getIdentityKey(person)} onClick={() => setRequestTarget(person)}><Avatar participant={person} /><span><strong>{person.nickname}</strong><small>{currentlyAssigned.length ? `${currentlyAssigned.join(", ")} 담당 중` : "아직 담당 없음"}</small></span><span>{selected ? "✓" : "○"}</span></button>;
              })}
            </div>
            <label>메모 (선택)<input maxLength={30} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} /></label>
            <span className="prep-char-count">{requestNote.length}/30</span>
            <button type="button" className="prep-primary prep-submit" disabled={busy || !requestTarget.id} onClick={handleRequestSubmit}>부탁 보내기</button>
          </section>
        </div>
      )}

      {contextSheet && (
        <div className="prep-overlay prep-overlay-top" onMouseDown={(event) => { if (event.target === event.currentTarget) setContextSheet(null); }}>
          <section className="prep-sheet">
            <SheetGrabber onClose={() => setContextSheet(null)} />
            <div className="prep-sheet-title"><h2>어떤 약속인가요? (선택)</h2></div>
            <p className="prep-sheet-description">약속 종류를 알려주면 더 맞는 준비물을 추천해요</p>
            <div className="prep-note-chips prep-context-chips">
              {PREP_EVENT_CATEGORIES.map((category) => (
                <button
                  type="button"
                  key={category.value}
                  className={contextDraft.category === category.value ? "selected" : ""}
                  onClick={() => setContextDraft((prev) => ({ ...prev, category: prev.category === category.value ? null : category.value }))}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <label>한 줄 설명 (선택)
              <input maxLength={40} value={contextDraft.note} placeholder="예: 아이유 콘서트 · 스탠딩" onChange={(event) => setContextDraft((prev) => ({ ...prev, note: event.target.value }))} />
            </label>
            <span className="prep-char-count">{contextDraft.note.length}/40</span>
            {contextSheet === "recommend" ? (
              <div className="prep-detail-footer">
                <button type="button" className="prep-outline" disabled={busy} onClick={skipContextAndRecommend}>건너뛰고 추천받기</button>
                <button type="button" className="prep-primary" disabled={busy} onClick={() => submitContext(true)}>이걸로 추천받기</button>
              </div>
            ) : (
              <div className="prep-detail-footer">
                <button type="button" className="prep-outline" disabled={busy} onClick={() => setContextSheet(null)}>취소</button>
                <button type="button" className="prep-primary" disabled={busy} onClick={() => submitContext(false)}>저장</button>
              </div>
            )}
          </section>
        </div>
      )}

      {editingItem && (
        <div className="prep-overlay prep-overlay-top" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingItem(null); }}>
          <form className="prep-sheet" onSubmit={saveEdit}>
            <SheetGrabber onClose={() => setEditingItem(null)} />
            <div className="prep-sheet-title"><h2>준비물 수정</h2></div>
            <label>이름<input maxLength={60} required value={editForm.name} onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))} /></label>
            <label>메모<textarea maxLength={160} value={editForm.memo} onChange={(event) => setEditForm((prev) => ({ ...prev, memo: event.target.value }))} /></label>
            <button type="submit" className="prep-primary prep-submit" disabled={busy}>저장</button>
          </form>
        </div>
      )}
    </main>
  );
}

export default PrepChecklistPage;
