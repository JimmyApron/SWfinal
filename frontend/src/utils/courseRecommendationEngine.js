import { searchPlacesByKeyword } from "../api/kakaoPlacesApi";
import { createRecommendationDiagnostics, safeQueryType } from "./courseRecommendationDiagnostics";
import { validRecommendationCenter, validRecommendationRadius } from "./recommendationAreaUtils";
import { MEAL_WINDOWS, mealTimeError } from "./mealTimeUtils";

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
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dedupePlaces(places) {
  const deduped = new Map();
  places.forEach((place) => {
    const key = place.id ? `${place.placeSource}:${place.id}` : `${place.name}::${place.address}`;
    if (!deduped.has(key)) {
      deduped.set(key, place);
    }
  });
  return Array.from(deduped.values());
}

function resolveScheduleCenter(schedule, condition = {}) {
  if (validRecommendationCenter(condition.searchCenter)) {
    return { lat: Number(condition.searchCenter.lat), lng: Number(condition.searchCenter.lng), source: "selected_area" };
  }
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
  const center = resolveScheduleCenter(schedule, condition);
  const activityTerms = getActivitySearchTerms(condition);
  const mealTerms = getMealSearchTerms(condition?.mealPreferences || {});
  const regionKeyword = normalizeText(condition?.preferredRegion || schedule?.location || schedule?.locationaddress || "");
  const queries = [];

  if (center?.lat != null && center?.lng != null) {
    activityTerms.forEach((term) => queries.push({ type: "keyword", value: term, lat: center.lat, lng: center.lng }));
    mealTerms.forEach((term) => queries.push({ type: "keyword", value: term, lat: center.lat, lng: center.lng }));
  } else {
    // A region alone may not identify any business. Keep the requested place
    // types in the query even when the schedule has no coordinates.
    const localized = { activity: "체험", travel: "놀거리", museum: "박물관", culture: "전시", cafe: "카페",
      park: "공원", nature: "산책", bar: "술집", restaurant: "음식점", food: "맛집",
      korean: "한식", western: "양식", japanese: "일식", chinese: "중식", snack: "분식" };
    const terms = [...new Set([...activityTerms, ...mealTerms].map((term) => localized[term] || term))];
    terms.forEach((term) => queries.push({ type: "keyword", term,
      value: [regionKeyword, term].filter(Boolean).join(" "), lat: null, lng: null }));
  }

  if (regionKeyword) {
    queries.push({ type: "keyword", value: regionKeyword, lat: center?.lat ?? null, lng: center?.lng ?? null });
  }

  if (queries.length === 0) {
    queries.push({ type: "keyword", value: "맛집", lat: null, lng: null });
  }

  return queries;
}

