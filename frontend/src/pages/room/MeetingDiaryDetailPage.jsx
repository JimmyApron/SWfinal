import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FiArrowLeft, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { getDiaryPhotos, getMeetingDiaryDetails, getMeetingDiaryProgress, getRoomDiaryIdentity, getRoomMeetings, saveDiaryReaction, deleteDiaryPhotosAndRecord } from "../../api/meetupDiaryApi";
import { supabase } from "../../lib/supabaseClient";
import DiaryPhotoLightbox from "./DiaryPhotoLightbox";
import "./MeetingDiaryDetailPage.css";

const EMOJIS = ["😊", "❤️", "😂", "🥹", "👏", "🎉"];
const dateLabel = (value) => value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Seoul" }).format(new Date(`${value}T12:00:00+09:00`)) : "";
const timeLabel = (value) => value ? new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Seoul" }).format(new Date(value)) : "";

export default function MeetingDiaryDetailPage() {
  const { roomId, meetingId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [identity, setIdentity] = useState(null);
  const [userId, setUserId] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [meetingOrdinal, setMeetingOrdinal] = useState(0);
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [diaries, setDiaries] = useState([]);
  const [photosByDiary, setPhotosByDiary] = useState({});
  const [reactionRows, setReactionRows] = useState([]);
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photoSlideDirection, setPhotoSlideDirection] = useState("");
  const [showPhotoLightbox, setShowPhotoLightbox] = useState(false);
  const photoDragRef = useRef({ startX: null, pointerId: null });
  const suppressPhotoClickRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedDiary = diaries.find((diary) => diary.author_auth_user_id === selectedAuthor) || null;
  const selectedAuthorMember = selectedDiary && members.find((member) => String(member.userid) === String(selectedDiary.author_auth_user_id));
  const visibleAuthors = useMemo(() => diaries.map((diary) => diary.author_auth_user_id).filter(Boolean), [diaries]);
  const selectedPhotos = selectedDiary ? photosByDiary[selectedDiary.id] || [] : [];

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [auth, { data: roomData, error: roomError }, { data: memberData, error: memberError }, meetings] = await Promise.all([
        getRoomDiaryIdentity(roomId),
        supabase.from("rooms").select("id, roomname").eq("id", Number(roomId)).single(),
        supabase.from("room_members").select("userid, nickname, profiles:userid(profileimageurl)").eq("roomid", Number(roomId)),
        getRoomMeetings(roomId),
      ]);
      if (roomError) throw roomError;
      if (memberError) throw memberError;
      const foundMeeting = meetings.find((item) => item.id === meetingId);
      if (!foundMeeting) throw new Error("이 방에서 만남을 찾을 수 없습니다.");
      if (!auth.identityId || !auth.user) throw new Error("이 방의 회원만 기록을 볼 수 있습니다.");
      const records = await getMeetingDiaryDetails(meetingId);
      let meetingProgress = null;
      try { meetingProgress = await getMeetingDiaryProgress(meetingId); }
      catch (progressError) { setError(progressError.message || "기록 작성 현황을 불러오지 못했습니다."); }
      const loadedPhotos = await Promise.all(records.map(async (diary) => [diary.id, await getDiaryPhotos(diary.id)]));
      setIdentity(auth.identityId); setUserId(auth.user.id); setRoom(roomData); setMembers(memberData || []); setMeeting(foundMeeting);
      setMeetingOrdinal(meetings.findIndex((item) => item.id === meetingId) + 1);
      setDiaries(records); setProgress(meetingProgress || { published_count: new Set(records.map((diary) => diary.author_auth_user_id).filter(Boolean)).size, target_count: (memberData || []).length, published_member_ids: records.map((diary) => diary.author_auth_user_id).filter(Boolean) }); setPhotosByDiary(Object.fromEntries(loadedPhotos));
      const requestedAuthor = new URLSearchParams(location.search).get("author");
      const initialAuthor = records.some((diary) => diary.author_auth_user_id === requestedAuthor)
        ? requestedAuthor
        : records.some((diary) => diary.author_auth_user_id === auth.user.id) ? auth.user.id : records[0]?.author_auth_user_id || auth.user.id;
      setSelectedAuthor((previous) => records.some((diary) => diary.author_auth_user_id === previous) && !requestedAuthor ? previous : initialAuthor);
      const requestedPhoto = Number(new URLSearchParams(location.search).get("photo"));
      setPhotoIndex(Number.isInteger(requestedPhoto) && requestedPhoto >= 0 ? requestedPhoto : 0);
      setPhotoSlideDirection("");
    } catch (loadError) { setError(loadError.message || "기록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [roomId, meetingId, location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedDiaryId = selectedDiary?.id;
  useEffect(() => {
    let active = true;
    if (!selectedDiaryId) { setReactionRows([]); return undefined; }
    (async () => {
      const { data, error: queryError } = await supabase.from("diary_reactions").select("id, emoji, actor_identity_id").eq("diary_id", selectedDiaryId);
      if (!active) return;
      if (queryError) setError(queryError.message); else setReactionRows(data || []);
    })();
    return () => { active = false; };
  }, [selectedDiaryId]);

  const back = () => navigate(location.state?.from || `/rooms/${roomId}?tab=calendar`, { replace: !location.state?.from });
  const editDiary = () => navigate(`/rooms/${roomId}/meetings/${meetingId}/diary/edit`, { state: { from: `${location.pathname}${location.search}` } });
  const react = async (emoji) => {
    if (!selectedDiary || selectedDiary.author_auth_user_id === userId || busy) return;
    setBusy(true); setError("");
    try {
      await saveDiaryReaction({ diaryId: selectedDiary.id, identityId: identity, emoji });
      const { data, error: queryError } = await supabase.from("diary_reactions").select("id, emoji, actor_identity_id").eq("diary_id", selectedDiary.id);
      if (queryError) throw queryError;
      setReactionRows(data || []); setShowEmojiPicker(false);
    } catch (reactionError) { setError(reactionError.message || "공감을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selectedDiary || !window.confirm("이 기록을 삭제할까요?")) return;
    setBusy(true);
    try { await deleteDiaryPhotosAndRecord(selectedDiary); await load(); }
    catch (deleteError) { setError(deleteError.message || "기록을 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  if (loading) return <main className="meeting-diary-page"><p className="meeting-diary-state">기록을 불러오는 중…</p></main>;
  if (error && !meeting) return <main className="meeting-diary-page"><button className="meeting-diary-back" onClick={back}><FiArrowLeft /> 뒤로</button><p className="meeting-diary-state" role="alert">{error}</p></main>;
  const publishedByUserId = new Set(progress?.published_member_ids || []);
  const currentPosition = Math.max(0, visibleAuthors.indexOf(selectedAuthor));

  return <main className="meeting-diary-page">
    <header className="meeting-diary-hero">
      <div className="meeting-diary-topbar"><button className="meeting-diary-back" onClick={back} aria-label="캘린더로 돌아가기"><FiArrowLeft /></button><strong>{room?.roomname || "모임"}</strong><span aria-hidden="true" /></div>
      <h1>{meeting?.title || "함께한 만남"}</h1><p>{dateLabel(meeting?.meeting_date)} · {meetingOrdinal}번째 만남</p>
    </header>
    <section className="meeting-diary-members">
      <div className="meeting-diary-section-heading"><strong>우리의 기록</strong><span>{progress?.published_count ?? diaries.length}명 작성 · 전체 {members.length}명</span></div>
      <div className="meeting-diary-member-list" style={{ "--member-count": Math.max(members.length, 1) }}>{members.map((member) => {
        const hasDiary = publishedByUserId.has(String(member.userid));
        const isSelected = selectedDiary?.author_auth_user_id === String(member.userid);
        return <button key={member.userid} className={`meeting-diary-member ${hasDiary ? "written" : "unwritten"} ${isSelected ? "selected" : ""}`} disabled={!hasDiary} onClick={() => { setSelectedAuthor(String(member.userid)); setPhotoIndex(0); setPhotoSlideDirection(""); }}>
          <span className="meeting-diary-avatar">{member.profiles?.profileimageurl ? <img src={member.profiles.profileimageurl} alt="" /> : String(member.userid) === String(userId) ? "나" : member.nickname?.slice(0, 1) || "?"}</span><span className="meeting-diary-member-caption"><strong>{String(member.userid) === String(userId) ? "나" : member.nickname || "친구"}</strong>{hasDiary && String(member.userid) === String(userId) && <small>🙂</small>}</span>{!hasDiary && <small>미작성</small>}
        </button>;
      })}</div>
    </section>
    <section className="meeting-diary-record">
      <div className="meeting-diary-record-actions">{selectedDiary && <span className="meeting-diary-visibility">{selectedDiary.visibility === "private" ? "🔒 나만 보기" : "🔓 공개"}</span>}{selectedDiary?.author_auth_user_id === userId && <div><button onClick={editDiary}>수정하기</button><button className="delete" disabled={busy} onClick={remove}>삭제하기</button></div>}</div>
      {error && <p className="meeting-diary-error" role="alert">{error}</p>}
      {!selectedDiary ? <div className="meeting-diary-empty"><strong>아직 작성된 기록이 없어요</strong><p>이 만남을 함께한 하루를 기록해 보세요.</p>{identity && <button className="meeting-diary-create" onClick={editDiary}>✏️ 기록 남기기</button>}</div> : <>
        <div className="meeting-diary-title-row"><h2>{String(selectedDiary.author_auth_user_id) === String(userId) ? "나의 하루" : `${selectedAuthorMember?.nickname || "친구"}의 하루`}</h2>{selectedDiary.mood_emoji && <span className="meeting-diary-mood" aria-label={`기분 ${selectedDiary.mood_emoji}`}>{selectedDiary.mood_emoji}</span>}</div><time>{timeLabel(selectedDiary.published_at || selectedDiary.updated_at)}</time>
        {selectedPhotos.length > 0 && <><div className={`meeting-diary-photo-frame ${selectedPhotos.length > 1 ? "has-multiple-photos" : ""}`} role="button" tabIndex={0} aria-label="사진 크게 보기" onClick={() => { if (suppressPhotoClickRef.current) { suppressPhotoClickRef.current = false; return; } setShowPhotoLightbox(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setShowPhotoLightbox(true); } }} onPointerDown={(event) => { if (selectedPhotos.length < 2) return; photoDragRef.current = { startX: event.clientX, pointerId: event.pointerId }; suppressPhotoClickRef.current = false; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={(event) => { const drag = photoDragRef.current; if (drag.startX === null || drag.pointerId !== event.pointerId) return; const delta = event.clientX - drag.startX; photoDragRef.current = { startX: null, pointerId: null }; if (Math.abs(delta) > 22) { const step = delta < 0 ? 1 : -1; const nextIndex = Math.max(0, Math.min(selectedPhotos.length - 1, photoIndex + step)); suppressPhotoClickRef.current = true; if (nextIndex !== photoIndex) { setPhotoSlideDirection(step > 0 ? "next" : "previous"); setPhotoIndex(nextIndex); } } }} onPointerCancel={() => { photoDragRef.current = { startX: null, pointerId: null }; }}><img key={selectedPhotos[photoIndex]?.id || photoIndex} className={photoSlideDirection ? `photo-slide-${photoSlideDirection}` : ""} src={selectedPhotos[photoIndex]?.url} alt={`기록 사진 ${photoIndex + 1}`} draggable="false" /><span className="meeting-diary-photo-count">▣ 사진 {selectedPhotos.length}장 · 크게 보기</span></div><div className="meeting-diary-dots">{selectedPhotos.map((photo, index) => <button key={photo.id} aria-label={`${index + 1}번째 사진`} className={index === photoIndex ? "active" : ""} onClick={() => { if (index === photoIndex) return; setPhotoSlideDirection(index > photoIndex ? "next" : "previous"); setPhotoIndex(index); }} />)}</div></>}
        <p className="meeting-diary-body">{selectedDiary.body}</p>
        <div className="meeting-diary-reactions">{selectedDiary.author_auth_user_id !== userId && selectedDiary.visibility === "room" && <button type="button" className="meeting-diary-add-reaction" disabled={busy} onClick={() => setShowEmojiPicker((value) => !value)}>＋ <span className="meeting-diary-reaction-emoji">😊</span></button>}{reactionRows.length ? Object.entries(reactionRows.reduce((counts, row) => ({ ...counts, [row.emoji]: (counts[row.emoji] || 0) + 1 }), {})).map(([emoji, count]) => {
          const canReact = selectedDiary.author_auth_user_id !== userId && selectedDiary.visibility === "room";
          const reactedByMe = reactionRows.some((row) => row.emoji === emoji && String(row.actor_identity_id) === String(identity));
          return canReact
            ? <button type="button" key={emoji} className={`meeting-diary-reaction ${reactedByMe ? "selected" : ""}`} aria-pressed={reactedByMe} disabled={busy} onClick={() => react(emoji)}><span className="meeting-diary-reaction-emoji">{emoji}</span> <span>{count}</span></button>
            : <span className="meeting-diary-reaction-count" key={emoji}><span className="meeting-diary-reaction-emoji">{emoji}</span> <span>{count}</span></span>;
        }) : <span className="no-reactions">아직 공감이 없어요</span>}</div>
        {showEmojiPicker && <div className="meeting-diary-emoji-picker">{EMOJIS.map((emoji) => <button key={emoji} disabled={busy} onClick={() => react(emoji)}><span className="meeting-diary-picker-emoji">{emoji}</span></button>)}</div>}
        <nav className="meeting-diary-pager"><button disabled={currentPosition <= 0} onClick={() => { setSelectedAuthor(visibleAuthors[currentPosition - 1]); setPhotoIndex(0); setPhotoSlideDirection(""); }}><FiChevronLeft /> 이전 친구</button><span>{currentPosition + 1} / {visibleAuthors.length}</span><button disabled={currentPosition >= visibleAuthors.length - 1} onClick={() => { setSelectedAuthor(visibleAuthors[currentPosition + 1]); setPhotoIndex(0); setPhotoSlideDirection(""); }}>다음 친구 <FiChevronRight /></button></nav>
      </>}
    </section>
    {showPhotoLightbox && <DiaryPhotoLightbox photos={selectedPhotos} index={Math.min(photoIndex, selectedPhotos.length - 1)} onChange={(updateIndex) => setPhotoIndex((current) => updateIndex(current))} onClose={() => setShowPhotoLightbox(false)} />}
  </main>;
}
