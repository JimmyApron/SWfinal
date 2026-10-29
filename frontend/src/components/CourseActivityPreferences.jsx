import { mealTimeError, MEAL_WINDOWS } from '../utils/mealTimeUtils';
const categories = [{ id: 'food', label: '식사', icon: '🍽️' }, { id: 'play', label: '놀거리', icon: '🎟️' }, { id: 'cafe', label: '카페', icon: '☕' }, { id: 'bar', label: '주점', icon: '🍸' }];
const cuisines = [{ value: 'korean', label: '한식' }, { value: 'western', label: '양식' }, { value: 'japanese', label: '일식' }, { value: 'chinese', label: '중식' }, { value: 'snack', label: '분식' }, { value: 'any', label: '상관없음' }];
const playTypes = [{ value: 'experience', label: '체험 / 놀거리' }, { value: 'culture', label: '문화 / 전시' }, { value: 'walk', label: '산책 / 야외' }];
export function inferContentCategories(form) {
  return form.contentCategories || [
    ...(Object.values(form.mealPreferences || {}).some(Boolean) ? ['food'] : []),
    ...((form.activities || []).some((type) => ['experience', 'culture', 'walk'].includes(type)) ? ['play'] : []),
    ...['cafe', 'bar'].filter((type) => (form.activities || []).includes(type)),
  ];
}
const panel = { background: '#F7F5FF', borderRadius: 14, padding: 14, marginTop: 12 };
const chip = { border: '1px solid #E7E0FF', borderRadius: 9, padding: '8px 10px', cursor: 'pointer', fontSize: 12 };
export default function CourseActivityPreferences({ form, schedule, onChange, onError, error }) {
  const selected = inferContentCategories(form);
  const toggle = (id) => {
    const active = selected.includes(id);
    let activities = [...(form.activities || [])];
    let mealPreferences = { ...form.mealPreferences };
    if (id === 'food' && active) mealPreferences = { breakfast: null, lunch: null, dinner: null };
    if (id === 'play') activities = active ? activities.filter((type) => !playTypes.some((p) => p.value === type)) : [...activities, 'experience'];
    if (['cafe', 'bar'].includes(id)) activities = active ? activities.filter((type) => type !== id) : [...activities, id];
    onChange({ ...form, activities: [...new Set(activities)], mealPreferences,
      contentCategories: active ? selected.filter((type) => type !== id) : [...selected, id] });
    onError('');
  };
  return <section aria-label="코스 구성 선택" style={{ background: '#fff', border: '1px solid #EEE7FF', borderRadius: 18, padding: 16, marginBottom: 14 }}>
    <h3 style={{ marginTop: 0, fontSize: 16 }}>어떤 것을 포함할까요?</h3>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
      {categories.map((category) => <button key={category.id} type="button" aria-pressed={selected.includes(category.id)} onClick={() => toggle(category.id)} style={{ ...chip, padding: '12px 4px', background: selected.includes(category.id) ? (category.id === 'food' ? '#FF8A48' : '#7B61FF') : '#F3F0FF', color: selected.includes(category.id) ? '#fff' : '#17172B' }}><span aria-hidden="true" style={{ display: 'block', fontSize: 21, marginBottom: 4 }}>{category.icon}</span>{category.label}</button>)}
    </div>
    {selected.includes('food') && <div style={panel} aria-label="식사 설정">
      <strong>식사</strong><p style={{ fontSize: 12, color: '#646478' }}>먹을 끼니만 체크해 주세요. 아침 06–11시 · 점심 11–16시 · 저녁 17–24시</p>
      {error && <p role="status" style={{ color: '#C62828', fontSize: 13 }}>{error}</p>}
      {Object.entries(MEAL_WINDOWS).map(([key, meal]) => <div key={key} style={{ padding: '12px 0', borderTop: '1px solid #E7E0FF' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}><input type="checkbox" checked={Boolean(form.mealPreferences?.[key])} onChange={(event) => {
          const error = event.target.checked ? mealTimeError(key, schedule) : '';
          if (error) { onError(error); return; }
          onChange({ ...form, mealPreferences: { ...form.mealPreferences, [key]: event.target.checked ? 'any' : null } }); onError('');
        }} />{meal.label} 먹기</label>
        {form.mealPreferences?.[key] && <div role="group" aria-label={`${meal.label} 음식 종류`} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{cuisines.map((cuisine) => <button key={cuisine.value} type="button" aria-pressed={form.mealPreferences[key] === cuisine.value} style={{ ...chip, background: form.mealPreferences[key] === cuisine.value ? '#7B61FF' : '#fff', color: form.mealPreferences[key] === cuisine.value ? '#fff' : '#17172B' }} onClick={() => onChange({ ...form, mealPreferences: { ...form.mealPreferences, [key]: cuisine.value } })}>{cuisine.label}</button>)}</div>}
      </div>)}
    </div>}
    {selected.includes('play') && <div style={panel} aria-label="놀거리 설정"><strong>놀거리</strong><p style={{ fontSize: 12 }}>하고 싶은 활동을 선택해 주세요.</p><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{playTypes.map((type) => <button key={type.value} type="button" aria-pressed={form.activities.includes(type.value)} style={{ ...chip, background: form.activities.includes(type.value) ? '#7B61FF' : '#fff', color: form.activities.includes(type.value) ? '#fff' : '#17172B' }} onClick={() => onChange({ ...form, activities: form.activities.includes(type.value) ? form.activities.filter((a) => a !== type.value) : [...form.activities, type.value] })}>{type.label}</button>)}</div></div>}
    {selected.includes('cafe') && <div style={panel} aria-label="카페 설정"><strong>카페</strong><p style={{ fontSize: 13 }}>선택한 구역에서 카페 방문을 코스에 포함합니다.</p></div>}
    {selected.includes('bar') && <div style={panel} aria-label="주점 설정"><strong>주점</strong><p style={{ fontSize: 13 }}>선택한 구역에서 주점 방문을 코스에 포함합니다.</p></div>}
  </section>;
}
