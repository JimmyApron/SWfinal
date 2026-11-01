import { estimateStopBudget, summarizeCourseBudget } from "./courseBudgetUtils";
import { searchPlacesByKeyword } from "../api/kakaoPlacesApi";
import { attachGoogleRatings } from "../api/googlePlacesApi";
import { createRecommendationDiagnostics, safeQueryType } from "./courseRecommendationDiagnostics";
import { validRecommendationCenter, validRecommendationRadius } from "./recommendationAreaUtils";
import { MEAL_WINDOWS, MIN_MEAL_GAP_MINUTES, mealTimeError } from "./mealTimeUtils";
import { ACTIVITY_SEARCH_TERMS, ACTIVITY_MATCH, PLAY_OPTIONS, matchesActivity, activityDescription } from './courseActivityOptions';
import { getBarMode, resolveCourseMeals, barTimeError } from './courseBarUtils';

const ACTIVITY_CATEGORY_MAP = ACTIVITY_SEARCH_TERMS;

const MEAL_CATEGORY_MAP = {
  korean: ["한식", "korean"],
  western: ["양식", "western", "pasta", "steak"],
  japanese: ["일식", "japanese", "sushi", "ramen"],
  chinese: ["중식", "chinese", "dimsum"],
  snack: ["분식", "snack", "tteokbokki", "kimbap"],
  any: ["restaurant", "food"],
  bar: ['술집'],
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
    return Object.values(condition?.mealPreferences || {}).some(Boolean) ? [] : ['방탈출', '볼링장', '공방', '박물관', '공원'];
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

  return terms;
}

function buildSearchQueries(condition, schedule) {
  const center = resolveScheduleCenter(schedule, condition);
  const localized = { activity: "체험", travel: "놀거리", museum: "박물관", culture: "전시", cafe: "카페", park: "공원", nature: "산책", bar: "술집", restaurant: "음식점", food: "맛집", korean: "한식", western: "양식", japanese: "일식", chinese: "중식", snack: "분식", pasta: "파스타", steak: "스테이크", sushi: "초밥", ramen: "라멘", dimsum: "딤섬", tteokbokki: "떡볶이", kimbap: "김밥" };
  const activityTerms = [...new Set(getActivitySearchTerms(condition).map(term => localized[term] || term))];
  const mealTerms = [...new Set(getMealSearchTerms(condition?.mealPreferences || {}).map(term => localized[term] || term))];
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
    queries.push({ type: "keyword", value: "공원", lat: center?.lat ?? null, lng: center?.lng ?? null });
  }

  return queries.filter((query, index) => queries.findIndex(other => other.value === query.value) === index);
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
          price: place.priceSource ? toNumber(place.price, null) : null,
          priceSource: place.priceSource || null,
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
  const rated = await attachGoogleRatings(scoped);
  return rated.map((place) => ({ ...place, rating: toNumber(place.rating, null) }));
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
    const range = estimateStopBudget(place);
    score -= (range.max ?? 100000) / 300;
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

function buildCourseName(stops) {
  const themes = [];
  if (stops.some(stop => stop.mealKey || mealMatches(stop, 'any'))) themes.push('맛집');
  const labels = { ...Object.fromEntries(PLAY_OPTIONS.map(option => [option.value, option.label])), experience: '체험', culture: '문화·전시', cafe: '카페', walk: '산책', bar: '주점' };
  Object.keys(ACTIVITY_MATCH).forEach(key => {
    if (key === 'experience' && stops.some(stop => ['escape', 'bowling', 'boardgame', 'workshop'].some(type => matchesActivity(stop, type)))) return;
    if (stops.some(stop => matchesActivity(stop, key))) themes.push(labels[key]);
  });
  return `${stops[0].name} · ${themes.length ? themes.join(' + ') : '지역 탐방'} 코스`;
}

