export function courseTravelMode(course, fallback) {
  const explicit = course.travelMode || course.travel_mode || course.manualDraft?.travelMode || fallback
  if (explicit) return explicit === 'walk' ? 'walking' : explicit
  const text = `${course.summary || ''} ${course.recommendation_condition || ''}`
  if (/walking|\bwalk\b|도보|걸어서/.test(text)) return 'walking'
  if (/transit|대중교통/.test(text)) return 'transit'
  if (/\bcar\b|자동차/.test(text)) return 'car'
  return null
}
