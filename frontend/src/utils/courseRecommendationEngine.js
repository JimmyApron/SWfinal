import { searchNearbyPlaces, searchPlacesByKeyword } from "../api/kakaoPlacesApi";

const ACTIVITY_CATEGORY_MAP = {
  experience: ["activity", "travel"],
  culture: ["museum", "culture"],
  cafe: ["cafe"],
  walk: ["park", "nature"],
  bar: ["bar", "restaurant"],
};

const MEAL_CATEGORY_MAP = {
  korean: ["한식", "korean"],
  western: ["양식", "western", "pasta", "steak"],
  japanese: ["일식", "japanese", "sushi", "ramen"],
  chinese: ["중식", "chinese", "dimsum"],
  snack: ["분식", "snack", "tteokbokki", "kimbap"],
  any: ["restaurant", "food", "cafe"],
};

const DEFAULT_DAY_RANGE = {
  startTime: "10:00",
  endTime: "21:00",
};

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dedupePlaces(places) {
  const deduped = new Map();
  places.forEach((place) => {
    const key = [place.id || place.place_id || place.placeId || place.name, place.address || place.place_address].join("::");
    if (!deduped.has(key)) {
      deduped.set(key, place);
    }
  });
  return Array.from(deduped.values());
}

function resolveScheduleCenter(schedule) {
  const lat = toNumber(schedule?.locationlat ?? schedule?.lat, null);
  const lng = toNumber(schedule?.locationlng ?? schedule?.lng, null);

  if (lat !== null && lng !== null) {
    return { lat, lng, source: "schedule" };
  }

  if (schedule?.locationaddress) {
    return { lat: null, lng: null, address: schedule.locationaddress, source: "address" };
  }

  return null;
}

function getActivitySearchTerms(condition) {
  const selected = Array.isArray(condition?.activities) ? condition.activities : [];
  if (selected.length === 0) {
    return ["카페", "산책", "맛집"];
  }

  return selected.flatMap((activity) => ACTIVITY_CATEGORY_MAP[activity] || [activity]);
}

function getMealSearchTerms(mealPreferences) {
  const meals = ["breakfast", "lunch", "dinner"];
  const terms = [];

  meals.forEach((mealKey) => {
    const selected = mealPreferences?.[mealKey];
    if (!selected) return;
    const mealTerms = MEAL_CATEGORY_MAP[selected] || [selected];
    terms.push(...mealTerms);
  });

  return terms.length > 0 ? terms : ["맛집", "카페"];
}

function buildSearchQueries(condition, schedule) {
  const center = resolveScheduleCenter(schedule);
  const activityTerms = getActivitySearchTerms(condition);
  const mealTerms = getMealSearchTerms(condition?.mealPreferences || {});
  const regionKeyword = normalizeText(condition?.preferredRegion || schedule?.location || schedule?.locationaddress || "");
  const queries = [];

  if (center?.lat != null && center?.lng != null) {
    activityTerms.forEach((term) => queries.push({ type: "keyword", value: term, lat: center.lat, lng: center.lng }));
    mealTerms.forEach((term) => queries.push({ type: "keyword", value: term, lat: center.lat, lng: center.lng }));
  }

  if (regionKeyword) {
    queries.push({ type: "keyword", value: regionKeyword, lat: center?.lat ?? null, lng: center?.lng ?? null });
  }

  if (queries.length === 0) {
    queries.push({ type: "keyword", value: "맛집", lat: null, lng: null });
  }

  return queries;
}

async function gatherPlacePool(condition, schedule) {
  const queries = buildSearchQueries(condition, schedule);
  const collected = [];

  for (const query of queries) {
    try {
      const rawResults = query.lat != null && query.lng != null
        ? await searchNearbyPlaces({
            lat: query.lat,
            lng: query.lng,
            category: query.value,
            radius: 1200,
          })
        : await searchPlacesByKeyword({
            lat: 37.5665,
            lng: 126.9780,
            keyword: query.value,
            radius: 12000,
          });

      (rawResults || []).forEach((place) => {
        collected.push({
          id: place.id || `${place.name}-${place.address}`,
          name: place.name || "이름 없음",
          address: place.address || "주소 정보 없음",
          lat: toNumber(place.lat ?? place.latitude, null),
          lng: toNumber(place.lng ?? place.longitude, null),
          category: place.category || query.value || "general",
          placeSource: "kakao",
          imageUrl: place.imageUrl || null,
          rating: toNumber(place.rating, null),
          price: toNumber(place.price, null),
          sourceQuery: query.value,
        });
      });
    } catch (error) {
      console.warn("추천 장소 검색 실패:", query, error);
    }
  }

  return dedupePlaces(collected).filter((place) => place.lat != null && place.lng != null);
}

