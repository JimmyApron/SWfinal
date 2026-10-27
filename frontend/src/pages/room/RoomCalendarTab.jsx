import { useCallback, useEffect, useMemo, useState } from "react";
import { createLightningMeeting, getDiaryCoverPhotos, getMeetingDiaryProgress, getRoomDiaries, getRoomDiaryIdentity, getRoomMeetings } from "../../api/meetupDiaryApi";
import DiaryCollection from "./DiaryCollection";
import DiaryEditor from "./DiaryEditor";
import "./RoomCalendar.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (value) => String(value).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const getTodayInSeoul = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

function RoomCalendarTab({ roomId, participants = [] }) {
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [identity, setIdentity] = useState(null);
  const [user, setUser] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [allMeetings, setAllMeetings] = useState([]);
  const [diaries, setDiaries] = useState([]);
  const [diariesLoaded, setDiariesLoaded] = useState(false);
  const [diaryCovers, setDiaryCovers] = useState({});
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedMeetingIndex, setSelectedMeetingIndex] = useState(0);
  const [meetingProgressById, setMeetingProgressById] = useState({});
  const [editorMeeting, setEditorMeeting] = useState(null);
  const [showLightning, setShowLightning] = useState(false);
  const [showCollection, setShowCollection] = useState(false);
  const [collectionMeetingId, setCollectionMeetingId] = useState(null);
  const [collectionDiaryId, setCollectionDiaryId] = useState(null);
  const [lightningTitle, setLightningTitle] = useState("");
  const [lightningLocation, setLightningLocation] = useState("");
  const [lightningStart, setLightningStart] = useState("");
  const [lightningEnd, setLightningEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingLightning, setSavingLightning] = useState(false);
  const [error, setError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const today = getTodayInSeoul();
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
        setUser(auth.user);
        currentIdentity = auth.identityId;
        setIdentity(currentIdentity);
        if (!auth.user) {
          setAuthMessage("방 공통 캘린더와 기록은 회원 인증이 필요합니다. 기존 게스트 계정의 guest_id는 기록 권한 확인에 사용하지 않습니다.");
          setMeetings([]); setAllMeetings([]);
          setDiaries([]);
          return;
        }
        if (!currentIdentity) {
          setAuthMessage("현재 계정은 이 방의 활성 회원이 아닙니다.");
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
      const covers = await getDiaryCoverPhotos(monthDiaries.map((diary) => diary.id));
      setMeetings(monthMeetings);
      setAllMeetings(roomMeetings);
      setDiaries(monthDiaries);
      setDiaryCovers(covers);
      setDiariesLoaded(true);
    } catch (loadError) {
      setError(loadError.message || "캘린더를 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [firstDay, identity, lastDay, roomId]);

  useEffect(() => { load({ initialize: true }); }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (identity) load(); }, [firstDay, identity, lastDay, load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("pageshow", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  const meetingGroups = useMemo(() => meetings.reduce((groups, meeting) => {
    groups[meeting.meeting_date] = [...(groups[meeting.meeting_date] || []), meeting];
    return groups;
  }, {}), [meetings]);
  const diaryDates = useMemo(() => new Set(diaries.map((diary) => meetingForDiary(diary, meetings)?.meeting_date).filter(Boolean)), [diaries, meetings]);
  const diaryCoversByDate = useMemo(() => diaries.reduce((covers, diary) => {
    const meeting = meetingForDiary(diary, meetings);
    const cover = diaryCovers[diary.id];
    if (meeting && cover && !covers[meeting.meeting_date]) covers[meeting.meeting_date] = cover;
    return covers;
  }, {}), [diaries, diaryCovers, meetings]);
  const diaryCountsByDate = useMemo(() => diaries.reduce((counts, diary) => {
    const date = meetingForDiary(diary, meetings)?.meeting_date;
    if (date) counts[date] = (counts[date] || 0) + 1;
    return counts;
  }, {}), [diaries, meetings]);
  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = first.getDay();
    return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index - offset + 1));
  }, [month]);
  const selectedMeetings = meetingGroups[selectedDate] || [];
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

  function openMeetingRecords(meetingId, diaryId = null) {
    setCollectionMeetingId(meetingId);
    setCollectionDiaryId(diaryId);
    setShowCollection(true);
  }

  async function refreshCalendar() { await load(); }

  const submitLightning = async (event) => {
    event.preventDefault();
    setSavingLightning(true);
    setError("");
    try {
      await createLightningMeeting({ roomId, date: selectedDate, title: lightningTitle.trim(), startTime: lightningStart, endTime: lightningEnd, location: lightningLocation.trim() });
      setShowLightning(false);
      setLightningTitle(""); setLightningLocation(""); setLightningStart(""); setLightningEnd("");
      await refreshCalendar();
    } catch (createError) { setError(createError.message || "번개 만남 등록에 실패했습니다."); }
    finally { setSavingLightning(false); }
  };

  return (
    <main className="room-calendar-page">
      <div className="room-calendar-heading"><div><p className="room-calendar-eyebrow">ROOM CALENDAR</p><h1>우리의 캘린더</h1><p>{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(month)} · 이번 달 {meetings.filter((meeting) => meeting.lifecycle_status !== "cancelled").length}번의 만남</p></div><button type="button" className="calendar-collection-button" disabled={!identity} onClick={() => setShowCollection(true)}>기록 모아보기</button></div>
      {authMessage && <div className="calendar-notice" role="status">{authMessage}</div>}
      {error && <div className="calendar-error" role="alert">{error}<button type="button" onClick={refreshCalendar}>다시 불러오기</button></div>}
      <section className="room-calendar-card" aria-label="방 공통 월간 캘린더">
        <header className="room-calendar-month"><button type="button" aria-label="이전 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><strong>{month.getFullYear()}년 {month.getMonth() + 1}월</strong><button type="button" aria-label="다음 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></header>
        <div className="room-calendar-grid room-calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="room-calendar-grid room-calendar-days">{calendarDays.map((date) => {
          const key = dateKey(date);
          const dayMeetings = meetingGroups[key] || [];
          const outside = date.getMonth() !== month.getMonth();
          return <button type="button" key={key} className={`room-calendar-day ${diaryCoversByDate[key] ? "has-cover" : ""} ${outside ? "outside" : ""} ${selectedDate === key ? "selected" : ""} ${key === today ? "today" : ""}`} onClick={() => { setSelectedDate(key); setSelectedMeetingIndex(0); }}>
            {diaryCoversByDate[key] ? <img className="room-calendar-day-cover" src={diaryCoversByDate[key]} alt="이 날짜의 기록 사진" /> : <span>{date.getDate()}</span>}
            {diaryCoversByDate[key] && <span className="room-calendar-day-date">{date.getDate()}</span>}
            {!diaryCoversByDate[key] && <span className="room-calendar-markers">{dayMeetings.slice(0, 3).map((meeting) => <i key={meeting.id} className={meeting.meeting_date < today ? "past" : "scheduled"} title={meeting.title || "만남"} />)}{diaryDates.has(key) && <b title="기록이 있습니다">✦</b>}</span>}
            {diaryCountsByDate[key] > 0 ? <small>{diaryCountsByDate[key]}</small> : dayMeetings.length > 1 && <small>{dayMeetings.length}회</small>}
          </button>;
        })}</div>
        <div className="room-calendar-legend"><span><i className="scheduled" />확정 일정</span><span><i className="past" />지난 만남</span><span><b>✦</b>기록 있음</span></div>
      </section>
      {loading && <p className="calendar-loading">캘린더를 불러오는 중…</p>}
      {selectedDate && <section className="calendar-selected-section" aria-label={`${selectedDate} 만남`}>
        <div className="calendar-sheet-handle" aria-hidden="true" />
        <header className="calendar-selected-heading"><h2>{selectedMeetings.length ? selectedDateLabel : "이 날짜의 만남"}</h2>{activeMeeting && <span className="calendar-meeting-badge">{activeMeeting.source_type === "lightning" ? "번개" : "약속"} · {activeMeetingOrdinal}번째 만남</span>}{canCreateLightning && identity && <button type="button" className="calendar-lightning-button" onClick={() => setShowLightning(true)}>＋ 번개 만남 등록</button>}</header>
        {selectedMeetings.length === 0 && <div className="calendar-empty-meeting"><p>등록된 만남이 없습니다.</p>{canCreateLightning && identity && <button type="button" onClick={() => setShowLightning(true)}>번개 만남 등록하기</button>}</div>}
        {selectedMeetings.length > 0 && <div className={`calendar-meeting-carousel ${selectedMeetings.length > 1 ? "has-multiple" : "single"}`}>
          {selectedMeetings.length > 1 && <button type="button" className="calendar-meeting-arrow" aria-label="이전 만남" onClick={() => setSelectedMeetingIndex((activeMeetingIndex - 1 + selectedMeetings.length) % selectedMeetings.length)}>‹</button>}
          {activeMeeting && <article key={activeMeeting.id} className={`calendar-meeting-card ${isActiveRecordPublished ? "is-complete" : ""}`}>
              <button type="button" className="calendar-meeting-summary" onClick={() => openMeetingRecords(activeMeeting.id, activeRecord?.id)} aria-label={`${activeMeeting.title || "약속"} 기록 상세 보기`}>
              <div className="calendar-meeting-summary-main">
                <div className="calendar-meeting-info">
                  <strong>{activeMeeting.title || (activeMeeting.source_type === "lightning" ? "번개 만남" : "확정 일정")}</strong>
                  <span>{activeMeeting.start_time ? new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(`2000-01-01T${activeMeeting.start_time}`)) : "하루 종일"}{activeMeeting.location ? ` · 📍 ${activeMeeting.location}` : ""}</span>
                  {activeMeeting.lifecycle_status === "cancelled" && <em>취소된 일정</em>}
                </div>
                <span className="calendar-meeting-chevron" aria-hidden="true">›</span>
              </div>
              <div className="calendar-meeting-participants">
                <div className="calendar-participant-avatars" aria-label={`참여 인원 ${participants.length}명`}>
                  {participants.slice(0, 4).map((participant) => <span className={`calendar-participant-avatar ${activePublishedMemberIds.has(String(participant.userid)) ? "written" : "unwritten"}`} key={participant.userid || participant.id} title={participant.nickname}>
                    {participant.profiles?.profileimageurl ? <img src={participant.profiles.profileimageurl} alt="" /> : participant.nickname?.trim()?.slice(0, 1) || "?"}
                  </span>)}
                  {participants.length > 4 && <span className="calendar-participant-avatar calendar-participant-more">+{participants.length - 4}</span>}
                </div>
                <span className="calendar-record-count">{activeMeetingDiaryCount ?? "—"}/{activeMeetingProgress?.target_count ?? participants.length}명 기록</span>
                {isActiveRecordPublished && <span className="calendar-record-complete-label">✓ 내 일기 작성함</span>}
              </div>
              </button>
              {!isActiveRecordPublished && <><button type="button" className="calendar-record-cta" disabled={!identity || activeMeeting.meeting_date > today} onClick={() => setEditorMeeting(activeMeeting)}>{activeMeeting.meeting_date > today ? `✏️ 기록 남기기 · ${new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(`${activeMeeting.meeting_date}T12:00:00`))}부터` : "✏️ 기록 남기기"}</button>
              <p className="calendar-record-hint">약속 카드를 누르면 모임 기록으로 가요</p></>}
          </article>}
          {selectedMeetings.length > 1 && <button type="button" className="calendar-meeting-arrow" aria-label="다음 만남" onClick={() => setSelectedMeetingIndex((activeMeetingIndex + 1) % selectedMeetings.length)}>›</button>}
          {selectedMeetings.length > 1 && <span className="calendar-meeting-position">{activeMeetingIndex + 1} / {selectedMeetings.length}</span>}
        </div>}
      </section>}
      {showLightning && <div className="diary-modal"><form className="diary-sheet lightning-sheet" onSubmit={submitLightning}><header className="diary-sheet-header"><div><p className="diary-eyebrow">{selectedDate}</p><h2>번개 만남 등록</h2></div><button type="button" className="diary-icon-button" onClick={() => setShowLightning(false)} aria-label="닫기">×</button></header><label className="diary-field-label" htmlFor="lightning-title">만남 이름</label><input id="lightning-title" className="diary-select" value={lightningTitle} onChange={(event) => setLightningTitle(event.target.value)} maxLength={120} placeholder="함께한 만남" /><label className="diary-field-label" htmlFor="lightning-location">장소</label><input id="lightning-location" className="diary-select" value={lightningLocation} onChange={(event) => setLightningLocation(event.target.value)} maxLength={200} placeholder="장소를 입력해 주세요" /><div className="lightning-time-row"><label>시작 시간<input type="time" value={lightningStart} onChange={(event) => setLightningStart(event.target.value)} /></label><label>종료 시간<input type="time" value={lightningEnd} onChange={(event) => setLightningEnd(event.target.value)} /></label></div>{error && <p className="diary-error">{error}</p>}<button type="submit" className="diary-publish-button" disabled={savingLightning}>{savingLightning ? "등록 중…" : "번개 만남 저장"}</button></form></div>}
      {showCollection && identity && <div className="diary-modal"><div className="diary-sheet diary-collection-sheet"><button type="button" className="diary-collection-close" onClick={() => setShowCollection(false)}>닫기</button><DiaryCollection roomId={roomId} identityId={identity} diaries={diaries} meetings={allMeetings} initialMeetingId={collectionMeetingId} initialDiaryId={collectionDiaryId} onRefresh={refreshCalendar} onEdit={(meeting) => { setShowCollection(false); setEditorMeeting(meeting); }} /></div></div>}
      {editorMeeting && identity && user && <DiaryEditor key={`${editorMeeting.id}:${identity}`} roomId={roomId} meeting={editorMeeting} identityId={identity} onClose={() => setEditorMeeting(null)} onPublished={async () => { setEditorMeeting(null); await refreshCalendar(); }} />}
    </main>
  );
}

function meetingForDiary(diary, meetings) { return meetings.find((meeting) => meeting.id === diary.meeting_id); }

export default RoomCalendarTab;
