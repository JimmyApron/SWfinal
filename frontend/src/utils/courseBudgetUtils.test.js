import { estimateStopBudget, summarizeCourseBudget, formatCourseBudget } from './courseBudgetUtils';

test('카테고리 범위와 출처 있는 실제 비용을 구분', () => {
  expect(estimateStopBudget({ category: '음식점' }, 'lunch')).toMatchObject({ min: 8000, max: 18000, source: 'category_estimate' });
  expect(estimateStopBudget({ category: '카페', price: 6000 })).toMatchObject({ min: 5000, max: 10000, source: 'category_estimate' });
  expect(estimateStopBudget({ category: '카페', price: 6000, priceSource: 'verified-menu' })).toMatchObject({ min: 6000, max: 6000, source: 'verified' });
  expect(estimateStopBudget({ category: '공원' }).source).toBe('unknown');
});

test('예산 충족·초과·불확실·미설정과 미확인 비용 합계', () => {
  const stops = [{ category: '카페' }, { category: '음식점', mealKey: 'lunch' }];
  expect(summarizeCourseBudget(stops, 30000)).toMatchObject({ min: 13000, max: 28000, status: 'within' });
  expect(summarizeCourseBudget(stops, 20000).status).toBe('uncertain');
  expect(summarizeCourseBudget(stops, 10000).status).toBe('over');
  expect(summarizeCourseBudget(stops).status).toBe('not_set');
  expect(summarizeCourseBudget([...stops, { category: '기타' }], 50000)).toMatchObject({ max: null, unknownCount: 1, status: 'uncertain' });
  expect(formatCourseBudget(summarizeCourseBudget([{ category: '기타' }]))).toBe('비용 정보 확인 필요');
});