async function gatherPlacePool(condition, schedule, diagnostic) {
  const queries = buildSearchQueries(condition, schedule);
  const collected = [];
  const stats = diagnostic.stats.search;
  const selectedCenter = validRecommendationCenter(condition.searchCenter) ? condition.searchCenter : null;
  const radius = condition.searchRadiusMeters ?? 1200;
  stats.planned = queries.length;
  diagnostic.start();

  for (const query of queries) {
    const request = { index: stats.requests.length + 1, type: safeQueryType(query.term || query.value),
      usesFallbackCenter: false, hasLocationBias: query.lat != null, radiusMeters: query.lat != null ? radius : null,
      sdkStatus: 'unobserved', httpStatus: null, httpStatusAvailable: false, resultCount: 0 };
    stats.requests.push(request);
    try {
      // These are keyword terms, not Kakao category codes. Category search silently
      // mapped unknown terms (including cafe/walk/Korean meal terms) to restaurants.
      const rawResults = await searchPlacesByKeyword({
        lat: query.lat, lng: query.lng,
        keyword: query.value, radius: query.lat != null ? radius : 12000,
        onDiagnostic: (event) => {
          request.sdkStatus = ['OK', 'ZERO_RESULT', 'ERROR'].includes(event.sdkStatus) ? event.sdkStatus : 'unobserved';
        },
      });
      request.outcome = rawResults?.length ? 'success' : 'empty';
      request.resultCount = rawResults?.length || 0;
      stats.succeeded += 1;
      stats.empty += Number(!rawResults?.length);
      stats.rawCount += request.resultCount;

      (rawResults || []).forEach((place) => {
        collected.push({
          id: place.id || `${place.name}-${place.address}`,
          name: place.name || "이름 없음",
          address: place.address || "주소 정보 없음",
          lat: toNumber(place.lat ?? place.latitude, null),
          lng: toNumber(place.lng ?? place.longitude, null),
          category: place.category || "",
          placeSource: "kakao",
          imageUrl: place.imageUrl || null,
          rating: toNumber(place.rating, null),
          price: toNumber(place.price, null),
          sourceQuery: query.value,
        });
      });
    } catch (error) {
      // Do not print the query (may contain an address) or arbitrary SDK errors.
      stats.failed += 1;
      request.outcome = 'failure';
      request.failureStage = ['sdk_load', 'sdk_callback'].includes(error?.searchStage) ? error.searchStage : 'sdk_request';
    } finally {
      diagnostic.searchFinished(request);
    }
  }

  const unique = dedupePlaces(collected);
  const valid = unique.filter((place) => place.lat != null && place.lng != null &&
    Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180);
  stats.uniqueCount = unique.length;
  stats.duplicateExcluded = collected.length - unique.length;
  stats.coordinateExcluded = unique.length - valid.length;
  stats.coordinateValid = valid.length;
  const scoped = selectedCenter ? valid.filter((place) => buildDistanceEstimate(
    { lat: Number(selectedCenter.lat), lng: Number(selectedCenter.lng) }, place) <= radius) : valid;
  stats.areaExcluded = valid.length - scoped.length;
  stats.areaValid = scoped.length;
  return scoped;
}

