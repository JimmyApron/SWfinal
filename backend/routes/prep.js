const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();
const weatherCache = new Map();
const WEATHER_CACHE_MS = 30 * 60 * 1000;

let supabase;

function getSupabase() {
  if (supabase) return supabase;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_KEY가 설정되지 않았습니다.");
  }

  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return supabase;
}

function validScheduleId(value) {
  const scheduleId = Number(value);
  return Number.isSafeInteger(scheduleId) && scheduleId > 0 ? scheduleId : null;
}

async function getSchedule(scheduleId) {
  const { data, error } = await getSupabase()
    .from("confirmed_schedules")
    .select(
      "id, roomid, title, date, starttime, endtime, isallday, location, locationaddress, locationlat, locationlng, locationcategory, absentees"
    )
    .eq("id", scheduleId)
    .maybeSingle();

  if (error) throw new Error(`확정 일정을 조회하지 못했습니다: ${error.message}`);
  if (!data) {
    const notFound = new Error("확정 일정을 찾을 수 없습니다.");
    notFound.status = 404;
    throw notFound;
  }
  return data;
}

const originMemory = new Map();

function validCoordinates(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  return (
    lat != null &&
    lng != null &&
    lat !== "" &&
    lng !== "" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function parseUserLocation(input) {
  if (!input || !validCoordinates(input.lat, input.lng)) return null;
  return { lat: Number(input.lat), lng: Number(input.lng) };
}

function describeOrigin(origin) {
  return { type: origin.type, label: origin.label || null };
}

async function geocodePlaceName(query) {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey || !query) return null;

  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", query);
  url.searchParams.set("size", "1");

  try {
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const place = (await response.json())?.documents?.[0];
    if (!place || !validCoordinates(place.y, place.x)) return null;
    return { lat: Number(place.y), lng: Number(place.x) };
  } catch (error) {
    console.error("카카오 장소 좌표 조회 실패:", error.message);
    return null;
  }
}

// 현재 좌표를 구 단위 이름(예: 부산진구)으로 바꾼다. 좌표 자체는 화면에 내보내지 않는다.
async function getRegionLabel(lat, lng) {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) return null;

  const url = new URL("https://dapi.kakao.com/v2/local/geo/coord2regioncode.json");
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));

  try {
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const region = (await response.json())?.documents?.[0];
    return region?.region_2depth_name || region?.region_1depth_name || null;
  } catch (error) {
    console.error("현재 위치 지역명 조회 실패:", error.message);
    return null;
  }
}

// 날씨 기준 위치: ① 확정 장소 ② 함께 가고 싶은 장소 첫 번째 ③ 요청한 사람의 현재 위치 ④ 없음
async function resolveWeatherOrigin(schedule, userLocation) {
  if (validCoordinates(schedule.locationlat, schedule.locationlng)) {
    return {
      type: "place",
      lat: Number(schedule.locationlat),
      lng: Number(schedule.locationlng),
      label: schedule.location || schedule.locationaddress || "확정 장소",
    };
  }

  const { data: wishPlaces, error } = await getSupabase()
    .from("confirmed_locations")
    .select("placename")
    .eq("scheduleid", schedule.id)
    .order("id", { ascending: true })
    .limit(1);
  if (error) console.error("함께 가고 싶은 장소 조회 실패:", error.message);

  const wishName = wishPlaces?.[0]?.placename;
  if (wishName) {
    const point = await geocodePlaceName(wishName);
    if (point) return { type: "wish", ...point, label: wishName };
  }

  if (userLocation) {
    const label = (await getRegionLabel(userLocation.lat, userLocation.lng)) || "현재 위치";
    const origin = { type: "current", ...userLocation, label };
    originMemory.set(schedule.id, { origin, expiresAt: Date.now() + WEATHER_CACHE_MS });
    return origin;
  }

  const remembered = originMemory.get(schedule.id);
  if (remembered && remembered.expiresAt > Date.now()) return remembered.origin;

  return { type: "none", lat: null, lng: null, label: null };
}

function weatherBasisOf(origin) {
  return origin.type === "place" ? "place" : "none";
}

