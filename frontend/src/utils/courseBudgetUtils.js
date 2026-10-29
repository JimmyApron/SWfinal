// Planning assumptions, not provider prices or verified admission/menu fees.
export const CATEGORY_BUDGET_RANGES = {
  breakfast: [5000, 12000], lunch: [8000, 18000], dinner: [10000, 25000],
  cafe: [5000, 10000], experience: [10000, 35000], culture: [0, 20000], bar: [15000, 40000],
};

export function estimateStopBudget(place, mealKey = null) {
  if (Number.isFinite(place.price) && place.price >= 0 && place.priceSource) {
    return { min: place.price, max: place.price, source: 'verified', priceSource: place.priceSource };
  }
  const text = `${place.category || ''}`.toLowerCase();
  const kind = mealKey || (/카페|커피|cafe/.test(text) ? 'cafe'
    : /술집|주점|맥주|bar/.test(text) ? 'bar'
    : /박물관|미술관|전시|문화|museum|culture/.test(text) ? 'culture'
    : /체험|액티비티|테마파크|activity/.test(text) ? 'experience' : null);
  const range = CATEGORY_BUDGET_RANGES[kind];
  return range ? { min: range[0], max: range[1], source: 'category_estimate', category: kind } : { min: null, max: null, source: 'unknown' };
}

export function summarizeCourseBudget(stops, limit = null) {
  const ranges = stops.map((stop) => stop.budgetEstimate || estimateStopBudget(stop, stop.mealKey));
  const unknownCount = ranges.filter((range) => range.min == null || range.max == null).length;
  const min = ranges.reduce((sum, range) => sum + (range.min ?? 0), 0);
  const max = unknownCount ? null : ranges.reduce((sum, range) => sum + range.max, 0);
  return { min, max, unknownCount, source: 'planning_range',
    status: limit == null ? 'not_set' : min > limit ? 'over' : unknownCount || max > limit ? 'uncertain' : 'within' };
}

export function formatCourseBudget(estimate) {
  if (!estimate || estimate.max == null) return '비용 정보 확인 필요';
  return `예상 예산: 1인 기준 ${estimate.min.toLocaleString('ko-KR')}~${estimate.max.toLocaleString('ko-KR')}원`;
}
