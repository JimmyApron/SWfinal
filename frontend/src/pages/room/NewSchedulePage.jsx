import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import CourseVoteComposer from '../../components/CourseVoteComposer';
import { saveNewScheduleWithCourse, validateNewScheduleCourse } from '../../api/newScheduleCourseApi';
import { createRoomNotifications } from '../../api/notificationApi';
import { getCurrentRoomParticipantInfo } from '../../api/courseApi';
import { getTodayStr } from '../../utils/scheduleUtils';
import { updateRoomLastActivity } from '../../api/roomApi';
import './NewSchedulePage.css';

export default function NewSchedulePage() {
  const { roomid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initial = location.state?.newScheduleDraft || {};
  const [form, setForm] = useState(initial.form || { title: '', date: '', starttime: '', endtime: '', isallday: false });
  const [mode, setMode] = useState(initial.mode === 'none' || !initial.mode ? 'none' : 'direct');
  const [courses, setCourses] = useState(initial.courses || []);
  const [selectedCourseId, setSelectedCourseId] = useState(initial.selectedCourseId || '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const progress = useRef(initial.progress || {});
  const lock = useRef(false);
  const [hasSavedSchedule, setHasSavedSchedule] = useState(Boolean(initial.progress?.schedule || initial.progress?.orphanScheduleId));
  const schedule = { ...form, roomid: Number(roomid) };
  const validTime = !form.isallday && form.starttime && form.endtime && form.starttime < form.endtime;
  useEffect(() => {
    if (!courses.some(course => String(course.courseid) === String(selectedCourseId))) {
      setSelectedCourseId(courses[0]?.courseid || '');
    }
  }, [courses, selectedCourseId]);
  const update = (key, value) => { setForm(previous => ({ ...previous, [key]: value })); setError(''); };
  const validate = () => {
    if (!form.date || form.date < getTodayStr()) return '오늘 이후의 날짜를 선택해 주세요.';
    if (!form.isallday && !validTime) return '시작·종료 시간을 정하고 종료가 시작보다 늦은지 확인해 주세요.';
    if (editing) return '편집 중인 코스를 후보에 반영하거나 편집을 취소해 주세요.';
    return validateNewScheduleCourse({ schedule, mode, courses, selectedCourseId });
  };
  const recommend = () => {
    if (!form.date || !validTime) { setError('추천받기 전에 날짜와 시작·종료 시간을 입력해 주세요.'); return; }
    navigate(`/rooms/${roomid}/course-recommendation`, { state: { schedule,
      roomId: Number(roomid), newScheduleDraft: { form, mode, courses, selectedCourseId } } });
  };
  const save = async () => {
    if (lock.current) return;
    const invalid = validate();
    if (invalid) { setError(invalid); return; }
    lock.current = true; setSaving(true); setError('');
    try {
      const saved = await saveNewScheduleWithCourse({ schedule: { ...schedule,
        title: form.title.trim() || null, starttime: form.isallday ? null : form.starttime,
        endtime: form.isallday ? null : form.endtime }, mode, courses, selectedCourseId,
        progress: progress.current, onProgress: next => {
          progress.current = next;
          if (next.schedule || next.orphanScheduleId) setHasSavedSchedule(true);
        } });
      try { await updateRoomLastActivity(roomid); }
      catch (activityError) { console.warn('일정 저장 후 모임 최근 활동 갱신 실패:', activityError); }
      let notificationFailed = false;
      try {
        const actor = await getCurrentRoomParticipantInfo(roomid);
        await createRoomNotifications({ roomId: Number(roomid), senderId: actor.participantId,
          type: 'schedule_confirmed', title: '🗓️ 일정 확정', message: `"${form.title || '새 일정'}" 일정이 생성되었습니다.`,
          link: `/rooms/${roomid}?tab=schedule&scheduleId=${saved.schedule.id}` });
      } catch { notificationFailed = true; }
      if (notificationFailed) window.alert('일정은 저장됐지만 알림 전송에 실패했습니다. 일정에서 결과를 확인해 주세요.');
      if (saved.finalization?.warning) window.alert(saved.finalization.warning);
      if (mode === 'direct') navigate(`/rooms/${roomid}/schedules/${saved.schedule.id}/final-course`, { replace: true });
      else navigate(`/rooms/${roomid}?tab=schedule&scheduleId=${saved.schedule.id}`, { replace: true });
    } catch (failure) {
      setError(`${failure.message || '저장에 실패했습니다.'}${progress.current.schedule ? ' 일정은 이미 생성됐습니다. 아래 버튼으로 남은 저장을 다시 시도해 주세요.' : ''}`);
    } finally { lock.current = false; setSaving(false); }
  };
  return <main className="new-schedule-page">
    <header><button type="button" onClick={() => navigate(`/rooms/${roomid}?tab=schedule`)}>← 일정 목록</button><h2>{mode === 'direct' ? '코스 만들기' : '일정 만들기'}</h2></header>
    <fieldset disabled={saving || hasSavedSchedule}>
      <div className="new-schedule-mode" role="group" aria-label="만들기 선택">
        {[['none', '일정 만들기'], ['direct', '코스 만들기']].map(([value, label]) =>
          <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setError(''); }}>{label}</button>)}
      </div>
      <section className="new-schedule-card">
        <h3>언제 만날까요?</h3>
        <label>일정 제목 (선택)<input aria-label="일정 제목" value={form.title} onChange={e => update('title', e.target.value)} placeholder="예: 홍대에서 만나는 날" /></label>
        <label>날짜<input aria-label="일정 날짜" type="date" min={getTodayStr()} value={form.date} onChange={e => update('date', e.target.value)} /></label>
        <label className="new-schedule-checkbox"><input type="checkbox" checked={form.isallday} onChange={e => update('isallday', e.target.checked)} />하루종일</label>
        {!form.isallday && <div className="new-schedule-times">
          <label>시작 시간<input aria-label="일정 시작 시간" type="time" value={form.starttime} onChange={e => update('starttime', e.target.value)} /></label>
          <label>종료 시간<input aria-label="일정 종료 시간" type="time" value={form.endtime} onChange={e => update('endtime', e.target.value)} /></label>
        </div>}
      </section>
      {mode !== 'none' && <>
        {!validTime && <p role="status">코스를 추가하려면 하루종일을 해제하고 시작·종료 시간을 입력해 주세요.</p>}
        <CourseVoteComposer schedules={[]} hideScheduleSelector schedule={validTime && form.date ? schedule : null}
          options={courses} onChange={setCourses} onRecommend={recommend} onEditingChange={setEditing} />
        {mode === 'direct' && courses.length > 0 && <section className="new-schedule-card"><h3>바로 사용할 코스</h3>
          {courses.map(course => <label className="new-schedule-checkbox" key={course.courseid}>
            <input type="radio" name="final-course" checked={String(selectedCourseId) === String(course.courseid)} onChange={() => setSelectedCourseId(course.courseid)} />{course.course_name}
          </label>)}
        </section>}
      </>}
    </fieldset>
    {hasSavedSchedule && <p>일정은 생성되었습니다. 중복 생성을 방지하기 위해 입력을 고정하고 남은 저장만 다시 시도합니다.</p>}
    {error && <p role="alert" className="new-schedule-error">{error}</p>}
    <button type="button" className="new-schedule-save" disabled={saving || editing || !!progress.current.orphanScheduleId} onClick={save}>
      {saving ? '저장 중…' : hasSavedSchedule ? '남은 저장 다시 시도' : mode === 'direct' ? '코스 저장하기' : '일정 저장하기'}
    </button>
  </main>;
}