// OpenWeatherMap 한국어 번역 중 어색한 표현을 사람이 쓰는 말로 바꾼다. (예: "실 비" = light drizzle)
const WEATHER_DESCRIPTION_LABELS = {
  "실 비": "이슬비",
  "가벼운 비": "약한 비",
  "보통 비": "비",
  "강한 비": "강한 비",
  "튼구름": "구름 많음",
  "구름조금": "구름 조금",
  "온흐림": "흐림",
  "박무": "옅은 안개",
  "연무": "연무",
};

function describeWeather(description) {
  if (!description) return "날씨 정보";
  return WEATHER_DESCRIPTION_LABELS[description.trim()] || description;
}

function formatForecastEntry(entry, timezoneOffset) {
  const localDate = new Date((entry.dt + timezoneOffset) * 1000);
  return {
    date: localDate.toISOString().slice(0, 10),
    minutes: localDate.getUTCHours() * 60 + localDate.getUTCMinutes(),
    entry,
  };
}

function summarizeForecast(entries, schedule, timezoneOffset) {
  const localEntries = entries
    .map((entry) => formatForecastEntry(entry, timezoneOffset))
    .filter(({ date }) => date === schedule.date);

  if (localEntries.length === 0) return null;

  const allDay = schedule.isallday || !schedule.starttime;
  if (allDay) {
    const selected = localEntries.reduce((best, current) =>
      Number(current.entry.pop || 0) > Number(best.entry.pop || 0) ? current : best
    );
    const lows = localEntries
      .map(({ entry }) => Number(entry.main?.temp_min))
      .filter(Number.isFinite);
    const highs = localEntries
      .map(({ entry }) => Number(entry.main?.temp_max))
      .filter(Number.isFinite);

    return {
      description: describeWeather(selected.entry.weather?.[0]?.description),
      precipitationProbability: Math.round(
        Math.max(...localEntries.map(({ entry }) => Number(entry.pop || 0))) * 100
      ),
      temperature: null,
      temperatureMin: lows.length ? Math.round(Math.min(...lows)) : null,
      temperatureMax: highs.length ? Math.round(Math.max(...highs)) : null,
    };
  }

  const [hours, minutes] = schedule.starttime.split(":").map(Number);
  const targetMinutes = hours * 60 + (minutes || 0);
  const closest = localEntries.reduce((best, current) =>
    Math.abs(current.minutes - targetMinutes) < Math.abs(best.minutes - targetMinutes)
      ? current
      : best
  );
  const entry = closest.entry;

  return {
    description: describeWeather(entry.weather?.[0]?.description),
    precipitationProbability: Math.round(Number(entry.pop || 0) * 100),
    temperature: Number.isFinite(Number(entry.main?.temp))
      ? Math.round(Number(entry.main.temp))
      : null,
    temperatureMin: null,
    temperatureMax: null,
  };
}

async function getScheduleWeather(schedule, origin, { logErrors = true } = {}) {
  const weatherBasis = weatherBasisOf(origin);
  const weatherSource = describeOrigin(origin);
  if (origin.type === "none" || !schedule.date) {
    return { weather: null, weatherBasis, weatherSource };
  }

  const apiKey =
    process.env.OPENWEATHERMAP_API_KEY || process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return { weather: null, weatherBasis, weatherSource };

  const cacheKey = [
    schedule.id,
    schedule.date,
    schedule.starttime || "",
    origin.lat,
    origin.lng,
  ].join(":");
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
  url.searchParams.set("lat", String(origin.lat));
  url.searchParams.set("lon", String(origin.lng));
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "metric");
  url.searchParams.set("lang", "kr");

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch (error) {
    if (logErrors) console.error("OpenWeatherMap 연결 실패:", error);
    const unavailable = new Error("날씨 예보 서비스에 연결하지 못했습니다.");
    unavailable.status = 502;
    throw unavailable;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (logErrors) console.error("OpenWeatherMap 응답 JSON 파싱 실패:", error);
    const parseError = new Error("날씨 예보 응답을 읽지 못했습니다.");
    parseError.status = 502;
    throw parseError;
  }

  if (!response.ok) {
    const detail = payload?.message || response.statusText;
    if (logErrors) {
      console.error("OpenWeatherMap 응답 오류:", response.status, detail);
    }
    const weatherError = new Error("날씨 예보를 가져오지 못했습니다.");
    weatherError.status = 502;
    throw weatherError;
  }

  if (!Array.isArray(payload?.list)) {
    const weatherError = new Error("날씨 예보 응답 형식이 올바르지 않습니다.");
    weatherError.status = 502;
    throw weatherError;
  }

  const weather = summarizeForecast(
    payload?.list || [],
    schedule,
    Number(payload?.city?.timezone || 0)
  );
  const value = { weather, weatherBasis, weatherSource };
  weatherCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + WEATHER_CACHE_MS,
  });
  return value;
}

