import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { finalizeCourse, getCourseConfirmationProgress } from "../api/courseFinalizationApi";
import { Link } from "react-router-dom";
import { roadmapPath } from "../utils/courseRoadmapUtils";

export default function CourseFinalizationPanel({ vote, roomId, onFinalized }) {
  const links = vote.vote_course_links || [];
  const courseIds = [...new Set(links.map((link) => String(link.course_id)))];
  const [courseId, setCourseId] = useState(courseIds[0] || "");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const notifyFinalized = useRef(onFinalized);
  notifyFinalized.current = onFinalized;

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setProgress(null);
    setError("");
    try {
      const state = await getCourseConfirmationProgress({ scheduleId: vote.scheduleid, roomId, voteId: vote.id, courseId });
      if (current !== generation.current) return;
      setProgress(state);
      notifyFinalized.current(Boolean(state.finalization));
    } catch (failure) {
      if (current === generation.current) setError(failure.message || "확정 현황을 조회하지 못했습니다.");
    }
  }, [vote.scheduleid, vote.id, roomId, courseId]);

  useEffect(() => {
    refresh();
    // Polling also works where Realtime is not enabled for these tables.
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    const channel = supabase.channel(`course-progress-${vote.id}-${courseId}`);
    for (const [table, filter] of [
      ["course_member_confirmations", `schedule_id=eq.${vote.scheduleid}`],
      ["schedule_finalizations", `schedule_id=eq.${vote.scheduleid}`],
      ["schedule_creation_records", `schedule_id=eq.${vote.scheduleid}`],
      ["confirmed_schedules", `id=eq.${vote.scheduleid}`],
      ["room_members", `roomid=eq.${roomId}`], ["room_guests", `roomid=eq.${roomId}`],
      ["voteresponses", `voteid=eq.${vote.id}`],
    ]) channel.on("postgres_changes", { event: "*", schema: "public", table, filter }, refresh);
    channel.subscribe();
    return () => {
      generation.current += 1;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      supabase.removeChannel(channel);
    };
  }, [refresh, vote.id, vote.scheduleid, roomId, courseId]);

  const saved = progress?.finalization;
  return (
    <section style={{ background: "#FFFFFF", color: "#17172B", border: "1px solid #7B61FF", borderRadius: 16, padding: 16, marginBottom: 16 }} aria-label="코스 최종 확정 현황">
      <h3 style={{ marginTop: 0 }}>개인 확정 현황</h3>
      <label>확인할 코스
        <select aria-label="확정 현황 코스" value={courseId} disabled={busy} onChange={(event) => setCourseId(event.target.value)} style={{ display: "block", width: "100%", padding: 10, margin: "8px 0", borderRadius: 10 }}>
          {courseIds.map((id) => {
            const link = links.find((item) => String(item.course_id) === id);
            const option = vote.voteoptions?.find((item) => String(item.id) === String(link.vote_option_id));
            return <option key={id} value={id}>{option?.courseMeta?.course_name || option?.optiontext || `코스 ${id}`}</option>;
          })}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {!progress && !error && <p>참석자와 확정 현황을 확인하고 있습니다.</p>}
      {progress && <>
        <strong>{progress.course.course_name}</strong>
        <p>참석 대상 {progress.eligibleCount}명 · 개인 확정 {progress.confirmedCount}명 · 미확정 {progress.unconfirmed.length}명</p>
        <progress aria-label="개인 확정 진행률" max={progress.eligibleCount || 1} value={progress.confirmedCount} style={{ width: "100%", accentColor: "#7B61FF" }} />
        <ul style={{ paddingLeft: 20 }}>{progress.participants.map((participant) => (
          <li key={participant.participantKey}>{participant.nickname} ({participant.participantType === "member" ? "회원" : "게스트"}) · {participant.status}</li>
        ))}</ul>
        {!saved && <p>{progress.reason}</p>}
        {!saved && progress.isCreator && <button type="button" disabled={!progress.canFinalize || busy} style={{ border: 0, borderRadius: 12, padding: "12px 16px", background: "#7B61FF", color: "white", opacity: progress.canFinalize && !busy ? 1 : 0.45 }} onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError("");
          let warning = "";
          try {
            const result = await finalizeCourse({ scheduleId: vote.scheduleid, roomId, voteId: vote.id, courseId });
            warning = result.warning || "";
            notifyFinalized.current(true);
          } catch (failure) { warning = failure.message || "최종 확정에 실패했습니다."; }
          finally {
            await refresh();
            if (warning) setError(warning);
            setBusy(false);
            lock.current = false;
          }
        }}>{busy ? "저장 중..." : "이 코스로 최종 확정하기"}</button>}
        {saved && <div style={{ background: "#F3F0FF", padding: 14, borderRadius: 12, marginTop: 12 }}>
          <strong>최종 확정 완료 · {saved.course.course_name}</strong>
          <p><Link to={roadmapPath(roomId, vote.scheduleid)}>전체 코스 보기</Link></p>
          <ol>{saved.course.stops.map((stop) => <li key={stop.id || stop.stop_order}>{stop.place_name}</li>)}</ol>
          <p>최종 확정 후에는 코스 투표와 개인 확정을 변경할 수 없습니다.</p>
        </div>}
      </>}
      <button type="button" disabled={busy} onClick={refresh} style={{ display: "block", marginTop: 12, border: 0, background: "#F3F0FF", color: "#7B61FF", padding: "8px 12px", borderRadius: 10 }}>현황 새로고침</button>
    </section>
  );
}
