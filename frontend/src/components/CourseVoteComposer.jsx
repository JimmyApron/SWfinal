import { useEffect, useMemo, useState } from 'react';
import LocationPicker from './map/LocationPicker';
import KakaoMapView from './map/KakaoMapView';
import { buildManualCourse, manualStop } from '../utils/manualCourseUtils';
import { normalizeCourseVoteSelection } from '../utils/courseVoteUtils';
import './CourseVoteComposer.css';

export default function CourseVoteComposer({ schedules, schedule, scheduleId, onScheduleChange, loading, error,
  options, onChange, onRecommend, onEditingChange, hideScheduleSelector = false }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => { onEditingChange?.(!!draft); }, [draft, onEditingChange]);
  const preview = useMemo(() => draft ? buildManualCourse(draft, schedule) : null, [draft, schedule]);
  const places = useMemo(() => (preview?.course?.stops || []).map((stop, i) => ({
    id: stop.id, name: stop.placeName, address: stop.placeAddress, lat: Number(stop.lat), lng: Number(stop.lng), orderNumber: i + 1,
  })), [preview]);
  const open = (index = -1) => {
    const option = index >= 0 ? options[index] : null;
    setEditing(index);
    setMessage('');
    setDraft({ name: option?.course_name || '', stops: (option?.stops || []).map(manualStop),
      startTime: option?.manualDraft?.startTime || option?.stops?.[0]?.visitStartTime || option?.stops?.[0]?.visit_start_time || schedule?.starttime?.slice(0, 5) || '10:00',
      travelMode: option?.manualDraft?.travelMode || 'walking' });
  };
  const move = (index, offset) => {
    const stops = [...draft.stops];
    [stops[index], stops[index + offset]] = [stops[index + offset], stops[index]];
    setDraft({ ...draft, stops });
  };
  const save = () => {
    if (!preview || preview.errors.length) { setMessage('입력 내용과 시간표를 확인해 주세요.'); return; }
    if (options.some((option, index) => index !== editing && option.course_name?.trim() === draft.name.trim())) {
      setMessage('후보마다 다른 코스 이름을 입력해 주세요.'); return;
    }
    const course = { ...preview.course, id: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    const option = { ...normalizeCourseVoteSelection([course])[0], manualDraft: course.manualDraft };
    onChange(editing >= 0 ? options.map((old, i) => i === editing ? option : old) : [...options, option]);
    setDraft(null); setEditing(null); setMessage('');
  };
  return <section className="course-composer" aria-label="코스 후보 만들기">
    <h3>코스 후보 만들기</h3>
    {!hideScheduleSelector && <label>연결할 확정 일정
      <select aria-label="연결할 확정 일정" value={scheduleId || ''} disabled={loading} onChange={event => {
        if ((options.length || draft) && !window.confirm('일정을 바꾸면 작성한 코스 후보가 초기화됩니다. 계속할까요?')) return;
        onScheduleChange(event.target.value); setDraft(null); setEditing(null); setMessage('');
      }}>
        <option value="">일정을 선택해 주세요</option>
        {schedules.map(item => <option key={item.id} value={item.id}>{item.title || '확정 일정'} · {item.date} {item.starttime?.slice(0, 5)}~{item.endtime?.slice(0, 5)}</option>)}
      </select>
    </label>}
    {loading && <p role="status">확정 일정을 불러오고 있습니다.</p>}
    {error && <p role="alert">{error}</p>}
    {!hideScheduleSelector && !loading && !error && !schedules.length && <p>먼저 모임에서 일정을 확정해 주세요.</p>}
    <div className="course-composer-actions">
      <button type="button" disabled={!schedule || !!draft} onClick={onRecommend}>추천받기</button>
      <button type="button" disabled={!schedule || !!draft} onClick={() => open()}>직접 만들기</button>
    </div>
    {draft && <div className="course-editor">
      <h4>{editing >= 0 ? '코스 수정' : '직접 코스 만들기'}</h4>
      <label>코스 이름<input aria-label="코스 이름" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="예: 홍대 카페와 저녁" /></label>
      <div className="course-composer-actions">
        <label>시작 시간<input aria-label="코스 시작 시간" type="time" value={draft.startTime?.slice(0, 5)} onChange={e => setDraft({ ...draft, startTime: e.target.value })} /></label>
        <label>이동 수단<select aria-label="코스 이동 수단" value={draft.travelMode} onChange={e => setDraft({ ...draft, travelMode: e.target.value })}>
          <option value="walking">도보</option><option value="transit">대중교통</option><option value="car">자동차</option>
        </select></label>
      </div>
      <p>방문할 장소를 검색해서 추가하세요. 식사 시간과 체류 시간을 직접 정할 수 있습니다.</p>
      <LocationPicker allowMapClick={false} showMap={false} placeholder="추가할 장소 검색" onSelect={(name, address, place) => {
        if (draft.stops.some(stop => String(stop.id) === String(place.id))) { setMessage('이미 추가한 장소입니다.'); return; }
        setDraft({ ...draft, stops: [...draft.stops, manualStop({ ...place, name, address })] }); setMessage('');
      }} />
      <ol className="course-stop-list">
        {draft.stops.map((stop, index) => <li key={`${stop.id}-${index}`}>
          <strong>{index + 1}. {stop.placeName}</strong><p>{stop.placeAddress}</p>
          <label>체류 시간 (분)<input type="number" min="1" max="1440" aria-label={`${index + 1}번째 체류 시간`} value={stop.expectedStayMin} onChange={e => setDraft({ ...draft, stops: draft.stops.map((old, i) => i === index ? { ...old, expectedStayMin: e.target.value } : old) })} /></label>
          <div className="course-composer-actions">
            <button type="button" aria-label={`${index + 1}번째 장소 위로`} disabled={!index} onClick={() => move(index, -1)}>↑ 위로</button>
            <button type="button" aria-label={`${index + 1}번째 장소 아래로`} disabled={index === draft.stops.length - 1} onClick={() => move(index, 1)}>↓ 아래로</button>
            <button type="button" aria-label={`${index + 1}번째 장소 삭제`} onClick={() => setDraft({ ...draft, stops: draft.stops.filter((_, i) => i !== index) })}>삭제</button>
          </div>
        </li>)}
      </ol>
      {preview?.course && <section aria-label="직접 만든 코스 미리보기">
        <h4>지도와 시간표</h4>
        <KakaoMapView places={places} routePath={places} numberedPlaces height="260px" />
        <p>예상 소요 {preview.course.totalDurationMin}분 · 이동 {preview.course.estimatedTravelTimeMin}분</p>
        {preview.course.stops.map((stop, index) => <p key={index}>{index + 1}. {stop.placeName} · {stop.visitStartTime}~{stop.visitEndTime}{index > 0 && ` · 이동 약 ${stop.travelTimeFromPrevMin}분`}</p>)}
        <p className="course-composer-hint">지도 선과 이동 시간은 좌표 기반 추정입니다. 실제 경로·영업시간·비용은 별도로 확인해 주세요.</p>
      </section>}
      {!!preview?.errors.length && <ul role="status">{preview.errors.map(item => <li key={item}>{item}</li>)}</ul>}
      <div className="course-composer-actions">
        <button type="button" disabled={!!preview?.errors.length} onClick={save}>{editing >= 0 ? '후보 수정 완료' : '투표 후보에 추가'}</button>
        <button type="button" onClick={() => { setDraft(null); setEditing(null); setMessage(''); }}>편집 취소</button>
      </div>
    </div>}
    {message && <p role="status">{message}</p>}
    <h4>투표 후보 {options.length}개</h4>
    {!options.length && <p>추천받거나 직접 만든 코스를 후보에 추가해 주세요.</p>}
    {options.map((option, index) => <article className="course-candidate" key={index}>
      <strong>{option.course_name || option.optiontext}</strong>
      <p>{option.stops?.map(stop => stop.placeName || stop.place_name || stop.name).join(' → ')}</p>
      <p>{option.stop_count}곳 · 예상 {option.total_duration_min}분 · 비용 정보 확인 필요</p>
      <div className="course-composer-actions">
        <button type="button" disabled={!!draft || !schedule} onClick={() => open(index)}>수정·지도 보기</button>
        <button type="button" disabled={!!draft} onClick={() => onChange(options.filter((_, i) => i !== index))}>후보 삭제</button>
      </div>
    </article>)}
    {draft && <p>편집 중인 코스는 ‘투표 후보에 추가’ 또는 ‘후보 수정 완료’를 눌러야 반영됩니다.</p>}
  </section>;
}