async function getAttendingCount(schedule) {
  const client = getSupabase();
  const [{ data: members, error: memberError }, { data: guests, error: guestError }] =
    await Promise.all([
      client.from("room_members").select("userid").eq("roomid", schedule.roomid),
      client.from("room_guests").select("id").eq("roomid", schedule.roomid),
    ]);

  if (memberError) {
    throw new Error(`회원 목록을 조회하지 못했습니다: ${memberError.message}`);
  }
  if (guestError) {
    throw new Error(`게스트 목록을 조회하지 못했습니다: ${guestError.message}`);
  }

  const absentIds = new Set((schedule.absentees || []).map(String));
  const attending = [
    ...(members || []).map((member) => ({
      type: "member",
      id: String(member.userid),
    })),
    ...(guests || []).map((guest) => ({
      type: "guest",
      id: String(guest.id),
    })),
  ].filter((participant) => !absentIds.has(participant.id));

  return attending.length;
}

const BASIS_TYPES = ["weather", "place", "time", "event", "date", "people", "air"];
const EVENT_CATEGORY_LABELS = {
  meal: "식사·카페",
  drink: "술자리",
  birthday: "생일·기념일",
  concert: "콘서트·공연",
  sports: "스포츠·관람",
  trip: "여행·MT",
  picnic: "피크닉·야외",
  study: "스터디·회의",
  etc: "기타",
};
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// 양력 고정 공휴일 + 2026년 음력 공휴일(설날·부처님오신날·추석 연휴)
const FIXED_HOLIDAYS = {
  "01-01": "신정",
  "03-01": "삼일절",
  "05-05": "어린이날",
  "06-06": "현충일",
  "08-15": "광복절",
  "10-03": "개천절",
  "10-09": "한글날",
  "12-25": "크리스마스",
};
const LUNAR_HOLIDAYS_2026 = {
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-05-24": "부처님오신날",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
};
const KST_OFFSET_SECONDS = 9 * 60 * 60;
const airCache = new Map();
const placeCategoryCache = new Map();

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(":").map(Number);
  return Number.isFinite(hours) ? hours * 60 + (minutes || 0) : null;
}

function getDateTraits(schedule) {
  const [year, month, day] = schedule.date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mmdd = schedule.date.slice(5);
  const season =
    month >= 3 && month <= 5
      ? "봄"
      : month >= 6 && month <= 8
        ? "여름"
        : month >= 9 && month <= 11
          ? "가을"
          : "겨울";
  const holiday = LUNAR_HOLIDAYS_2026[schedule.date] || FIXED_HOLIDAYS[mmdd] || null;

  return {
    weekday: `${WEEKDAYS[weekday]}요일`,
    isWeekend: weekday === 0 || weekday === 6,
    season,
    holiday,
  };
}

function getTimeTraits(schedule) {
  const allDay = Boolean(schedule.isallday || !schedule.starttime);
  const start = timeToMinutes(schedule.starttime);
  const end = timeToMinutes(schedule.endtime);
  return {
    allDay,
    starttime: allDay ? null : schedule.starttime?.slice(0, 5),
    endtime: allDay ? null : schedule.endtime?.slice(0, 5) || null,
    durationHours:
      start != null && end != null && end > start
        ? Math.round(((end - start) / 60) * 10) / 10
        : null,
    startsEarly: start != null && start < 10 * 60,
    endsLate: end != null ? end >= 22 * 60 : start != null && start >= 20 * 60,
  };
}

