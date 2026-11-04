import { useEffect, useState } from "react";
import { getMeetingParticipantUserIds } from "../../utils/meetingParticipants";
import LocationPicker from "../../components/map/LocationPicker";

const todayInSeoul = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export default function LightningMeetingEditSheet({ meeting, members, userId, busy, error, onClose, onSave }) {
  const [date, setDate] = useState(meeting.meeting_date);
  const [title, setTitle] = useState(meeting.title || "");
  const [startTime, setStartTime] = useState(meeting.start_time?.slice(0, 5) || "");
  const [endTime, setEndTime] = useState(meeting.end_time?.slice(0, 5) || "");
  const [location, setLocation] = useState(meeting.location || "");
  const [address, setAddress] = useState(meeting.location_address || "");
  const [participantIds, setParticipantIds] = useState(getMeetingParticipantUserIds(meeting));
  const [formError, setFormError] = useState("");
  const [showPlacePicker, setShowPlacePicker] = useState(false);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) { setFormError("만남 이름을 입력해 주세요."); return; }
    if (!date || date > todayInSeoul()) { setFormError("오늘 또는 이전 날짜를 선택해 주세요."); return; }
    if (endTime && (!startTime || endTime < startTime)) { setFormError("종료 시간을 시작 시간 이후로 입력해 주세요."); return; }
    if (participantIds.length === 0) { setFormError("함께 만난 사람을 한 명 이상 선택해 주세요."); return; }
    setFormError("");
    onSave({ date, title: title.trim(), startTime, endTime, location: location.trim(), address: address.trim(), participantUserIds: participantIds });
  };

  return <div className="lightning-edit-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="lightning-edit-sheet" role="dialog" aria-modal="true" aria-labelledby="lightning-edit-title" onSubmit={showPlacePicker ? (event) => event.preventDefault() : submit}>
      <header>{showPlacePicker && <button type="button" onClick={() => setShowPlacePicker(false)} aria-label="수정 화면으로 돌아가기">‹</button>}<h2 id="lightning-edit-title">{showPlacePicker ? "장소 선택" : "번개 만남 수정"}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="닫기">×</button></header>
      {showPlacePicker ? <div className="lightning-edit-place-picker" onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}><LocationPicker includeAddressSearch prefillKeywordFromInitialPlace={false} mapHeight="min(38dvh, 290px)" onSelect={(name, selectedAddress, place) => {
        const selectedName = (name || place?.name || selectedAddress || place?.address || "").trim();
        if (!selectedName) return;
        setLocation(selectedName);
        setAddress((selectedAddress || place?.address || "").trim());
        setShowPlacePicker(false);
      }} /></div> : <>
      <label>날짜<input type="date" value={date} max={todayInSeoul()} onChange={(event) => setDate(event.target.value)} required /></label>
      <div className="lightning-edit-time-row">
        <label>시작 시간 <small>(선택)</small><input type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); if (!event.target.value) setEndTime(""); }} /></label>
        <label>종료 시간 <small>(선택)</small><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
      </div>
      <label>이름<input type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></label>
      <label htmlFor="lightning-edit-location">장소 <small>(선택)</small></label><div className="lightning-edit-place-row"><input id="lightning-edit-location" type="text" value={location} onChange={(event) => { setLocation(event.target.value); setAddress(""); }} maxLength={200} placeholder="장소를 입력해 주세요" /><button type="button" onClick={() => setShowPlacePicker(true)}>지도에서 선택</button></div>
      {address && <p className="lightning-edit-address">{address}</p>}
      <fieldset><legend>같이 만난 사람</legend><div className="lightning-edit-members">{members.map((member) => {
        const id = String(member.userid);
        const isCurrentUser = id === String(userId);
        const selected = participantIds.includes(id);
        return <button type="button" key={id} aria-pressed={selected} className={selected ? "selected" : ""} disabled={busy} onClick={() => setParticipantIds((current) => selected ? current.filter((value) => value !== id) : [...current, id])}>{member.nickname || (isCurrentUser ? "나" : "친구")}{isCurrentUser ? " (나)" : ""}{selected && " ✓"}</button>;
      })}</div></fieldset>
      {(formError || error) && <p className="lightning-edit-error" role="alert">{formError || error}</p>}
      <button className="lightning-edit-save" type="submit" disabled={busy}>{busy ? "저장 중…" : "저장하기"}</button>
      </>}
    </form>
  </div>;
}
