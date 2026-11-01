import { useState } from 'react';
import { mealTimeError, MEAL_WINDOWS } from '../utils/mealTimeUtils';
import { PLAY_OPTIONS } from '../utils/courseActivityOptions';
import { BAR_OPTIONS, getBarMode, resolveCourseMeals } from '../utils/courseBarUtils';
const categories = [{ id: 'food', label: '식사', icon: '🍽️' }, { id: 'play', label: '놀거리', icon: '🎟️' }, { id: 'cafe', label: '카페', icon: '☕' }, { id: 'bar', label: '주점', icon: '🍸' }];
const cuisines = [{ value: 'korean', label: '한식' }, { value: 'western', label: '양식' }, { value: 'japanese', label: '일식' }, { value: 'chinese', label: '중식' }, { value: 'snack', label: '분식' }, { value: 'any', label: '상관없음' }];
const playTypes = PLAY_OPTIONS;
export function inferContentCategories(form) {
  return form.contentCategories || [
    ...(Object.values(form.mealPreferences || {}).some(Boolean) ? ['food'] : []),
    ...((form.activities || []).some((type) => playTypes.some(option => option.value === type)) ? ['play'] : []),
    ...['cafe', 'bar'].filter((type) => (form.activities || []).includes(type)),
  ];
}
const panel = { background: '#F7F5FF', borderRadius: 14, padding: 14, marginTop: 12 };
const chip = { border: '1px solid #E7E0FF', borderRadius: 9, padding: '8px 10px', cursor: 'pointer', fontSize: 12 };
export default function CourseActivityPreferences({ form, schedule, onChange, onError, error }) {
  const [mealsConfirmed, setMealsConfirmed] = useState(false);
  const [playConfirmed, setPlayConfirmed] = useState(false);
  const [barConfirmed, setBarConfirmed] = useState(false);
  const barMode = getBarMode(form);
  const effectiveMeals = resolveCourseMeals(form);
  const confirmMeals = () => {
    const meals = Object.keys(MEAL_WINDOWS).filter(key => effectiveMeals[key]);
    const validationError = meals.length ? meals.map(key => mealTimeError(key, schedule)).find(Boolean) : '먹을 끼니를 하나 이상 선택해 주세요.';
    if (validationError) { onError(validationError); return; }
    onError('');
    setMealsConfirmed(true);
  };
  const selected = inferContentCategories(form);
  const toggle = (id) => {
    const active = selected.includes(id);
    let activities = [...(form.activities || [])];
    let mealPreferences = { ...form.mealPreferences };
    if (id === 'food') {
      setMealsConfirmed(false);
      if (active) mealPreferences = { breakfast: null, lunch: null, dinner: null };
    }
    if (id === 'play') {
      setPlayConfirmed(false);
      activities = active ? activities.filter((type) => !playTypes.some((p) => p.value === type)) : [...activities, 'experience'];
    }
    if (['cafe', 'bar'].includes(id)) activities = active ? activities.filter((type) => type !== id) : [...activities, id];
    if (id === 'bar') {
      setMealsConfirmed(false);
      setBarConfirmed(false);
    }
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
      {mealsConfirmed ? <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <strong>식사 선택 완료</strong>
          <button type="button" style={{ ...chip, background: '#fff' }} onClick={() => setMealsConfirmed(false)}>수정</button>
        </div>
        <p style={{ fontSize: 13, color: '#646478', marginBottom: 0 }}>
          {Object.entries(MEAL_WINDOWS).filter(([key]) => effectiveMeals[key]).map(([key, meal]) => `${meal.label} · ${effectiveMeals[key] === 'bar' ? '주점에서 식사 겸 한잔' : cuisines.find((cuisine) => cuisine.value === effectiveMeals[key])?.label || '상관없음'}`).join(' / ')}
        </p>
      </> : <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong>식사</strong>
        <button type="button" style={{ ...chip, background: '#7B61FF', color: '#fff', flexShrink: 0 }} onClick={confirmMeals}>확인</button>
      </div>
      <p style={{ fontSize: 12, color: '#646478' }}>먹을 끼니만 체크해 주세요. 아침 06–11시 · 점심 11–16시 · 저녁 17–24시</p>
      <p style={{ fontSize: 12, color: '#646478', lineHeight: 1.6 }}>한 끼는 45분~1시간으로 잡고, 식사 후 다음 끼니까지 최소 3시간을 둬요. 선택한 놀거리는 식사 사이에 나눠 넣어요.</p>
      {error && <p role="status" style={{ color: '#C62828', fontSize: 13 }}>{error}</p>}
      {Object.entries(MEAL_WINDOWS).map(([key, meal]) => <div key={key} style={{ padding: '12px 0', borderTop: '1px solid #E7E0FF' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}><input type="checkbox" checked={Boolean(effectiveMeals[key])} disabled={key === 'dinner' && Boolean(barMode)} onChange={(event) => {
          const error = event.target.checked ? mealTimeError(key, schedule) : '';
          if (error) { onError(error); return; }
          onChange({ ...form, mealPreferences: { ...form.mealPreferences, [key]: event.target.checked ? 'any' : null } }); onError('');
        }} />{meal.label} 먹기</label>
        {key === 'dinner' && barMode && <p style={{ fontSize: 12, color: '#6650B0' }}>{barMode === 'dinner' ? '주점에서 저녁 식사 겸 한잔해요. 저녁 식당은 따로 넣지 않아요.' : '저녁 식사 후 주점에 가요. 저녁 음식 종류는 아래에서 고를 수 있어요.'}</p>}
        {effectiveMeals[key] && effectiveMeals[key] !== 'bar' && <div role="group" aria-label={`${meal.label} 음식 종류`} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>{cuisines.map((cuisine) => <button key={cuisine.value} type="button" aria-pressed={effectiveMeals[key] === cuisine.value} style={{ ...chip, background: effectiveMeals[key] === cuisine.value ? '#7B61FF' : '#fff', color: effectiveMeals[key] === cuisine.value ? '#fff' : '#17172B' }} onClick={() => onChange({ ...form, mealPreferences: { ...form.mealPreferences, [key]: cuisine.value } })}>{cuisine.label}</button>)}</div>}
      </div>)}
      </>}
    </div>}
    {selected.includes('play') && <div style={panel} aria-label="놀거리 설정">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong>{playConfirmed ? '놀거리 선택 완료' : '어떤 활동을 하고 싶으세요?'}</strong>
        <button type="button" style={{ ...chip, background: playConfirmed ? '#fff' : '#7B61FF', color: playConfirmed ? '#17172B' : '#fff', flexShrink: 0 }} onClick={() => {
          if (playConfirmed) { setPlayConfirmed(false); return; }
          if (!playTypes.some(type => (form.activities || []).includes(type.value))) { onError('놀거리를 하나 이상 선택해 주세요.'); return; }
          onError('');
          setPlayConfirmed(true);
        }}>{playConfirmed ? '수정' : '확인'}</button>
      </div>
      {playConfirmed ? <p style={{ fontSize: 13, color: '#646478', marginBottom: 0 }}>{playTypes.filter(type => (form.activities || []).includes(type.value)).map(type => type.label).join(' / ')}</p> : <>
      <p style={{ fontSize: 13, lineHeight: 1.6 }}>여러 개 선택하면 각각 코스에 넣어요. 식사와 카페는 따로 선택한 경우에만 포함해요.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {playTypes.map(type => <button key={type.value} type="button" aria-pressed={form.activities.includes(type.value)} style={{ ...chip, textAlign: 'left', lineHeight: 1.5, background: form.activities.includes(type.value) ? '#7B61FF' : '#fff', color: form.activities.includes(type.value) ? '#fff' : '#17172B' }} onClick={() => {
          const current = form.activities || [];
          const specificTypes = ['escape', 'bowling', 'boardgame', 'karaoke', 'workshop'];
          const next = current.includes(type.value) ? current.filter(value => value !== type.value)
            : [...current.filter(value => type.value === 'experience' ? !specificTypes.includes(value) : specificTypes.includes(type.value) ? value !== 'experience' : true), type.value];
          onChange({ ...form, activities: next });
          onError('');
        }}><strong style={{ display: 'block', fontSize: 14 }}>{type.label}</strong><span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>{type.description}</span></button>)}
      </div>
      </>}
    </div>}
    {selected.includes('cafe') && <div style={panel} aria-label="카페 설정"><strong>카페</strong><p style={{ fontSize: 13 }}>선택한 구역에서 카페 방문을 코스에 포함합니다.</p></div>}
    {selected.includes('bar') && <div style={panel} aria-label="주점 설정">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong>{barConfirmed ? '주점 선택 완료' : '주점은 언제 갈까요?'}</strong>
        <button type="button" style={{ ...chip, background: barConfirmed ? '#fff' : '#7B61FF', color: barConfirmed ? '#17172B' : '#fff', flexShrink: 0 }} onClick={() => {
          setBarConfirmed(previous => !previous);
          onError('');
        }}>{barConfirmed ? '수정' : '확인'}</button>
      </div>
      {barConfirmed ? <p style={{ fontSize: 13, color: '#646478', marginBottom: 0 }}>{BAR_OPTIONS.find(option => option.value === barMode)?.label}</p> : <>
      <div role="radiogroup" aria-label="주점 방문 방식" style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {BAR_OPTIONS.map(option => <label key={option.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, border: barMode === option.value ? '1px solid #7B61FF' : '1px solid #E7E0FF', background: '#fff', cursor: 'pointer' }}>
          <input type="radio" name="course-bar-mode" value={option.value} checked={barMode === option.value} onChange={() => { onChange({ ...form, barMode: option.value }); setMealsConfirmed(false); onError(''); }} style={{ accentColor: '#7B61FF', marginTop: 4 }} />
          <span><strong style={{ fontSize: 14 }}>{option.label}</strong><span style={{ display: 'block', fontSize: 12, lineHeight: 1.6, color: '#646478', marginTop: 4 }}>{option.description}</span></span>
        </label>)}
      </div>
      <p style={{ fontSize: 12, color: '#646478', lineHeight: 1.6 }}>주점은 저녁 시간에 배치해요. 저녁 식사 선택은 위 설정에 맞춰 자동으로 반영돼요.</p>
      </>}
    </div>}
  </section>;
}
