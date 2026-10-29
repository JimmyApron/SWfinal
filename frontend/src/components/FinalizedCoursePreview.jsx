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
  return <section style={{ background: "#F3F0FF", color: "#17172B", borderRadius: 14, padding: 14, marginBottom: 12 }}>
    <strong>최종 코스 확정 완료</strong>
    <h3 style={{ margin: "8px 0" }}>{course.course_name}</h3>
    <p>{schedule.date || "날짜 정보 없음"}</p>
    <p>{course.stops.slice(0, 4).map((stop) => `${stop.roadmapNumber}. ${stop.place_name}`).join(" → ") || "등록된 방문 장소가 없습니다."}{course.stops.length > 4 ? " …" : ""}</p>
    <p>예상 소요 {numberInfo(course.estimated_total_duration_min, "분")} · 1인당 {numberInfo(course.estimated_cost_per_person, "원")}</p>
    <Link onClick={(event) => event.stopPropagation()} to={roadmapPath(roomId, scheduleId)} style={{ color: "#5435DB", fontWeight: 700 }}>{shared ? "코스 자세히 보기" : "전체 코스 보기"}</Link>
  </section>;
}
