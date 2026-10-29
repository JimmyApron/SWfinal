import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { finalizeCourse, getCourseConfirmationProgress } from '../api/courseFinalizationApi';
import { roadmapPath } from '../utils/courseRoadmapUtils';
import KakaoMapView from './map/KakaoMapView';
import './CourseFinalizationPanel.css';

export default function CourseFinalizationPanel({ vote, roomId, onFinalized, isVoting = false, selectedOptions = [], onSelect, onSubmit, onReVote, voteBusy = false, isClosed = false }) {
  const links = vote.vote_course_links || [];
  const firstCourseId = links[0]?.course_id;
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const notify = useRef(onFinalized);
  notify.current = onFinalized;
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await getCourseConfirmationProgress({ scheduleId: vote.scheduleid, roomId, voteId: vote.id, courseId: firstCourseId });
      if (current !== generation.current) return;
      setProgress(result); setError(''); notify.current?.(Boolean(result.finalization));
    } catch (failure) {
      if (current === generation.current) { setProgress(null); setError(failure.message || '투표 결과를 조회하지 못했습니다.'); }
    }
  }, [vote.id, vote.scheduleid, roomId, firstCourseId]);
  useEffect(() => {
    setProgress(null); refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    const channel = supabase.channel(`course-results-${vote.id}`);
    for (const [table, filter] of [
      ['voteresponses', `voteid=eq.${vote.id}`], ['schedule_finalizations', `schedule_id=eq.${vote.scheduleid}`],
      ['voteoptions', `voteid=eq.${vote.id}`], ['vote_course_links', `vote_id=eq.${vote.id}`],
      ['confirmed_schedules', `id=eq.${vote.scheduleid}`], ['room_members', `roomid=eq.${roomId}`], ['room_guests', `roomid=eq.${roomId}`],
    ]) channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, refresh);
    channel.subscribe();
    return () => { generation.current += 1; clearInterval(timer); window.removeEventListener('focus', refresh); supabase.removeChannel(channel); };
  }, [refresh, vote, roomId]);
  const saved = progress?.finalization;
  const saving = busy || voteBusy;
  async function confirm(courseId) {
    if (lock.current || saving) return;
    lock.current = true; setBusy(true);
    let message = '';
    try {
      const result = await finalizeCourse({ scheduleId: vote.scheduleid, roomId, voteId: vote.id, courseId });
      message = result.warning || ''; notify.current?.(true);
    } catch (failure) { message = failure.message || '코스 확정에 실패했습니다.'; }
    finally { await refresh(); if (message) setError(message); setBusy(false); lock.current = false; }
  }
  return <section className="course-vote-results" aria-label="코스 투표 결과">
    <span className="course-vote-badge">코스 투표</span>
    <p className="course-vote-help">투표 여부와 관계없이 참여자 누구나 한 코스를 확정할 수 있어요.</p>
    {error && <p role="alert">{error}</p>}
    {!progress && !error && <p>투표 결과를 확인하고 있습니다.</p>}
    {(vote.voteoptions || []).map(option => {
      const courseId = links.find(item => String(item.vote_option_id) === String(option.id))?.course_id;
      const tally = progress?.options?.find(item => String(item.optionId) === String(option.id));
      const count = tally?.count || 0, percent = tally?.percent || 0;
      const confirmed = saved && String(saved.course_id) === String(courseId);
      const meta = option.courseMeta || {};
      const stops = [...(meta.stops || [])].sort((a, b) => a.stop_order - b.stop_order);
      const places = stops.filter(stop => stop.latitude != null && stop.longitude != null).map(stop => ({ id: stop.id || stop.stop_order, name: stop.place_name, lat: stop.latitude, lng: stop.longitude, orderNumber: stop.stop_order }));
      return <article key={option.id} className="course-vote-candidate">
        <div className="course-vote-row">
          <label className="course-vote-name">
            {isVoting && !saved && <input type="radio" name={`course-vote-${vote.id}`} checked={selectedOptions.some(id => String(id) === String(option.id))} disabled={saving} onChange={() => onSelect?.(option.id)} />}
            <span><strong>{meta.course_name || option.optiontext}</strong><small>{stops.map(stop => stop.place_name).join(' → ')}</small></span>
          </label>
          <div className="course-vote-actions">
            <button type="button" onClick={() => setOpened(opened === option.id ? null : option.id)} aria-expanded={opened === option.id}>{opened === option.id ? '지도접기' : '지도보기'}</button>
            {progress && <button type="button" className={confirmed ? 'course-vote-confirmed' : 'course-vote-confirm'} disabled={saving || Boolean(saved) || !courseId} onClick={() => confirm(courseId)}>{confirmed ? '코스 확정됨' : busy ? '저장 중...' : '코스 확정'}</button>}
            <span className="course-vote-count">{progress ? `${count}명 (${percent}%)` : '집계 확인 중'}</span>
          </div>
        </div>
        <div role="progressbar" aria-label={`${meta.course_name || option.optiontext} 득표율`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="course-vote-bar"><div style={{ width: `${percent}%` }} /></div>
        {opened === option.id && <div className="course-vote-detail">{places.length > 0 ? <KakaoMapView places={places} routePath={places} numberedPlaces height="260px" /> : <p>표시할 장소 좌표가 없습니다.</p>}<ol>{stops.map((stop, index) => <li key={stop.id || index}>{stop.place_name} {stop.visit_start_time?.slice(0, 5)}{stop.visit_end_time ? ` ~ ${stop.visit_end_time.slice(0, 5)}` : ''}</li>)}</ol></div>}
      </article>;
    })}
    {saved ? <div className="course-vote-final"><strong>최종 확정 완료 · {saved.course.course_name}</strong><ol>{saved.course.stops.map((stop, index) => <li key={stop.id || index}>{stop.place_name}</li>)}</ol><Link to={roadmapPath(roomId, vote.scheduleid)}>전체 코스 보기</Link></div>
      : isVoting ? <button className="course-vote-submit" type="button" disabled={saving || !selectedOptions.length} onClick={onSubmit}>{saving ? '저장 중...' : '투표하기'}</button>
      : !isClosed && onReVote && <button className="course-vote-revote" type="button" disabled={saving} onClick={onReVote}>다시 투표하기</button>}
    <button type="button" className="course-vote-refresh" disabled={saving} onClick={refresh}>결과 새로고침</button>
  </section>;
}
