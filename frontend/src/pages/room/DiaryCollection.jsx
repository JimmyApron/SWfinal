import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FiArrowLeft, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { getDiaryPhotos, getMeetingDiaryDetails, getMyMeetingDiary, getRoomDiaryIdentity, getRoomMeetings } from "../../api/meetupDiaryApi";
import { supabase } from "../../lib/supabaseClient";
import DiaryPhotoLightbox from "./DiaryPhotoLightbox";
import "./DiaryCollection.css";

const todayInSeoul = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const dateFormat = (date, options) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...options }).format(new Date(`${date}T12:00:00+09:00`));
const monthTitle = (key) => {
  const [year, month] = key.split("-").map(Number);
  return `${year}년 ${month}월`;
};
const meetingTitle = (meeting) => meeting?.title || (meeting?.source_type === "lightning" ? "번개 만남" : "함께한 만남");
const isPastActiveMeeting = (meeting, today) => meeting.meeting_date <= today && meeting.lifecycle_status !== "cancelled";
const parseMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || "") ? new Date(`${value}-01T12:00:00`) : new Date(`${monthKey(new Date())}-01T12:00:00`);
const fromLocation = (location) => {
  const params = new URLSearchParams(location.search);
  return {
    tab: ["meetings", "photos", "mine"].includes(params.get("tab")) ? params.get("tab") : "meetings",
    view: params.get("view") === "all" ? "all" : "monthly",
    month: parseMonth(params.get("month")),
  };
};
const monthOf = (meeting) => meeting.meeting_date?.slice(0, 7);
const groupByMonth = (rows, getMeeting) => {
  const groups = new Map();
  rows.forEach((row) => {
    const meeting = getMeeting(row);
    const key = monthOf(meeting || {});
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
};
const groupPhotosByMeeting = (rows) => {
  const groups = new Map();
  rows.forEach((entry) => {
    const key = entry.meeting.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return [...groups.entries()].sort(([, a], [, b]) => b[0].meeting.meeting_date.localeCompare(a[0].meeting.meeting_date));
};

export default function DiaryCollection() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = fromLocation(location);
  const { tab, view, month } = routeState;
  const [today] = useState(todayInSeoul);
  const [showUnreadMeetings, setShowUnreadMeetings] = useState(false);
  const [visibleMonthCount, setVisibleMonthCount] = useState(6);
  const [userId, setUserId] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [diaries, setDiaries] = useState([]);
  const [myEntries, setMyEntries] = useState({});
  const [myTargetMeetings, setMyTargetMeetings] = useState([]);
  const [photos, setPhotos] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const [reactionCounts, setReactionCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const restoredScroll = useRef(false);

  const updateRoute = (changes) => {
    const params = new URLSearchParams(location.search);
    const next = { ...routeState, ...changes };
    params.set("tab", next.tab);
    params.set("view", next.view);
    params.set("month", monthKey(next.month));
    navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { state: location.state });
  };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const auth = await getRoomDiaryIdentity(roomId);
      if (!auth.user || !auth.identityId) throw new Error("이 방의 회원만 기록을 볼 수 있습니다.");
      const allMeetings = await getRoomMeetings(roomId);
      const currentMeetings = allMeetings.filter((meeting) => meeting.lifecycle_status !== "cancelled");
      // Keep diary visibility in the database RPC and cap concurrent calls for older rooms.
      const recordSets = [];
      for (let start = 0; start < currentMeetings.length; start += 12) {
        const batch = currentMeetings.slice(start, start + 12);
        recordSets.push(...await Promise.all(batch.map(async (meeting) => {
          const [visibleRecords, ownRecord] = await Promise.all([
            getMeetingDiaryDetails(meeting.id),
            getMyMeetingDiary(meeting.id),
          ]);
          return { meetingId: meeting.id, visibleRecords, ownRecord };
        })));
      }
      const allVisible = recordSets.flatMap((set) => set.visibleRecords);
      const ownByMeeting = Object.fromEntries(recordSets.filter((set) => set.ownRecord).map((set) => [set.meetingId, set.ownRecord]));
      setUserId(auth.user.id);
      setMeetings(currentMeetings);
      setDiaries(allVisible);
      setMyEntries(ownByMeeting);
      // getRoomDiaryIdentity already verifies active room membership; guests cannot reach this page.
      setMyTargetMeetings(currentMeetings.map((meeting) => meeting.id));
      setPhotos({}); setReactionCounts({});
    } catch (loadError) { setError(loadError.message || "기록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    let channels = [];
    let refreshTimer;
    const connect = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active || !session?.access_token) return;
      await supabase.realtime.setAuth(session.access_token);
      if (!active) return;
      channels = [`meetup-diary-room:${roomId}`, `meetup-diary-user:${userId}`].map((topic) => {
        let connectedOnce = false;
        return supabase.channel(topic, { config: { private: true } })
          .on("broadcast", { event: "collection_changed" }, () => {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => { if (active) load(); }, 300);
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED" && connectedOnce) {
              clearTimeout(refreshTimer);
              refreshTimer = setTimeout(() => { if (active) load(); }, 300);
            }
            if (status === "SUBSCRIBED") connectedOnce = true;
          });
      });
    };
    connect().catch((connectError) => console.error("Diary realtime subscription failed", connectError));
    return () => {
      active = false;
      clearTimeout(refreshTimer);
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [load, roomId, userId]);

  useEffect(() => {
    if (loading || restoredScroll.current) return;
    restoredScroll.current = true;
    const savedY = location.state?.collectionScrollY;
    if (Number.isFinite(savedY)) window.scrollTo(0, savedY);
    else {
      const cachedY = sessionStorage.getItem(`diary-collection:${location.pathname}${location.search}`);
      if (cachedY !== null) window.scrollTo(0, Number(cachedY));
    }
  }, [loading, location.pathname, location.search, location.state?.collectionScrollY]);

  const monthMeetings = useMemo(() => meetings.filter((meeting) => monthOf(meeting) === monthKey(month)), [meetings, month]);
  const selectedMeetings = view === "all" ? meetings : monthMeetings;
  const selectedIds = useMemo(() => new Set(selectedMeetings.map((meeting) => meeting.id)), [selectedMeetings]);
  const records = useMemo(() => diaries.filter((diary) => selectedIds.has(diary.meeting_id) && diary.status === "published"), [diaries, selectedIds]);
  const recordsByMeeting = useMemo(() => records.reduce((groups, diary) => {
    if (!groups.has(diary.meeting_id)) groups.set(diary.meeting_id, []);
    groups.get(diary.meeting_id).push(diary);
    return groups;
  }, new Map()), [records]);
  const orderedMeetings = useMemo(() => [...selectedMeetings].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date) || String(b.created_at).localeCompare(String(a.created_at))), [selectedMeetings]);
  const meetingsWithRecords = useMemo(() => orderedMeetings.filter((meeting) => recordsByMeeting.has(meeting.id)), [orderedMeetings, recordsByMeeting]);

  useEffect(() => {
    let active = true;
    const loadAssets = async () => {
      const loadedPhotos = [];
      for (let start = 0; start < records.length; start += 12) {
        const batch = records.slice(start, start + 12);
        loadedPhotos.push(...await Promise.all(batch.map(async (diary) => {
          try { return [diary.id, await getDiaryPhotos(diary.id, { thumbnail: true })]; }
          catch { return [diary.id, []]; }
        })));
      }
      let reactionMap = {};
      for (let start = 0; start < records.length; start += 200) {
        const ids = records.slice(start, start + 200).map((diary) => diary.id);
        const { data: reactions, error: reactionError } = await supabase.from("diary_reactions").select("diary_id, emoji").in("diary_id", ids);
        if (!reactionError) reactionMap = (reactions || []).reduce((map, reaction) => ({ ...map, [reaction.diary_id]: [...(map[reaction.diary_id] || []), reaction.emoji] }), reactionMap);
      }
      if (active) { setPhotos(Object.fromEntries(loadedPhotos)); setReactionCounts(reactionMap); }
    };
    loadAssets();
    return () => { active = false; };
  }, [records]);

  const ordinal = (meetingId) => meetings.findIndex((meeting) => meeting.id === meetingId) + 1;
  const ownPublishedFor = (meetingId) => myEntries[meetingId]?.status === "published";
  const ownMissingMeetings = selectedMeetings.filter((meeting) => myTargetMeetings.includes(meeting.id) && isPastActiveMeeting(meeting, today) && myEntries[meeting.id]?.status !== "published").sort((a, b) => b.meeting_date.localeCompare(a.meeting_date) || String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
  const orderedRecords = [...records].sort((a, b) => (a.published_at || "").localeCompare(b.published_at || ""));
  const flatPhotos = orderedMeetings.flatMap((meeting) => orderedRecords.filter((diary) => diary.meeting_id === meeting.id).flatMap((diary) => (photos[diary.id] || []).map((photo) => ({ meeting, diary, photo }))));
  const visibleMeetingCount = selectedMeetings.filter((meeting) => isPastActiveMeeting(meeting, today)).length;
  const ownPublishedCount = selectedMeetings.filter((meeting) => ownPublishedFor(meeting.id)).length;
  const heartCount = records.filter((diary) => diary.author_auth_user_id === userId).reduce((sum, diary) => sum + (reactionCounts[diary.id] || []).length, 0);
  const meetingGroups = groupByMonth(meetingsWithRecords, (meeting) => meeting);
  const unreadGroups = groupByMonth(ownMissingMeetings, (meeting) => meeting);
  const photoGroupsByMonth = groupByMonth(flatPhotos, (entry) => entry.meeting).map(([key, items]) => [key, groupPhotosByMeeting(items)]);
  const ownGroups = groupByMonth(orderedRecords.filter((diary) => diary.author_auth_user_id === userId), (diary) => meetings.find((meeting) => meeting.id === diary.meeting_id));
  const meetingMonthKeys = [...new Set([...meetingGroups.map(([key]) => key), ...unreadGroups.map(([key]) => key)])].sort((a, b) => b.localeCompare(a));
  const ownMonthKeys = [...new Set([...ownGroups.map(([key]) => key), ...(view === "all" ? unreadGroups.map(([key]) => key) : [])])].sort((a, b) => b.localeCompare(a));
  const monthsToShow = view === "all" ? Math.max(1, visibleMonthCount) : Infinity;
  const write = (meeting) => {
    sessionStorage.setItem(`diary-collection:${location.pathname}${location.search}`, String(window.scrollY));
    navigate(`/rooms/${roomId}/meetings/${meeting.id}/diary/edit`, { state: { from: `${location.pathname}${location.search}`, collectionScrollY: window.scrollY } });
  };
  const openPhotos = async (diary, photoId) => {
    const thumbnails = photos[diary.id] || [];
    let fullPhotos = thumbnails;
    try { fullPhotos = await getDiaryPhotos(diary.id); } catch { /* Keep the already loaded previews available. */ }
    const index = Math.max(0, fullPhotos.findIndex((photo) => photo.id === photoId));
    setLightbox({ photos: fullPhotos, index });
  };
  const openRecord = (meeting, diary, photoIndex = null) => {
    const query = new URLSearchParams();
    if (diary?.author_auth_user_id) query.set("author", diary.author_auth_user_id);
    if (photoIndex !== null) query.set("photo", String(photoIndex));
    sessionStorage.setItem(`diary-collection:${location.pathname}${location.search}`, String(window.scrollY));
    navigate(`/rooms/${roomId}/meetings/${meeting.id}/diary${query.size ? `?${query}` : ""}`, { state: { from: `${location.pathname}${location.search}`, collectionScrollY: window.scrollY } });
  };
  const back = () => navigate(location.state?.from || `/rooms/${roomId}?tab=calendar`, { replace: !location.state?.from });
  const renderMeetingCard = (meeting) => {
    const meetingRecords = recordsByMeeting.get(meeting.id) || [];
    const previewDiary = meetingRecords[meetingRecords.length - 1];
    return <article className="collection-meeting-card" key={meeting.id}>
      <button type="button" className="collection-card-main" onClick={() => openRecord(meeting, previewDiary || null)}>
        <span className="collection-card-heading"><span><strong>{dateFormat(meeting.meeting_date, { month: "long", day: "numeric", weekday: "short" })}{meeting.source_type === "lightning" && " · ⚡"}</strong><small className="collection-appointment-line"><span>{meetingTitle(meeting)}</span>{meeting.location && <span className="collection-card-location">📍 {meeting.location}</span>}</small></span><b>{ordinal(meeting.id)}번째 만남</b></span>
        {meetingRecords.length > 0 && <span className="collection-photo-strip">{meetingRecords.flatMap((diary) => (photos[diary.id] || []).map((photo) => <span className="collection-photo-preview" key={photo.id} role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); openPhotos(diary, photo.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openPhotos(diary, photo.id); } }} aria-label="사진 크게 보기"><img src={photo.url} alt="기록 사진" loading="lazy" /></span>))}</span>}
        {previewDiary && <><span className="collection-preview-text">{previewDiary.body || "사진 기록"}</span><span className="collection-reactions">{Object.entries((reactionCounts[previewDiary.id] || []).reduce((counts, emoji) => ({ ...counts, [emoji]: (counts[emoji] || 0) + 1 }), {})).slice(0, 3).map(([emoji, count]) => <span key={emoji}>{emoji} {count}</span>)}</span></>}
      </button>
      <button type="button" className="collection-open-link" onClick={() => openRecord(meeting, previewDiary)}>내 기록 보기 ›</button>
    </article>;
  };
  const renderUnread = (items) => items.length > 0 && <div className="collection-unwritten">
    <button type="button" className="collection-unwritten-banner" onClick={() => setShowUnreadMeetings((shown) => !shown)} aria-expanded={showUnreadMeetings}>
      <span><strong>아직 기록이 없는 만남 {items.length}개</strong><small>{items.slice(0, 3).map((meeting) => `${dateFormat(meeting.meeting_date, { month: "numeric", day: "numeric" })} ${meetingTitle(meeting)}`).join(" · ")}{items.length > 3 ? " …" : ""}</small></span>
      <b>{showUnreadMeetings ? "접기 ⌃" : "쓰러 가기 ›"}</b>
    </button>
    {showUnreadMeetings && <section className="collection-unwritten-list"><h3>기록을 쓸 만남을 선택해 주세요</h3>{items.map((meeting) => <div className="collection-unwritten-row" key={meeting.id}><span><b>{dateFormat(meeting.meeting_date, { month: "numeric", day: "numeric", weekday: "short" })}{meeting.meeting_date === today && <em>오늘</em>}{meeting.source_type === "lightning" && " ⚡"}</b><small>{meetingTitle(meeting)} · 내 기록 없음</small></span><button type="button" onClick={() => write(meeting)}>쓰기</button></div>)}</section>}
  </div>;

  return <main className="diary-collection-page">
    <header className="collection-topbar"><button type="button" onClick={back} aria-label="뒤로 가기"><FiArrowLeft /></button><h1>기록 모아보기</h1><span aria-hidden="true" /></header>
    <div className="collection-toolbar"><nav className="collection-tabs" aria-label="기록 보기 방식">{[["meetings", "만남별"], ["photos", "사진"], ["mine", "내 기록"]].map(([key, label]) => <button type="button" key={key} className={tab === key ? "selected" : ""} aria-pressed={tab === key} onClick={() => updateRoute({ tab: key })}>{label}</button>)}</nav><div className="collection-view-toggle" role="group" aria-label="조회 기간">{[["all", "전체 보기"], ["monthly", "월별 보기"]].map(([key, label]) => <button type="button" key={key} className={view === key ? "selected" : ""} aria-pressed={view === key} onClick={() => updateRoute({ view: key })}>{label}</button>)}</div></div>
    <div className="collection-body">
      {view === "monthly" && <div className="collection-month-row"><div className="collection-month-controls"><button type="button" onClick={() => updateRoute({ month: new Date(month.getFullYear(), month.getMonth() - 1, 1) })} aria-label="이전 달"><FiChevronLeft /></button><h2>{monthTitle(monthKey(month))}</h2><button type="button" onClick={() => updateRoute({ month: new Date(month.getFullYear(), month.getMonth() + 1, 1) })} aria-label="다음 달"><FiChevronRight /></button></div>{tab === "meetings" ? <span>{meetingsWithRecords.length}번 만남 · 기록 {records.length}개</span> : tab === "photos" ? <span>사진 {flatPhotos.length}장</span> : null}</div>}
      {view === "all" && !loading && !error && tab !== "mine" && <div className="collection-all-summary">{tab === "meetings" ? `전체 ${meetingsWithRecords.length}번 만남 · 기록 ${records.length}개` : `전체 사진 ${flatPhotos.length}장`}</div>}
      {loading && <p className="collection-state">기록을 불러오는 중…</p>}
      {error && <div className="collection-error" role="alert">{error}<button type="button" onClick={load}>다시 불러오기</button></div>}
      {!loading && !error && tab === "meetings" && <>
        {renderUnread(ownMissingMeetings)}
        {(view === "all" ? meetingMonthKeys.slice(0, monthsToShow) : meetingMonthKeys).map((key) => {
          const items = meetingGroups.find(([groupKey]) => groupKey === key)?.[1] || [];
          return <section className="collection-month-section" key={key}>{view === "all" && <h2>{monthTitle(key)}</h2>}{items.length > 0 && <div className="collection-meeting-list">{items.map(renderMeetingCard)}</div>}</section>;
        })}
        {!meetingMonthKeys.length && <p className="collection-state">{view === "monthly" && monthMeetings.length === 0 ? "이 달의 만남이 없습니다." : "아직 작성된 기록이 없어요."}</p>}
        {view === "all" && meetingMonthKeys.length > monthsToShow && <button type="button" className="collection-load-more" onClick={() => setVisibleMonthCount((count) => count + 6)}>이전 기록 더 보기</button>}
      </>}
      {!loading && !error && tab === "photos" && (photoGroupsByMonth.length ? <div className="collection-month-sections">{(view === "all" ? photoGroupsByMonth.slice(0, monthsToShow) : photoGroupsByMonth).map(([key, meetingGroupsForMonth]) => <section className="collection-month-section" key={key}>{view === "all" && <h2>{monthTitle(key)} <small>사진 {meetingGroupsForMonth.reduce((count, [, items]) => count + items.length, 0)}장</small></h2>}<div className="collection-photo-groups">{meetingGroupsForMonth.map(([meetingKey, items]) => { const meeting = items[0].meeting; return <section key={`${meetingKey}-${meeting.id}`}><h3>{dateFormat(meeting.meeting_date, { month: "long", day: "numeric" })} · {ordinal(meeting.id)}번째 만남</h3><div className="collection-photo-grid">{items.map(({ diary, photo }) => <button type="button" key={photo.id} onClick={() => openPhotos(diary, photo.id)} aria-label="사진 크게 보기"><img src={photo.url} alt="내 만남 기록 사진" loading="lazy" /></button>)}</div></section>; })}</div></section>)}</div> : <p className="collection-state">아직 모아 볼 사진이 없어요.</p>)}
      {!loading && !error && tab === "photos" && view === "all" && photoGroupsByMonth.length > monthsToShow && <button type="button" className="collection-load-more" onClick={() => setVisibleMonthCount((count) => count + 6)}>이전 기록 더 보기</button>}
      {!loading && !error && tab === "mine" && <>
        <section className="collection-stats"><div><strong>{visibleMeetingCount}번</strong><span>함께한 만남</span></div><div><strong>{ownPublishedCount}개</strong><span>내가 쓴 기록</span></div><div><strong>{heartCount}개</strong><span>받은 공감</span></div></section>
        {renderUnread(ownMissingMeetings)}
        {ownMonthKeys.length > 0 && (view === "all" || ownMonthKeys.includes(monthKey(month))) && <div className="collection-sort-caption">최신순</div>}
        {(view === "all" ? ownMonthKeys.slice(0, monthsToShow) : [monthKey(month)]).map((key) => {
          const items = ownGroups.find(([groupKey]) => groupKey === key)?.[1] || [];
          return <section className="collection-month-section collection-mine-list" key={key}><h3>{monthTitle(key)}</h3>{items.slice().sort((a, b) => meetings.find((meeting) => meeting.id === b.meeting_id)?.meeting_date.localeCompare(meetings.find((meeting) => meeting.id === a.meeting_id)?.meeting_date || "") || (b.published_at || "").localeCompare(a.published_at || "")).map((diary) => {
            const meeting = meetings.find((item) => item.id === diary.meeting_id); if (!meeting) return null;
            const diaryPhotos = photos[diary.id] || [];
            return <article className="collection-own-card" key={diary.id} onClick={() => openRecord(meeting, diary)}><div className="collection-own-heading"><span className="collection-avatar">나</span><span><b>나의 하루 {diary.mood_emoji || ""}</b><small>{dateFormat(meeting.meeting_date, { month: "long", day: "numeric", weekday: "short" })} · {ordinal(meeting.id)}번째 만남 · {meetingTitle(meeting)}</small></span><em>{diary.visibility === "room" ? "공개" : "나만 보기"}</em></div>{diaryPhotos[0] && <img className="collection-own-cover" src={diaryPhotos.find((photo) => photo.is_cover)?.url || diaryPhotos[0].url} alt="기록 대표 사진" loading="lazy" onClick={(event) => { event.stopPropagation(); openPhotos(diary, (diaryPhotos.find((photo) => photo.is_cover) || diaryPhotos[0]).id); }} />}<p>{diary.body || "사진 기록"}</p><footer><span>{Object.entries((reactionCounts[diary.id] || []).reduce((counts, emoji) => ({ ...counts, [emoji]: (counts[emoji] || 0) + 1 }), {})).slice(0, 3).map(([emoji, count]) => `${emoji} ${count}`).join("  ")}</span><span onClick={(event) => { event.stopPropagation(); write(meeting); }}>수정 · 보기 ›</span></footer></article>;
          })}{items.length === 0 && <p className="collection-state">아직 작성한 기록이 없어요.</p>}</section>;
        })}
        {view === "all" && !ownGroups.length && !ownMissingMeetings.length && <p className="collection-state">아직 작성한 기록이 없어요.</p>}
        {view === "all" && ownMonthKeys.length > monthsToShow && <button type="button" className="collection-load-more" onClick={() => setVisibleMonthCount((count) => count + 6)}>이전 기록 더 보기</button>}
      </>}
    </div>
    {lightbox && <DiaryPhotoLightbox photos={lightbox.photos} index={lightbox.index} onChange={(updateIndex) => setLightbox((current) => ({ ...current, index: updateIndex(current.index) }))} onClose={() => setLightbox(null)} />}
  </main>;
}
