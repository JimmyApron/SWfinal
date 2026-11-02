import { useMemo, useState } from "react";
import LocationPicker from "./map/LocationPicker";
import KakaoMapView from "./map/KakaoMapView";
import { buildManualCourse, manualStop } from "../utils/manualCourseUtils";
import { buildCourseVoteDbRows } from "../utils/courseVoteUtils";
import { updateFinalizedCourseStops } from "../api/courseRoadmapApi";
import "./FinalizedCourseEditor.css";

const stopKey = (source, id) => `${source || "manual"}:${id}`;

// 일정 시간이 비어 있어도 편집할 수 있게 하루 전체를 허용 범위로 쓴다.
function scheduleRange(schedule) {
  return schedule?.starttime && schedule?.endtime && !schedule?.isallday ? schedule : { isallday: true };
}

// 최종 확정된 코스의 방문 장소를 추가·삭제·순서 변경·체류 시간 수정한다.
export default function FinalizedCourseEditor({ scheduleId, course, schedule, onSaved, onCancel }) {
  const originals = useMemo(() => new Map(course.stops.map((stop) => [stopKey(stop.place_source, stop.place_id), stop])), [course]);
  const [draft, setDraft] = useState(() => ({
    name: course.course_name,
    stops: course.stops.map(manualStop),
    startTime: course.stops[0]?.visit_start_time?.slice(0, 5) || schedule?.starttime?.slice(0, 5) || "10:00",
    travelMode: "walking",
  }));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => buildManualCourse(draft, scheduleRange(schedule)), [draft, schedule]);
  const places = useMemo(() => (preview.course?.stops || []).map((stop, index) => ({
    id: `${stop.id}-${index}`, name: stop.placeName, address: stop.placeAddress,
    lat: Number(stop.lat), lng: Number(stop.lng), orderNumber: index + 1,
  })), [preview]);

  const setStops = (stops) => { setDraft({ ...draft, stops }); setMessage(""); };
  const move = (index, offset) => {
    const stops = [...draft.stops];
    [stops[index], stops[index + offset]] = [stops[index + offset], stops[index]];
    setStops(stops);
  };

  const save = async () => {
    if (!preview.course || preview.errors.length || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const rows = buildCourseVoteDbRows(preview.course);
      // 시간표는 새로 계산하지만 기존 장소의 비용·평점·사진·분류는 그대로 유지한다.
      const stops = rows.stops.map((row) => {
        const original = originals.get(stopKey(row.place_source, row.place_id));
        return original ? {
          ...row,
          estimated_cost: original.estimated_cost ?? null,
          rating: original.rating ?? null,
          image_url: original.image_url ?? null,
          category: original.category ?? row.category,
        } : row;
      });
      const allCosts = stops.every((stop) => stop.estimated_cost !== null && stop.estimated_cost !== undefined);
      await updateFinalizedCourseStops(scheduleId, {
        estimated_total_duration_min: rows.estimated_total_duration_min,
        estimated_travel_time_min: rows.estimated_travel_time_min,
        estimated_cost_per_person: allCosts ? stops.reduce((sum, stop) => sum + Number(stop.estimated_cost), 0) : null,
        stops,
      });
      await onSaved();
    } catch (error) {
      setMessage(error.message || "코스를 수정하지 못했습니다.");
      setSaving(false);
    }
  };

  return <section className="fce" aria-label="확정 코스 수정">
    <h2>코스 수정</h2>
    <p className="fce-hint">장소를 추가하거나 순서를 바꾸면 방문 시간이 다시 계산돼요. 수정하면 참여자에게 알림이 가요.</p>
    <div className="fce-row">
      <label>시작 시간<input type="time" aria-label="코스 시작 시간" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} /></label>
      <label>이동 수단<select aria-label="코스 이동 수단" value={draft.travelMode} onChange={(event) => setDraft({ ...draft, travelMode: event.target.value })}>
        <option value="walking">도보</option><option value="transit">대중교통</option><option value="car">자동차</option>
      </select></label>
    </div>
    <LocationPicker allowMapClick={false} showMap={false} placeholder="추가할 장소 검색" onSelect={(name, address, place) => {
      if (draft.stops.some((stop) => String(stop.id) === String(place.id))) { setMessage("이미 추가한 장소입니다."); return; }
      setStops([...draft.stops, manualStop({ ...place, name, address })]);
    }} />
    <ol className="fce-list">
      {draft.stops.map((stop, index) => <li key={`${stop.id}-${index}`}>
        <div className="fce-stop">
          <span className="fce-num">{index + 1}</span>
          <div className="fce-info"><strong>{stop.placeName}</strong><p>{stop.placeAddress}</p></div>
        </div>
        <div className="fce-controls">
          <label>체류(분)<input type="number" min="1" max="1440" aria-label={`${index + 1}번째 체류 시간`} value={stop.expectedStayMin}
            onChange={(event) => setStops(draft.stops.map((old, i) => i === index ? { ...old, expectedStayMin: event.target.value } : old))} /></label>
          <button type="button" aria-label={`${index + 1}번째 장소 위로`} disabled={!index} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={`${index + 1}번째 장소 아래로`} disabled={index === draft.stops.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" className="fce-del" aria-label={`${index + 1}번째 장소 삭제`} onClick={() => setStops(draft.stops.filter((_, i) => i !== index))}>삭제</button>
        </div>
        {preview.course && <p className="fce-time">{preview.course.stops[index].visitStartTime} ~ {preview.course.stops[index].visitEndTime}{index > 0 && ` · 이동 약 ${preview.course.stops[index].travelTimeFromPrevMin}분`}</p>}
      </li>)}
    </ol>
    {preview.course && places.length > 0 && <KakaoMapView places={places} routePath={places} numberedPlaces height="220px" />}
    {preview.course && <p className="fce-hint">예상 소요 {preview.course.totalDurationMin}분 · 이동 {preview.course.estimatedTravelTimeMin}분 (좌표 기반 추정)</p>}
    {!!preview.errors.length && <ul className="fce-errors" role="status">{preview.errors.map((item) => <li key={item}>{item}</li>)}</ul>}
    {message && <p className="fce-errors" role="alert">{message}</p>}
    <div className="fce-actions">
      <button type="button" onClick={onCancel} disabled={saving}>취소</button>
      <button type="button" className="fce-save" onClick={save} disabled={saving || !!preview.errors.length}>{saving ? "저장 중..." : "수정 완료"}</button>
    </div>
  </section>;
}
