import { useCallback, useEffect, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiX } from "react-icons/fi";
import "./DiaryPhotoLightbox.css";

export default function DiaryPhotoLightbox({ photos, index, onChange, onClose }) {
  const dragRef = useRef({ startX: null, pointerId: null });
  const [slideDirection, setSlideDirection] = useState("");

  const changePhoto = useCallback((step) => {
    const nextIndex = Math.max(0, Math.min(photos.length - 1, index + step));
    if (nextIndex === index) return;
    setSlideDirection(step > 0 ? "next" : "previous");
    onChange(() => nextIndex);
  }, [index, onChange, photos.length]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") changePhoto(-1);
      if (event.key === "ArrowRight") changePhoto(1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changePhoto, onClose]);

  if (!photos?.length) return null;
  const photo = photos[index];

  return <div className="diary-photo-lightbox" role="dialog" aria-modal="true" aria-label="사진 크게 보기" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button type="button" className="diary-photo-lightbox-close" onClick={onClose} aria-label="닫기"><FiX /></button>
    {index > 0 && <button type="button" className="diary-photo-lightbox-nav previous" onClick={() => changePhoto(-1)} aria-label="이전 사진"><FiChevronLeft /></button>}
    <img
      key={photo.id || index}
      className={`${photos.length > 1 ? "is-draggable" : ""} ${slideDirection ? `photo-slide-${slideDirection}` : ""}`}
      src={photo.url}
      alt={`기록 사진 ${index + 1}`}
      draggable="false"
      onPointerDown={(event) => {
        if (photos.length < 2) return;
        dragRef.current = { startX: event.clientX, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (drag.startX === null || drag.pointerId !== event.pointerId) return;
        const delta = event.clientX - drag.startX;
        dragRef.current = { startX: null, pointerId: null };
        if (Math.abs(delta) > 22) changePhoto(delta < 0 ? 1 : -1);
      }}
      onPointerCancel={() => { dragRef.current = { startX: null, pointerId: null }; }}
    />
    {index < photos.length - 1 && <button type="button" className="diary-photo-lightbox-nav next" onClick={() => changePhoto(1)} aria-label="다음 사진"><FiChevronRight /></button>}
    <span className="diary-photo-lightbox-count">{index + 1} / {photos.length}</span>
  </div>;
}
