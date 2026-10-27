import { useEffect, useMemo, useState } from "react";
import { getDiaryPhotos, saveDiaryReaction, deleteDiaryPhotosAndRecord } from "../../api/meetupDiaryApi";
import { supabase } from "../../lib/supabaseClient";
import "./RoomCalendar.css";

const REACTIONS = ["❤️", "😊", "👏", "🥰"];

function DiaryCollection({ roomId, identityId, diaries, meetings, initialMeetingId = null, initialDiaryId = null, onRefresh, onEdit }) {
  const [view, setView] = useState("mine");
  const [selectedDiary, setSelectedDiary] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const [reactionRows, setReactionRows] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const visibleDiaries = useMemo(() => diaries.filter((diary) => diary.status === "published" || diary.author_identity_id === identityId), [diaries, identityId]);
  const meetingDiaries = useMemo(() => initialMeetingId ? visibleDiaries.filter((diary) => diary.meeting_id === initialMeetingId) : visibleDiaries, [initialMeetingId, visibleDiaries]);
  const mine = useMemo(() => meetingDiaries.filter((diary) => diary.author_identity_id === identityId), [meetingDiaries, identityId]);
  const friends = useMemo(() => meetingDiaries.filter((diary) => diary.author_identity_id !== identityId && diary.status === "published" && diary.visibility === "room"), [meetingDiaries, identityId]);
  const current = useMemo(() => view === "mine" ? mine : view === "friends" ? friends : meetingDiaries, [friends, meetingDiaries, mine, view]);
  const groupedAuthors = useMemo(() => [...new Set(friends.map((diary) => diary.author_identity_id))].sort(), [friends]);

  useEffect(() => {
    if (!initialMeetingId) return;
    const initialDiary = visibleDiaries.find((diary) => diary.id === initialDiaryId && diary.meeting_id === initialMeetingId)
      || visibleDiaries.find((diary) => diary.meeting_id === initialMeetingId && diary.status === "published")
      || visibleDiaries.find((diary) => diary.meeting_id === initialMeetingId);
    if (initialDiary) {
      setView(initialDiary.author_identity_id === identityId ? "mine" : "friends");
      setSelectedDiary(initialDiary);
    }
  }, [identityId, initialDiaryId, initialMeetingId, visibleDiaries]);

  useEffect(() => {
    let active = true;
    const loadPhotos = async () => {
      const entries = await Promise.all(current.map(async (diary) => {
        try { return [diary.id, await getDiaryPhotos(diary.id)]; }
        catch (loadError) { setError(loadError.message || "일부 사진을 불러오지 못했습니다."); return [diary.id, []]; }
      }));
      if (active) setPhotoUrls((previous) => ({ ...previous, ...Object.fromEntries(entries) }));
    };
    loadPhotos();
    return () => { active = false; };
  }, [current]);

  useEffect(() => {
    if (!selectedDiary) return undefined;
    let active = true;
    (async () => {
      const { data, error: queryError } = await supabase.from("diary_reactions").select("id, emoji, actor_identity_id").eq("diary_id", selectedDiary.id);
      if (!active) return;
      if (queryError) setError(queryError.message);
      else setReactionRows(data || []);
    })();
    return () => { active = false; };
  }, [selectedDiary]);

  const meetingFor = (diary) => meetings.find((meeting) => meeting.id === diary.meeting_id);
  const authorLabel = (diary) => diary.author_identity_id === identityId ? "내 기록" : `친구 ${groupedAuthors.indexOf(diary.author_identity_id) + 1}`;

  const react = async (emoji) => {
    if (!selectedDiary || selectedDiary.author_identity_id === identityId) return;
    setBusyId(selectedDiary.id);
    try {
      await saveDiaryReaction({ diaryId: selectedDiary.id, identityId, emoji });
      const { data, error: queryError } = await supabase.from("diary_reactions").select("id, emoji, actor_identity_id").eq("diary_id", selectedDiary.id);
      if (queryError) throw queryError;
      setReactionRows(data || []);
    } catch (reactionError) { setError(reactionError.message || "반응을 저장하지 못했습니다."); }
    finally { setBusyId(null); }
  };

  const remove = async (diary) => {
    if (!window.confirm("이 기록을 삭제할까요?")) return;
    setBusyId(diary.id);
    try {
      await deleteDiaryPhotosAndRecord(diary);
      setSelectedDiary(null);
      onRefresh();
    } catch (deleteError) { setError(deleteError.message || "기록 삭제에 실패했습니다."); }
    finally { setBusyId(null); }
  };

  return (
    <section className="diary-collection">
      <header className="diary-collection-header"><div><p className="diary-eyebrow">ROOM DIARY</p><h2>기록 모아보기</h2></div><button type="button" className="diary-icon-button" onClick={onRefresh} aria-label="새로고침">↻</button></header>
      <div className="diary-collection-tabs"><button type="button" className={view === "mine" ? "selected" : ""} onClick={() => setView("mine")}>내 기록 <span>{mine.length}</span></button><button type="button" className={view === "friends" ? "selected" : ""} onClick={() => setView("friends")}>친구들의 공개 기록 <span>{friends.length}</span></button><button type="button" className={view === "photos" ? "selected" : ""} onClick={() => setView("photos")}>사진 모아보기</button></div>
      {error && <p className="diary-error">{error}</p>}
      {view === "photos" ? <div className="diary-gallery">{current.flatMap((diary) => (photoUrls[diary.id] || []).map((photo) => ({ diary, photo }))).map(({ diary, photo }) => <button type="button" key={photo.id} onClick={() => setSelectedDiary(diary)} aria-label={`${authorLabel(diary)} 사진 열기`}><img src={photo.url} alt="만남 기록 사진" /></button>)}</div> : current.length === 0 ? <div className="diary-empty"><span>📖</span><strong>아직 기록이 없어요</strong><p>함께한 만남의 하루를 기록해 보세요.</p></div> : <div className="diary-list">
        {current.map((diary) => {
          const meeting = meetingFor(diary);
          const photos = photoUrls[diary.id] || [];
          return <button type="button" className="diary-list-card" key={diary.id} onClick={() => setSelectedDiary(diary)}>
            {photos[0] && <img className="diary-list-cover" src={photos.find((photo) => photo.is_cover)?.url || photos[0].url} alt="기록 대표 사진" />}
            <span className="diary-list-copy"><span className="diary-list-meta">{meeting?.meeting_date || "날짜 없음"} · {authorLabel(diary)} {diary.status === "draft" ? "· 초안" : ""}</span><strong>{diary.mood_emoji ? `${diary.mood_emoji} ` : ""}{meeting?.title || "함께한 만남"}</strong><span>{diary.body || (photos.length ? "사진 기록" : "한 줄 기록")}</span></span>
          </button>;
        })}
      </div>}
      {selectedDiary && <div className="diary-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDiary(null); }}><section className="diary-sheet diary-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="diary-detail-title">
        <header className="diary-sheet-header"><div><p className="diary-eyebrow">{meetingFor(selectedDiary)?.meeting_date} · {authorLabel(selectedDiary)}</p><h2 id="diary-detail-title">{meetingFor(selectedDiary)?.title || "함께한 만남"}</h2></div><button type="button" className="diary-icon-button" onClick={() => setSelectedDiary(null)} aria-label="닫기">×</button></header>
        {selectedDiary.mood_emoji && <div className="diary-detail-mood">오늘의 기분 <span>{selectedDiary.mood_emoji}</span></div>}
        {(photoUrls[selectedDiary.id] || []).length > 0 && <div className="diary-detail-photos">{photoUrls[selectedDiary.id].map((photo) => <img key={photo.id} src={photo.url} alt="만남 기록 사진" />)}</div>}
        {selectedDiary.body && <p className="diary-detail-body">{selectedDiary.body}</p>}
        {selectedDiary.status === "published" && selectedDiary.visibility === "room" && selectedDiary.author_identity_id !== identityId && <div className="diary-reactions">{REACTIONS.map((emoji) => { const reacted = reactionRows.some((reaction) => reaction.actor_identity_id === identityId && reaction.emoji === emoji); const count = reactionRows.filter((reaction) => reaction.emoji === emoji).length; return <button type="button" key={emoji} disabled={busyId === selectedDiary.id} className={reacted ? "selected" : ""} onClick={() => react(emoji)}>{emoji} {count || ""}</button>; })}</div>}
        {selectedDiary.author_identity_id === identityId && <footer className="diary-actions"><button type="button" className="diary-secondary-button" disabled={busyId === selectedDiary.id} onClick={() => { setSelectedDiary(null); onEdit(meetingFor(selectedDiary)); }}>수정</button><button type="button" className="diary-delete-button" disabled={busyId === selectedDiary.id} onClick={() => remove(selectedDiary)}>삭제</button></footer>}
      </section></div>}
    </section>
  );
}

export default DiaryCollection;
