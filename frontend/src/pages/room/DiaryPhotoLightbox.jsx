import { useEffect } from "react";
import { FiChevronLeft, FiChevronRight, FiX } from "react-icons/fi";
import "./DiaryPhotoLightbox.css";

export default function DiaryPhotoLightbox({ photos, index, onChange, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onChange((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") onChange((current) => Math.min(photos.length - 1, current + 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onChange, onClose, photos.length]);

  if (!photos?.length) return null;
  const photo = photos[index];

  return <div className="diary-photo-lightbox" role="dialog" aria-modal="true" aria-label="사진 크게 보기" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button type="button" className="diary-photo-lightbox-close" onClick={onClose} aria-label="닫기"><FiX /></button>
    {index > 0 && <button type="button" className="diary-photo-lightbox-nav previous" onClick={() => onChange((current) => Math.max(0, current - 1))} aria-label="이전 사진"><FiChevronLeft /></button>}
    <img src={photo.url} alt={`기록 사진 ${index + 1}`} />
    {index < photos.length - 1 && <button type="button" className="diary-photo-lightbox-nav next" onClick={() => onChange((current) => Math.min(photos.length - 1, current + 1))} aria-label="다음 사진"><FiChevronRight /></button>}
    <span className="diary-photo-lightbox-count">{index + 1} / {photos.length}</span>
  </div>;
}
