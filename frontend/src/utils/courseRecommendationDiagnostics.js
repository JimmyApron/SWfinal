let sequence = 0;
const activities = new Set(['experience', 'culture', 'cafe', 'walk', 'bar']);
const meals = new Set(['korean', 'western', 'japanese', 'chinese', 'snack', 'any']);
const queryTypes = new Set(['activity', 'travel', 'museum', 'culture', 'cafe', 'park', 'nature', 'bar', 'restaurant', '한식', 'korean', '양식', 'western', 'pasta', 'steak', '일식', 'japanese', 'sushi', 'ramen', '중식', 'chinese', 'dimsum', '분식', 'snack', 'tteokbokki', 'kimbap', 'food', '카페', '산책', '맛집', '체험', '놀거리', '박물관', '전시', '공원', '술집', '음식점']);
export function safeQueryType(value) {
  return queryTypes.has(value) ? value : 'region_or_other';
}

// No raw conditions, locations, place IDs/names, response bodies or error objects.
// Nothing is stored in localStorage or added to the public result structure.
export function createRecommendationDiagnostics(condition = {}) {
  condition = condition || {};
  const stats = {
    run: ++sequence,
    request: {
      activities: (Array.isArray(condition.activities) ? condition.activities : []).map((type) => activities.has(type) ? type : 'unknown'),
      meals: ['breakfast', 'lunch', 'dinner'].filter((key) => condition.mealPreferences?.[key]).map((key) => ({ slot: key, preference: meals.has(condition.mealPreferences[key]) ? condition.mealPreferences[key] : 'unknown' })),
      travelMode: ['car', 'walking', 'walk', 'transit'].includes(condition.travelMode) ? condition.travelMode : 'unknown',
    },
    search: { planned: 0, succeeded: 0, failed: 0, empty: 0, requests: [], rawCount: 0,
      uniqueCount: 0, duplicateExcluded: 0, coordinateExcluded: 0, coordinateValid: 0, areaExcluded: 0, areaValid: 0 },
    filter: { ratingExcluded: 0, priceExcluded: 0, missingRating: 0, missingPrice: 0,
      categoryExcluded: 0, candidates: 0, requiredSlots: 0, targetSlots: 0, slotMatches: [],
      availableMinutes: null, minimumStayMinutes: null, invalidTimeRange: false },
    combination: { visits: 0, usedExcluded: 0, slotMismatchExcluded: 0, invalidTravelExcluded: 0,
      travelLimitExcluded: 0, timeLimitExcluded: 0, totalBudgetExcluded: 0, duplicateExcluded: 0,
      accepted: 0, searchLimitReached: false },
  };
  stats.filter.requiredSlots = stats.request.meals.length + new Set(stats.request.activities).size;
  return { stats,
    start() {
      if (process.env.NODE_ENV === 'development') console.info('[MeetUP course diagnostic start]', JSON.stringify({ run: stats.run, request: stats.request, planned: stats.search.planned }));
    },
    searchFinished(request) {
      if (process.env.NODE_ENV === 'development') console.info('[MeetUP course search]', JSON.stringify({ run: stats.run, ...request }));
    },
    finish(outcome) {
    if (process.env.NODE_ENV === 'development') {
      // Stringify now so DevTools does not display a subsequently mutated object.
      console.info('[MeetUP course diagnostic]', JSON.stringify({ ...stats, outcome }));
    }
  } };
}