function hoursToMinutes(value) {
  if (!value) return 0;
  const [hours, minutes] = String(value).split(":").map(Number);
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

function formatTimeFromMinutes(totalMinutes) {
  const mins = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildDistanceEstimate(origin, destination) {
  const earthRadiusKm = 6371;
  const dLat = ((destination.lat - origin.lat) * Math.PI) / 180;
  const dLng = ((destination.lng - origin.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((origin.lat * Math.PI) / 180) * Math.cos((destination.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = earthRadiusKm * c;
  return distanceKm * 1000;
}

function estimateTravelMinutes(origin, destination, mode) {
  if (!origin || !destination) return null;
  const distanceMeters = buildDistanceEstimate(origin, destination);

  if (mode === "walking") return Math.max(5, Math.round(distanceMeters / 80));
  if (mode === "transit") return Math.max(8, Math.round(distanceMeters / 180));
  if (mode === "car") return Math.max(3, Math.round(distanceMeters / 500));
  return null;
}

function scorePlace(place, condition) {
  let score = 100;

  const minRating = toNumber(condition?.minRating, 0);
  if (place.rating != null && place.rating < minRating) {
    score -= 30;
  }

  const budget = toNumber(condition?.budget, null);
  if (budget != null && place.price != null && place.price > budget) {
    score -= 25;
  }

  const priority = condition?.priority || "travel";
  if (priority === "budget") {
    if (place.price != null) score -= place.price / 300;
  }
  if (priority === "rating") {
    if (place.rating != null) score += place.rating * 8;
  }
  if (priority === "variety") {
    score += 6;
  }
  if (priority === "travel") {
    score += 4;
  }

  return score;
}

function buildCourseName(index) {
  const names = ["도심 산책 루트", "맛집 중심 데이트", "활동 가득 하루", "감성 카페 루트", "지역 맛집 탐방"];
  return names[index % names.length] || `추천 코스 ${index + 1}`;
}

export async function generateCourseRecommendations({ condition, schedule }) {
  if (!condition || !schedule) {
    return {
      courses: [],
      warning: "추천에 필요한 일정 또는 조건 정보가 없습니다.",
    };
  }

  const center = resolveScheduleCenter(schedule);
  const floorCondition = {
    mealPreferences: condition?.mealPreferences || {},
    activities: Array.isArray(condition?.activities) ? condition.activities : [],
    travelMode: condition?.travelMode || "transit",
    maxTravelMinutes: toNumber(condition?.maxTravelMinutes, 45),
    budget: toNumber(condition?.budget, null),
    minRating: toNumber(condition?.minRating, 0),
    priority: condition?.priority || "travel",
    preferredRegion: condition?.preferredRegion || schedule?.location || "",
  };

  const placePool = await gatherPlacePool(floorCondition, schedule);
  if (!placePool.length) {
    return {
      courses: [],
      warning: "현재 조건으로는 추천 가능한 장소를 찾지 못했습니다. 지역 또는 활동 조건을 조정해 주세요.",
    };
  }

  const scoredPlaces = placePool
    .map((place) => ({ ...place, score: scorePlace(place, floorCondition) }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const mealOptions = ["breakfast", "lunch", "dinner"].filter((meal) => !!floorCondition.mealPreferences?.[meal]);
  const activities = floorCondition.activities.length > 0 ? floorCondition.activities : ["experience", "cafe", "walk"];

  const chosenCourses = [];
  const baseStopCount = Math.max(3, 2 + mealOptions.length + Math.min(2, activities.length));

  for (let index = 0; index < 5; index += 1) {
    const selectedStops = [];
    const usedIds = new Set();

    const candidatePool = scoredPlaces.filter((place) => !usedIds.has(place.id));
    if (!candidatePool.length) break;

    const mealSelection = mealOptions.length > 0 ? mealOptions : ["lunch"];
    mealSelection.forEach((mealKey, mealIndex) => {
      const pick = candidatePool.find((place) => !usedIds.has(place.id));
      if (!pick) return;
      usedIds.add(pick.id);
      selectedStops.push({
        order: selectedStops.length + 1,
        mealKey,
        ...pick,
        stayMinutes: mealtimeMinutes(mealKey),
      });
    });

    for (let i = 0; i < Math.max(0, baseStopCount - selectedStops.length); i += 1) {
      const pick = candidatePool.find((place) => !usedIds.has(place.id));
      if (!pick) break;
      usedIds.add(pick.id);
      selectedStops.push({
        order: selectedStops.length + 1,
        mealKey: null,
        ...pick,
        stayMinutes: 60,
      });
    }

    if (selectedStops.length === 0) break;

    const orderedStops = selectedStops.map((stop, idx) => {
      const prev = idx === 0 ? null : selectedStops[idx - 1];
      const travelMinutes = prev ? estimateTravelMinutes({ lat: prev.lat, lng: prev.lng }, { lat: stop.lat, lng: stop.lng }, floorCondition.travelMode) : 0;
      const startMinutes = idx === 0
        ? hoursToMinutes(schedule?.starttime || DEFAULT_DAY_RANGE.startTime)
        : hoursToMinutes(selectedStops[idx - 1].visitEndTime || DEFAULT_DAY_RANGE.startTime) + (travelMinutes || 0);

      const startTime = formatTimeFromMinutes(startMinutes);
      const endMinutes = startMinutes + (stop.stayMinutes || 60);
      const endTime = formatTimeFromMinutes(endMinutes);

      return {
        ...stop,
        order: idx + 1,
        visitStartTime: startTime,
        visitEndTime: endTime,
        expectedStayMin: stop.stayMinutes || 60,
        travelTimeFromPrevMin: prev ? travelMinutes : 0,
        distanceFromPrevM: prev ? Math.round(buildDistanceEstimate({ lat: prev.lat, lng: prev.lng }, { lat: stop.lat, lng: stop.lng })) : 0,
      };
    });

    const totalTravelMinutes = orderedStops.reduce((sum, stop, idx) => sum + (idx === 0 ? 0 : stop.travelTimeFromPrevMin || 0), 0);
    const totalMinutes = orderedStops.reduce((sum, stop) => sum + (stop.expectedStayMin || 0), 0) + totalTravelMinutes;
    const estimatedCost = orderedStops.reduce((sum, stop) => sum + (toNumber(stop.price, 0) || 0), 0);
    const hasMeal = orderedStops.some((stop) => stop.mealKey);
    const summary = [
      hasMeal ? "식사 포함" : "식사 선택 없음",
      `${floorCondition.travelMode} 기준`,
      floorCondition.priority === "budget" ? "예산 우선" : floorCondition.priority === "rating" ? "평점 우선" : "동선 중심",
    ].join(" · ");

    chosenCourses.push({
      id: `course-${index + 1}`,
      name: buildCourseName(index),
      summary,
      totalDurationMin: totalMinutes,
      estimatedTravelTimeMin: totalTravelMinutes,
      estimatedCostPerPerson: estimatedCost,
      stopCount: orderedStops.length,
      stops: orderedStops.map((stop) => ({
        id: stop.id,
        order: stop.order,
        placeName: stop.name,
        placeAddress: stop.address,
        category: stop.category,
        latitude: stop.lat,
        longitude: stop.lng,
        placeSource: stop.placeSource,
        imageUrl: stop.imageUrl || null,
        rating: stop.rating ?? null,
        estimatedCost: stop.price ?? null,
        visitStartTime: stop.visitStartTime,
        visitEndTime: stop.visitEndTime,
        expectedStayMin: stop.expectedStayMin,
        travelTimeFromPrevMin: stop.travelTimeFromPrevMin,
        distanceFromPrevM: stop.distanceFromPrevM,
      })),
    });
  }

  const validCourses = chosenCourses.filter((course) => course.stops.length > 0);

  return {
    courses: validCourses.slice(0, 5),
    center,
    condition: floorCondition,
    source: "kakao",
    warning: validCourses.length > 0 ? null : "조건에 맞는 코스를 1개 이상 생성하지 못했습니다.",
  };
}

function mealtimeMinutes(mealKey) {
  if (mealKey === "breakfast") return 45;
  if (mealKey === "lunch") return 60;
  if (mealKey === "dinner") return 75;
  return 50;
}
