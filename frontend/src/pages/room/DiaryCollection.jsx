import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FiArrowLeft, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { getDiaryPhotos, getMeetingDiaryDetails, getMyMeetingDiary, getRoomDiaryIdentity, getRoomMeetings } from "../../api/meetupDiaryApi";
import { supabase } from "../../lib/supabaseClient";
import DiaryPhotoLightbox from "./DiaryPhotoLightbox";
import "./DiaryCollection.css";

const todayInSeoul = () => { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; };
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const dateFormat = (date, options) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...options }).format(new Date(`${date}T12:00:00+09:00`));
const monthTitle = (date) => `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
const meetingTitle = (meeting) => meeting?.title || (meeting?.source_type === "lightning" ? "번개 만남" : "함께한 만남");
const isPastActiveMeeting = (meeting, today) => meeting.meeting_date <= today && meeting.lifecycle_status !== "cancelled";

export default function DiaryCollection() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState("meetings");
  const [month, setMonth] = useState(() => new Date(`${monthKey(new Date())}-01T12:00:00`));
  const [today] = useState(todayInSeoul);
  const [showUnreadMeetings, setShowUnreadMeetings] = useState(false);
  const [userId, setUserId] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [diaries, setDiaries] = useState([]);
  const [myEntries, setMyEntries] = useState({});
  const [photos, setPhotos] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const [reactionCounts, setReactionCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const auth = await getRoomDiaryIdentity(roomId);
      if (!auth.user || !auth.identityId) throw new Error("이 방의 회원만 기록을 볼 수 있습니다.");
      const allMeetings = await getRoomMeetings(roomId);
      const currentMeetings = allMeetings.filter((meeting) => meeting.lifecycle_status !== "cancelled");
      const recordSets = await Promise.all(currentMeetings.map(async (meeting) => {
        const [visibleRecords, ownRecord] = await Promise.all([
          getMeetingDiaryDetails(meeting.id),
          getMyMeetingDiary(meeting.id),
        ]);
        return { meetingId: meeting.id, visibleRecords, ownRecord };
      }));
      const allVisible = recordSets.flatMap((set) => set.visibleRecords);
      const ownByMeeting = Object.fromEntries(recordSets.filter((set) => set.ownRecord).map((set) => [set.meetingId, set.ownRecord]));
      setUserId(auth.user.id); setMeetings(currentMeetings); setDiaries(allVisible.filter((diary) => diary.author_auth_user_id === auth.user.id));
      setMyEntries(ownByMeeting);
      setPhotos({}); setReactionCounts({});
    } catch (loadError) { setError(loadError.message || "기록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => { load(); }, [load]);

  const monthMeetings = useMemo(() => meetings.filter((meeting) => meeting.meeting_date?.startsWith(monthKey(month))), [meetings, month]);
  const recordsForMonth = useMemo(() => diaries.filter((diary) => monthMeetings.some((meeting) => meeting.id === diary.meeting_id) && diary.status === "published"), [diaries, monthMeetings]);
  const meetingsWithRecords = useMemo(() => monthMeetings.filter((meeting) => recordsForMonth.some((diary) => diary.meeting_id === meeting.id)), [monthMeetings, recordsForMonth]);
  useEffect(() => {
    let active = true;
    const meetingIds = new Set(monthMeetings.map((meeting) => meeting.id));
    const monthRecords = diaries.filter((diary) => meetingIds.has(diary.meeting_id) && diary.status === "published");
    const loadMonthAssets = async () => {
      const loadedPhotos = await Promise.all(monthRecords.map(async (diary) => {
        try { return [diary.id, await getDiaryPhotos(diary.id, { thumbnail: true })]; }
        catch { return [diary.id, []]; }
      }));
      let reactionMap = {};
      if (monthRecords.length) {
        const { data: reactions, error: reactionError } = await supabase.from("diary_reactions").select("diary_id, emoji").in("diary_id", monthRecords.map((diary) => diary.id));
        if (!reactionError) reactionMap = (reactions || []).reduce((map, reaction) => ({ ...map, [reaction.diary_id]: [...(map[reaction.diary_id] || []), reaction.emoji] }), {});
      }
      if (active) { setPhotos(Object.fromEntries(loadedPhotos)); setReactionCounts(reactionMap); }
    };
    loadMonthAssets();
    return () => { active = false; };
  }, [diaries, monthMeetings]);
  const ordinal = (meetingId) => meetings.findIndex((meeting) => meeting.id === meetingId) + 1;
  const recordFor = (meetingId, authorId) => diaries.find((diary) => diary.meeting_id === meetingId && diary.author_auth_user_id === authorId);
  const ownPublishedFor = (meetingId) => recordFor(meetingId, userId);
  const ownMissingMeetings = monthMeetings.filter((meeting) => isPastActiveMeeting(meeting, today) && myEntries[meeting.id]?.status !== "published");
  const unread = ownMissingMeetings;
  const orderedRecords = [...recordsForMonth].sort((a, b) => (a.published_at || "").localeCompare(b.published_at || ""));
  const flatPhotos = [...monthMeetings].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date)).flatMap((meeting) => orderedRecords.filter((diary) => diary.meeting_id === meeting.id).flatMap((diary) => (photos[diary.id] || []).map((photo) => ({ meeting, diary, photo }))));
  const visibleMeetingCount = monthMeetings.filter((meeting) => isPastActiveMeeting(meeting, today)).length;
  const ownPublishedCount = monthMeetings.filter((meeting) => ownPublishedFor(meeting.id)).length;
  const heartCount = recordsForMonth.filter((diary) => diary.author_auth_user_id === userId).reduce((sum, diary) => sum + (reactionCounts[diary.id] || []).length, 0);
  const write = (meeting) => navigate(`/rooms/${roomId}/meetings/${meeting.id}/diary/edit`, { state: { from: `${location.pathname}${location.search}` } });
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
    navigate(`/rooms/${roomId}/meetings/${meeting.id}/diary${query.size ? `?${query}` : ""}`, { state: { from: `${location.pathname}${location.search}` } });
  };
  const back = () => navigate(location.state?.from || `/rooms/${roomId}?tab=calendar`, { replace: !location.state?.from });
  const groupedPhotos = monthMeetings.map((meeting) => ({ meeting, items: flatPhotos.filter((entry) => entry.meeting.id === meeting.id) })).filter((group) => group.items.length);

  return <main className="diary-collection-page">
    <header className="collection-topbar"><button type="button" onClick={back} aria-label="뒤로 가기"><FiArrowLeft /></button><h1>기록 모아보기</h1><button className="collection-refresh" type="button" onClick={load} aria-label="새로고침">↻</button></header>
    <nav className="collection-tabs" aria-label="기록 보기 방식">{[["meetings", "만남별"], ["photos", "사진"], ["mine", "내 기록"]].map(([key, label]) => <button type="button" key={key} className={tab === key ? "selected" : ""} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    <div className="collection-body">
      <div className="collection-month-row"><div className="collection-month-controls"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="이전 달"><FiChevronLeft /></button><h2>{monthTitle(month)}</h2><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="다음 달"><FiChevronRight /></button></div>{tab !== "mine" && <span>{tab === "meetings" ? `${meetingsWithRecords.length}번 만남 · 기록 ${recordsForMonth.length}개` : `사진 ${flatPhotos.length}장`}</span>}</div>
      {loading && <p className="collection-state">기록을 불러오는 중…</p>}
      {error && <div className="collection-error" role="alert">{error}<button type="button" onClick={load}>다시 불러오기</button></div>}
      {!loading && !error && tab === "meetings" && <>
        {unread.length > 0 && <button type="button" className="collection-unwritten-banner" onClick={() => unread.length === 1 ? write(unread[0]) : setShowUnreadMeetings((shown) => !shown)} aria-expanded={unread.length > 1 ? showUnreadMeetings : undefined}><span><strong>아직 기록이 없는 만남 {unread.length}개</strong><small>{unread.slice(0, 3).map((meeting) => `${dateFormat(meeting.meeting_date, { month: "numeric", day: "numeric" })} ${meeting.meeting_date === today ? "오늘" : meetingTitle(meeting)}`).join(" · ")}{unread.length > 3 ? " · …" : ""}</small></span><b>{unread.length === 1 ? "쓰러 가기 ›" : showUnreadMeetings ? "접기 ⌃" : "고르기 ›"}</b></button>}
        {unread.length > 1 && showUnreadMeetings && <section className="collection-unwritten-list"><h3>기록을 쓸 만남을 선택해 주세요</h3>{unread.map((meeting) => <div className="collection-unwritten-row" key={meeting.id}><span><b>{dateFormat(meeting.meeting_date, { month: "numeric", day: "numeric", weekday: "short" })}{meeting.meeting_date === today && <em>오늘</em>}{meeting.source_type === "lightning" && " \u26A1"}</b><small>{meetingTitle(meeting)} \u00b7 내 기록 없음</small></span><button type="button" onClick={() => write(meeting)}>쓰기</button></div>)}</section>}
        <div className="collection-meeting-list">{[...meetingsWithRecords].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date) || String(b.created_at).localeCompare(String(a.created_at))).map((meeting) => {
          const records = orderedRecords.filter((diary) => diary.meeting_id === meeting.id);
          const previewDiary = records[records.length - 1];
          return <article className="collection-meeting-card" key={meeting.id}>
            <button type="button" className="collection-card-main" onClick={() => openRecord(meeting, previewDiary || null)}>
              <span className="collection-card-heading"><span><strong>{dateFormat(meeting.meeting_date, { month: "long", day: "numeric", weekday: "short" })}{meeting.source_type === "lightning" && " · ⚡"}</strong><small className="collection-appointment-line"><span>{meetingTitle(meeting)}</span>{meeting.location && <span className="collection-card-location">📍 {meeting.location}</span>}</small></span><b>{ordinal(meeting.id)}번째 만남</b></span>
            {records.length > 0 && <span className="collection-photo-strip">{records.flatMap((diary) => (photos[diary.id] || []).map((photo) => <span className="collection-photo-preview" key={photo.id} role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); openPhotos(diary, photo.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openPhotos(diary, photo.id); } }} aria-label="사진 크게 보기"><img src={photo.url} alt="기록 사진" loading="lazy" /></span>))}</span>}
              {previewDiary && <><span className="collection-preview-text">{previewDiary.body || "사진 기록"}</span><span className="collection-reactions">{Object.entries((reactionCounts[previewDiary.id] || []).reduce((counts, emoji) => ({ ...counts, [emoji]: (counts[emoji] || 0) + 1 }), {})).slice(0, 3).map(([emoji, count]) => <span key={emoji}>{emoji} {count}</span>)}</span></>}
            </button>
            <button type="button" className="collection-open-link" onClick={() => openRecord(meeting, previewDiary)}>내 기록 보기 ›</button>
          </article>;
        })}{monthMeetings.length === 0 ? <p className="collection-state">이 달의 만남이 없습니다.</p> : meetingsWithRecords.length === 0 ? <p className="collection-state">이 달에 작성한 기록이 없어요.</p> : null}</div>
      </>}
      {!loading && !error && tab === "photos" && (groupedPhotos.length ? <div className="collection-photo-groups">{groupedPhotos.map(({ meeting, items }) => <section key={meeting.id}><h3>{dateFormat(meeting.meeting_date, { month: "long", day: "numeric" })} · {ordinal(meeting.id)}번째 만남</h3><div className="collection-photo-grid">{items.map(({ diary, photo }) => <button type="button" key={photo.id} onClick={() => openPhotos(diary, photo.id)} aria-label="사진 크게 보기"><img src={photo.url} alt="내 만남 기록 사진" loading="lazy" /></button>)}</div></section>)}</div> : <p className="collection-state">아직 모아 볼 사진이 없어요.</p>)}
      {!loading && !error && tab === "mine" && <>
        <section className="collection-stats"><div><strong>{visibleMeetingCount}번</strong><span>함께한 만남</span></div><div><strong>{ownPublishedCount}개</strong><span>내가 쓴 기록</span></div><div><strong>{heartCount}개</strong><span>받은 공감</span></div></section>
        <div className="collection-mine-list"><h3>{monthTitle(month)}<small>최신순</small></h3>{[...orderedRecords].filter((diary) => diary.author_auth_user_id === userId).reverse().map((diary) => {
          const meeting = monthMeetings.find((item) => item.id === diary.meeting_id); if (!meeting) return null;
          const diaryPhotos = photos[diary.id] || [];
          return <article className="collection-own-card" key={diary.id} onClick={() => openRecord(meeting, diary)}><div className="collection-own-heading"><span className="collection-avatar">나</span><span><b>나의 하루 {diary.mood_emoji || ""}</b><small>{dateFormat(meeting.meeting_date, { month: "long", day: "numeric", weekday: "short" })} · {ordinal(meeting.id)}번째 만남 · {meetingTitle(meeting)}</small></span><em>{diary.visibility === "room" ? "공개" : "나만 보기"}</em></div>{diaryPhotos[0] && <img className="collection-own-cover" src={diaryPhotos.find((photo) => photo.is_cover)?.url || diaryPhotos[0].url} alt="기록 대표 사진" loading="lazy" onClick={(event) => { event.stopPropagation(); openPhotos(diary, (diaryPhotos.find((photo) => photo.is_cover) || diaryPhotos[0]).id); }} />}<p>{diary.body || "사진 기록"}</p><footer><span>{Object.entries((reactionCounts[diary.id] || []).reduce((counts, emoji) => ({ ...counts, [emoji]: (counts[emoji] || 0) + 1 }), {})).slice(0, 3).map(([emoji, count]) => `${emoji} ${count}`).join("  ")}</span><span onClick={(event) => { event.stopPropagation(); write(meeting); }}>수정 · 보기 ›</span></footer></article>;
        })}{!ownPublishedCount && <p className="collection-state">아직 작성한 기록이 없어요.</p>}</div>
        {unread.length > 1 && showUnreadMeetings && <section className="collection-unwritten-list"><h3>기록을 쓸 만남을 선택해 주세요</h3>{unread.map((meeting) => <div className="collection-unwritten-row" key={meeting.id}><span><b>{dateFormat(meeting.meeting_date, { month: "numeric", day: "numeric", weekday: "short" })}{meeting.meeting_date === today && <em>오늘</em>}{meeting.source_type === "lightning" && " \u26A1"}</b><small>{meetingTitle(meeting)} \u00b7 내 기록 없음</small></span><button type="button" onClick={() => write(meeting)}>쓰기</button></div>)}</section>}
      </>}
    </div>
    {lightbox && <DiaryPhotoLightbox photos={lightbox.photos} index={lightbox.index} onChange={(updateIndex) => setLightbox((current) => ({ ...current, index: updateIndex(current.index) }))} onClose={() => setLightbox(null)} />}
  </main>;
}
