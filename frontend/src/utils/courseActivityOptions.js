export const PLAY_OPTIONS = [
  { value: 'experience', label: '놀거리 골고루', description: '방탈출·볼링·보드게임·공방 중에서 찾아요' },
  { value: 'escape', label: '방탈출', description: '단서를 풀며 함께 탈출하기' },
  { value: 'bowling', label: '볼링', description: '볼링장에서 함께 게임하기' },
  { value: 'boardgame', label: '보드게임', description: '보드게임을 골라 함께 즐기기' },
  { value: 'karaoke', label: '노래방', description: '노래 부르며 놀기' },
  { value: 'workshop', label: '공방 체험', description: '도자기·향수 등 만들기 체험 찾아보기' },
  { value: 'culture', label: '전시·박물관', description: '미술관·박물관·전시 관람하기' },
  { value: 'walk', label: '공원·산책', description: '공원·산책로에서 걷고 쉬기' },
];

export const ACTIVITY_SEARCH_TERMS = {
  experience: ['방탈출', '볼링장', '보드게임', '공방'],
  escape: ['방탈출'], bowling: ['볼링장'], boardgame: ['보드게임'],
  karaoke: ['노래방'], workshop: ['공방'],
  culture: ['박물관', '미술관', '전시관'], walk: ['공원', '산책로'],
  cafe: ['카페'], bar: ['술집'],
};

export const ACTIVITY_MATCH = {
  escape: ['방탈출', 'escape room'], bowling: ['볼링', 'bowling'],
  boardgame: ['보드게임', 'board game'], karaoke: ['노래방', '노래연습장', 'karaoke'],
  workshop: ['공방', '도자기체험', '향수체험'],
  experience: ['방탈출', '볼링', '보드게임', '공방', '체험', 'activity', '테마파크'],
  culture: ['museum', 'culture', '박물관', '미술관', '전시', '갤러리'],
  walk: ['park', 'nature', '공원', '산책', '수목원', '정원'],
  cafe: ['cafe', '카페', '커피'], bar: ['bar', '술집', '주점', '맥주'],
};

export function matchesActivity(place, type) {
  const category = String(place.category || '').toLowerCase();
  const text = `${category} ${place.name || place.placeName || ''}`.toLowerCase();
  // A restaurant name mentioning a nearby attraction is not that activity.
  if (type !== 'cafe' && type !== 'bar' && /음식점|식당|한식|양식|일식|중식|분식|restaurant/.test(category)) return false;
  if (!['cafe', 'bar', 'boardgame', 'experience'].includes(type) && /카페|커피|cafe/.test(category)) return false;
  return (ACTIVITY_MATCH[type] || []).some(token => text.includes(token));
}

export function activityDescription(place, type) {
  const specific = PLAY_OPTIONS.find(option => option.value !== 'experience' && matchesActivity(place, option.value));
  return specific?.description || PLAY_OPTIONS.find(option => option.value === type)?.description || null;
}