async function searchKakaoCategory(query, { lat, lng } = {}) {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey || !query) return null;

  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.searchParams.set("query", query);
  url.searchParams.set("size", "1");
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set("x", String(lng));
    url.searchParams.set("y", String(lat));
    url.searchParams.set("radius", "500");
  }

  const cacheKey = url.toString();
  if (placeCategoryCache.has(cacheKey)) return placeCategoryCache.get(cacheKey);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const category = payload?.documents?.[0]?.category_name || null;
    placeCategoryCache.set(cacheKey, category);
    return category;
  } catch (error) {
    console.error("카카오 장소 카테고리 조회 실패:", error.message);
    return null;
  }
}

// 저장된 값이 없으면 카카오에서 조회하고, 찾으면 일정에 저장해 다음부터 재사용한다.
async function resolveLocationCategory(schedule) {
  if (schedule.locationcategory) return schedule.locationcategory;
  const name = schedule.location || schedule.locationaddress;
  if (!name) return null;

  const category = await searchKakaoCategory(name, {
    lat: Number(schedule.locationlat),
    lng: Number(schedule.locationlng),
  });
  if (category) {
    const { error } = await getSupabase()
      .from("confirmed_schedules")
      .update({ locationcategory: category })
      .eq("id", schedule.id);
    if (error) console.error("장소 카테고리 저장 실패:", error.message);
  }
  return category;
}

async function getAdditionalPlaces(scheduleId) {
  const { data, error } = await getSupabase()
    .from("confirmed_locations")
    .select("placename")
    .eq("scheduleid", scheduleId)
    .limit(3);
  if (error) {
    console.error("함께 가고 싶은 장소 조회 실패:", error.message);
    return [];
  }

  return Promise.all(
    (data || [])
      .filter((place) => place.placename)
      .map(async (place) => ({
        name: place.placename,
        category: await searchKakaoCategory(place.placename),
      }))
  );
}

async function getEventContext(scheduleId) {
  const { data, error } = await getSupabase()
    .from("prep_contexts")
    .select("category, note")
    .eq("scheduleid", scheduleId)
    .maybeSingle();
  if (error) {
    console.error("약속 종류 조회 실패:", error.message);
    return null;
  }
  if (!data || (!data.category && !data.note)) return null;
  return {
    category: data.category ? EVENT_CATEGORY_LABELS[data.category] || null : null,
    note: data.note || null,
  };
}

function getAirLevel(pm25) {
  if (pm25 <= 15) return "좋음";
  if (pm25 <= 35) return "보통";
  if (pm25 <= 75) return "나쁨";
  return "매우 나쁨";
}

async function getScheduleAir(schedule, origin) {
  if (origin.type === "none" || !schedule.date) return null;
  const apiKey =
    process.env.OPENWEATHERMAP_API_KEY || process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;

  const cacheKey = [
    schedule.date,
    schedule.starttime || "",
    origin.lat,
    origin.lng,
  ].join(":");
  const cached = airCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL("https://api.openweathermap.org/data/2.5/air_pollution/forecast");
  url.searchParams.set("lat", String(origin.lat));
  url.searchParams.set("lon", String(origin.lng));
  url.searchParams.set("appid", apiKey);

  let value = null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const payload = await response.json();
      const entries = (payload?.list || [])
        .map((entry) => {
          const local = new Date((entry.dt + KST_OFFSET_SECONDS) * 1000);
          return {
            date: local.toISOString().slice(0, 10),
            minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
            pm25: Number(entry.components?.pm2_5),
            pm10: Number(entry.components?.pm10),
          };
        })
        .filter((entry) => entry.date === schedule.date && Number.isFinite(entry.pm25));

      if (entries.length > 0) {
        const target = timeToMinutes(schedule.starttime);
        const picked =
          target == null
            ? entries.reduce((worst, current) => (current.pm25 > worst.pm25 ? current : worst))
            : entries.reduce((best, current) =>
                Math.abs(current.minutes - target) < Math.abs(best.minutes - target)
                  ? current
                  : best
              );
        value = {
          level: getAirLevel(picked.pm25),
          pm25: Math.round(picked.pm25),
          pm10: Number.isFinite(picked.pm10) ? Math.round(picked.pm10) : null,
        };
      }
    }
  } catch (error) {
    console.error("대기질 예보 조회 실패:", error.message);
  }

  airCache.set(cacheKey, { value, expiresAt: Date.now() + WEATHER_CACHE_MS });
  return value;
}