function matchesPlace(place, tokens) {
  const text = String(place.category || place.name || '').toLowerCase();
  return tokens.some((token) => text.includes(token));
}
function mealMatches(place, preference) {
  if (preference === 'bar') return matchesActivity(place, 'bar');
  if (/카페|커피|술집|주점|cafe|bar/i.test(place.category || '')) return false;
  return matchesPlace(place, preference === "any"
    ? ["restaurant", "food", "음식", "식당", "한식", "양식", "일식", "중식", "분식"]
    : MEAL_CATEGORY_MAP[preference] || [String(preference).toLowerCase()]);
}

// Combination identity deliberately ignores visit order: shuffling the same places
// does not constitute an additional recommendation.
export function courseCombinationKey(stops) {
  return JSON.stringify(stops.map(placeIdentity).sort());
}

function placeIdentity(stop) {
  return `${stop.placeSource || stop.place_source || "kakao"}:${stop.id ?? stop.place_id ?? `${stop.placeName || stop.name}:${stop.placeAddress || stop.address}`}`;
}

export function courseOverlapCount(first, second) {
  const identities = new Set(first.map(placeIdentity));
  return new Set(second.map(placeIdentity).filter(id => identities.has(id))).size;
}

function selectCourseCandidates(scoredPlaces, condition, schedule, diagnostic, targetLimit = Infinity) {
  const filter = diagnostic.stats.filter;
  const combination = diagnostic.stats.combination;
  const meals = ["breakfast", "lunch", "dinner"].filter((key) => condition.mealPreferences[key]);
  const activities = [...new Set(condition.activities)];
  const slots = [
    ...meals.map((key) => ({ mealKey: key, matches: (place) => mealMatches(place, condition.mealPreferences[key]) })),
    ...activities.map((key) => ({ mealKey: null, activityKey: key, afterDinner: key === 'bar', matches: (place) => matchesActivity(place, key) })),
  ];
  const pool = scoredPlaces.filter((place) => {
    filter.missingRating += Number(place.rating == null);
    filter.missingPrice += Number(place.price == null);
    if (condition.minRating > 0 && (place.rating == null || place.rating < condition.minRating)) { filter.ratingExcluded += 1; return false; }
    if (place.price != null && (place.price < 0 || (condition.budget != null && place.price > condition.budget))) { filter.priceExcluded += 1; return false; }
    return true;
  });
  const requiredSlots = [...slots];
  const allowed = (place) => requiredSlots.length ? requiredSlots.some((slot) => slot.matches(place))
    : ['experience', 'culture', 'walk'].some(type => matchesActivity(place, type));
  const candidates = pool.filter(allowed);
  const paddingActivities = activities.filter(key => key !== 'bar');
  const desiredCount = paddingActivities.length ? Math.max(3, slots.length, meals.length * 2 - 1 + (condition.barMode === 'afterDinner' ? 1 : 0))
    : slots.length ? slots.length : 3;
  const targetCount = Math.min(candidates.length, desiredCount, targetLimit);
  filter.requiredSlots = slots.length;
  filter.targetSlots = targetCount;
  filter.candidates = candidates.length;
  filter.categoryExcluded = pool.length - candidates.length;
  filter.mealMatches = candidates.filter(place => requiredSlots.some(slot => slot.mealKey && slot.matches(place))).length;
  filter.activityMatches = candidates.filter(place => requiredSlots.some(slot => !slot.mealKey && slot.matches(place))).length;
  filter.slotMatches = requiredSlots.map((slot, index) => ({ index: index + 1, type: slot.mealKey || 'activity',
    matchesBeforeNumericFilters: scoredPlaces.filter(slot.matches).length,
    matches: candidates.filter(slot.matches).length }));
  const start = hoursToMinutes(schedule.starttime || DEFAULT_DAY_RANGE.startTime);
  const end = hoursToMinutes(schedule.endtime || DEFAULT_DAY_RANGE.endTime);
  filter.availableMinutes = Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
  filter.minimumStayMinutes = requiredSlots.reduce((sum, slot) => sum + (slot.mealKey ? mealtimeMinutes(slot.mealKey) : 60), 0)
    + Math.max(0, targetCount - requiredSlots.length) * 60;
  filter.invalidTimeRange = !Number.isFinite(start) || !Number.isFinite(end) || end <= start;
  if (filter.slotMatches.some(slot => slot.matches === 0)) {
    combination.slotMismatchExcluded += candidates.length;
    return [];
  }
  if (!targetCount || slots.length > targetCount) return [];
  const extraActivityMatches = place => paddingActivities.length ? paddingActivities.some(key => matchesActivity(place, key)) : allowed(place);
  while (slots.length < targetCount) slots.push({ mealKey: null, matches: extraActivityMatches });
  const result = [];
  const seen = new Set();
  let attempts = 0;
  let recommendationTarget = 1;
  if (filter.invalidTimeRange) return [];
  const mealStart = (key, arrival, stops) => {
    const window = MEAL_WINDOWS[key];
    const lastMeal = [...stops].reverse().find(stop => stop.mealKey);
    const previousMealEnd = lastMeal ? hoursToMinutes(lastMeal.visitEndTime) : null;
    const afterDinnerTime = key === 'dinner' && condition.barMode === 'afterDinner' ? 60 + condition.maxTravelMinutes : 0;
    return Math.max(arrival, window.start,
      Math.min(window.preferredStart, end - window.stay - afterDinnerTime, window.end - window.stay),
      previousMealEnd == null ? 0 : previousMealEnd + MIN_MEAL_GAP_MINUTES);
  };
  function visit(stops, used, clock, knownCost, remainingSlots) {
    combination.visits += 1;
    if (++attempts > 5000 || result.length >= recommendationTarget) { combination.searchLimitReached = attempts > 5000; return; }
    if (result.some(course => courseOverlapCount(course, stops) >= 2)) {
      combination.duplicateExcluded += 1;
      return;
    }
    if (!remainingSlots.length) {
      const signature = courseCombinationKey(stops);
      if (!seen.has(signature)) { seen.add(signature); result.push(stops); combination.accepted += 1; }
      else combination.duplicateExcluded += 1;
      return;
    }
    const mealIndex = remainingSlots.findIndex(slot => slot.mealKey);
    const dinnerFinished = stops.some(stop => stop.mealKey === 'dinner');
    const activityIndices = remainingSlots.map((slot, index) => slot.mealKey || (slot.afterDinner && (!dinnerFinished || remainingSlots.some(other => other !== slot && !other.afterDinner))) ? -1 : index).filter(index => index >= 0);
    const lastMealIndex = stops.reduce((last, stop, index) => stop.mealKey ? index : last, -1);
    const hasActivitySinceMeal = stops.slice(lastMealIndex + 1).some(stop => !stop.mealKey);
    const mealsLeft = remainingSlots.filter(slot => slot.mealKey).length;
    const reserveForLaterGaps = Math.max(0, mealsLeft - 1);
    const nextMealStart = mealIndex >= 0 ? mealStart(remainingSlots[mealIndex].mealKey, clock, stops) : Infinity;
    // Use a gap before the next meal, while reserving activities for later gaps.
    const activityFirst = clock + 60 <= nextMealStart &&
      (!hasActivitySinceMeal || activityIndices.length > reserveForLaterGaps);
    const nextIndices = activityFirst ? [...activityIndices, mealIndex] : [mealIndex, ...activityIndices];
    for (const slotIndex of nextIndices.filter(index => index >= 0)) {
    const slot = remainingSlots[slotIndex];
    const previous = stops[stops.length - 1];
    const usage = (place) => result.reduce((count, course) => count + Number(course.some(stop => placeIdentity(stop) === placeIdentity(place))), 0);
    const ranked = candidates.filter((place) => {
      if (used.has(place.id)) { combination.usedExcluded += 1; return false; }
      if (!slot.matches(place)) { combination.slotMismatchExcluded += 1; return false; }
      return true;
    }).map((place) => ({ place,
      travel: previous ? estimateTravelMinutes(previous, place, condition.travelMode) : 0,
      novelty: usage(place),
      startUsage: stops.length ? 0 : result.filter(course => placeIdentity(course[0]) === placeIdentity(place)).length,
    })).sort((a, b) =>
      a.startUsage - b.startUsage || a.novelty - b.novelty ||
      (condition.priority === "budget" ? (estimateStopBudget(a.place, slot.mealKey).max ?? 100000) - (estimateStopBudget(b.place, slot.mealKey).max ?? 100000) : 0) ||
      (condition.priority === "travel" ? a.travel - b.travel : 0) ||
      b.place.score - a.place.score);
    for (const { place, travel } of ranked) {
      const stay = slot.mealKey ? mealtimeMinutes(slot.mealKey) : 60;
      const mealWindow = MEAL_WINDOWS[slot.mealKey];
      const visitStart = mealWindow ? mealStart(slot.mealKey, clock + travel, stops) : clock + travel;
      if (travel == null) { combination.invalidTravelExcluded += 1; continue; }
      if (travel > condition.maxTravelMinutes) { combination.travelLimitExcluded += 1; continue; }
      if (visitStart + stay > end || (mealWindow && visitStart + stay > mealWindow.end)) { combination.timeLimitExcluded += 1; continue; }
      const isDinnerBar = slot.mealKey === 'dinner' && condition.mealPreferences.dinner === 'bar';
      const budgetEstimate = estimateStopBudget(place, isDinnerBar ? 'bar' : slot.mealKey);
      const cost = knownCost + (budgetEstimate.max ?? 0);
      // A spending limit must cover the upper estimate for the whole course.
      // Unknown costs cannot establish that a course fits, especially at zero.
      if (condition.budget != null && (budgetEstimate.max == null || cost > condition.budget)) { combination.totalBudgetExcluded += 1; continue; }
      const next = { ...place, budgetEstimate, order: stops.length + 1, mealKey: slot.mealKey,
        activityKey: isDinnerBar || slot.activityKey === 'bar' ? 'bar' : slot.activityKey || null,
        activityDescription: isDinnerBar ? '저녁 식사 겸 한잔' : slot.activityKey === 'bar' ? '저녁 먹고 2차' : slot.mealKey ? `${MEAL_WINDOWS[slot.mealKey].label} 식사하기` : activityDescription(place, slot.activityKey),
        visitStartTime: formatTimeFromMinutes(visitStart), visitEndTime: formatTimeFromMinutes(visitStart + stay),
        waitingTimeMin: visitStart - clock - travel,
        expectedStayMin: stay, travelTimeFromPrevMin: travel,
        distanceFromPrevM: previous ? Math.round(buildDistanceEstimate(previous, place)) : 0 };
      visit([...stops, next], new Set([...used, place.id]), visitStart + stay, cost, remainingSlots.filter((_, index) => index !== slotIndex));
      if (result.length >= recommendationTarget || attempts > 5000) break;
    }
    if (result.length >= recommendationTarget || attempts > 5000) break;
    }
  }
  // Build one course per search, then rank all starting places again using
  // the accepted courses. Continuing one branch would keep its first stop fixed.
  for (let index = 0; index < 5 && attempts <= 5000; index += 1) {
    const previousCount = result.length;
    recommendationTarget = previousCount + 1;
    visit([], new Set(), start, 0, slots);
    if (result.length === previousCount) break;
  }
  combination.searchLimitReached = attempts > 5000;
  // Extra visits are optional. Keep all requested meals/activities, but try a
  // shorter course when padding to three visits cannot fit the schedule.
  if (!result.length && !combination.searchLimitReached && (combination.timeLimitExcluded > 0 || combination.totalBudgetExcluded > 0) &&
      targetCount > Math.max(1, requiredSlots.length) &&
      requiredSlots.reduce((sum, slot) => sum + (slot.mealKey ? mealtimeMinutes(slot.mealKey) : 60), 0) <= end - start) {
    return selectCourseCandidates(scoredPlaces, condition, schedule, diagnostic,
      combination.totalBudgetExcluded > 0 ? targetCount - 1 : Math.max(1, requiredSlots.length));
  }
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
  const barMode = getBarMode(condition);
  const effectiveMeals = resolveCourseMeals(condition);
  const barError = barTimeError(condition, schedule);
  if (barError) { diagnostic.finish('invalid_bar_time'); return { courses: [], warning: barError }; }
  if (toNumber(condition.budget, null) === 0 && Object.values(effectiveMeals).some(Boolean)) {
    diagnostic.finish('invalid_budget');
    return { courses: [], warning: '1인당 예산이 0원이라 식사가 포함된 코스를 추천할 수 없어요. 예산을 늘리거나 식사 선택을 해제해 주세요.' };
  }
  for (const key of ['breakfast', 'lunch', 'dinner']) {
    const error = effectiveMeals[key] ? mealTimeError(key, schedule) : '';
    if (error) { diagnostic.finish('invalid_meal_time'); return { courses: [], warning: error }; }
  }
  const floorCondition = {
    mealPreferences: effectiveMeals,
    activities: (Array.isArray(condition?.activities) ? condition.activities : []).filter(key => barMode !== 'dinner' || key !== 'bar'),
    barMode,
    travelMode: condition?.travelMode || "transit",
    maxTravelMinutes: toNumber(condition?.maxTravelMinutes, 45),
    budget: toNumber(condition?.budget, null),
    minRating: toNumber(condition?.minRating, 0),
    priority: condition?.priority || "rating",
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
      warning: search.failed ? "장소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요." : search.coordinateExcluded ? "검색 장소의 좌표를 확인할 수 없습니다." : search.areaExcluded ? "선택한 추천 구역 안에 장소가 없습니다. 반경을 조정해 주세요." : "선택한 구역에서 장소 검색 결과가 없습니다. 지역 또는 활동 조건을 조정해 주세요.",
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
    const travelLabel = { walking: '걸어서 이동', walk: '걸어서 이동', transit: '대중교통으로 이동', car: '자동차로 이동' }[floorCondition.travelMode] || '이동 수단 미정';
    const priorityLabel = { budget: '예산을 먼저 고려했어요', rating: '평점 높은 장소 위주예요', travel: '이동이 편한 코스예요', variety: '다양한 활동을 담았어요' }[floorCondition.priority] || '이동이 편한 코스예요';
    const summary = [
      hasMeal ? "식사가 포함돼 있어요" : "식사 없이 즐기는 코스예요",
      travelLabel,
      priorityLabel,
      ...(barMode ? [barMode === 'dinner' ? '저녁 식사 겸 한잔' : '저녁 먹고 2차'] : []),
    ].join(" · ");

    chosenCourses.push({
      id: `course-${index + 1}`,
      name: buildCourseName(orderedStops),
      summary,
      travelMode: floorCondition.travelMode,
      priority: floorCondition.priority,
      barMode,
      totalDurationMin: totalMinutes,
      estimatedTravelTimeMin: totalTravelMinutes,
      estimatedCostPerPerson: estimatedCost,
      budgetEstimate: summarizeCourseBudget(orderedStops, floorCondition.budget),
      stopCount: orderedStops.length,
      stops: orderedStops.map((stop) => ({
        id: stop.id,
        mealKey: stop.mealKey,
        order: stop.order,
        placeName: stop.name,
        placeAddress: stop.address,
        category: stop.category,
        activityDescription: stop.activityDescription,
        activityKey: stop.activityKey,
        latitude: stop.lat,
        longitude: stop.lng,
        placeSource: stop.placeSource,
        imageUrl: stop.imageUrl || null,
        rating: stop.rating ?? null,
        estimatedCost: stop.price ?? null,
        priceSource: stop.priceSource,
        budgetEstimate: stop.budgetEstimate,
        visitStartTime: stop.visitStartTime,
        visitEndTime: stop.visitEndTime,
        waitingTimeMin: stop.waitingTimeMin,
        expectedStayMin: stop.expectedStayMin,
        travelTimeFromPrevMin: stop.travelTimeFromPrevMin,
        distanceFromPrevM: stop.distanceFromPrevM,
      })),
    });
  }

  const validCourses = chosenCourses.filter((course) => course.stops.length > 0);
  const budgetRank = { within: 0, not_set: 0, uncertain: 1, over: 2 };
  validCourses.sort((a, b) => budgetRank[a.budgetEstimate.status] - budgetRank[b.budgetEstimate.status] || (floorCondition.priority === "budget" ? (a.budgetEstimate.max ?? Infinity) - (b.budgetEstimate.max ?? Infinity) : 0));
  if (floorCondition.priority === "rating") {
    const averageRating = (course) => course.stops.reduce((sum, stop) => sum + (stop.rating ?? 0), 0) / course.stops.length;
    validCourses.sort((a, b) => averageRating(b) - averageRating(a));
  }
  diagnostic.finish(validCourses.length ? 'success' : 'no_combination');

  return {
    courses: validCourses.slice(0, 5).map((course, index) => ({ ...course, name: `${index + 1}. ${course.name}` })),
    center,
    condition: floorCondition,
    source: "kakao",
    warning: !validCourses.length ? recommendationFailureReason(diagnostic.stats)
      : validCourses.some((course) => course.stops.some((stop) =>
          (floorCondition.minRating > 0 && stop.rating == null) || (floorCondition.budget != null && stop.estimatedCost == null)))
        ? "일부 장소의 비용 정보 또는 추정 범위로 조건 충족 여부를 확인할 수 없습니다." : null,
  };
}

