import { useCallback, useEffect, useRef, useState } from "react";
import { getDiaryPhotos, getMyMeetingDiary, saveDiary, uploadDiaryPhotos } from "../../api/meetupDiaryApi";
import "./RoomCalendar.css";

const MOODS = ["😍", "😋", "😊", "😐", "😢", "😡"];

function makeRequestId() {
  return crypto.randomUUID();
}

function openDiaryDraftDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("이 브라우저는 오프라인 사진 초안을 지원하지 않습니다.")); return; }
    const request = window.indexedDB.open("meetup-diary-local-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("photos", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeLocalPhotoDraft(key, photos) {
  const database = await openDiaryDraftDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("photos", "readwrite");
    transaction.objectStore("photos").put({
      id: key,
      updatedAt: Date.now(),
      photos: photos.map((photo) => ({
        storage_path: photo.storage_path || null,
        is_cover: Boolean(photo.is_cover),
        name: photo.file?.name || "photo.jpg",
        type: photo.file?.type || "image/jpeg",
        blob: photo.file || null,
      })),
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => database.close());
}

async function readLocalPhotoDraft(key, remotePhotos) {
  const database = await openDiaryDraftDatabase();
  const record = await new Promise((resolve, reject) => {
    const transaction = database.transaction("photos", "readonly");
    const request = transaction.objectStore("photos").get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
  if (!record) return null;
  const photos = record.photos.map((photo) => {
    if (photo.storage_path) return remotePhotos.find((remote) => remote.storage_path === photo.storage_path) || null;
    if (!photo.blob) return null;
    const file = new File([photo.blob], photo.name, { type: photo.type });
    return { file, url: URL.createObjectURL(file), is_cover: photo.is_cover };
  }).filter(Boolean);
  return { photos, updatedAt: record.updatedAt };
}

function photoListsDiffer(left, right) {
  return left.length !== right.length || left.some((photo, index) =>
    photo.storage_path !== right[index]?.storage_path || Boolean(photo.is_cover) !== Boolean(right[index]?.is_cover)
  );
}

async function removeLocalPhotoDraft(key) {
  if (!window.indexedDB) return;
  const database = await openDiaryDraftDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("photos", "readwrite");
    transaction.objectStore("photos").delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
}

function DiaryEditor({ roomId, meeting, identityId, onClose, onPublished }) {
  const [diary, setDiary] = useState(null);
  const [body, setBody] = useState("");
  const [mood, setMood] = useState("");
  const [visibility, setVisibility] = useState("room");
  const [photos, setPhotos] = useState([]);
  const [photosDirty, setPhotosDirty] = useState(false);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef("");
  const moodRef = useRef("");
  const visibilityRef = useRef("room");
  const photosRef = useRef([]);
  const diaryRef = useRef(null);
  const photosDirtyRef = useRef(false);
  const publishedPhotoChangesRef = useRef(false);
  const publishedLocalDraftRef = useRef(false);
  const savingRef = useRef(false);
  const savedContentRef = useRef(null);
  const idleTimerRef = useRef(null);
  const maxTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const storageKey = `meetup-diary-draft:${roomId}:${meeting.id}:${identityId}`;

  const contentSnapshot = useCallback(() => JSON.stringify({
    body: bodyRef.current,
    mood: moodRef.current,
    visibility: visibilityRef.current,
  }), []);

  const setPhotoList = (next) => {
    photosRef.current = next;
    photosDirtyRef.current = true;
    setPhotos(next);
    setPhotosDirty(true);
    writeLocalPhotoDraft(storageKey, next).catch((error) => {
      setErrorMessage(error.message || "사진 초안을 이 기기에 보관하지 못했습니다.");
    });
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const existing = await getMyMeetingDiary(meeting.id);
        if (!active) return;
        let nextBody = existing?.body || "";
        let nextMood = existing?.mood_emoji || "";
        let nextVisibility = existing?.visibility || "room";
        let nextPhotos = existing ? await getDiaryPhotos(existing.id) : [];
        let localPhotoDraft = null;
        try { localPhotoDraft = await readLocalPhotoDraft(storageKey, nextPhotos); }
        catch (draftError) { setErrorMessage(draftError.message || "사진 초안을 불러오지 못했습니다."); }
        const localDraft = localStorage.getItem(storageKey);
        if (localDraft) {
          try {
            const parsed = JSON.parse(localDraft);
            if (!existing || parsed.savedAt > new Date(existing.updated_at).getTime()) {
              nextBody = parsed.body || "";
              nextMood = parsed.mood || "";
              nextVisibility = parsed.visibility || "room";
              if (existing?.status === "published") publishedLocalDraftRef.current = true;
            }
          } catch {
            localStorage.removeItem(storageKey);
          }
        }
        if (localPhotoDraft && photoListsDiffer(localPhotoDraft.photos, nextPhotos)) {
          nextPhotos = localPhotoDraft.photos;
          photosRef.current = nextPhotos;
          photosDirtyRef.current = true;
          if (existing?.status === "published") publishedLocalDraftRef.current = true;
          setPhotosDirty(true);
        }
        if (!active) return;
        diaryRef.current = existing;
        setDiary(existing);
        bodyRef.current = nextBody;
        moodRef.current = nextMood;
        visibilityRef.current = nextVisibility;
        photosRef.current = nextPhotos;
        setBody(nextBody);
        setMood(nextMood);
        setVisibility(nextVisibility);
        setPhotos(nextPhotos);
        savedContentRef.current = JSON.stringify({ body: existing?.body || "", mood: existing?.mood_emoji || "", visibility: existing?.visibility || "room" });
        setStatus("saved");
      } catch (error) {
        if (active) {
          setStatus("failed");
          setErrorMessage(error.message || "기록을 불러오지 못했습니다.");
        }
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(idleTimerRef.current);
      window.clearTimeout(maxTimerRef.current);
      window.clearTimeout(retryTimerRef.current);
    };
  }, [meeting.id, storageKey]);

  const persist = useCallback(async (publish = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setStatus("saving");
    setErrorMessage("");
    window.clearTimeout(idleTimerRef.current);
    window.clearTimeout(maxTimerRef.current);
    window.clearTimeout(retryTimerRef.current);
    idleTimerRef.current = null;
    maxTimerRef.current = null;
    retryTimerRef.current = null;
    let failed = false;
    try {
      let current = diaryRef.current;
      const snapshot = contentSnapshot();
      const savedBody = bodyRef.current;
      const savedMood = moodRef.current;
      const savedVisibility = visibilityRef.current;
      if (current?.status === "published" && !publish) {
        localStorage.setItem(storageKey, JSON.stringify({ body: bodyRef.current, mood: moodRef.current, visibility: visibilityRef.current, savedAt: Date.now() }));
        savedContentRef.current = snapshot;
        publishedPhotoChangesRef.current = publishedPhotoChangesRef.current || photosDirtyRef.current;
        publishedLocalDraftRef.current = true;
        photosDirtyRef.current = false;
        setPhotosDirty(false);
        setStatus("saved");
        return;
      }
      if (!current || snapshot !== savedContentRef.current || publish) {
        const publishNow = publish && current?.status === "published";
        const result = await saveDiary({
          meetingId: meeting.id,
          expectedVersion: current?.version || 0,
          body: savedBody,
          moodEmoji: savedMood,
          visibility: savedVisibility,
          publish: publishNow,
          requestId: makeRequestId(),
        });
        current = { ...(current || {}), ...result, meeting_id: meeting.id, body: savedBody, mood_emoji: savedMood, visibility: savedVisibility };
        diaryRef.current = current;
        setDiary(current);
        savedContentRef.current = snapshot;
      }
      if (photosDirtyRef.current || (publish && publishedPhotoChangesRef.current)) {
        const photosToSave = photosRef.current;
        const result = await uploadDiaryPhotos({
          roomId,
          meetingId: meeting.id,
          diaryId: current.id,
          photos: photosToSave,
          expectedVersion: current.version,
        });
        current = { ...current, ...result };
        diaryRef.current = current;
        setDiary(current);
        const noNewerPhotoChanges = photosRef.current === photosToSave;
        const committedPhotos = new Map(photosToSave.map((photo, index) => [photo, result.photos[index]]));
        photosRef.current = photosRef.current.map((photo) => {
          const committed = committedPhotos.get(photo);
          return committed ? { ...photo, storage_path: committed.storage_path, file: null } : photo;
        });
        setPhotos(photosRef.current);
        publishedPhotoChangesRef.current = false;
        if (noNewerPhotoChanges) {
          photosDirtyRef.current = false;
          setPhotosDirty(false);
        }
        await writeLocalPhotoDraft(storageKey, photosRef.current);
      }
      if (publish && current.status === "draft") {
        const result = await saveDiary({
          meetingId: meeting.id,
          expectedVersion: current.version,
          body: savedBody,
          moodEmoji: savedMood,
          visibility: savedVisibility,
          publish: true,
          requestId: makeRequestId(),
        });
        current = { ...current, ...result };
        diaryRef.current = current;
        setDiary(current);
      }
      localStorage.setItem(storageKey, JSON.stringify({ body: bodyRef.current, mood: moodRef.current, visibility: visibilityRef.current, savedAt: Date.now() }));
      setStatus("saved");
      if (publish && contentSnapshot() === snapshot && !photosDirtyRef.current) {
        publishedLocalDraftRef.current = false;
        localStorage.removeItem(storageKey);
        await removeLocalPhotoDraft(storageKey);
        onPublished();
      }
    } catch (error) {
      failed = true;
      setStatus("failed");
      const isVersionConflict = error.code === "40001" || /version conflict/i.test(error.message || "");
      setErrorMessage(isVersionConflict ? "다른 곳에서 기록이 변경되어 저장하지 않았습니다. 입력은 이 기기에 보관했습니다. 새로고침 후 최신 기록을 확인해 주세요." : error.message || "저장하지 못했습니다. 입력 내용은 이 기기에 보관했습니다.");
      try {
        localStorage.setItem(storageKey, JSON.stringify({ body: bodyRef.current, mood: moodRef.current, visibility: visibilityRef.current, savedAt: Date.now() }));
      } catch { /* Storage may be unavailable; keep the editor state in memory. */ }
      if (!isVersionConflict) retryTimerRef.current = window.setTimeout(() => persist(publishedPhotoChangesRef.current), 5000);
    } finally {
      savingRef.current = false;
      setBusy(false);
      if (!failed && (contentSnapshot() !== savedContentRef.current || photosDirtyRef.current)) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = window.setTimeout(() => persist(false), 2000);
      }
    }
  }, [contentSnapshot, meeting.id, onPublished, roomId, storageKey]);

  const isDirty = Boolean(savedContentRef.current) && (contentSnapshot() !== savedContentRef.current || photosDirty);

  useEffect(() => {
    if (status === "loading" || status === "failed" || !isDirty) return undefined;
    setStatus("saving");
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => persist(false), 2000);
    if (!maxTimerRef.current) {
      maxTimerRef.current = window.setTimeout(() => persist(false), 10000);
    }
    return () => window.clearTimeout(idleTimerRef.current);
  }, [body, mood, visibility, photosDirty, isDirty, persist, status]);

  const updateMood = (value) => { moodRef.current = value; setMood(value); storeLocalDraft(); window.setTimeout(() => persist(false), 0); };
  const updateVisibility = (value) => { visibilityRef.current = value; setVisibility(value); storeLocalDraft(); window.setTimeout(() => persist(false), 0); };
  const storeLocalDraft = () => {
    try { localStorage.setItem(storageKey, JSON.stringify({ body: bodyRef.current, mood: moodRef.current, visibility: visibilityRef.current, savedAt: Date.now() })); }
    catch { /* Keep edits in memory when browser storage is unavailable. */ }
  };

  const handleFiles = (event) => {
    const incoming = Array.from(event.target.files || []);
    event.target.value = "";
    if (photosRef.current.length + incoming.length > 10) {
      setErrorMessage("사진은 최대 10장까지 첨부할 수 있습니다.");
      return;
    }
    const valid = incoming.filter((file) => file.type.startsWith("image/"));
    if (valid.length !== incoming.length) setErrorMessage("이미지 파일만 첨부할 수 있습니다.");
    if (!valid.length) return;
    const added = valid.map((file) => ({ file, url: URL.createObjectURL(file), is_cover: photosRef.current.length === 0 }));
    setPhotoList([...photosRef.current, ...added]);
    storeLocalDraft();
    window.setTimeout(() => persist(false), 0);
  };

  const removePhoto = (index) => {
    const next = photosRef.current.filter((_, i) => i !== index);
    if (next.length && !next.some((photo) => photo.is_cover)) next[0].is_cover = true;
    setPhotoList(next);
  };

  const movePhoto = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= photosRef.current.length) return;
    const next = [...photosRef.current];
    [next[index], next[target]] = [next[target], next[index]];
    setPhotoList(next);
  };

  const selectCover = (index) => setPhotoList(photosRef.current.map((photo, i) => ({ ...photo, is_cover: i === index })));

  if (status === "loading") return <div className="diary-modal"><div className="diary-sheet">기록을 불러오는 중…</div></div>;

  return (
    <div className="diary-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="diary-sheet" role="dialog" aria-modal="true" aria-labelledby="diary-title">
        <header className="diary-sheet-header"><div><p className="diary-eyebrow">{meeting.meeting_date}</p><h2 id="diary-title">나의 하루</h2></div><button type="button" className="diary-icon-button" onClick={onClose} aria-label="닫기">×</button></header>
        <div className="diary-meeting-card"><strong>{meeting.title || "함께한 만남"}</strong><span>{meeting.location || (meeting.source_type === "lightning" ? "번개 만남" : "확정 일정")}</span></div>
        <label className="diary-field-label">오늘 기분은 어땠나요?</label>
        <div className="diary-moods">{MOODS.map((item) => <button type="button" key={item} className={mood === item ? "selected" : ""} onClick={() => updateMood(mood === item ? "" : item)}>{item}</button>)}</div>
        <div className="diary-field-heading"><label className="diary-field-label" htmlFor="diary-body">사진</label><span>{photos.length}/10</span></div>
        <div className="diary-photos">
          {photos.map((photo, index) => <div className="diary-photo" key={photo.storage_path || photo.url || index}><img src={photo.url} alt={`기록 사진 ${index + 1}`} /><button type="button" className="diary-photo-cover" onClick={() => selectCover(index)}>{photo.is_cover ? "대표" : "대표 지정"}</button><div className="diary-photo-actions"><button type="button" onClick={() => movePhoto(index, -1)} aria-label="앞으로">←</button><button type="button" onClick={() => movePhoto(index, 1)} aria-label="뒤로">→</button><button type="button" onClick={() => removePhoto(index)} aria-label="삭제">×</button></div></div>)}
          {photos.length < 10 && <label className="diary-photo-add">＋<span>사진 추가</span><input type="file" accept="image/*" multiple onChange={handleFiles} /></label>}
        </div>
        <label className="diary-field-label" htmlFor="diary-body">어떤 하루였나요?</label>
        <textarea id="diary-body" className="diary-textarea" maxLength={500} value={body} onChange={(event) => { bodyRef.current = event.target.value; setBody(event.target.value); storeLocalDraft(); }} placeholder="오늘 함께한 순간을 기록해 보세요." />
        <div className="diary-character-count">{body.length}/500</div>
        <label className="diary-field-label" htmlFor="diary-visibility">공개 범위</label>
        <select id="diary-visibility" className="diary-select" value={visibility} onChange={(event) => updateVisibility(event.target.value)}><option value="room">모임 친구 공개</option><option value="private">나만 보기</option></select>
        <div className={`diary-save-state ${status === "failed" ? "error" : ""}`}>{status === "saving" || busy ? "저장 중" : status === "failed" ? `저장 실패 · ${errorMessage}` : diary?.status === "published" && (isDirty || publishedLocalDraftRef.current) ? "이 기기에 자동 저장됨 · 게시 버튼을 누르면 모임에 반영됩니다." : "자동 저장됨"}</div>
        <footer className="diary-actions"><button type="button" className="diary-secondary-button" disabled={busy} onClick={() => persist(false)}>지금 저장</button><button type="button" className="diary-publish-button" disabled={busy || (diary?.status === "published" && !isDirty && !publishedLocalDraftRef.current)} onClick={() => persist(true)}>{diary?.status === "published" ? "수정 내용 게시" : "기록 남기기"}</button></footer>
      </section>
    </div>
  );
}

export default DiaryEditor;
