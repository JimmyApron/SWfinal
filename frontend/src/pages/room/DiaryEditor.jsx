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

function seoulDateKey(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDraftRestoreTime(timestamp) {
  const savedAt = new Date(timestamp);
  const savedDate = seoulDateKey(savedAt);
  const today = seoulDateKey(new Date());
  const yesterdayDate = new Date(`${today}T12:00:00+09:00`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = seoulDateKey(yesterdayDate);
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(savedAt);
  if (savedDate === today) return `오늘 ${time}에 쓰던 글을 불러왔어요`;
  if (savedDate === yesterday) return `어제 ${time}에 쓰던 글을 불러왔어요`;
  const date = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "long", day: "numeric",
  }).format(savedAt);
  return `${date} ${time}에 쓰던 글을 불러왔어요`;
}

function hasDraftContent(body, mood, visibility, photos) {
  return Boolean(body.trim() || mood || visibility !== "room" || photos.length);
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

function DiaryEditor({ roomId, meeting, identityId, profileImageUrl = "", onClose, onPublished, fullScreen = false, roomName = "모임", dateSubtitle = "" }) {
  const [diary, setDiary] = useState(null);
  const [body, setBody] = useState("");
  const [mood, setMood] = useState("");
  const [visibility, setVisibility] = useState("room");
  const [photos, setPhotos] = useState([]);
  const [draggingPhotoIndex, setDraggingPhotoIndex] = useState(null);
  const [dropPhotoIndex, setDropPhotoIndex] = useState(null);
  const [photosDirty, setPhotosDirty] = useState(false);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [restoredDraftTime, setRestoredDraftTime] = useState("");
  const [resetFailed, setResetFailed] = useState(false);
  const [showSaveFailureDialog, setShowSaveFailureDialog] = useState(false);
  const [retryingSave, setRetryingSave] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef("");
  const moodRef = useRef("");
  const visibilityRef = useRef("room");
  const photosRef = useRef([]);
  const serverPhotosRef = useRef([]);
  const diaryRef = useRef(null);
  const photosDirtyRef = useRef(false);
  const publishedPhotoChangesRef = useRef(false);
  const publishedLocalDraftRef = useRef(false);
  const savingRef = useRef(false);
  const discardingRef = useRef(false);
  const lastSaveErrorRef = useRef("");
  const savedContentRef = useRef(null);
  const idleTimerRef = useRef(null);
  const maxTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const photoTouchRef = useRef(null);
  const storageKey = `meetup-diary-draft:${roomId}:${meeting.id}:${identityId}`;
  const resumeKey = `meetup-diary-resume:${roomId}:${meeting.id}:${identityId}`;

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
    setStatus("editing");
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
        serverPhotosRef.current = nextPhotos;
        let hasRecoveredDraft = false;
        let restoredAt = new Date(existing?.updated_at || 0).getTime();
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
              hasRecoveredDraft = true;
              restoredAt = Math.max(restoredAt, Number(parsed.savedAt) || 0);
              if (existing?.status === "published") publishedLocalDraftRef.current = true;
            }
          } catch {
            localStorage.removeItem(storageKey);
          }
        }
        if (localPhotoDraft && photoListsDiffer(localPhotoDraft.photos, nextPhotos)) {
          nextPhotos = localPhotoDraft.photos;
          hasRecoveredDraft = true;
          restoredAt = Math.max(restoredAt, Number(localPhotoDraft.updatedAt) || 0);
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
        let shouldShowRestore = false;
        try {
          shouldShowRestore = sessionStorage.getItem(resumeKey) === "1"
            && existing?.status === "draft"
            && hasDraftContent(nextBody, nextMood, nextVisibility, nextPhotos);
          sessionStorage.removeItem(resumeKey);
        } catch { /* Resume notice is optional when session storage is unavailable. */ }
        if (shouldShowRestore && restoredAt) setRestoredDraftTime(String(restoredAt));
        setStatus(existing && !hasRecoveredDraft ? "saved" : "editing");
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
  }, [meeting.id, resumeKey, storageKey]);

  const persist = useCallback(async (publish = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setErrorMessage("");
    lastSaveErrorRef.current = "";
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
        const hasChanges = snapshot !== savedContentRef.current || photosDirtyRef.current;
        if (!hasChanges) {
          setStatus("saved");
          return true;
        }
        localStorage.setItem(storageKey, JSON.stringify({ body: bodyRef.current, mood: moodRef.current, visibility: visibilityRef.current, savedAt: Date.now() }));
        savedContentRef.current = snapshot;
        publishedPhotoChangesRef.current = publishedPhotoChangesRef.current || photosDirtyRef.current;
        publishedLocalDraftRef.current = true;
        photosDirtyRef.current = false;
        setPhotosDirty(false);
        setStatus("editing");
        return true;
      }
      if (!current || snapshot !== savedContentRef.current || publish) {
        const publishNow = publish && current?.status === "published";
        setStatus("saving");
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
        setStatus("saving");
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
        serverPhotosRef.current = photosToSave.map((photo) => {
          const committed = committedPhotos.get(photo);
          return committed ? { ...photo, ...committed, file: null } : photo;
        });
        photosRef.current = photosRef.current.map((photo) => {
          const committed = committedPhotos.get(photo);
          return committed ? { ...photo, storage_path: committed.storage_path, file: null } : photo;
        });
        serverPhotosRef.current = photosRef.current;
        setPhotos(photosRef.current);
        publishedPhotoChangesRef.current = false;
        if (noNewerPhotoChanges) {
          photosDirtyRef.current = false;
          setPhotosDirty(false);
        }
        if (!discardingRef.current) await writeLocalPhotoDraft(storageKey, photosRef.current);
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
      if (discardingRef.current) return false;
      localStorage.setItem(storageKey, JSON.stringify({ body: bodyRef.current, mood: moodRef.current, visibility: visibilityRef.current, savedAt: Date.now() }));
      setStatus(current?.id ? "saved" : "editing");
      if (publish && contentSnapshot() === snapshot && !photosDirtyRef.current) {
        publishedLocalDraftRef.current = false;
        localStorage.removeItem(storageKey);
        await removeLocalPhotoDraft(storageKey);
        onPublished();
      }
      return true;
    } catch (error) {
      failed = true;
      setStatus("failed");
      const isVersionConflict = error.code === "40001" || /version conflict/i.test(error.message || "");
      const message = isVersionConflict ? "다른 곳에서 기록이 변경되어 저장하지 않았습니다. 입력은 이 기기에 보관했습니다. 새로고침 후 최신 기록을 확인해 주세요." : error.message || "저장하지 못했습니다. 입력 내용은 이 기기에 보관했습니다.";
      lastSaveErrorRef.current = message;
      setErrorMessage(message);
      if (!discardingRef.current) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({ body: bodyRef.current, mood: moodRef.current, visibility: visibilityRef.current, savedAt: Date.now() }));
        } catch { /* Storage may be unavailable; keep the editor state in memory. */ }
      }
      if (!isVersionConflict && !discardingRef.current) retryTimerRef.current = window.setTimeout(() => persist(publishedPhotoChangesRef.current), 5000);
      return false;
    } finally {
      savingRef.current = false;
      setBusy(false);
      if (!failed && !discardingRef.current && (contentSnapshot() !== savedContentRef.current || photosDirtyRef.current)) {
        setStatus("editing");
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = window.setTimeout(() => persist(false), 2000);
      }
    }
  }, [contentSnapshot, meeting.id, onPublished, roomId, storageKey]);

  const isDirty = Boolean(savedContentRef.current) && (contentSnapshot() !== savedContentRef.current || photosDirty);

  useEffect(() => {
    if (status === "loading" || status === "saving" || status === "failed" || !isDirty) return undefined;
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => persist(false), 2000);
    if (!maxTimerRef.current) {
      maxTimerRef.current = window.setTimeout(() => persist(false), 10000);
    }
    return () => window.clearTimeout(idleTimerRef.current);
  }, [body, mood, visibility, photosDirty, isDirty, persist, status]);

  const updateMood = (value) => { moodRef.current = value; setMood(value); setStatus("editing"); storeLocalDraft(); window.setTimeout(() => persist(false), 0); };
  const updateVisibility = (value) => { visibilityRef.current = value; setVisibility(value); setStatus("editing"); storeLocalDraft(); window.setTimeout(() => persist(false), 0); };
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
    if (next.length) next.forEach((photo, photoIndex) => { photo.is_cover = photoIndex === 0; });
    setPhotoList(next);
  };

  const reorderPhoto = (from, to) => {
    if (from === to || from < 0 || to < 0 || from >= photosRef.current.length || to >= photosRef.current.length) return;
    const next = [...photosRef.current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    next.forEach((photo, index) => { photo.is_cover = index === 0; });
    setPhotoList(next);
  };
  const startPhotoReorder = (event, index) => {
    if (photosRef.current.length < 2) return;
    const touch = event.touches[0];
    setDropPhotoIndex(null);
    photoTouchRef.current = { index, x: touch.clientX, y: touch.clientY, timer: window.setTimeout(() => setDraggingPhotoIndex(index), 350) };
  };
  const movePhotoTouch = (event) => {
    const current = photoTouchRef.current;
    if (!current) return;
    const touch = event.touches[0];
    if (draggingPhotoIndex !== null) {
      const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest("[data-diary-photo-index]");
      const targetIndex = Number(target?.dataset.diaryPhotoIndex);
      setDropPhotoIndex(Number.isInteger(targetIndex) ? targetIndex : null);
      return;
    }
    if (Math.abs(touch.clientX - current.x) > 9 || Math.abs(touch.clientY - current.y) > 9) {
      window.clearTimeout(current.timer);
      photoTouchRef.current = null;
    }
  };
  const endPhotoReorder = (event) => {
    const current = photoTouchRef.current;
    if (current?.timer) window.clearTimeout(current.timer);
    if (draggingPhotoIndex !== null && event.changedTouches?.[0]) {
      const touch = event.changedTouches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest("[data-diary-photo-index]");
      const targetIndex = Number(target?.dataset.diaryPhotoIndex);
      if (Number.isInteger(targetIndex)) reorderPhoto(draggingPhotoIndex, targetIndex);
    }
    photoTouchRef.current = null;
    setDraggingPhotoIndex(null);
    setDropPhotoIndex(null);
  };
  const handlePhotoDragStart = (event, index) => {
    if (photosRef.current.length < 2) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggingPhotoIndex(index);
    setDropPhotoIndex(null);
  };
  const handlePhotoDragOver = (event, index) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropPhotoIndex(index);
  };
  const handlePhotoDrop = (event, index) => {
    event.preventDefault();
    const from = Number(event.dataTransfer.getData("text/plain"));
    reorderPhoto(Number.isInteger(from) ? from : draggingPhotoIndex, index);
    setDraggingPhotoIndex(null);
    setDropPhotoIndex(null);
  };
  const handlePhotoKeyDown = (event, index) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); reorderPhoto(index, index - 1); }
    if (event.key === "ArrowRight" && index < photosRef.current.length - 1) { event.preventDefault(); reorderPhoto(index, index + 1); }
  };

  const leaveEditor = (saved) => {
    try {
      if (diaryRef.current?.status === "draft" && hasDraftContent(
        diaryRef.current.body || "", diaryRef.current.mood_emoji || "", diaryRef.current.visibility || "room", serverPhotosRef.current,
      )) {
        sessionStorage.setItem(resumeKey, "1");
      } else {
        sessionStorage.removeItem(resumeKey);
      }
    } catch { /* Resume notice is optional when session storage is unavailable. */ }
    onClose({ saved });
  };

  const closeEditor = async () => {
    const hadUnsavedChanges = contentSnapshot() !== savedContentRef.current || photosDirtyRef.current;
    const wasSaving = savingRef.current;
    if (wasSaving) {
      while (savingRef.current) await new Promise((resolve) => window.setTimeout(resolve, 40));
    }
    const hasUnsavedChanges = contentSnapshot() !== savedContentRef.current || photosDirtyRef.current;
    const saved = wasSaving && lastSaveErrorRef.current
      ? false
      : hasUnsavedChanges ? await persist(false) : !lastSaveErrorRef.current && status !== "failed";
    if (!saved) {
      setRetryError(lastSaveErrorRef.current || errorMessage || "마지막 자동 저장에 실패했습니다.");
      setShowSaveFailureDialog(true);
      return;
    }
    leaveEditor(hadUnsavedChanges || hasUnsavedChanges);
  };

  const retrySaveAndLeave = async () => {
    if (retryingSave || savingRef.current) return;
    setRetryingSave(true);
    setRetryError("");
    const saved = await persist(false);
    if (!discardingRef.current) {
      if (saved) {
        setShowSaveFailureDialog(false);
        leaveEditor(true);
      } else {
        setRetryError(lastSaveErrorRef.current || "저장하지 못했습니다. 다시 시도해 주세요.");
      }
    }
    setRetryingSave(false);
  };

  const discardAndLeave = async () => {
    if (discardingRef.current) return;
    discardingRef.current = true;
    window.clearTimeout(idleTimerRef.current);
    window.clearTimeout(maxTimerRef.current);
    window.clearTimeout(retryTimerRef.current);
    try { localStorage.removeItem(storageKey); } catch { /* Keep the exit action available if storage is unavailable. */ }
    try {
      await removeLocalPhotoDraft(storageKey);
    } catch {
      try { await writeLocalPhotoDraft(storageKey, serverPhotosRef.current); } catch { /* Server photos remain available through the diary record. */ }
    }
    leaveEditor(false);
  };

  const startNewDraft = async () => {
    if (busy || savingRef.current || !window.confirm("지금까지 작성한 내용을 모두 지우고 새로 작성할까요?")) return;
    const previousLocalDraft = localStorage.getItem(storageKey);
    const previousPhotos = photosRef.current;
    const emptySnapshot = JSON.stringify({ body: "", mood: "", visibility: "room" });
    let serverWasReset = false;
    savingRef.current = true;
    setBusy(true);
    setStatus("saving");
    setErrorMessage("");
    setResetFailed(false);
    window.clearTimeout(idleTimerRef.current);
    window.clearTimeout(maxTimerRef.current);
    window.clearTimeout(retryTimerRef.current);
    try {
      await writeLocalPhotoDraft(storageKey, []);
      localStorage.setItem(storageKey, JSON.stringify({ body: "", mood: "", visibility: "room", savedAt: Date.now() }));

      let current = diaryRef.current;
      if (!current || current.status !== "draft") throw new Error("초안을 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.");
      const saved = await saveDiary({
        meetingId: meeting.id,
        expectedVersion: current.version,
        body: "",
        moodEmoji: "",
        visibility: "room",
        publish: false,
        requestId: makeRequestId(),
      });
      current = { ...current, ...saved, meeting_id: meeting.id, body: "", mood_emoji: null, visibility: "room" };
      diaryRef.current = current;
      serverWasReset = true;
      if (previousPhotos.length) {
        const photoResult = await uploadDiaryPhotos({
          roomId,
          meetingId: meeting.id,
          diaryId: current.id,
          photos: [],
          expectedVersion: current.version,
        });
        current = { ...current, ...photoResult };
        diaryRef.current = current;
        serverPhotosRef.current = [];
      }
      const resetSavedAt = new Date(current.updated_at || Date.now()).getTime();
      localStorage.setItem(storageKey, JSON.stringify({ body: "", mood: "", visibility: "room", savedAt: resetSavedAt }));
      await writeLocalPhotoDraft(storageKey, []);
      diaryRef.current = current;
      serverPhotosRef.current = [];
      setDiary(current);
      bodyRef.current = "";
      moodRef.current = "";
      visibilityRef.current = "room";
      photosRef.current = [];
      photosDirtyRef.current = false;
      setBody("");
      setMood("");
      setVisibility("room");
      setPhotos([]);
      setPhotosDirty(false);
      setRestoredDraftTime("");
      savedContentRef.current = emptySnapshot;
      try { sessionStorage.removeItem(resumeKey); } catch { /* Ignore unavailable session storage. */ }
      setStatus("saved");
    } catch (error) {
      try {
        let recovery = { body: bodyRef.current, mood: moodRef.current, visibility: visibilityRef.current };
        try { recovery = { ...recovery, ...(previousLocalDraft ? JSON.parse(previousLocalDraft) : {}) }; } catch { /* Keep the live editor values. */ }
        const serverUpdatedAt = new Date(diaryRef.current?.updated_at || 0).getTime();
        recovery.savedAt = Math.max(Date.now(), serverUpdatedAt + 1);
        localStorage.setItem(storageKey, JSON.stringify(recovery));
        await writeLocalPhotoDraft(storageKey, previousPhotos);
      } catch { /* Keep the original content in the editor if local rollback is unavailable. */ }
      if (serverWasReset) {
        savedContentRef.current = emptySnapshot;
        photosDirtyRef.current = Boolean(previousPhotos.length);
        setPhotosDirty(photosDirtyRef.current);
      }
      setStatus("failed");
      setResetFailed(true);
      setErrorMessage(error.message || "초안을 초기화하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const saveLabel = status === "saving"
    ? "저장 중..."
    : status === "failed"
      ? "저장 실패"
      : status === "saved" && diary?.id
        ? "✓ 자동 저장됨"
        : "작성 중";

  if (status === "loading") return fullScreen
    ? <main className="diary-fullscreen-loading">기록을 불러오는 중…</main>
    : <div className="diary-modal"><div className="diary-sheet">기록을 불러오는 중…</div></div>;

  return (
    <main className={fullScreen ? "diary-fullscreen-editor" : "diary-modal"} role={fullScreen ? undefined : "presentation"} onMouseDown={!fullScreen ? (event) => { if (event.target === event.currentTarget && !busy) closeEditor(); } : undefined}>
      {fullScreen && <header className="diary-fullscreen-hero">
        <div className="diary-fullscreen-topbar"><button type="button" onClick={closeEditor} aria-label="닫기">×</button><strong>{roomName}</strong><span className={status === "failed" ? "failed" : ""}>{saveLabel}</span></div>
        <h1>{meeting.title || "함께한 만남"}</h1><p>{dateSubtitle}</p>
      </header>}
      {restoredDraftTime && <div className="diary-draft-restore-banner"><span>✎ {formatDraftRestoreTime(Number(restoredDraftTime))}</span><button type="button" disabled={busy} onClick={startNewDraft}>새로 쓰기</button></div>}
      <section className={`diary-sheet ${fullScreen ? "diary-fullscreen-sheet" : ""}`} role="dialog" aria-modal="true" aria-labelledby="diary-title">
        {!fullScreen && <header className="diary-sheet-header"><div><p className="diary-eyebrow">{meeting.meeting_date}</p><h2 id="diary-title">나의 하루</h2></div><button type="button" className="diary-icon-button" onClick={closeEditor} aria-label="닫기">×</button></header>}
        {fullScreen && <div className="diary-fullscreen-title-row"><span className="diary-fullscreen-profile-avatar">{profileImageUrl ? <img src={profileImageUrl} alt="내 프로필" /> : "나"}</span><h2 id="diary-title">나의 하루</h2>{mood && <b>{mood}</b>}</div>}
        {!fullScreen && <div className="diary-meeting-card"><strong>{meeting.title || "함께한 만남"}</strong><span>{meeting.location || (meeting.source_type === "lightning" ? "번개 만남" : "확정 일정")}</span></div>}
        <label className="diary-field-label">오늘 기분은 어땠나요?</label>
        <div className="diary-moods">{MOODS.map((item) => <button type="button" key={item} className={mood === item ? "selected" : ""} onClick={() => updateMood(mood === item ? "" : item)}>{item}</button>)}</div>
        <div className="diary-field-heading"><label className="diary-field-label" htmlFor="diary-body">사진</label><span>{photos.length}/10 · 길게 눌러 끌어서 순서 변경</span></div>
        <div className="diary-photos">
          {photos.map((photo, index) => <div data-diary-photo-index={index} draggable={photos.length > 1} tabIndex={photos.length > 1 ? 0 : undefined} role="group" aria-roledescription="사진" aria-label={`사진 ${index + 1}/${photos.length}, 길게 눌러 끌어서 순서 변경${photo.is_cover ? ", 대표 사진" : ""}`} onKeyDown={(event) => handlePhotoKeyDown(event, index)} onDragStart={(event) => handlePhotoDragStart(event, index)} onDragOver={(event) => handlePhotoDragOver(event, index)} onDrop={(event) => handlePhotoDrop(event, index)} onDragEnd={() => { setDraggingPhotoIndex(null); setDropPhotoIndex(null); }} onTouchStart={(event) => startPhotoReorder(event, index)} onTouchMove={movePhotoTouch} onTouchEnd={endPhotoReorder} onTouchCancel={endPhotoReorder} onContextMenu={(event) => event.preventDefault()} className={`diary-photo ${draggingPhotoIndex === index ? "is-dragging" : ""} ${dropPhotoIndex === index && draggingPhotoIndex !== index ? "is-drop-target" : ""}`} key={photo.storage_path || photo.url || index}><img src={photo.url} alt={`기록 사진 ${index + 1}`} draggable="false" />{photo.is_cover && <span className="diary-photo-cover">대표</span>}<div className="diary-photo-actions"><button type="button" onClick={() => removePhoto(index)} aria-label={`사진 ${index + 1} 삭제`}>×</button></div></div>)}
          {photos.length < 10 && <label className="diary-photo-add">＋<span>사진 추가</span><input type="file" accept="image/*" multiple onChange={handleFiles} /></label>}
        </div>
        <label className="diary-field-label" htmlFor="diary-body">어떤 하루였나요?</label>
        <textarea id="diary-body" className="diary-textarea" maxLength={500} value={body} onChange={(event) => { bodyRef.current = event.target.value; setBody(event.target.value); setStatus("editing"); storeLocalDraft(); }} placeholder="오늘 함께한 순간을 기록해 보세요." />
        <div className="diary-character-count">{body.length}/500</div>
        <div className="diary-field-label" id="diary-visibility-label">공개 범위</div>
        <div className="diary-visibility-options" role="group" aria-labelledby="diary-visibility-label">
          <button type="button" className={visibility === "room" ? "selected" : ""} aria-pressed={visibility === "room"} onClick={() => updateVisibility("room")}>🔒 모임 친구 공개</button>
          <button type="button" className={visibility === "private" ? "selected" : ""} aria-pressed={visibility === "private"} onClick={() => updateVisibility("private")}>🔒 나만 보기</button>
        </div>
        {errorMessage && <div className={`diary-save-state ${status === "failed" ? "error" : ""}`} role={status === "failed" ? "alert" : undefined}>{status === "failed" ? `저장 실패 · ${errorMessage}` : errorMessage}{status === "failed" && <button type="button" className="diary-retry-button" disabled={busy} onClick={() => resetFailed ? startNewDraft() : persist(false)}>{resetFailed ? "초기화 다시 시도" : "다시 저장"}</button>}</div>}
        {!fullScreen && <div className={`diary-save-state ${status === "failed" ? "error" : ""}`}>{status === "saving" || busy ? "저장 중" : status === "failed" ? `저장 실패 · ${errorMessage}` : diary?.status === "published" && (isDirty || publishedLocalDraftRef.current) ? "이 기기에 자동 저장됨 · 게시 버튼을 누르면 모임에 반영됩니다." : "자동 저장됨"}</div>}
        <footer className={`diary-actions ${fullScreen ? "diary-fullscreen-actions" : ""}`}>{!fullScreen && <button type="button" className="diary-secondary-button" disabled={busy} onClick={() => persist(false)}>지금 저장</button>}<button type="button" className="diary-publish-button" disabled={busy || (diary?.status === "published" && !isDirty && !publishedLocalDraftRef.current)} onClick={() => persist(true)}>{diary?.status === "published" ? "수정 내용 게시" : "기록 남기기"}</button></footer>
      </section>
      {showSaveFailureDialog && <div className="diary-save-failure-overlay"><section className="diary-save-failure-dialog" role="alertdialog" aria-modal="true" aria-labelledby="diary-save-failure-title" aria-describedby="diary-save-failure-description">
        <span className="diary-save-failure-icon" aria-hidden="true">!</span>
        <h2 id="diary-save-failure-title">자동 저장에 실패했어요</h2>
        <p id="diary-save-failure-description">작성 중인 내용이 아직 저장되지 않았어요.<br />다시 저장하거나 계속 작성할 수 있어요.</p>
        {retryError && <p className="diary-save-failure-error" role="alert">{retryError}</p>}
        <button type="button" className="diary-save-failure-primary" disabled={retryingSave || busy} onClick={retrySaveAndLeave}>{retryingSave || busy ? "저장 중..." : "다시 저장"}</button>
        <button type="button" className="diary-save-failure-secondary" disabled={retryingSave || busy} onClick={() => { setShowSaveFailureDialog(false); setRetryError(""); }}>계속 작성</button>
        <p className="diary-save-failure-warning">저장하지 않고 나가면 마지막 저장 이후 변경사항은 사라집니다.</p>
        <button type="button" className="diary-save-failure-discard" disabled={retryingSave || busy} onClick={discardAndLeave}>저장하지 않고 나가기</button>
      </section></div>}
    </main>
  );
}

export default DiaryEditor;