function hoursToMinutes(value) {
  if (!value || !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(String(value))) return NaN;
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60 ? hours * 60 + minutes : NaN;
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

  if (mode === "walking" || mode === "walk") return Math.max(5, Math.round(distanceMeters / 80));
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

const ACTIVITY_MATCH = {
  experience: ["activity", "travel", "체험", "테마", "관광"],
  culture: ["museum", "culture", "박물관", "미술관", "문화", "전시"],
  cafe: ["cafe", "카페", "커피"], walk: ["park", "nature", "공원", "산책", "자연"],
  bar: ["bar", "술집", "주점", "맥주"],
};
function matchesPlace(place, tokens) {
  const text = `${place.category} ${place.name}`.toLowerCase();
  return tokens.some((token) => text.includes(token));
}
function mealMatches(place, preference) {
  return matchesPlace(place, preference === "any"
    ? ["restaurant", "food", "음식", "식당", "한식", "양식", "일식", "중식", "분식"]
    : MEAL_CATEGORY_MAP[preference] || [String(preference).toLowerCase()]);
}

// Combination identity deliberately ignores visit order: shuffling the same places
// does not constitute an additional recommendation.
export function courseCombinationKey(stops) {
  return JSON.stringify(stops.map((stop) => `${stop.placeSource || stop.place_source || "kakao"}:${stop.id ?? stop.place_id ?? `${stop.placeName}:${stop.placeAddress}`}`).sort());
}

function selectCourseCandidates(scoredPlaces, condition, schedule, diagnostic) {
  const filter = diagnostic.stats.filter;
  const combination = diagnostic.stats.combination;
  const meals = ["breakfast", "lunch", "dinner"].filter((key) => condition.mealPreferences[key]);
  const activities = [...new Set(condition.activities)];
  const slots = [
    ...meals.map((key) => ({ mealKey: key, matches: (place) => mealMatches(place, condition.mealPreferences[key]) })),
    ...activities.map((key) => ({ mealKey: null, matches: (place) => matchesPlace(place, ACTIVITY_MATCH[key] || [key]) })),
  ];
  const pool = scoredPlaces.filter((place) => {
    filter.missingRating += Number(place.rating == null);
    filter.missingPrice += Number(place.price == null);
    if (place.rating != null && place.rating < condition.minRating) { filter.ratingExcluded += 1; return false; }
    if (place.price != null && (place.price < 0 || (condition.budget != null && place.price > condition.budget))) { filter.priceExcluded += 1; return false; }
    return true;
  });
  const requiredSlots = [...slots];
  const allowed = (place) => !requiredSlots.length || requiredSlots.some((slot) => slot.matches(place));
  const candidates = pool.filter(allowed);
  const targetCount = Math.min(candidates.length, Math.max(3, slots.length));
  filter.requiredSlots = slots.length;
  filter.targetSlots = targetCount;
  filter.candidates = candidates.length;
  filter.categoryExcluded = pool.length - candidates.length;
  filter.slotMatches = requiredSlots.map((slot, index) => ({ index: index + 1, type: slot.mealKey || 'activity',
    matchesBeforeNumericFilters: scoredPlaces.filter(slot.matches).length,
    matches: candidates.filter(slot.matches).length }));
  const start = hoursToMinutes(schedule.starttime || DEFAULT_DAY_RANGE.startTime);
  const end = hoursToMinutes(schedule.endtime || DEFAULT_DAY_RANGE.endTime);
  filter.availableMinutes = Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
  filter.minimumStayMinutes = requiredSlots.reduce((sum, slot) => sum + (slot.mealKey ? mealtimeMinutes(slot.mealKey) : 60), 0)
    + Math.max(0, targetCount - requiredSlots.length) * 60;
  filter.invalidTimeRange = !Number.isFinite(start) || !Number.isFinite(end) || end <= start;
  if (!targetCount || slots.length > targetCount) return [];
  while (slots.length < targetCount) slots.push({ mealKey: null, matches: allowed });
  const result = [];
  const seen = new Set();
  let attempts = 0;
  if (filter.invalidTimeRange) return [];
  function visit(stops, used, clock, knownCost) {
    combination.visits += 1;
    if (++attempts > 5000 || result.length >= 5) { combination.searchLimitReached = attempts > 5000; return; }
    if (stops.length === slots.length) {
      const signature = courseCombinationKey(stops);
      if (!seen.has(signature)) { seen.add(signature); result.push(stops); combination.accepted += 1; }
      else combination.duplicateExcluded += 1;
      return;
    }
    const slot = slots[stops.length];
    const previous = stops[stops.length - 1];
    const usage = (place) => result.reduce((count, course) => count + Number(course.some((stop) => stop.id === place.id)), 0);
    const ranked = candidates.filter((place) => {
      if (used.has(place.id)) { combination.usedExcluded += 1; return false; }
      if (!slot.matches(place)) { combination.slotMismatchExcluded += 1; return false; }
      return true;
    }).map((place) => ({ place,
      travel: previous ? estimateTravelMinutes(previous, place, condition.travelMode) : 0,
      novelty: usage(place),
    })).sort((a, b) => a.novelty - b.novelty ||
      (condition.priority === "travel" ? a.travel - b.travel : 0) || b.place.score - a.place.score);
    for (const { place, travel } of ranked) {
      const stay = slot.mealKey ? mealtimeMinutes(slot.mealKey) : 60;
      const mealWindow = MEAL_WINDOWS[slot.mealKey];
      const visitStart = mealWindow ? Math.max(clock + travel, mealWindow.start) : clock + travel;
      if (travel == null) { combination.invalidTravelExcluded += 1; continue; }
      if (travel > condition.maxTravelMinutes) { combination.travelLimitExcluded += 1; continue; }
      if (visitStart + stay > end || (mealWindow && visitStart + stay > mealWindow.end)) { combination.timeLimitExcluded += 1; continue; }
      const cost = knownCost + (place.price ?? 0);
      if (condition.budget != null && cost > condition.budget) { combination.totalBudgetExcluded += 1; continue; }
      const next = { ...place, order: stops.length + 1, mealKey: slot.mealKey,
        visitStartTime: formatTimeFromMinutes(visitStart), visitEndTime: formatTimeFromMinutes(visitStart + stay),
        waitingTimeMin: visitStart - clock - travel,
        expectedStayMin: stay, travelTimeFromPrevMin: travel,
        distanceFromPrevM: previous ? Math.round(buildDistanceEstimate(previous, place)) : 0 };
      visit([...stops, next], new Set([...used, place.id]), visitStart + stay, cost);
      if (result.length >= 5 || attempts > 5000) break;
    }
  }
  visit([], new Set(), start, 0);
  combination.searchLimitReached = attempts > 5000;
  return result;
}

export async function generateCourseRecommendations({ condition, schedule }) {
  const diagnostic = createRecommendationDiagnostics(condition);
  if (!condition || !schedule) {
    diagnostic.finish('missing_input');
    return {
      courses: [],
      warning: "추천에 필요한 일정 또는 조건 정보가 없습니다.",
    };
  }

  if ((condition.searchCenter != null && !validRecommendationCenter(condition.searchCenter)) ||
      (condition.searchRadiusMeters != null && !validRecommendationRadius(condition.searchRadiusMeters))) {
    diagnostic.finish('invalid_area');
    return { courses: [], warning: "추천 중심점과 반경을 다시 선택해 주세요." };
  }
  const center = resolveScheduleCenter(schedule, condition);
  for (const key of ['breakfast', 'lunch', 'dinner']) {
    const error = condition.mealPreferences?.[key] ? mealTimeError(key, schedule) : '';
    if (error) { diagnostic.finish('invalid_meal_time'); return { courses: [], warning: error }; }
  }
  const floorCondition = {
    mealPreferences: condition?.mealPreferences || {},
    activities: Array.isArray(condition?.activities) ? condition.activities : [],
    travelMode: condition?.travelMode || "transit",
    maxTravelMinutes: toNumber(condition?.maxTravelMinutes, 45),
    budget: toNumber(condition?.budget, null),
    minRating: toNumber(condition?.minRating, 0),
    priority: condition?.priority || "travel",
    preferredRegion: condition?.preferredRegion || schedule?.location || "",
    searchCenter: condition.searchCenter || null,
    searchRadiusMeters: condition.searchRadiusMeters ?? null,
  };

  const placePool = await gatherPlacePool(floorCondition, schedule, diagnostic);
  if (!placePool.length) {
    const search = diagnostic.stats.search;
    diagnostic.finish(search.failed === search.planned ? 'api_failure_all'
      : search.areaExcluded && search.coordinateValid ? 'area_empty'
      : search.uniqueCount ? 'coordinates_empty' : search.failed ? 'api_failure_partial_empty' : 'search_empty');
    return {
      courses: [],
      warning: "현재 조건으로는 추천 가능한 장소를 찾지 못했습니다. 지역 또는 활동 조건을 조정해 주세요.",
    };
  }

  const scoredPlaces = placePool
    .map((place) => ({ ...place, score: scorePlace(place, floorCondition) }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const chosenCourses = [];
  const combinations = selectCourseCandidates(scoredPlaces, floorCondition, schedule, diagnostic);
  for (const [index, orderedStops] of combinations.entries()) {

    const totalTravelMinutes = orderedStops.reduce((sum, stop, idx) => sum + (idx === 0 ? 0 : stop.travelTimeFromPrevMin || 0), 0);
    const totalMinutes = orderedStops.reduce((sum, stop) => sum + (stop.expectedStayMin || 0) + (stop.waitingTimeMin || 0), 0) + totalTravelMinutes;
    const estimatedCost = orderedStops.every((stop) => stop.price != null)
      ? orderedStops.reduce((sum, stop) => sum + stop.price, 0) : null;
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
        mealKey: stop.mealKey,
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
  diagnostic.finish(validCourses.length ? 'success' : 'no_combination');

  return {
    courses: validCourses.slice(0, 5),
    center,
    condition: floorCondition,
    source: "kakao",
    warning: !validCourses.length ? "조건과 일정 범위에 맞는 서로 다른 코스를 찾지 못했습니다. 장소·평점·비용 정보 또는 조건을 확인해 주세요."
      : validCourses.some((course) => course.stops.some((stop) =>
          (floorCondition.minRating > 0 && stop.rating == null) || (floorCondition.budget != null && stop.estimatedCost == null)))
        ? "일부 장소의 평점·비용 정보가 없어 최소 평점과 총예산 충족 여부를 확인할 수 없습니다." : null,
  };
}

function mealtimeMinutes(mealKey) {
  if (mealKey === "breakfast") return 45;
  if (mealKey === "lunch") return 60;
  if (mealKey === "dinner") return 75;
  return 50;
}
