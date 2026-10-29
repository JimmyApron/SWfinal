import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiImage, FiPlus } from "react-icons/fi";
import { createLightningMeeting, getCalendarDiaryThumbnails, getMeetingDiaryProgress, getRoomDiaries, getRoomDiaryIdentity, getRoomMeetings } from "../../api/meetupDiaryApi";
import "./RoomCalendar.css";

const WEEKDAYS = ["\uC77C", "\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0"];
const pad = (value) => String(value).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const getTodayInSeoul = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

function RoomCalendarTab({ roomId, participants = [], settingsOpen = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [month, setMonth] = useState(() => {
    const requestedDate = new URLSearchParams(window.location.search).get("date");
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return new Date(`${requestedDate}T12:00:00`);
    try { const saved = JSON.parse(sessionStorage.getItem(`room-calendar-state:${roomId}`) || "null"); if (saved?.month) return new Date(`${saved.month}T12:00:00`); } catch {}
    const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [identity, setIdentity] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [allMeetings, setAllMeetings] = useState([]);
  const [diaries, setDiaries] = useState([]);
  const [diariesLoaded, setDiariesLoaded] = useState(false);
  const [diaryCovers, setDiaryCovers] = useState({});
  const [selectedDate, setSelectedDate] = useState(() => {
    const requestedDate = new URLSearchParams(window.location.search).get("date");
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return requestedDate;
    try { return JSON.parse(sessionStorage.getItem(`room-calendar-state:${roomId}`) || "null")?.selectedDate || ""; } catch { return ""; }
  });
  const [selectedMeetingIndex, setSelectedMeetingIndex] = useState(() => { try { return JSON.parse(sessionStorage.getItem(`room-calendar-state:${roomId}`) || "null")?.selectedMeetingIndex || 0; } catch { return 0; } });
  const [meetingProgressById, setMeetingProgressById] = useState({});
  const [showLightning, setShowLightning] = useState(false);
  const [showDiarySavedToast, setShowDiarySavedToast] = useState(false);
  const [lightningTitle, setLightningTitle] = useState("");
  const [lightningTitleError, setLightningTitleError] = useState(false);
  const [lightningParticipantIds, setLightningParticipantIds] = useState([]);
  const [authUserId, setAuthUserId] = useState(null);
  const [lightningLocation, setLightningLocation] = useState("");
  const [lightningStart, setLightningStart] = useState("");
  const [lightningEnd, setLightningEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingLightning, setSavingLightning] = useState(false);
  const lightningRequestIdRef = useRef(null);
  const [error, setError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [today, setToday] = useState(getTodayInSeoul);
  const firstDay = dateKey(month);
  const lastDay = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));

  const load = useCallback(async ({ initialize = false } = {}) => {
    setLoading(true);
    setDiariesLoaded(false);
    setError("");
    try {
      let currentIdentity = identity;
      if (initialize || !currentIdentity) {
        const auth = await getRoomDiaryIdentity(roomId);
        currentIdentity = auth.identityId;
        setIdentity(currentIdentity);
        setAuthUserId(auth.user?.id || null);
        if (!auth.user) {
          setAuthMessage("\uBC29 \uACF5\uD1B5 \uCE98\uB9B0\uB354\uC640 \uAE30\uB85D\uC740 \uD68C\uC6D0 \uC778\uC99D\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uAE30\uC874 \uAC8C\uC2A4\uD2B8 \uACC4\uC815\uC758 guest_id\uB294 \uAE30\uB85D \uAD8C\uD55C \uD655\uC778\uC5D0 \uC0AC\uC6A9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
          setMeetings([]); setAllMeetings([]);
          setDiaries([]);
          return;
        }
        if (!currentIdentity) {
          setAuthMessage("\uD604\uC7AC \uACC4\uC815\uC740 \uC774 \uBC29\uC758 \uD65C\uC131 \uD68C\uC6D0\uC774 \uC544\uB2D9\uB2C8\uB2E4.");
          setMeetings([]); setAllMeetings([]);
          setDiaries([]);
          return;
        }
        setAuthMessage("");
      }
      const [monthMeetings, roomMeetings] = await Promise.all([
        getRoomMeetings(roomId, firstDay, lastDay),
        getRoomMeetings(roomId),
      ]);
      const monthDiaries = await getRoomDiaries(roomId, roomMeetings.map((meeting) => meeting.id));
      const monthMeetingIds = new Set(monthMeetings.map((meeting) => meeting.id));
      const visibleRoomDiaryIds = monthDiaries
        .filter((diary) => monthMeetingIds.has(diary.meeting_id) && diary.status === "published" && diary.visibility === "room")
        .map((diary) => diary.id);
      const thumbnails = await getCalendarDiaryThumbnails(visibleRoomDiaryIds);
      setMeetings(monthMeetings);
      setAllMeetings(roomMeetings);
      setDiaries(monthDiaries);
      setDiaryCovers(thumbnails);
      setDiariesLoaded(true);
    } catch (loadError) {
      setError(loadError.message || "캘린더를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [firstDay, identity, lastDay, roomId]);

  useEffect(() => { load({ initialize: true }); }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (identity) load(); }, [firstDay, identity, lastDay, load]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedDate = params.get("date");
    const requestedMeetingId = params.get("meetingId");
    if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return;
    setMonth(new Date(`${requestedDate}T12:00:00`));
    setSelectedDate(requestedDate);
    if (requestedMeetingId) {
      const sameDateMeetings = meetings.filter((meeting) => meeting.meeting_date === requestedDate);
      const index = sameDateMeetings.findIndex((meeting) => meeting.id === requestedMeetingId);
      if (index >= 0) setSelectedMeetingIndex(index);
    }
  }, [location.search, meetings]);
  useEffect(() => {
    const nextMidnight = new Date(`${today}T00:00:00+09:00`).getTime() + 24 * 60 * 60 * 1000;
    const midnightTimer = window.setTimeout(() => setToday(getTodayInSeoul()), Math.max(0, nextMidnight - Date.now()));
    const refresh = () => {
      setToday(getTodayInSeoul());
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearTimeout(midnightTimer); window.removeEventListener("pageshow", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load, today]);

  const meetingGroups = useMemo(() => meetings.reduce((groups, meeting) => {
    groups[meeting.meeting_date] = [...(groups[meeting.meeting_date] || []), meeting];
    return groups;
  }, {}), [meetings]);
  const publishedDiaryDates = useMemo(() => new Set(diaries
    .filter((diary) => diary.status === "published")
    .map((diary) => meetingForDiary(diary, meetings)?.meeting_date)
    .filter(Boolean)), [diaries, meetings]);
  const firstPublicDiaryByDate = useMemo(() => {
    return diaries.reduce((records, diary) => {
      if (diary.status !== "published" || diary.visibility !== "room") return records;
      const meeting = meetingForDiary(diary, meetings);
      if (meeting && !records[meeting.meeting_date]) records[meeting.meeting_date] = diary;
      return records;
    }, {});
  }, [diaries, meetings]);
  const diaryCoversByDate = useMemo(() => Object.entries(firstPublicDiaryByDate).reduce((covers, [date, diary]) => {
    if (diaryCovers[diary.id]) covers[date] = diaryCovers[diary.id];
    return covers;
  }, {}), [diaryCovers, firstPublicDiaryByDate]);
  const diaryCountsByDate = useMemo(() => diaries.reduce((counts, diary) => {
    const date = meetingForDiary(diary, meetings)?.meeting_date;
    if (date) counts[date] = (counts[date] || 0) + 1;
    return counts;
  }, {}), [diaries, meetings]);
  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = first.getDay();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const weekCount = Math.ceil((offset + daysInMonth) / 7);
    return Array.from({ length: weekCount * 7 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index - offset + 1));
  }, [month]);
  const selectedMeetings = meetingGroups[selectedDate] || [];
  const selectedDateHasLightning = selectedMeetings.some((meeting) => meeting.source_type === "lightning" && meeting.lifecycle_status !== "cancelled");
  const activeMeetingIndex = selectedMeetings.length ? selectedMeetingIndex % selectedMeetings.length : 0;
  const activeMeeting = selectedMeetings[activeMeetingIndex];
  const activeMeetingProgress = activeMeeting ? meetingProgressById[activeMeeting.id] : null;
  const activeRecord = activeMeeting ? diaries.find((diary) => diary.meeting_id === activeMeeting.id && diary.author_identity_id === identity) : null;
  const isActiveRecordPublished = Boolean(diariesLoaded && activeRecord?.status === "published");
  const activePublishedMemberIds = new Set(activeMeetingProgress?.published_member_ids || []);
  const activeMeetingOrdinal = activeMeeting ? allMeetings.findIndex((meeting) => meeting.id === activeMeeting.id) + 1 : 0;
  const activeMeetingDiaryCount = activeMeetingProgress?.published_count;
  const selectedMeetingIdsKey = selectedMeetings.map((meeting) => meeting.id).join(",");
  const selectedDateLabel = selectedDate
    ? new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${selectedDate}T12:00:00`))
    : "";
  const canCreateLightning = Boolean(selectedDate && selectedDate <= today);
  const showEmptyDayPrompt = selectedMeetings.length === 0 && canCreateLightning;

  useEffect(() => {
    sessionStorage.setItem(`room-calendar-state:${roomId}`, JSON.stringify({ month: dateKey(month), selectedDate, selectedMeetingIndex }));
  }, [month, roomId, selectedDate, selectedMeetingIndex]);

  useEffect(() => {
    if (!location.state?.diaryAutoSavedToast) return undefined;
    setShowDiarySavedToast(true);
    const { diaryAutoSavedToast, ...nextState } = location.state;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: nextState });
  }, [location.key, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!showDiarySavedToast) return undefined;
    const timer = window.setTimeout(() => setShowDiarySavedToast(false), 2600);
    return () => window.clearTimeout(timer);
  }, [showDiarySavedToast]);

  useEffect(() => {
    const meetingIds = selectedMeetingIdsKey ? selectedMeetingIdsKey.split(",") : [];
    if (meetingIds.length === 0 || !identity || !diariesLoaded) {
      setMeetingProgressById({});
      return undefined;
    }
    let active = true;
    setMeetingProgressById({});
    Promise.all(meetingIds.map(async (meetingId) => {
      try {
        return [meetingId, await getMeetingDiaryProgress(meetingId)];
      } catch (progressError) {
        if (active) setError(progressError.message || "기록 현황을 불러오지 못했습니다.");
        return [meetingId, null];
      }
    })).then((entries) => {
      if (active) setMeetingProgressById(Object.fromEntries(entries.filter(([, progress]) => progress)));
    });
    return () => { active = false; };
  }, [diariesLoaded, identity, selectedMeetingIdsKey]);

  function openMeetingRecords(meetingId) {
    navigate(`/rooms/${roomId}/meetings/${meetingId}/diary`, { state: { from: `${location.pathname}${location.search}` } });
  }

  function openDiaryEditor(meeting, selectedIndex) {
    const nextSelectedDate = meeting.meeting_date;
    const nextMeetingIndex = Number.isInteger(selectedIndex) && selectedIndex >= 0
      ? selectedIndex
      : (meetingGroups[nextSelectedDate] || []).findIndex((item) => item.id === meeting.id);
    sessionStorage.setItem(`room-calendar-state:${roomId}`, JSON.stringify({
      month: dateKey(month),
      selectedDate: nextSelectedDate,
      selectedMeetingIndex: Math.max(0, nextMeetingIndex),
    }));
    setSelectedDate(nextSelectedDate);
    setSelectedMeetingIndex(Math.max(0, nextMeetingIndex));
    navigate(`/rooms/${roomId}/meetings/${meeting.id}/diary/edit`, { state: { from: `${location.pathname}${location.search}` } });
  }

  function openLightningForm() {
    setLightningParticipantIds([]);
    setLightningTitleError(false);
    setLightningTitle(""); setLightningLocation(""); setLightningStart(""); setLightningEnd("");
    setError("");
    lightningRequestIdRef.current = null;
    setShowLightning(true);
  }

  function toggleLightningParticipant(userId) {
    setLightningParticipantIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  }

  async function refreshCalendar() { await load(); }

  const submitLightning = async (event) => {
    event.preventDefault();
    if (!lightningTitle.trim()) {
      setLightningTitleError(true);
      return;
    }
    if (savingLightning) return;
    setLightningTitleError(false);
    setError("");
    try {
      setSavingLightning(true);
      lightningRequestIdRef.current ||= crypto.randomUUID();
      await createLightningMeeting({ roomId, date: selectedDate, title: lightningTitle.trim(), startTime: lightningStart, endTime: lightningEnd, location: lightningLocation.trim(), participantUserIds: lightningParticipantIds, requestId: lightningRequestIdRef.current });
      const date = new Date(`${selectedDate}T12:00:00`);
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      setSelectedMeetingIndex(0);
      await refreshCalendar();
      lightningRequestIdRef.current = null;
      setShowLightning(false);
    } catch (createError) { setError(createError.message || "\uBC88\uAC1C \uB9CC\uB0A8 \uB4F1\uB85D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."); }
    finally { setSavingLightning(false); }
  };

  return (
    <main className={`room-calendar-page ${settingsOpen ? "is-room-settings-open" : ""}`}>
      {authMessage && <div className="calendar-notice" role="status">{authMessage}</div>}
      {error && <div className="calendar-error" role="alert">{error}<button type="button" onClick={refreshCalendar}>&#xB2E4;&#xC2DC; &#xBD88;&#xB7EC;&#xC624;&#xAE30;</button></div>}
      <section className="room-calendar-card" aria-label="&#xBC29; &#xACF5;&#xD1B5; &#xC6D4;&#xAC04; &#xCE98;&#xB9B0;&#xB354">
        <header className="room-calendar-month"><button type="button" aria-label="&#xC774;&#xC804; &#xB2EC;" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><strong>{month.getFullYear()}년 {month.getMonth() + 1}월</strong><button type="button" aria-label="&#xB2E4;&#xC74C; &#xB2EC;" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></header>
        <div className="room-calendar-summary-row"><p className="room-calendar-summary">이번 달 {meetings.filter((meeting) => meeting.lifecycle_status !== "cancelled").length}건 만남이에요</p><button type="button" className="calendar-collection-button" disabled={!identity} onClick={() => navigate(`/rooms/${roomId}/diaries`, { state: { from: `${location.pathname}${location.search}` } })}>기록 모아보기</button></div>
        <div className="room-calendar-grid room-calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="room-calendar-grid room-calendar-days">{calendarDays.map((date) => {
          const key = dateKey(date);
          const dayMeetings = meetingGroups[key] || [];
          const outside = date.getMonth() !== month.getMonth();
          const needsRecord = Boolean(identity && key <= today && dayMeetings.some((meeting) => meeting.lifecycle_status !== "cancelled") && !dayMeetings.some((meeting) => diaries.some((diary) => diary.meeting_id === meeting.id && diary.author_identity_id === identity && diary.status === "published")));
          const recordMeeting = dayMeetings.find((meeting) => meeting.lifecycle_status !== "cancelled" && meeting.meeting_date <= today && !diaries.some((diary) => diary.meeting_id === meeting.id && diary.author_identity_id === identity && diary.status === "published"));
          const hasLightning = dayMeetings.some((meeting) => meeting.source_type === "lightning" && meeting.lifecycle_status !== "cancelled");
          const hasUpcomingMeeting = dayMeetings.some((meeting) => meeting.source_type !== "lightning" && meeting.lifecycle_status !== "cancelled" && meeting.meeting_date > today);
          return <div className="room-calendar-day-wrap" key={key}>
            <button type="button" className={`room-calendar-day ${diaryCoversByDate[key] ? "has-cover" : ""} ${hasUpcomingMeeting ? "upcoming" : ""} ${outside ? "outside" : ""} ${selectedDate === key ? "selected" : ""} ${key === today ? "today" : ""}`} onClick={() => { setSelectedDate(key); setSelectedMeetingIndex(0); }}>
              <span className="room-calendar-day-number">{date.getDate()}</span>
              {publishedDiaryDates.has(key) && <CalendarDayThumbnail src={diaryCoversByDate[key]} />}
              {hasLightning && <span className="room-calendar-lightning" aria-label="Lightning meeting">&#x26A1;&#xFE0F;</span>}
              {diaryCountsByDate[key] > 0 ? <small className="room-calendar-record-count-badge">{diaryCountsByDate[key]}</small> : dayMeetings.length > 1 && <small>{dayMeetings.length}</small>}
            </button>
            {needsRecord && recordMeeting && <button type="button" className="room-calendar-record-action" aria-label="Add diary" title="Add diary" onClick={(event) => { event.stopPropagation(); openDiaryEditor(recordMeeting, dayMeetings.findIndex((meeting) => meeting.id === recordMeeting.id)); }}><FiPlus aria-hidden="true" /></button>}
          </div>;
        })}</div>
        <div className="room-calendar-legend"><span><i className="scheduled" />약속 예정</span><span><i className="record-add"><FiPlus aria-hidden="true" /></i>기록 남기</span><span><i className="record-image"><FiImage aria-hidden="true" /></i>기록 있음</span><span><b>&#x26A1;&#xFE0F;</b>번개 만남</span></div>
      </section>
      {loading && <p className="calendar-loading">캘린더를 불러오는 중...</p>}
      {selectedDate && <section className={`calendar-selected-section ${showEmptyDayPrompt ? "has-empty-day-prompt" : ""}`} aria-label={`Selected date ${selectedDate}`}>
        <div className="calendar-sheet-handle" aria-hidden="true" />
        <header className="calendar-selected-heading"><h2>{selectedDateLabel}</h2>{activeMeeting && <span className="calendar-meeting-badge">{activeMeeting.source_type === "lightning" && <span aria-hidden="true">&#x26A1;&#xFE0F;</span>}{activeMeeting.source_type === "lightning" ? "\uBC88\uAC1C" : "\uC57D\uC18D"}&#xB7; {activeMeetingOrdinal}&#xBC88;&#xC9F8; &#xB9CC;&#xB0A8;</span>}{showEmptyDayPrompt && <span className="calendar-empty-day-badge">&#xC57D;&#xC18D; &#xC5C6;&#xC74C;</span>}{activeMeeting && !selectedDateHasLightning && canCreateLightning && identity && <button type="button" className="calendar-lightning-button" onClick={openLightningForm}>&#xFF0B; &#xBC88;&#xAC1C; &#xB9CC;&#xB0A8; &#xB4F1;&#xB85D;</button>}</header>
        {selectedMeetings.length === 0 && (showEmptyDayPrompt
          ? <div className="calendar-empty-day-prompt"><span className="calendar-empty-day-icon" aria-hidden="true">&#x26A1;&#xFE0F;</span><strong>&#xC774; &#xB0A0; &#xCE5C;&#xAD6C;&#xB4E4;&#xC744; &#xB9CC;&#xB0AC;&#xB098;&#xC694;?</strong><p>&#xC571;&#xC5D0;&#xC11C; &#xC815;&#xD558;&#xC9C0; &#xC54A;&#xC740; &#xBC88;&#xAC1C; &#xB9CC;&#xB0A8;&#xB3C4; &#xAE30;&#xB85D;&#xD560; &#xC218; &#xC788;&#xC5B4;&#xC694;</p><button type="button" className="calendar-empty-day-cta" disabled={!identity} onClick={openLightningForm}>&#x26A1;&#xFE0F; &#xBC88;&#xAC1C; &#xB9CC;&#xB0A8; &#xAE30;&#xB85D;&#xD558;&#xAE30;</button></div>
          : <div className="calendar-empty-meeting"><p>&#xB4F1;&#xB85D;&#xB41C; &#xB9CC;&#xB0A8;&#xC774; &#xC5C6;&#xC2B5;&#xB2C8;&#xB2E4;.</p></div>)}
        {selectedMeetings.length > 0 && <div className={`calendar-meeting-carousel ${selectedMeetings.length > 1 ? "has-multiple" : "single"} ${!isActiveRecordPublished && activeMeeting?.meeting_date <= today ? "has-record-hint" : ""}`}>
          {selectedMeetings.length > 1 && <button type="button" className="calendar-meeting-arrow previous" aria-label="&#xC774;&#xC804; &#xB9CC;&#xB0A8;" onClick={() => setSelectedMeetingIndex((activeMeetingIndex - 1 + selectedMeetings.length) % selectedMeetings.length)}>&#x2039;</button>}
          {activeMeeting && <article key={activeMeeting.id} className={`calendar-meeting-card ${isActiveRecordPublished ? "is-complete" : ""}`}>
              <button type="button" className="calendar-meeting-summary" disabled={activeMeeting.meeting_date > today} onClick={() => openMeetingRecords(activeMeeting.id)} aria-label={`${activeMeeting.title || "\uC57D\uC18D"} \uAE30\uB85D \uC0C1\uC138 \uBCF4\uAE30`}>
              <div className="calendar-meeting-summary-main">
                <div className="calendar-meeting-info">
                  <strong>{activeMeeting.title || (activeMeeting.source_type === "lightning" ? "\uBC88\uAC1C \uB9CC\uB0A8" : "\uD655\uC815 \uC77C\uC815")}</strong>
                  <span>{activeMeeting.start_time ? new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(`2000-01-01T${activeMeeting.start_time}`)) : "\uD558\uB8E8 \uC885\uC77C"}{activeMeeting.location ? ` ? ?? ${activeMeeting.location}` : ""}</span>
                  {activeMeeting.lifecycle_status === "cancelled" && <em>痍⑥냼???쇱젙</em>}
                </div>
                {activeMeeting.meeting_date <= today && <span className="calendar-meeting-chevron" aria-hidden="true">&#x203A;</span>}
              </div>
              <div className="calendar-meeting-participants">
                <div className="calendar-participant-avatars" aria-label={`참여 인원 ${participants.length}명`}>
                  {participants.slice(0, 4).map((participant) => <span className={`calendar-participant-avatar ${activePublishedMemberIds.has(String(participant.userid)) ? "written" : "unwritten"}`} key={participant.userid || participant.id} title={participant.nickname}>
                    {participant.profiles?.profileimageurl ? <img src={participant.profiles.profileimageurl} alt="" /> : participant.nickname?.trim()?.slice(0, 1) || "?"}
                  </span>)}
                  {participants.length > 4 && <span className="calendar-participant-avatar calendar-participant-more">+{participants.length - 4}</span>}
                </div>
                <span className="calendar-record-count">{activeMeetingDiaryCount ?? "\u2014"}/{activeMeetingProgress?.target_count ?? participants.length}&#xBA85; &#xAE30;&#xB85D;</span>
                {isActiveRecordPublished && <span className="calendar-record-complete-label">&#x2713; &#xB0B4; &#xAE30;&#xB85D; &#xC791;&#xC131; &#xC644;&#xB8CC;</span>}
              </div>
              </button>
              {activeMeeting.meeting_date > today && <div className="calendar-upcoming-record"><button type="button" disabled>&#xAE30;&#xB85D;&#xC740; {new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(`${activeMeeting.meeting_date}T12:00:00+09:00`))}&#xBD80;&#xD130; &#xC791;&#xC131;&#xD560; &#xC218; &#xC788;&#xC5B4;&#xC694;</button></div>}
              {!isActiveRecordPublished && activeMeeting.meeting_date <= today && <button type="button" className="calendar-record-cta" disabled={!identity} onClick={() => openDiaryEditor(activeMeeting, activeMeetingIndex)}>&#xAE30;&#xB85D; &#xC4F0;&#xAE30;</button>}
          </article>}
          {!isActiveRecordPublished && activeMeeting?.meeting_date <= today && <p className="calendar-record-hint">오늘의 만남은 어떠셨나요? 하루의 기록을 남겨보세요.</p>}
          {selectedMeetings.length > 1 && <button type="button" className="calendar-meeting-arrow next" aria-label="Next meeting" onClick={() => setSelectedMeetingIndex((activeMeetingIndex + 1) % selectedMeetings.length)}>&#x203A;</button>}
          {selectedMeetings.length > 1 && <span className="calendar-meeting-position">{activeMeetingIndex + 1} / {selectedMeetings.length}</span>}
        </div>}
      </section>}
      {showDiarySavedToast && <div className="diary-autosave-toast" role="status">쓰던 글은 자동 저장됐어요. 언제든 이어 쓸 수 있어요.</div>}
      {showLightning && <div className="diary-modal"><form className="diary-sheet lightning-sheet" onSubmit={submitLightning}>
        <header className="diary-sheet-header"><div><p className="diary-eyebrow">{selectedDate ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${selectedDate}T12:00:00`)) : ""}</p><h2>&#x26A1;&#xFE0F; &#xBC88;&#xAC1C; &#xB9CC;&#xB0A8; &#xAE30;&#xB85D;&#xD558;&#xAE30;</h2></div><button type="button" className="diary-icon-button" onClick={() => setShowLightning(false)} aria-label="&#xB2EB;&#xAE30;">&times;</button></header>
        <div className="lightning-time-row"><label htmlFor="lightning-start">&#xC2DC;&#xC791; &#xC2DC;&#xAC04;<input id="lightning-start" type="time" value={lightningStart} onChange={(event) => setLightningStart(event.target.value)} /></label><label htmlFor="lightning-end">&#xC885;&#xB8CC; &#xC2DC;&#xAC04;<input id="lightning-end" type="time" value={lightningEnd} onChange={(event) => setLightningEnd(event.target.value)} /></label></div>
        <label className="diary-field-label" htmlFor="lightning-title">&#xC774;&#xB984; <span className="lightning-required-mark" aria-label="Required">*</span></label><input id="lightning-title" className="diary-select" value={lightningTitle} onChange={(event) => { setLightningTitle(event.target.value); if (event.target.value.trim()) setLightningTitleError(false); }} maxLength={120} placeholder="&#xD568;&#xAED8;&#xD55C; &#xB9CC;&#xB0A8;" />{lightningTitleError && <p className="lightning-field-error">&#xC774;&#xB984;&#xC744; &#xC785;&#xB825;&#xD574; &#xC8FC;&#xC138;&#xC694;.</p>}
        <label className="diary-field-label" htmlFor="lightning-location">&#xC7A5;&#xC18C; <span className="lightning-optional-label">(&#xC120;&#xD0DD;)</span></label><input id="lightning-location" className="diary-select" value={lightningLocation} onChange={(event) => setLightningLocation(event.target.value)} maxLength={200} placeholder="&#xC7A5;&#xC18C;&#xB97C; &#xC785;&#xB825;&#xD574; &#xC8FC;&#xC138;&#xC694;" />
        <fieldset className="lightning-members"><legend>&#xAC19;&#xC774; &#xB9CC;&#xB09C; &#xC0AC;&#xB78C; <span className="lightning-optional-label">(&#xC120;&#xD0DD;)</span></legend><div className="lightning-member-options">{participants.filter((participant) => String(participant.userid || "") !== authUserId).map((participant, index) => { const userId = String(participant.userid || ""); const selected = lightningParticipantIds.includes(userId); return <button type="button" key={userId || participant.id || index} className={`lightning-member-option ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => userId && userId !== authUserId && toggleLightningParticipant(userId)} disabled={!userId}><span className="lightning-member-avatar">{participant.profiles?.profileimageurl ? <img src={participant.profiles.profileimageurl} alt="" /> : participant.nickname?.trim()?.slice(0, 1) || "?"}</span><span>{participant.nickname || "Member"}</span>{selected && <b aria-hidden="true">&#x2713;</b>}</button>; })}</div></fieldset>
        {error && <p className="diary-error">{error}</p>}<button type="submit" className="diary-publish-button" disabled={savingLightning || !selectedDate}>{savingLightning ? "\uB4F1\uB85D\uC911..." : "\uAE30\uB85D\uD558\uAE30"}</button>
      </form></div>}
    </main>
  );
}

function meetingForDiary(diary, meetings) { return meetings.find((meeting) => meeting.id === diary.meeting_id); }

function CalendarDayThumbnail({ src }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) return <FiImage className="room-calendar-day-image-icon" aria-label="&#xAE30;&#xB85D; &#xC0AC;&#xC9C4; &#xC5C6;&#xC74C;" />;
  return <img className="room-calendar-day-cover" src={src} alt="&#xC774; &#xB0A0;&#xC9DC;&#xC758; &#xAE30;&#xB85D; &#xC0AC;&#xC9C4;" onError={() => setFailed(true)} />;
}

export default RoomCalendarTab;
