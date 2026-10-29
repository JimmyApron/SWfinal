// OpenWeatherMap(lang=kr) 설명과 강수확률로 날씨 이모지를 고른다.
export function getWeatherEmoji(weather) {
  if (!weather) return "🌤️";
  const description = weather.description || "";

  if (/눈/.test(description)) return "❄️";
  if (/비|소나기|이슬비|뇌우|천둥/.test(description)) return "🌧️";
  if (/안개|박무|연무|황사/.test(description)) return "🌫️";
  if (/맑음/.test(description)) return "☀️";
  if (/구름|흐림/.test(description)) {
    return Number(weather.precipitationProbability) >= 50 ? "🌧️" : "☁️";
  }
  return Number(weather.precipitationProbability) >= 50 ? "🌧️" : "🌤️";
}

export const PREP_BASIS_ICONS = {
  weather: "🌦️",
  place: "📍",
  time: "⏰",
  event: "🎯",
  date: "📅",
  people: "👥",
  air: "😷",
};
