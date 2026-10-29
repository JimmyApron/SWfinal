import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getFinalizedRoadmap, shareFinalizedCourse } from "../../api/courseRoadmapApi";
import KakaoMapView from "../../components/map/KakaoMapView";
import { externalMapLink, mapPlaces, numberInfo } from "../../utils/courseRoadmapUtils";
import "./FinalizedCourseRoadmapPage.css";

export default function FinalizedCourseRoadmapPage() {
  const { roomid, scheduleid } = useParams();
  const [state, setState] = useState({ loading: true });
  const [selectedId, setSelectedId] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState("");
  const shareLock = useRef(false);
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    setSelectedId(null);
    setShareResult("");
    getFinalizedRoadmap(roomid, scheduleid).then((data) => { if (active) setState({ data }); })
      .catch((error) => { if (active) setState({ error: error.message || "최종 코스를 조회하지 못했습니다." }); });
    return () => { active = false; };
  }, [roomid, scheduleid]);
  const stops = state.data?.course.stops;
  const places = useMemo(() => mapPlaces(stops || []), [stops]);
  const selectPlace = useCallback((place) => setSelectedId(place.id), []);
  const selectedPlace = places.find((place) => place.id === selectedId);
  if (state.loading) return <main className="course-roadmap">최종 코스를 불러오고 있습니다.</main>;
  if (state.error) return <main className="course-roadmap"><p role="alert">{state.error}</p><Link to={`/rooms/${roomid}`}>모임으로 돌아가기</Link></main>;
  if (!state.data) return <main className="course-roadmap"><p>아직 최종 확정된 코스가 없습니다.</p><Link to={`/rooms/${roomid}`}>모임으로 돌아가기</Link></main>;
  const { course, schedule, room } = state.data;
  return <main className="course-roadmap">
    <Link to={`/rooms/${roomid}?tab=schedule&scheduleId=${scheduleid}`}>← 일정으로 돌아가기</Link>
    <header><p>{room.roomname} · {schedule.title || "이름 없는 일정"}</p><span className="course-roadmap-badge">최종 확정 완료</span>
      <h1>{course.course_name}</h1><p>{schedule.date || "날짜 정보 없음"} · {schedule.isallday ? "종일" : `${schedule.starttime?.slice(0, 5) || "시작 시간 정보 없음"} ~ ${schedule.endtime?.slice(0, 5) || "종료 시간 정보 없음"}`}</p></header>
    <section className="course-roadmap-card" aria-label="전체 코스 요약">
      <h2>하루 코스 요약</h2><div className="course-roadmap-summary">
        <span>방문 장소 <strong>{stops.length}곳</strong></span>
        <span>예상 소요 <strong>{numberInfo(course.estimated_total_duration_min, "분")}</strong></span>
        <span>예상 이동 <strong>{numberInfo(course.estimated_travel_time_min, "분")}</strong></span>
        <span>1인당 예상 비용 <strong>{numberInfo(course.estimated_cost_per_person, "원")}</strong></span>
      </div>
      {course.recommendation_condition && <p>저장된 추천 조건: {course.recommendation_condition}</p>}
    </section>
    <section className="course-roadmap-card"><h2>방문 순서 지도</h2>
      {places.length ? <KakaoMapView places={places} routePath={places.length > 1 ? places : []} numberedPlaces selectedPlace={selectedPlace} onPlaceSelect={selectPlace} height="min(55vh, 420px)" /> : <p>지도에 표시할 좌표가 없습니다. 아래 방문 장소 목록을 확인해 주세요.</p>}
      <p className="course-roadmap-muted">선은 방문 순서를 보여주는 직선이며 실제 도로 경로가 아닙니다. 좌표가 없는 장소는 지도에서 제외됩니다.</p>
    </section>
    <section aria-label="방문 장소 타임라인"><h2>방문 장소</h2>
      {!stops.length && <p>등록된 방문 장소가 없습니다.</p>}
      {stops.map((stop) => {
        const href = externalMapLink(stop);
        return <article key={stop.roadmapId} className={`course-roadmap-card ${selectedId === stop.roadmapId ? "selected" : ""}`}>
          <button className="course-roadmap-stop" onClick={() => setSelectedId(stop.roadmapId)} aria-pressed={selectedId === stop.roadmapId}><span className="course-roadmap-number">{stop.roadmapNumber}</span><strong>{stop.place_name}</strong></button>
          {stop.category && <p>{stop.category}</p>}<p>{stop.place_address || "주소 정보 없음"}</p>
          <p>방문 {stop.visit_start_time?.slice(0, 5) || "정보 없음"} ~ {stop.visit_end_time?.slice(0, 5) || "정보 없음"} · 체류 {numberInfo(stop.expected_stay_min, "분")}</p>
          <p>예상 비용 {numberInfo(stop.estimated_cost, "원")}{stop.roadmapNumber > 1 && ` · 이전 장소에서 이동 ${numberInfo(stop.travel_time_from_prev_min, "분")}`}</p>
          {stop.rating != null && <p>평점 {numberInfo(stop.rating)}</p>}
          {typeof stop.image_url === "string" && /^https?:\/\//i.test(stop.image_url) && <img src={stop.image_url} alt={`${stop.place_name} 장소 사진`} loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />}
          {href && <a href={href} target="_blank" rel="noreferrer">카카오맵에서 위치 확인</a>}
        </article>;
      })}
    </section>
    <button className="course-roadmap-share" disabled={sharing} onClick={async () => {
      if (shareLock.current) return;
      shareLock.current = true;
      setSharing(true);
      setShareResult("");
      try { await shareFinalizedCourse(roomid, scheduleid); setShareResult("채팅방에 코스를 공유했습니다."); }
      catch (error) { setShareResult(error.message || "코스 공유에 실패했습니다."); }
      finally { setSharing(false); shareLock.current = false; }
    }}>{sharing ? "공유 중..." : "채팅방에 코스 공유하기"}</button>
    <p role="status">{shareResult}</p><Link to={`/rooms/${roomid}?tab=chat`}>채팅방 보기</Link>
  </main>;
}
