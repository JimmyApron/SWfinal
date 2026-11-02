import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getFinalizedRoadmap } from "../api/courseRoadmapApi";
import { numberInfo, roadmapPath } from "../utils/courseRoadmapUtils";

export default function FinalizedCoursePreview({ roomId, scheduleId, expectedCourseId = null, shared = false }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    getFinalizedRoadmap(roomId, scheduleId, expectedCourseId).then((data) => {
      if (active) setState({ data });
    }).catch(() => { if (active) setState({ error: true }); });
    return () => { active = false; };
  }, [roomId, scheduleId, expectedCourseId]);
  if (state.loading) return <p>최종 코스 확인 중...</p>;
  if (state.error) return <p role="status">최종 코스를 조회할 수 없습니다. 일정이 삭제되었거나 접근 권한이 없을 수 있습니다.</p>;
  if (!state.data) return shared ? <p>현재 조회할 수 있는 최종 코스가 없습니다.</p> : null;
  const { course, schedule } = state.data;
  const stops = course.stops.slice(0, 4);
  const stat = (label, value) => <div style={{ flex: 1, background: "#fff", borderRadius: 10, padding: "8px 10px" }}>
    <div style={{ fontSize: 11, color: "#8B8AA3" }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{value}</div>
  </div>;
  return <section style={{ background: "#F5F3FF", color: "#17172B", borderRadius: 16, padding: 16, marginBottom: 12 }}>
    <span style={{ display: "inline-block", background: "#7C5CFF", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px" }}>최종 코스 확정</span>
    <h3 style={{ margin: "10px 0 2px", fontSize: 16, lineHeight: 1.35, wordBreak: "keep-all" }}>{course.course_name}</h3>
    <p style={{ margin: 0, fontSize: 12, color: "#8B8AA3" }}>{schedule.date || "날짜 정보 없음"}</p>
    {stops.length ? <ol style={{ listStyle: "none", margin: "14px 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {stops.map((stop) => <li key={stop.roadmapId ?? stop.roadmapNumber} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
        <span style={{ flex: "none", width: 22, height: 22, borderRadius: "50%", background: "#7C5CFF", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{stop.roadmapNumber}</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stop.place_name}</span>
      </li>)}
      {course.stops.length > 4 && <li style={{ fontSize: 12, color: "#8B8AA3", paddingLeft: 32 }}>외 {course.stops.length - 4}곳</li>}
    </ol> : <p style={{ margin: "14px 0", fontSize: 13 }}>등록된 방문 장소가 없습니다.</p>}
    <div style={{ display: "flex", gap: 8 }}>
      {stat("예상 소요", numberInfo(course.estimated_total_duration_min, "분"))}
      {stat("1인당", numberInfo(course.estimated_cost_per_person, "원"))}
    </div>
    <Link onClick={(event) => event.stopPropagation()} to={roadmapPath(roomId, scheduleId)}
      style={{ display: "block", marginTop: 12, textAlign: "center", background: "#7C5CFF", color: "#fff", borderRadius: 10, padding: "10px 0", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>{shared ? "코스 자세히 보기" : "전체 코스 보기"}</Link>
  </section>;
}
