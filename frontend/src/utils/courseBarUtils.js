import { MEAL_WINDOWS, timeMinutes } from './mealTimeUtils';

export const BAR_OPTIONS = [
  { value: 'dinner', label: '저녁 식사 겸 한잔', description: '저녁 식당 대신 주점에서 식사와 한잔을 함께해요.' },
  { value: 'afterDinner', label: '저녁 먹고 2차', description: '저녁 식당을 먼저 방문하고, 그 뒤에 주점에 가요. 두 곳의 비용을 모두 포함해요.' },
];

export function getBarMode(condition) {
  if (!(condition.activities || []).includes('bar')) return null;
  return condition.barMode === 'afterDinner' ? 'afterDinner' : 'dinner';
}

export function resolveCourseMeals(condition) {
  const meals = { ...condition.mealPreferences };
  const mode = getBarMode(condition);
  if (mode) meals.dinner = mode === 'dinner' ? 'bar' : meals.dinner || 'any';
  return meals;
}

export function barTimeError(condition, schedule) {
  const mode = getBarMode(condition);
  if (!mode) return '';
  const start = Math.max(timeMinutes(schedule?.starttime, 600), MEAL_WINDOWS.dinner.start);
  const end = timeMinutes(schedule?.endtime, 1260);
  // Two visits require dinner, at least five minutes of travel, and one hour at the bar.
  const duration = mode === 'afterDinner' ? 125 : MEAL_WINDOWS.dinner.stay;
  return !Number.isFinite(start) || !Number.isFinite(end) || end - start < duration
    ? mode === 'afterDinner' ? '저녁 식사와 2차 주점을 방문할 시간이 부족해요. 저녁 시간대를 2시간 5분 이상 확보하거나 저녁 식사 겸 한잔으로 바꿔 주세요.'
      : '저녁 식사 겸 한잔은 오후 5시 이후에 1시간 이상 필요해요. 일정 시간을 바꿔 주세요.'
    : '';
}