function compact(value) {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, compact(entry)])
      .filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value === null || value === "" || value === false ? undefined : value;
}

function validateAiResponse(value, participantCount) {
  if (!value || !Array.isArray(value.items)) {
    throw new Error("AI 응답에 items 배열이 없습니다.");
  }

  const normalized = value.items.map((item) => {
    if (
      !item ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      !["personal", "shared"].includes(item.kind)
    ) {
      throw new Error("AI 응답에 유효하지 않은 준비물이 포함되어 있습니다.");
    }

    return {
      name: item.name.trim().slice(0, 80),
      emoji: null,
      kind: item.kind,
      reason: typeof item.reason === "string" ? item.reason.trim().slice(0, 200) : null,
      basis: BASIS_TYPES.includes(item.basis) ? item.basis : null,
      neededCount:
        item.kind === "shared" && participantCount > 0
          ? Math.max(
              1,
              Math.min(
                participantCount,
                Number.isFinite(Number(item.neededCount))
                  ? Math.floor(Number(item.neededCount))
                  : 1
              )
            )
          : 1,
    };
  });

  // AI 추천은 각자 챙길 것만 사용한다. 같이 준비할 것이 섞여 오면 버리고, 개수가 넘치면 5개까지만 쓴다.
  const personal = normalized
    .filter((item) => item.kind === "personal")
    .slice(0, 5)
    .map((item) => ({ ...item, neededCount: 1 }));
  if (personal.length === 0) {
    throw new Error("AI 응답에 각자 챙길 준비물이 없습니다.");
  }

  return personal;
}

async function requestAiItems(context) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = compact({
    title: context.schedule.title || "모임",
    eventType: context.eventContext,
    date: context.schedule.date,
    dateInfo: context.dateTraits,
    time: context.timeTraits,
    place: {
      name: context.schedule.location || context.schedule.locationaddress || null,
      category: context.locationCategory,
    },
    otherPlaces: context.additionalPlaces,
    weather: context.weather,
    weatherLocation: context.weatherLocation,
    airQuality: context.air,
    participantCount: context.participantCount,
  });

  let lastParseError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "모임 준비물 추천 도우미입니다. 반드시 JSON 객체만 반환하세요. schema: {\"items\":[{\"name\":\"문자열\",\"kind\":\"personal|shared\",\"reason\":\"추천 근거를 짧게\",\"basis\":\"weather|place|time|event|date|people|air\",\"neededCount\":1}]}. 각자 챙길 것(kind=personal)만 3~5개 추천하고, 같이 준비할 것(shared)은 절대 추천하지 마세요. 사용자 메시지(JSON)에는 약속 이름, 약속 종류(eventType), 날짜 특성(dateInfo), 시간(time), 장소와 장소 종류(place), 함께 가고 싶은 다른 장소(otherPlaces), 날씨(weather), 대기질(airQuality), 참여 인원이 들어 있고, 없는 항목은 생략됩니다. eventType이 있으면 가장 중요한 힌트로 삼고, 없으면 약속 이름에서 성격을 추론하세요. 장소 종류(예: 볼링장→양말, 고깃집→머리끈·탈취제, 공원·바다→돗자리·선크림, 술집→신분증, 공연장→티켓·신분증), 시간(밤늦게 끝나면 막차 확인·보조배터리, 하루종일이면 충전기·편한 신발), 날씨와 대기질(비→우산, 미세먼지 나쁨→마스크), 날짜(공휴일·시즌), 참여 인원을 반영해 약속에 특화된 항목을 추천하세요. 지갑·휴대폰처럼 너무 뻔한 것은 빼세요. reason은 근거를 15자 안팎으로 짧게 쓰고(예: \"볼링장 · 양말 필수\", \"밤 11시 종료 · 막차 확인\"), basis에는 그 근거의 종류를 하나 넣으세요. 이모지는 쓰지 마세요. 모든 항목의 kind는 \"personal\", neededCount는 1로 하세요.",
          },
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
        max_completion_tokens: 4000,
      }),
      signal: AbortSignal.timeout(20000),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error(
        "OpenAI API 응답 오류:",
        response.status,
        payload?.error?.message || response.statusText
      );
      const aiError = new Error("AI 준비물 추천에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      aiError.status = 502;
      throw aiError;
    }

    try {
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("AI 응답 내용이 비어 있습니다.");
      }
      return validateAiResponse(JSON.parse(content), context.participantCount);
    } catch (error) {
      lastParseError = error;
      console.error(`AI 응답 파싱 실패 (${attempt + 1}/2):`, error.message);
    }
  }

  const parseError = new Error("AI 응답을 읽지 못했습니다. 다시 시도해 주세요.");
  parseError.status = 502;
  parseError.cause = lastParseError;
  throw parseError;
}

