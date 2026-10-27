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
      "id, roomid, title, date, starttime, endtime, isallday, location, locationaddress, locationlat, locationlng, absentees"
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

function getWeatherBasis(schedule) {
  const lat = Number(schedule.locationlat);
  const lng = Number(schedule.locationlng);
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
    ? "place"
    : "none";
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
      description: selected.entry.weather?.[0]?.description || "날씨 정보",
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
    description: entry.weather?.[0]?.description || "날씨 정보",
    precipitationProbability: Math.round(Number(entry.pop || 0) * 100),
    temperature: Number.isFinite(Number(entry.main?.temp))
      ? Math.round(Number(entry.main.temp))
      : null,
    temperatureMin: null,
    temperatureMax: null,
  };
}

async function getScheduleWeather(schedule, { logErrors = true } = {}) {
  const weatherBasis = getWeatherBasis(schedule);
  if (weatherBasis !== "place" || !schedule.date) {
    return { weather: null, weatherBasis };
  }

  const apiKey =
    process.env.OPENWEATHERMAP_API_KEY || process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return { weather: null, weatherBasis };

  const cacheKey = [
    schedule.id,
    schedule.date,
    schedule.starttime || "",
    schedule.locationlat,
    schedule.locationlng,
  ].join(":");
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
  url.searchParams.set("lat", String(schedule.locationlat));
  url.searchParams.set("lon", String(schedule.locationlng));
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
  const value = { weather, weatherBasis };
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
      emoji: typeof item.emoji === "string" ? item.emoji.slice(0, 16) : null,
      kind: item.kind,
      reason: typeof item.reason === "string" ? item.reason.trim().slice(0, 200) : null,
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

  const personalCount = normalized.filter((item) => item.kind === "personal").length;
  const sharedCount = normalized.filter((item) => item.kind === "shared").length;
  if (
    personalCount < 3 ||
    personalCount > 5 ||
    sharedCount > 3 ||
    (participantCount === 0 && sharedCount > 0)
  ) {
    throw new Error("AI 응답의 준비물 개수가 기준에 맞지 않습니다.");
  }

  return normalized;
}

async function requestAiItems(context) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = {
    title: context.schedule.title || "모임",
    date: context.schedule.date,
    starttime: context.schedule.starttime,
    endtime: context.schedule.endtime,
    allDay: Boolean(context.schedule.isallday || !context.schedule.starttime),
    location: context.schedule.location || context.schedule.locationaddress || null,
    weather: context.weather,
    participantCount: context.participantCount,
  };

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
              "모임 준비물 추천 도우미입니다. 반드시 JSON 객체만 반환하세요. schema: {\"items\":[{\"name\":\"문자열\",\"emoji\":\"이모지\",\"kind\":\"personal|shared\",\"reason\":\"추천 이유\",\"neededCount\":1}]}. personal 준비물은 3~5개, shared 준비물은 0~3개만 추천하세요. 모임 이름과 날짜/시간/장소/날씨/참여 인원에 맞춰 실용적으로 추천하고, 개인적으로 챙길 항목은 개인용으로, 함께 사거나 한 명이 준비할 항목은 shared로 분류하세요. shared의 neededCount는 참여 인원을 넘기지 마세요. 개인 준비물의 neededCount는 1로 하세요.",
          },
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
        temperature: 0.6,
        max_tokens: 1200,
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
      source: "ai",
      createdby: null,
      createdbytype: null,
      sortorder: Date.now() + index,
    }));
    const { error: insertError } = await client.from("prep_items").insert(rows);
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
    const result = await getScheduleWeather(schedule);
    return res.json(result);
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

    const [weatherResult, participantCount] = await Promise.all([
      getScheduleWeather(schedule).catch((error) => {
        console.error("날씨 없이 AI 추천을 계속합니다:", error);
        return {
          weather: null,
          weatherBasis: getWeatherBasis(schedule),
          warning: "날씨 예보를 가져오지 못해 일정 정보만으로 추천했습니다.",
        };
      }),
      getAttendingCount(schedule),
    ]);
    const recommendations = await requestAiItems({
      schedule,
      weather: weatherResult.weather,
      participantCount,
    });
    const items = await saveRecommendations(
      schedule,
      recommendations,
      req.body?.regenerate === true
    );

    return res.json({
      weather: weatherResult.weather,
      weatherBasis: weatherResult.weatherBasis,
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