function recommendationFailureReason({ filter, combination }) {
  if (filter.invalidTimeRange) return '일정 시작·종료 시간을 확인해 주세요.';
  if (filter.priceExcluded || combination.totalBudgetExcluded) return '설정한 예산 안에서 선택한 식사·활동을 포함하는 코스를 찾지 못했어요. 예산을 늘리거나 식사·활동 조건을 바꿔 주세요. 비용을 확인할 수 없는 장소도 예산 제한이 있으면 제외해요.';
  if (filter.ratingExcluded && !filter.candidates) return '선택한 평점 기준에 맞는 장소가 부족합니다. 최소 평점을 낮추거나 추천 반경을 넓혀 주세요.';
  if (filter.slotMatches.some(slot => !slot.matches)) return '선택한 식사·활동 유형에 맞는 장소가 부족합니다.';
  if (combination.searchLimitReached) return '현재 탐색 범위에서 코스를 구성하지 못했습니다. 활동 또는 시간 조건을 조정해 주세요.';
  if (combination.timeLimitExcluded && filter.slotMatches.filter(slot => ['breakfast', 'lunch', 'dinner'].includes(slot.type)).length > 1) return '식사 사이에 최소 3시간의 간격과 활동 시간을 두기에는 일정이 짧아요. 일정 시간을 늘리거나 먹을 끼니를 줄여 주세요.';
  if (combination.timeLimitExcluded && combination.travelLimitExcluded) return '일정 시간과 이동 제한에 맞는 코스를 찾지 못했습니다. 시간 또는 이동 조건을 조정해 주세요.';
  if (combination.timeLimitExcluded) return '선택한 시간에 방문할 수 있는 코스를 찾지 못했습니다. 시간 또는 활동 조건을 조정해 주세요.';
  if (combination.travelLimitExcluded) return '장소 간 이동 제한에 맞는 코스가 없습니다. 이동 시간 조건을 조정해 주세요.';
  if (combination.totalBudgetExcluded) return '확인된 비용이 설정 예산을 초과합니다. 예산 조건을 조정해 주세요.';
  return '현재 조건에 맞는 코스를 구성하지 못했습니다. 조건을 조정해 주세요.';
}

function mealtimeMinutes(mealKey) {
  return MEAL_WINDOWS[mealKey]?.stay ?? 60;
}
