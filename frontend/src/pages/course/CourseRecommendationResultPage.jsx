import { formatCourseBudget } from "../../utils/courseBudgetUtils";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { deduplicateRecommendationResult, loadRecommendationResultFromStorage, saveRecommendationResultToStorage } from "../../api/courseRecommendationApi";

const PAGE_STYLES = {
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

function CourseRecommendationResultPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { roomid } = useParams();
  const queryParams = new URLSearchParams(location.search);
  const stateScheduleId = location.state?.schedule?.id || Number(queryParams.get("scheduleId")) || null;
  const stateRoomId = Number(roomid || location.state?.roomId || location.state?.schedule?.roomid || queryParams.get("roomId"));

  const [schedule, setSchedule] = useState(location.state?.schedule || null);
  const [recommendation, setRecommendation] = useState(() => deduplicateRecommendationResult(location.state?.recommendation));
  const [loading, setLoading] = useState(!recommendation);
  const [error, setError] = useState("");
  const [selectedCourseIds, setSelectedCourseIds] = useState([]);

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
    if (!stateRoomId || !stateScheduleId) {
      setError("유효하지 않은 일정 정보입니다.");
      setLoading(false);
      return;
    }

    if (recommendation) {
      setSelectedCourseIds(recommendation.courses?.map((course) => course.id) || []);
      saveRecommendationResultToStorage(stateRoomId, stateScheduleId, recommendation);
      setLoading(false);
      return;
    }

    const stored = loadRecommendationResultFromStorage(stateRoomId, stateScheduleId);
    if (stored) {
      setRecommendation(stored);
      setSelectedCourseIds(stored.courses?.map((course) => course.id) || []);
      setLoading(false);
      return;
    }

    setError("추천 결과를 찾을 수 없습니다. 조건을 다시 설정해 주세요.");
    setLoading(false);
  }, [recommendation, stateRoomId, stateScheduleId]);

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
    if (!selectedCourses.length || !stateRoomId || !stateScheduleId) {
      return;
    }

    navigate(`/rooms/${stateRoomId}/vote-create`, {
      state: {
        voteType: "course",
        votePurpose: "course",
        title: `${schedule?.title || "추천 코스"} 투표`,
        selectedCourses,
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

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                      <span style={PAGE_STYLES.chip}>{course.summary}</span>
                      <span style={PAGE_STYLES.chip}>{course.totalDurationMin || 0}분</span>
                      <span style={PAGE_STYLES.chip}>{course.budgetEstimate ? formatCourseBudget(course.budgetEstimate) : course.estimatedCostPerPerson == null ? "비용 정보 없음" : `예상 예산 ${Number(course.estimatedCostPerPerson).toLocaleString()}원`}</span>
                    </div>

                    {course.budgetEstimate && <p style={{ fontSize: 12, color: "#66657A" }}>카테고리별 추정 금액 · 실제 이용 요금은 다를 수 있습니다. {course.budgetEstimate.status === "over" ? "예상 범위가 설정 예산을 초과합니다." : course.budgetEstimate.status === "uncertain" ? "예산 충족 여부 확인 필요" : ""}</p>}
                    <div style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
                      {course.stops.map((stop, stopIndex) => (
                        <div key={`${course.id}-${stop.order || stopIndex}`} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
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
                            }}
                          >
                            {stop.order || stopIndex + 1}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: "14px" }}>{stop.placeName}</div>
                            <div style={{ fontSize: "12px", color: "#66657A", marginTop: "2px" }}>{stop.category || "기타"}</div>
                            <div style={{ fontSize: "12px", color: "#4D4E5C", marginTop: "5px" }}>
                              {stop.placeAddress || "주소 정보 없음"}
                            </div>
                            <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "6px", fontSize: "11px", color: "#4D4E5C" }}>
                              <span style={PAGE_STYLES.chip}>{getTimeLabel(stop.visitStartTime, stop.visitEndTime)}</span>
                              <span style={PAGE_STYLES.chip}>{stop.expectedStayMin || 60}분 체류</span>
                              {/* 평점 제공처 확보 후 다시 사용:
                              <span style={PAGE_STYLES.chip}>{stop.rating == null ? "평점 정보 없음" : `평점 ${Number(stop.rating).toFixed(1)}`}</span>
                              */}
                              {stop.travelTimeFromPrevMin != null && <span style={PAGE_STYLES.chip}>이동 {stop.travelTimeFromPrevMin}분</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                      <button type="button" style={{ ...PAGE_STYLES.secondaryButton, padding: "10px 12px", width: "100%" }}>
                        코스 상세 보기
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        <div style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
          <button
            type="button"
            style={{ ...PAGE_STYLES.primaryButton, opacity: selectedCount === 0 ? 0.5 : 1 }}
            disabled={selectedCount === 0}
            onClick={handleCreateCourseVote}
          >
            선택한 코스로 투표 만들기
          </button>
          <button type="button" onClick={goBack} style={PAGE_STYLES.secondaryButton}>
            조건 다시 설정
          </button>
        </div>
      </div>
    </div>
  );
}

export default CourseRecommendationResultPage;
