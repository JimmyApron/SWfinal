import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { generateRecommendationResult } from "../../api/courseRecommendationApi";

const MEAL_OPTIONS = [
  { value: "korean", label: "한식" },
  { value: "western", label: "양식" },
  { value: "japanese", label: "일식" },
  { value: "chinese", label: "중식" },
  { value: "snack", label: "분식" },
  { value: "any", label: "상관없음" },
];

const ACTIVITY_OPTIONS = [
  { value: "experience", label: "놀거리 / 체험" },
  { value: "culture", label: "문화 / 전시" },
  { value: "cafe", label: "카페 / 디저트" },
  { value: "walk", label: "산책 / 야외 활동" },
  { value: "bar", label: "술집 / 주점" },
];

const TRAVEL_OPTIONS = [
  { value: "walking", label: "도보" },
  { value: "transit", label: "대중교통" },
  { value: "car", label: "자동차" },
];

const PRIORITY_OPTIONS = [
  { value: "travel", label: "이동 시간 최소화" },
  { value: "budget", label: "예산 우선" },
  { value: "rating", label: "평점 우선" },
  { value: "variety", label: "다양한 활동 우선" },
];

const STORAGE_PREFIX = "course_recommendation_condition";

function readStoredDraft(roomId, scheduleId) {
  if (typeof window === "undefined") return null;

  const key = buildStorageKey(roomId, scheduleId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildStorageKey(roomId, scheduleId) {
  const roomKey = Number(roomId) || "temp";
  const scheduleKey = Number(scheduleId) || "temp";
  return `${STORAGE_PREFIX}_${roomKey}_${scheduleKey}`;
}

function getScheduleDisplay(schedule) {
  const title = schedule?.title || "확정 일정";
  const date = schedule?.date || "날짜 미정";
  const time = schedule?.starttime || schedule?.endtime ? `${schedule?.starttime || ""}${schedule?.endtime ? ` ~ ${schedule.endtime}` : ""}` : "시간 미정";

  return {
    title,
    date,
    time,
    roomId: schedule?.roomid || null,
    scheduleId: schedule?.id || null,
  };
}

function getDefaultForm(schedule) {
  const regionFallback = schedule?.location || schedule?.locationaddress || "";

  return {
    mealPreferences: {
      breakfast: null,
      lunch: null,
      dinner: null,
    },
    activities: [],
    travelMode: "transit",
    maxTravelMinutes: 45,
    budget: "",
    minRating: 3.5,
    priority: "travel",
    preferredRegion: regionFallback,
    regionDetail: regionFallback,
    notes: "",
  };
}

function CourseRecommendationConditionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { roomid } = useParams();
  const scheduleFromState = location.state?.schedule || null;
  const scheduleId = scheduleFromState?.id || Number(new URLSearchParams(location.search).get("scheduleId")) || null;
  const roomId = Number(roomid || location.state?.roomId || scheduleFromState?.roomid || new URLSearchParams(location.search).get("roomId"));
  const [resolvedSchedule, setResolvedSchedule] = useState(scheduleFromState || null);

  useEffect(() => {
    if (resolvedSchedule || !scheduleId || !roomId) return;

    const loadSchedule = async () => {
      try {
        const { data, error } = await supabase
          .from("confirmed_schedules")
          .select("*")
          .eq("id", Number(scheduleId))
          .eq("roomid", Number(roomId))
          .maybeSingle();

        if (error) throw error;
        if (data) setResolvedSchedule(data);
      } catch (err) {
        console.error("추천 조건용 일정 복원 실패:", err);
      }
    };

    loadSchedule();
  }, [resolvedSchedule, roomId, scheduleId]);

  const scheduleInfo = useMemo(() => getScheduleDisplay(resolvedSchedule || scheduleFromState), [resolvedSchedule, scheduleFromState]);
  const storedKey = buildStorageKey(roomId, scheduleId);

  const [form, setForm] = useState(() => {
    const base = getDefaultForm(resolvedSchedule || scheduleFromState);
    const saved = readStoredDraft(roomId, scheduleId);
    return { ...base, ...(saved || {}) };
  });
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(storedKey, JSON.stringify(form));
  }, [form, storedKey]);

  const updateMealPreference = (meal, value) => {
    setForm((prev) => ({
      ...prev,
      mealPreferences: {
        ...prev.mealPreferences,
        [meal]: value,
      },
    }));
    setValidationError("");
  };

  const toggleActivity = (value) => {
    setForm((prev) => {
      const exists = prev.activities.includes(value);
      return {
        ...prev,
        activities: exists
          ? prev.activities.filter((item) => item !== value)
          : [...prev.activities, value],
      };
    });
    setValidationError("");
  };

  const validateForm = () => {
    const budgetValue = Number(form.budget);
    const maxTravelMinutesValue = Number(form.maxTravelMinutes);
    const minRatingValue = Number(form.minRating);

    if (form.budget !== "" && (!Number.isFinite(budgetValue) || budgetValue < 0)) {
      return "예산은 0 이상이어야 합니다.";
    }

    if (form.maxTravelMinutes !== "" && (!Number.isFinite(maxTravelMinutesValue) || maxTravelMinutesValue <= 0)) {
      return "이동 시간은 0보다 커야 합니다.";
    }

    if (!Number.isFinite(minRatingValue) || minRatingValue < 0 || minRatingValue > 5) {
      return "최소 평점은 0~5점 범위여야 합니다.";
    }

    return "";
  };

  const handleSaveAndReturn = async () => {
    const errorMessage = validateForm();
    if (errorMessage) {
      setValidationError(errorMessage);
      return;
    }

    const payload = {
      ...form,
      savedAt: new Date().toISOString(),
      roomId,
      scheduleId,
    };

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("course_recommendation_saved", JSON.stringify(payload));
    }

    try {
      const result = await generateRecommendationResult({
        condition: payload,
        schedule: resolvedSchedule || scheduleFromState,
      });

      const finalPayload = {
        ...payload,
        recommendationResult: result,
      };

      navigate(`/rooms/${roomId || scheduleInfo.roomId || ""}/course-recommendation-result`, {
        state: {
          schedule: resolvedSchedule || scheduleFromState,
          roomId: roomId || scheduleInfo.roomId,
          scheduleId,
          recommendation: result,
          recommendationCondition: finalPayload,
        },
        replace: false,
      });
    } catch (err) {
      setValidationError(err?.message || "추천 생성 중 오류가 발생했습니다.");
    }
  };

  const goBack = () => {
    if (roomId) {
      navigate(`/rooms/${roomId}/confirmed-schedule`, {
        state: { schedule: scheduleFromState },
      });
      return;
    }
    navigate(-1);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F7F5FF", color: "#17172B" }}>
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #EEE7FF",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={goBack}
          style={{
            border: "none",
            background: "transparent",
            color: "#17172B",
            fontSize: "22px",
            cursor: "pointer",
            padding: 0,
          }}
        >
          ←
        </button>
        <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, flex: 1, textAlign: "center" }}>
          추천 조건 설정
        </h2>
        <div style={{ width: 24 }} />
      </div>

      <div style={{ padding: "16px", maxWidth: "640px", margin: "0 auto" }}>
        <div
          style={{
            background: "#fff",
            borderRadius: "18px",
            boxShadow: "0 8px 22px rgba(123, 97, 255, 0.08)",
            border: "1px solid #EEE7FF",
            padding: "16px",
            marginBottom: "14px",
          }}
        >
          <p style={{ margin: 0, fontSize: "12px", color: "#7B61FF", fontWeight: 700 }}>
            선택한 일정
          </p>
          <h3 style={{ margin: "6px 0 4px", fontSize: "18px" }}>{scheduleInfo.title}</h3>
          <div style={{ color: "#4A4A5A", fontSize: "13px", lineHeight: 1.6 }}>
            <div>{scheduleInfo.date}</div>
            <div>{scheduleInfo.time}</div>
          </div>
        </div>

        <section style={cardStyle}>
          <div style={sectionTitleStyle}>식사 선택</div>
          <div style={{ display: "grid", gap: "12px" }}>
            {[
              { key: "breakfast", label: "아침" },
              { key: "lunch", label: "점심" },
              { key: "dinner", label: "저녁" },
            ].map((meal) => (
              <div key={meal.key} style={{ display: "grid", gap: "8px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#17172B" }}>{meal.label}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {MEAL_OPTIONS.map((option) => {
                    const selected = form.mealPreferences[meal.key] === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => updateMealPreference(meal.key, option.value)}
                        style={{
                          ...chipStyle,
                          background: selected ? "#7B61FF" : "#F3F0FF",
                          color: selected ? "#fff" : "#17172B",
                          borderColor: selected ? "#7B61FF" : "#E7E0FF",
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionTitleStyle}>활동 선택</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {ACTIVITY_OPTIONS.map((option) => {
              const selected = form.activities.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleActivity(option.value)}
                  style={{
                    ...chipStyle,
                    background: selected ? "#7B61FF" : "#F3F0FF",
                    color: selected ? "#fff" : "#17172B",
                    borderColor: selected ? "#7B61FF" : "#E7E0FF",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionTitleStyle}>이동 방식</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {TRAVEL_OPTIONS.map((option) => {
              const selected = form.travelMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, travelMode: option.value }))}
                  style={{
                    ...chipStyle,
                    background: selected ? "#7B61FF" : "#F3F0FF",
                    color: selected ? "#fff" : "#17172B",
                    borderColor: selected ? "#7B61FF" : "#E7E0FF",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <label style={{ display: "block", marginTop: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>허용 이동 시간(분)</div>
            <input
              type="number"
              min="1"
              value={form.maxTravelMinutes}
              onChange={(event) => {
                const nextValue = event.target.value;
                setForm((prev) => ({ ...prev, maxTravelMinutes: nextValue }));
                setValidationError("");
              }}
              style={inputStyle}
            />
          </label>
        </section>

        <section style={cardStyle}>
          <div style={sectionTitleStyle}>예상 예산</div>
          <label style={{ display: "block" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>1인당 예상 예산 (원)</div>
            <input
              type="number"
              min="0"
              step="1000"
              value={form.budget}
              onChange={(event) => {
                const nextValue = event.target.value;
                setForm((prev) => ({ ...prev, budget: nextValue }));
                setValidationError("");
              }}
              placeholder="예: 25000"
              style={inputStyle}
            />
          </label>
        </section>

        <section style={cardStyle}>
          <div style={sectionTitleStyle}>최소 평점</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {[0, 2.5, 3, 3.5, 4, 4.5].map((value) => {
              const selected = Number(form.minRating) === Number(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setForm((prev) => ({ ...prev, minRating: value }));
                    setValidationError("");
                  }}
                  style={{
                    ...chipStyle,
                    background: selected ? "#7B61FF" : "#F3F0FF",
                    color: selected ? "#fff" : "#17172B",
                    borderColor: selected ? "#7B61FF" : "#E7E0FF",
                  }}
                >
                  {value === 0 ? "상관없음" : `${value}점 이상`}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: "12px", fontSize: "12px", color: "#66657A" }}>
            평점 정보가 없는 장소는 다음 추천 알고리즘 단계에서 별도 처리됩니다.
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionTitleStyle}>추천 우선순위</div>
          <div style={{ display: "grid", gap: "8px" }}>
            {PRIORITY_OPTIONS.map((option) => {
              const selected = form.priority === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, priority: option.value }))}
                  style={{
                    ...priorityButtonStyle,
                    background: selected ? "#F3F0FF" : "#fff",
                    borderColor: selected ? "#7B61FF" : "#EAE4FF",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{option.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionTitleStyle}>선호 지역</div>
          <label style={{ display: "block" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>지역 이름</div>
            <input
              type="text"
              value={form.preferredRegion}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, preferredRegion: event.target.value, regionDetail: event.target.value }));
                setValidationError("");
              }}
              placeholder="예: 강남역, 홍대, 청담동"
              style={inputStyle}
            />
          </label>

          <label style={{ display: "block", marginTop: "12px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>상세 주소 / 지역 메모</div>
            <textarea
              value={form.regionDetail}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, regionDetail: event.target.value }));
                setValidationError("");
              }}
              placeholder="예: 강남역 주변, 지하철 2호선 기준"
              rows={3}
              style={{
                ...inputStyle,
                resize: "vertical",
                minHeight: "88px",
              }}
            />
          </label>
        </section>

        {validationError && (
          <div
            style={{
              background: "#FFF1F2",
              border: "1px solid #FEC2C7",
              color: "#C62828",
              borderRadius: "12px",
              padding: "10px 12px",
              fontSize: "13px",
              marginBottom: "14px",
            }}
          >
            {validationError}
          </div>
        )}

        <div style={{ display: "grid", gap: "10px", marginTop: "6px" }}>
          <button type="button" onClick={handleSaveAndReturn} style={primaryButtonStyle}>
            조건 저장하고 돌아가기
          </button>
          <button type="button" onClick={goBack} style={secondaryButtonStyle}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

const cardStyle = {
  background: "#fff",
  borderRadius: "18px",
  border: "1px solid #EEE7FF",
  boxShadow: "0 8px 22px rgba(123, 97, 255, 0.08)",
  padding: "16px",
  marginBottom: "14px",
};

const sectionTitleStyle = {
  margin: "0 0 12px",
  fontSize: "15px",
  fontWeight: 700,
  color: "#17172B",
};

const chipStyle = {
  border: "1px solid #E7E0FF",
  background: "#F3F0FF",
  color: "#17172B",
  borderRadius: "999px",
  padding: "8px 12px",
  fontSize: "12px",
  cursor: "pointer",
  transition: "all 0.15s ease",
};

const priorityButtonStyle = {
  border: "1px solid #EAE4FF",
  background: "#fff",
  borderRadius: "12px",
  padding: "11px 12px",
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
  color: "#17172B",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #E7E0FF",
  borderRadius: "10px",
  background: "#fff",
  padding: "10px 12px",
  fontSize: "14px",
  boxSizing: "border-box",
  color: "#17172B",
};

const primaryButtonStyle = {
  width: "100%",
  border: "none",
  borderRadius: "12px",
  background: "#7B61FF",
  color: "#fff",
  padding: "12px 16px",
  fontSize: "15px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  width: "100%",
  border: "1px solid #E7E0FF",
  borderRadius: "12px",
  background: "#fff",
  color: "#17172B",
  padding: "12px 16px",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
};

export default CourseRecommendationConditionPage;
