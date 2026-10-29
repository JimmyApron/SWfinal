export const MEAL_WINDOWS = {
  breakfast: { label: '아침', start: 360, end: 660, stay: 45 },
  lunch: { label: '점심', start: 660, end: 960, stay: 60 },
  dinner: { label: '저녁', start: 1020, end: 1440, stay: 75 },
};
export function timeMinutes(value, fallback) {
  if (!value) return fallback;
  const [hours, minutes] = String(value).split(':').map(Number);
  return Number.isInteger(hours) && hours >= 0 && hours <= 23 && Number.isInteger(minutes) && minutes >= 0 && minutes < 60 ? hours * 60 + minutes : NaN;
}
export function mealTimeError(key, schedule) {
  const window = MEAL_WINDOWS[key];
  if (!window) return '';
  const start = timeMinutes(schedule?.starttime, 600);
  const end = timeMinutes(schedule?.endtime, 1260);
  return !Number.isFinite(start) || !Number.isFinite(end) || end <= start || Math.min(end, window.end) - Math.max(start, window.start) < window.stay
    ? `일정 시간대에 맞지 않는 선택입니다. ${window.label} 식사 시간을 포함할 수 없습니다.` : '';
}