async function saveRecommendations(schedule, recommendations, regenerate) {
  const client = getSupabase();
  const { data: existingItems, error: itemsError } = await client
    .from("prep_items")
    .select("id, name, kind, source")
    .eq("scheduleid", schedule.id);
  if (itemsError) {
    throw new Error(`기존 준비물을 조회하지 못했습니다: ${itemsError.message}`);
  }

  let retainedItems = existingItems || [];
  if (regenerate) {
    const aiIds = retainedItems
      .filter((item) => item.source === "ai")
      .map((item) => item.id);

    if (aiIds.length > 0) {
      const [
        { data: assignmentRows, error: assignmentsError },
        { data: checkRows, error: checksError },
      ] = await Promise.all([
        client.from("prep_assignments").select("itemid").in("itemid", aiIds),
        client
          .from("prep_checks")
          .select("itemid")
          .in("itemid", aiIds)
          .eq("checked", true),
      ]);
      if (assignmentsError) {
        throw new Error(`준비 담당 상태를 조회하지 못했습니다: ${assignmentsError.message}`);
      }
      if (checksError) {
        throw new Error(`개인 체크 상태를 조회하지 못했습니다: ${checksError.message}`);
      }

      const protectedIds = new Set([
        ...(assignmentRows || []).map((row) => row.itemid),
        ...(checkRows || []).map((row) => row.itemid),
      ]);
      const deleteIds = aiIds.filter((id) => !protectedIds.has(id));

      if (deleteIds.length > 0) {
        const { error: deleteError } = await client
          .from("prep_items")
          .delete()
          .in("id", deleteIds);
        if (deleteError) {
          throw new Error(`미사용 AI 준비물을 정리하지 못했습니다: ${deleteError.message}`);
        }
      }
      retainedItems = retainedItems.filter(
        (item) => item.source !== "ai" || protectedIds.has(item.id)
      );
    }
  }

  const existingNames = new Set(
    retainedItems.map((item) => item.name.trim().toLocaleLowerCase())
  );
  const uniqueRecommendations = recommendations.filter((item) => {
    const key = item.name.toLocaleLowerCase();
    if (existingNames.has(key)) return false;
    existingNames.add(key);
    return true;
  });

  if (uniqueRecommendations.length > 0) {
    const rows = uniqueRecommendations.map((item, index) => ({
      scheduleid: schedule.id,
      roomid: schedule.roomid,
      name: item.name,
      emoji: item.emoji,
      kind: item.kind,
      neededcount: item.neededCount,
      reason: item.reason,
      basis: item.basis,
      source: "ai",
      createdby: null,
      createdbytype: null,
      sortorder: Math.floor(Date.now() / 1000) + index,
    }));
    let { error: insertError } = await client.from("prep_items").insert(rows);
    if (insertError && /basis/.test(insertError.message || "")) {
      // basis 컬럼 마이그레이션 전에도 추천은 동작하도록 근거 종류 없이 다시 저장
      console.error("prep_items.basis 컬럼이 없어 근거 종류 없이 저장합니다.");
      ({ error: insertError } = await client
        .from("prep_items")
        .insert(rows.map(({ basis, ...row }) => row)));
    }
    if (insertError) {
      throw new Error(`AI 추천 준비물을 저장하지 못했습니다: ${insertError.message}`);
    }
  }

  const { data: finalItems, error: finalError } = await client
    .from("prep_items")
    .select("*")
    .eq("scheduleid", schedule.id)
    .order("sortorder", { ascending: true })
    .order("id", { ascending: true });

  if (finalError) {
    throw new Error(`추천 결과를 조회하지 못했습니다: ${finalError.message}`);
  }
  return finalItems || [];
}

