import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { deduplicateRecommendationResult, loadRecommendationResultFromStorage, saveRecommendationResultToStorage } from "../../api/courseRecommendationApi";
import { normalizeCourseVoteSelection } from "../../utils/courseVoteUtils";
import { confirmRecommendedCourse } from "../../api/directRecommendationApi";
import PlaceRating from "../../components/PlaceRating";
import CourseRouteMap from "../../components/map/CourseRouteMap";
import { courseTravelMode } from '../../utils/courseTravelMode';
import { validCoordinate } from "../../utils/courseRoadmapUtils";

const PAGE_STYLES = {
  summaryTag: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 9px',
    borderRadius: 8,
    background: '#F5F2FF',
    border: '1px solid #EAE4FF',
    color: '#6650B0',
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.5,
  },
  page: {
    minHeight: "100vh",
    background: "#F7F5FF",
    color: "#17172B",
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: "#fff",
    borderBottom: "1px solid #EDE7FF",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  card: {
    background: "#fff",
    borderRadius: "18px",
    border: "1px solid #EEE7FF",
    boxShadow: "0 10px 22px rgba(123, 97, 255, 0.08)",
    padding: "14px",
    margin: "12px 16px",
  },
  chip: {
    border: "1px solid #E6E0FF",
    background: "#F3F0FF",
    color: "#17172B",
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "11px",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  primaryButton: {
    width: "100%",
    border: "none",
    borderRadius: "12px",
    background: "linear-gradient(135deg, #7B61FF 0%, #9B85FF 100%)",
    color: "#fff",
    padding: "12px 16px",
    fontSize: "15px",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryButton: {
    width: "100%",
    border: "1px solid #E7E0FF",
    borderRadius: "12px",
    background: "#fff",
    color: "#17172B",
    padding: "12px 16px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
  },
};

function getTimeLabel(startTime, endTime) {
  if (!startTime && !endTime) return "시간 미정";
  if (startTime && endTime) return `${startTime} ~ ${endTime}`;
  return startTime || endTime;
}

function getStopCostLabel(stop) {
  if (stop.budgetEstimate?.max != null) {
    const { min, max } = stop.budgetEstimate;
    return min === max ? `1인 ${Number(max).toLocaleString('ko-KR')}원` : `1인 ${Number(min).toLocaleString('ko-KR')}~${Number(max).toLocaleString('ko-KR')}원`;
  }
  return stop.estimatedCost == null ? '비용 확인 필요' : `1인 ${Number(stop.estimatedCost).toLocaleString('ko-KR')}원`;
}

function CourseRecommendationResultPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { roomid } = useParams();
  const queryParams = new URLSearchParams(location.search);
  const isNewSchedule = Boolean(location.state?.newScheduleDraft);
  const stateScheduleId = location.state?.schedule?.id || Number(queryParams.get("scheduleId")) || null;
  const stateRoomId = Number(roomid || location.state?.roomId || location.state?.schedule?.roomid || queryParams.get("roomId"));

  const [schedule, setSchedule] = useState(location.state?.schedule || null);
  const [recommendation, setRecommendation] = useState(() => deduplicateRecommendationResult(location.state?.recommendation));
  const [loading, setLoading] = useState(!recommendation);
  const [error, setError] = useState("");
  const [selectedCourseIds, setSelectedCourseIds] = useState([]);
  const [expandedCourseIds, setExpandedCourseIds] = useState([]);
  const [confirmingCourseId, setConfirmingCourseId] = useState(null);
  const [confirmationError, setConfirmationError] = useState('');
  const confirmationLock = useRef(false);

  const handleConfirmCourse = async (course) => {
    if (confirmationLock.current || !stateRoomId || !stateScheduleId) return;
    confirmationLock.current = true;
    setConfirmingCourseId(course.id);
    setConfirmationError('');
    try {
      const result = await confirmRecommendedCourse({ roomId: stateRoomId, scheduleId: stateScheduleId, course });
      if (result.warning) window.alert(result.warning);
      navigate(`/rooms/${stateRoomId}/confirmed-schedule`, {
        state: { schedule: schedule || { id: stateScheduleId, roomid: stateRoomId } },
        replace: true,
      });
    } catch (failure) {
      console.error('코스 확정 실패:', failure);
      const message = failure.message || '코스 확정에 실패했습니다. 다시 시도해 주세요.';
      setConfirmationError(message);
      // 오류 문구는 페이지 맨 아래에 있어 놓치기 쉬우니 바로 알려 준다.
      window.alert(message);
    } finally {
      confirmationLock.current = false;
      setConfirmingCourseId(null);
    }
  };

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.key, loading]);

  useEffect(() => {
    const restoreSchedule = async () => {
      if (schedule || !stateRoomId || !stateScheduleId) return;

      try {
        const { data, error: scheduleError } = await supabase
          .from("confirmed_schedules")
          .select("*")
          .eq("id", stateScheduleId)
          .eq("roomid", stateRoomId)
          .maybeSingle();

        if (scheduleError) throw scheduleError;
        if (data) setSchedule(data);
      } catch (err) {
        setError("일정 정보를 불러오지 못했습니다.");
      }
    };

    restoreSchedule();
  }, [schedule, stateRoomId, stateScheduleId]);

  useEffect(() => {
    if (!stateRoomId || (!stateScheduleId && !isNewSchedule)) {
      setError("유효하지 않은 일정 정보입니다.");
      setLoading(false);
      return;
    }

    if (recommendation) {
      setSelectedCourseIds(recommendation.courses?.map((course) => course.id) || []);
      if (!isNewSchedule) saveRecommendationResultToStorage(stateRoomId, stateScheduleId, recommendation);
      setLoading(false);
      return;
    }

    const stored = !isNewSchedule && loadRecommendationResultFromStorage(stateRoomId, stateScheduleId);
    if (stored) {
      setRecommendation(stored);
      setSelectedCourseIds(stored.courses?.map((course) => course.id) || []);
      setLoading(false);
      return;
    }

    setError("추천 결과를 찾을 수 없습니다. 조건을 다시 설정해 주세요.");
    setLoading(false);
  }, [recommendation, stateRoomId, stateScheduleId, isNewSchedule]);

  const courseList = useMemo(() => recommendation?.courses || [], [recommendation]);

  const toggleCourse = (courseId) => {
    setSelectedCourseIds((prev) =>
      prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId]
    );
  };

  const toggleAll = (shouldSelectAll) => {
    setSelectedCourseIds(shouldSelectAll ? courseList.map((course) => course.id) : []);
  };

  const selectedCount = selectedCourseIds.length;
  const selectedCourses = useMemo(
    () => (recommendation?.courses || []).filter((course) => selectedCourseIds.includes(course.id)),
    [recommendation, selectedCourseIds]
  );

  const handleCreateCourseVote = () => {
    if (isNewSchedule && selectedCourses.length && stateRoomId) {
      const draft = location.state.newScheduleDraft;
      navigate(`/rooms/${stateRoomId}/schedules/new`, { state: { newScheduleDraft: {
        ...draft, courses: [...(draft.courses || []), ...normalizeCourseVoteSelection(selectedCourses, (draft.courses || []).length + 1)],
      } } });
      return;
    }
    if (!selectedCourses.length || !stateRoomId || !stateScheduleId) {
      return;
    }

    navigate(`/rooms/${stateRoomId}/vote-create`, {
      state: {
        voteType: "course",
        votePurpose: "course",
        title: `${schedule?.title || "추천 코스"} 투표`,
        selectedCourses,
        schedule,
        courseVoteDraft: location.state?.courseVoteDraft,
        scheduleId: stateScheduleId,
        fromScheduleId: stateScheduleId,
        scheduleTitle: schedule?.title || "",
        returnTab: "vote",
      },
    });
  };

  const goBack = () => {
    if (stateRoomId) {
      navigate(`/rooms/${stateRoomId}/course-recommendation`, {
        state: {
          schedule,
          roomId: stateRoomId,
          scheduleId: stateScheduleId,
          courseVoteDraft: location.state?.courseVoteDraft,
          newScheduleDraft: location.state?.newScheduleDraft,
        },
      });
      return;
    }
    navigate(-1);
  };

  if (loading) {
    return (
      <div style={PAGE_STYLES.page}>
        <div style={PAGE_STYLES.header}>
          <button type="button" onClick={goBack} style={{ ...PAGE_STYLES.secondaryButton, width: "auto", padding: "8px 12px" }}>←</button>
          <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>추천 결과</h2>
          <div style={{ width: 40 }} />
        </div>
        <div style={{ padding: "24px 16px", textAlign: "center", color: "#66657A" }}>추천 코스를 생성하고 있습니다...</div>
      </div>
    );
  }

  return (
    <div style={PAGE_STYLES.page}>
      <div style={PAGE_STYLES.header}>
        <button type="button" onClick={goBack} style={{ ...PAGE_STYLES.secondaryButton, width: "auto", padding: "8px 12px" }}>←</button>
        <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>추천 결과</h2>
        <div style={{ width: 40 }} />
      </div>

      <div style={{ padding: "12px 16px 18px" }}>
        <div style={PAGE_STYLES.card}>
          <div style={{ color: "#7B61FF", fontSize: "12px", fontWeight: 700 }}>선택 일정</div>
          <div style={{ marginTop: "6px", fontSize: "18px", fontWeight: 700 }}>{schedule?.title || "추천 일정"}</div>
          <div style={{ marginTop: "4px", color: "#4D4E5C", fontSize: "13px" }}>
            {schedule?.date || "날짜 미정"} · {schedule?.starttime || "시간 미정"}
          </div>
        </div>

        {error ? (
          <div style={{ ...PAGE_STYLES.card, borderColor: "#F6D2D4", background: "#FFF7F7" }}>
            {error}
          </div>
        ) : (
          <>
            {recommendation?.warning && <div role="status" style={PAGE_STYLES.card}>{recommendation.warning}</div>}
            <div style={{ ...PAGE_STYLES.card, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <span style={PAGE_STYLES.chip}>추천 코스 {courseList.length}개</span>
                <span style={{ fontSize: "12px", color: "#4D4E5C" }}>선택 {selectedCount}개</span>
              </div>

              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <button type="button" onClick={() => toggleAll(true)} style={{ ...PAGE_STYLES.secondaryButton, padding: "10px 12px", width: "auto", flex: 1 }}>
                  전체 선택
                </button>
                <button type="button" onClick={() => toggleAll(false)} style={{ ...PAGE_STYLES.secondaryButton, padding: "10px 12px", width: "auto", flex: 1 }}>
                  전체 해제
                </button>
              </div>
            </div>

            {courseList.length === 0 ? (
              <div style={{ ...PAGE_STYLES.card, color: "#4D4E5C" }}>
                추천 가능한 코스가 없습니다. 조건을 다시 설정해 주세요.
              </div>
            ) : (
              courseList.map((course, index) => {
                const checked = selectedCourseIds.includes(course.id);
                const expanded = expandedCourseIds.includes(course.id);
                const mapPlaces = course.stops.map((stop, stopIndex) => ({
                  id: `${course.id}-${stopIndex}`,
                  name: stop.placeName,
                  address: stop.placeAddress,
                  lat: stop.latitude ?? stop.lat,
                  lng: stop.longitude ?? stop.lng,
                  orderNumber: stopIndex + 1,
                })).filter(place => validCoordinate(place.lat, place.lng))
                  .map(place => ({ ...place, lat: Number(place.lat), lng: Number(place.lng) }));
                return (
                  <div key={course.id} style={{ ...PAGE_STYLES.card, padding: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <div>
                        <div style={{ fontSize: "12px", color: "#7B61FF", fontWeight: 700 }}>코스 {index + 1}</div>
                        <h3 style={{ margin: "5px 0 0", fontSize: "18px" }}>{course.name}</h3>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCourse(course.id)}
                        style={{ width: "20px", height: "20px", accentColor: "#7B61FF" }}
                      />
                    </div>

                    <div style={{ display: 'grid', gap: 8, marginTop: 12, fontSize: 14, lineHeight: 1.6 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <span style={PAGE_STYLES.summaryTag}>{course.stops.some(stop => stop.mealKey) || course.summary?.includes('식사 포함') || course.summary?.includes('식사가 포함') ? '식사 포함' : '식사 미포함'}</span>
                        <span style={PAGE_STYLES.summaryTag}>{({ walking: '도보 이동', transit: '대중교통 이동', car: '자동차 이동' })[courseTravelMode(course, recommendation?.condition?.travelMode)] || '이동 수단 미정'}</span>
                        {course.estimatedTravelTimeMin != null && <span style={PAGE_STYLES.summaryTag}>예상 이동 합계 약 {course.estimatedTravelTimeMin}분</span>}
                        {course.totalDurationMin > 0 && <span style={PAGE_STYLES.summaryTag}>코스 전체 약 {course.totalDurationMin >= 60 ? `${Math.floor(course.totalDurationMin / 60)}시간${course.totalDurationMin % 60 ? ` ${course.totalDurationMin % 60}분` : ''}` : `${course.totalDurationMin}분`} · 식사·활동·대기 포함</span>}
                        <span style={PAGE_STYLES.summaryTag}>{({ rating: '높은 평점 우선', budget: '예산 우선', variety: '다양한 활동 포함', travel: '이동 시간 최소화' })[course.priority || recommendation?.condition?.priority || (course.summary?.includes('평점') ? 'rating' : course.summary?.includes('예산 우선') ? 'budget' : 'travel')]}</span>
                        {course.barMode && <span style={PAGE_STYLES.summaryTag}>{course.barMode === 'dinner' ? '저녁 식사 · 주점 포함' : '식사 후 2차 포함'}</span>}
                      </div>
                      <div style={{ padding: '12px 14px', background: '#F7F5FF', borderRadius: 12 }}>
                        <div style={{ fontSize: 13, color: '#66657A' }}>1인 예상 비용</div>
                        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 3 }}>{course.budgetEstimate?.max != null ? `${Number(course.budgetEstimate.min).toLocaleString('ko-KR')}~${Number(course.budgetEstimate.max).toLocaleString('ko-KR')}원` : course.budgetEstimate ? '비용 정보 확인 필요' : course.estimatedCostPerPerson == null ? '비용 정보 없음' : `${Number(course.estimatedCostPerPerson).toLocaleString('ko-KR')}원`}</div>
                      </div>
                    </div>

                    {expanded && <div id={`course-details-${course.id}`} role="region" aria-label={`${course.name} 상세 정보`} style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
                      {mapPlaces.length > 0 ? (
                        <div aria-label="코스 방문 순서 지도">
                          <CourseRouteMap places={mapPlaces} travelMode={courseTravelMode(course, recommendation?.condition?.travelMode)} allowWalkingLookup height="280px" />
                          <p style={{ fontSize: 12, color: '#66657A', margin: '6px 0' }}>번호는 방문 순서입니다. 경로 조회에 실패한 경우 연결선을 표시하지 않습니다.</p>
                        </div>
                      ) : <p style={{ fontSize: 13, color: '#66657A' }}>지도에 표시할 장소 좌표가 없습니다.</p>}
                      {course.budgetEstimate && <p style={{ fontSize: 13, lineHeight: 1.6, color: "#66657A", margin: 0 }}>식사와 활동 종류를 바탕으로 계산한 금액이에요. 실제 이용 요금은 다를 수 있습니다. {course.budgetEstimate.status === "over" ? "설정한 예산보다 많이 들 수 있어요." : course.budgetEstimate.status === "uncertain" ? "선택한 예산 안에 가능한지 확인해 주세요." : ""}</p>}
                      {expanded && <p style={{ fontSize: 13, color: '#66657A', margin: '0 0 4px' }}>총 이동 시간: {course.estimatedTravelTimeMin == null ? '정보 없음' : `${course.estimatedTravelTimeMin}분`} · 이동 시간과 비용은 추정치입니다.</p>}
                      {course.stops.map((stop, stopIndex) => (
                        <div key={`${course.id}-${stop.order || stopIndex}`} style={{ display: "flex", gap: "10px", alignItems: "flex-start", borderBottom: '1px solid #EEE7FF', padding: '8px 0' }}>
                          <div
                            style={{
                              width: "24px",
                              height: "24px",
                              borderRadius: "50%",
                              background: "#F3F0FF",
                              color: "#7B61FF",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "11px",
                              fontWeight: 700,
                              marginTop: "2px",
                              flexShrink: 0,
                            }}
                          >
                            {stop.order || stopIndex + 1}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                              <div style={{ flex: '1 1 100px', fontWeight: 700, fontSize: 14, overflowWrap: 'anywhere' }}>
                                {stop.placeName}
                                <div style={{ marginTop: 3 }}><PlaceRating rating={stop.rating} /></div>
                              </div>
                              <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 12, lineHeight: 1.6 }}>
                                <div style={{ color: '#6650B0', fontWeight: 600 }}>{getStopCostLabel(stop)}</div>
                                <div style={{ color: '#66657A' }}>{stop.expectedStayMin == null ? '체류 시간 미정' : `${stop.expectedStayMin}분 체류`}</div>
                              </div>
                            </div>
                            {expanded && <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
                            <div style={{ fontSize: "12px", color: "#66657A", marginTop: "2px" }}>{stop.category || "기타"}</div>
                            {stop.activityDescription && <p style={{ margin: '6px 0', fontSize: 14, color: '#6650B0', lineHeight: 1.5 }}>{stop.activityDescription}</p>}
                            <p style={{ margin: '6px 0' }}>{stop.placeAddress || '주소 정보 없음'}</p>
                            <p style={{ margin: '6px 0' }}>방문 시간: {getTimeLabel(stop.visitStartTime, stop.visitEndTime)}</p>
                            {stop.waitingTimeMin > 0 && <p style={{ margin: '6px 0' }}>방문 전 여유 시간: {stop.waitingTimeMin}분 · 쉬거나 자유롭게 둘러보세요.</p>}
                            {stopIndex > 0 && <p style={{ margin: '6px 0' }}>이전 장소에서 이동: {stop.travelTimeFromPrevMin == null ? '시간 정보 없음' : `${stop.travelTimeFromPrevMin}분`}{stop.distanceFromPrevM != null ? ` · ${Number(stop.distanceFromPrevM).toLocaleString()}m` : ''}</p>}
                            </div>}
                          </div>
                        </div>
                      ))}
                    </div>}

                    <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                      <button type="button" aria-expanded={expanded} aria-controls={`course-details-${course.id}`} onClick={() => setExpandedCourseIds(previous => previous.includes(course.id) ? previous.filter(id => id !== course.id) : [...previous, course.id])} style={{ ...PAGE_STYLES.secondaryButton, padding: "10px 12px", width: "100%" }}>
                        {expanded ? '코스 상세 접기' : '코스 상세 보기'}
                      </button>
                    </div>
                    {!isNewSchedule && !location.state?.courseVoteDraft && (
                      <button type="button" disabled={confirmingCourseId !== null}
                        onClick={() => handleConfirmCourse(course)}
                        style={{ ...PAGE_STYLES.primaryButton, marginTop: '10px', opacity: confirmingCourseId !== null ? 0.5 : 1 }}>
                        {confirmingCourseId === course.id ? '확정 중…' : '이 코스로 바로 확정'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        <div style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
          {confirmationError && <p role="alert" style={{ color: '#B42318' }}>{confirmationError}</p>}
          <button
            type="button"
            style={{ ...PAGE_STYLES.primaryButton, opacity: selectedCount === 0 ? 0.5 : 1 }}
            disabled={selectedCount === 0 || confirmingCourseId !== null}
            onClick={handleCreateCourseVote}
          >
            {isNewSchedule ? '선택한 코스를 일정에 추가' : location.state?.courseVoteDraft ? '선택한 코스를 후보에 추가' : '선택한 코스로 투표 만들기'}
          </button>
          <button type="button" disabled={confirmingCourseId !== null} onClick={goBack} style={PAGE_STYLES.secondaryButton}>
            조건 다시 설정
          </button>
        </div>
      </div>
    </div>
  );
}

export default CourseRecommendationResultPage;
