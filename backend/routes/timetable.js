const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

// 에브리타임 등 시간표 캡처 이미지를 읽어 요일별 수업 시간을 돌려준다.
//   * 이미지는 메모리에서만 다루고 저장하지 않는다. OpenAI 로 보낸 뒤 버린다.
//   * 회원 전용: Supabase 로그인 토큰을 확인한다. (backend/.env 의 SUPABASE_SERVICE_ROLE_KEY 필요)
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const OCR_TIMEOUT_MS = 30000;
const FAILURE_MESSAGE = "시간표를 인식하지 못했어요. 직접 입력해 주세요.";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

let admin;
function getAdmin() {
  if (admin) return admin;
  admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

const SCHEMA = {
  name: "timetable_capture",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["classes"],
    properties: {
      classes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "weekday", "start", "end"],
          properties: {
            name: { type: "string", description: "블록 안의 과목명" },
            // 0=일 1=월 2=화 3=수 4=목 5=금 6=토
            weekday: { type: "integer" },
            start: { type: "string", description: "24시간제 HH:MM" },
            end: { type: "string", description: "24시간제 HH:MM" },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = [
  "너는 대학생 시간표 캡처 이미지(에브리타임 등)에서 수업 블록을 읽는 도구다.",
  "각 색칠된 수업 블록마다 요일과 시작/종료 시각을 24시간제 HH:MM 으로 반환한다.",
  "요일은 월=1, 화=2, 수=3, 목=4, 금=5, 토=6, 일=0 이다.",
  "왼쪽 숫자는 그 시각 가로선의 바로 아래에 적혀 있고, 가로선 사이 간격이 1시간이다. 눈금의 1~8 은 오후(13~20시)다.",
  "수업은 정각이 아니라 30분 단위(10:30, 16:30 등)에서 시작하고 끝나는 경우가 많다.",
  "블록의 위·아래 가장자리가 가로선과 다음 가로선의 정확히 중간쯤이면 :30 으로 읽는다. 가장자리가 가로선에 맞으면 정각이다.",
  "서로 다른 과목 블록은 맞닿아 있어도 절대 하나로 합치지 말고 각각 따로 반환한다.",
  "같은 과목이 여러 요일에 있으면 요일마다 따로 반환한다. name 은 블록 안의 과목명이다. 시간표가 아니면 빈 배열을 반환한다.",
].join("\n");

function receiveImage(req, res, next) {
  upload.single("image")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "이미지는 10MB 이하만 올릴 수 있어요." });
    }
    return res.status(400).json({ message: "이미지를 받지 못했어요. 다시 선택해 주세요." });
  });
}

function toMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

function toTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// 30분 칸에 맞춰 시작은 내림, 종료는 올림하고 잘못된 값은 버린다.
function normalizeClasses(raw) {
  return (Array.isArray(raw?.classes) ? raw.classes : [])
    .map((item) => {
      const start = toMinutes(item.start);
      const end = toMinutes(item.end);
      if (!Number.isInteger(item.weekday) || item.weekday < 0 || item.weekday > 6) return null;
      if (start === null || end === null) return null;
      const snappedStart = Math.floor(start / 30) * 30;
      const snappedEnd = Math.ceil(end / 30) * 30;
      if (snappedEnd <= snappedStart) return null;
      return { weekday: item.weekday, starttime: toTime(snappedStart), endtime: toTime(snappedEnd) };
    })
    .filter(Boolean);
}

async function recognizeTimetable(jpeg) {
  // 시간표는 가로선 위치로 30분 단위를 읽어야 해서 mini 모델은 시각을 자주 틀린다. (gpt-5.4 이상 권장)
  const model = process.env.OPENAI_TIMETABLE_MODEL || "gpt-5.4";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_completion_tokens: 2000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "이 시간표 이미지의 수업 블록을 모두 읽어 주세요." },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${payload?.error?.message}`);
  }

  return normalizeClasses(JSON.parse(payload?.choices?.[0]?.message?.content));
}

router.post(
  "/ocr",
  receiveImage,
  async (req, res) => {
    try {
      if (!process.env.OPENAI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return res.status(503).json({ message: "AI 인식을 사용할 수 없어요. 직접 입력해 주세요." });
      }

      const token = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
      const { data: authData } = token ? await getAdmin().auth.getUser(token) : { data: null };
      if (!authData?.user) {
        return res.status(401).json({ message: "로그인이 필요해요." });
      }

      if (!req.file) return res.status(400).json({ message: "이미지를 선택해 주세요." });
      if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) {
        return res.status(415).json({ message: "JPG, PNG 이미지만 올릴 수 있어요." });
      }

      let jpeg;
      try {
        jpeg = await sharp(req.file.buffer, { failOn: "none" })
          .rotate()
          .resize({ width: 1600, height: 2400, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch (error) {
        console.error("시간표 이미지 변환 실패:", error.message);
        return res.status(422).json({ message: "이미지를 읽지 못했어요. JPG나 PNG로 다시 올려 주세요." });
      }

      const classes = await recognizeTimetable(jpeg);
      if (classes.length === 0) return res.status(422).json({ message: FAILURE_MESSAGE });
      res.json({ classes });
    } catch (error) {
      console.error("시간표 OCR 실패:", error.name, error.message);
      res.status(500).json({ message: FAILURE_MESSAGE });
    }
  }
);

router.recognizeTimetable = recognizeTimetable;

module.exports = router;