router.get("/weather/:scheduleId", async (req, res) => {
  const scheduleId = validScheduleId(req.params.scheduleId);
  if (!scheduleId) {
    return res.status(400).json({ message: "scheduleId가 올바르지 않습니다." });
  }

  try {
    const schedule = await getSchedule(scheduleId);
    const origin = await resolveWeatherOrigin(
      schedule,
      parseUserLocation({ lat: req.query.lat, lng: req.query.lng })
    );
    const [result, air] = await Promise.all([
      getScheduleWeather(schedule, origin),
      getScheduleAir(schedule, origin),
    ]);
    return res.json({ ...result, air, needsLocation: origin.type === "none" });
  } catch (error) {
    console.error("준비물 날씨 조회 실패:", error);
    return res
      .status(error.status || 500)
      .json({ message: error.message || "날씨 정보를 조회하지 못했습니다." });
  }
});

router.post("/recommend", async (req, res) => {
  const scheduleId = validScheduleId(req.body?.scheduleId);
  if (!scheduleId) {
    return res.status(400).json({ message: "scheduleId가 필요합니다." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      message: "AI 추천을 사용하려면 backend/.env에 OPENAI_API_KEY를 설정해 주세요.",
    });
  }

  try {
    const schedule = await getSchedule(scheduleId);
    if (!schedule.date) {
      return res.status(400).json({
        message: "날짜가 정해진 일정에서 준비물을 추천받을 수 있습니다.",
      });
    }

    const origin = await resolveWeatherOrigin(
      schedule,
      parseUserLocation(req.body?.userLocation)
    );
    const [
      weatherResult,
      participantCount,
      air,
      eventContext,
      locationCategory,
      additionalPlaces,
    ] = await Promise.all([
      getScheduleWeather(schedule, origin).catch((error) => {
        console.error("날씨 없이 AI 추천을 계속합니다:", error);
        return {
          weather: null,
          weatherBasis: weatherBasisOf(origin),
          weatherSource: describeOrigin(origin),
          warning: "날씨 예보를 가져오지 못해 일정 정보만으로 추천했습니다.",
        };
      }),
      getAttendingCount(schedule),
      getScheduleAir(schedule, origin),
      getEventContext(schedule.id),
      resolveLocationCategory(schedule),
      getAdditionalPlaces(schedule.id),
    ]);
    const recommendations = await requestAiItems({
      schedule,
      weather: weatherResult.weather,
      weatherLocation: origin.label,
      air,
      eventContext,
      locationCategory,
      additionalPlaces,
      dateTraits: getDateTraits(schedule),
      timeTraits: getTimeTraits(schedule),
      participantCount,
    });
    const items = await saveRecommendations(
      schedule,
      recommendations,
      req.body?.regenerate === true
    );

    return res.json({
      weather: weatherResult.weather,
      air,
      weatherBasis: weatherResult.weatherBasis,
      weatherSource: weatherResult.weatherSource,
      ...(weatherResult.warning ? { weatherWarning: weatherResult.warning } : {}),
      items,
    });
  } catch (error) {
    console.error("AI 준비물 추천 실패:", error);
    return res
      .status(error.status || 500)
      .json({ message: error.message || "AI 준비물 추천에 실패했습니다." });
  }
});

module.exports = router;
