const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

// 정산 데이터(계좌번호·증빙)는 RLS 로 anon 접근을 막아 두었고, 이 라우트(service role)만 읽고 쓴다.
// 그래서 모든 라우트는 "요청자가 그 방의 회원/게스트인지"를 먼저 확인한다.
let admin;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getAdmin() {
  if (admin) return admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(
      503,
      "정산 기능을 사용하려면 backend/.env에 SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요."
    );
  }
  admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error("정산 처리 실패:", error);
      res
        .status(error.status || 500)
        .json({ message: error instanceof HttpError ? error.message : "정산을 처리하지 못했습니다." });
    }
  };
}

function toId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, `${label}가 올바르지 않습니다.`);
  return id;
}

// ---------------------------------------------------------------------------
// 인증: 회원은 Supabase 토큰, 게스트는 방에 등록된 guest_id(추측 불가능한 uuid)
// ---------------------------------------------------------------------------
async function authenticate(req, roomId) {
  const client = getAdmin();
  const bearer = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  const guestId = req.headers["x-guest-id"];

  if (bearer) {
    const { data, error } = await client.auth.getUser(bearer);
    if (!error && data?.user) {
      const { data: member } = await client
        .from("room_members")
        .select("id")
        .eq("roomid", roomId)
        .eq("userid", data.user.id)
        .maybeSingle();
      if (member) return { id: String(data.user.id), type: "member" };
      throw new HttpError(403, "이 방의 멤버만 이용할 수 있어요.");
    }
  }

  if (guestId && /^[0-9a-f-]{36}$/i.test(String(guestId))) {
    const { data: guest } = await client
      .from("room_guests")
      .select("id")
      .eq("roomid", roomId)
      .eq("id", String(guestId))
      .maybeSingle();
    if (guest) return { id: String(guest.id), type: "guest" };
    throw new HttpError(403, "이 방의 멤버만 이용할 수 있어요.");
  }

  throw new HttpError(401, "로그인하거나 게스트로 입장한 뒤 이용해 주세요.");
}

// 방과 무관한 기능(내 계좌)용: 로그인한 회원 토큰만 인정한다. 게스트는 계정이 없어 쓸 수 없다.
async function authenticateMember(req) {
  const bearer = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const { data, error } = await getAdmin().auth.getUser(bearer);
    if (!error && data?.user) return { id: String(data.user.id) };
  }
  throw new HttpError(401, "로그인한 회원만 이용할 수 있어요.");
}

async function getSchedule(scheduleId) {
  const { data, error } = await getAdmin()
    .from("confirmed_schedules")
    .select("id, roomid, title, date, starttime, endtime, isallday, location, absentees")
    .eq("id", scheduleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "확정 일정을 찾을 수 없어요.");
  return data;
}

async function getParticipants(roomId, absentees = []) {
  const client = getAdmin();
  const [{ data: members, error: memberError }, { data: guests, error: guestError }] =
    await Promise.all([
      client.from("room_members").select("userid, nickname").eq("roomid", roomId),
      client.from("room_guests").select("id, nickname").eq("roomid", roomId),
    ]);
  if (memberError) throw new Error(memberError.message);
  if (guestError) throw new Error(guestError.message);

  const userIds = (members || []).map((member) => member.userid);
  const { data: profiles } = userIds.length
    ? await client.from("profiles").select("id, nickname").in("id", userIds)
    : { data: [] };
  const profileNames = new Map((profiles || []).map((profile) => [profile.id, profile.nickname]));
  const absent = new Set((absentees || []).map(String));

  return [
    ...(members || []).map((member) => ({
      id: String(member.userid),
      type: "member",
      nickname: member.nickname || profileNames.get(member.userid) || "멤버",
      absent: absent.has(String(member.userid)),
    })),
    ...(guests || []).map((guest) => ({
      id: String(guest.id),
      type: "guest",
      nickname: guest.nickname || "게스트",
      absent: absent.has(String(guest.id)),
    })),
  ];
}

// "1000-1234-5678" -> "1000-****-****", "100012345678" -> "1000-****-****"
function maskAccount(accountNumber) {
  if (!accountNumber) return null;
  const value = String(accountNumber).trim();
  if (value.includes("-")) {
    const [first, ...rest] = value.split("-");
    return [first, ...rest.map((part) => "*".repeat(Math.max(part.length, 4)))].join("-");
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "*".repeat(digits.length);
  return `${digits.slice(0, 4)}-****-****`;
}

function normalizeAccountNumber(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!/^[0-9-]{4,30}$/.test(text)) {
    throw new HttpError(400, "계좌번호는 숫자와 -만 입력할 수 있어요.");
  }
  return text;
}

function key(participant) {
  return `${participant.type}:${participant.id}`;
}

function sanitizeOcrRaw(value) {
  if (!value || typeof value !== "object") return null;
  return JSON.stringify(value).length <= 20000 ? value : null;
}

// ---------------------------------------------------------------------------
// 이미지 업로드 / OCR
//   * 이미지는 메모리에서만 다루고 서버 디스크에는 남기지 않는다.
//   * OpenAI 로 보낸 뒤에는 버린다. 증빙은 등록 후 receipts 버킷에만 저장한다.
// ---------------------------------------------------------------------------
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const OCR_TIMEOUT_MS = 20000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

function receiveImage(req, res, next) {
  upload.single("image")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "이미지는 10MB 이하만 올릴 수 있어요." });
    }
    console.error("이미지 업로드 수신 실패:", error.message);
    return res.status(400).json({ message: "이미지를 받지 못했어요. 다시 선택해 주세요." });
  });
}

// 긴 변 1600px 로 줄이고(비용·속도), 회전 정보를 반영해 JPEG 로 통일한다.
async function prepareImage(file) {
  if (!file) throw new HttpError(400, "이미지를 선택해 주세요.");
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    throw new HttpError(415, "JPG, PNG 이미지만 올릴 수 있어요.");
  }
  try {
    return await sharp(file.buffer, { failOn: "none" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (error) {
    console.error("이미지 변환 실패:", error.message);
    throw new HttpError(422, "이미지를 읽지 못했어요. JPG나 PNG로 다시 올려 주세요.");
  }
}

const OCR_SCHEMA = {
  name: "payment_capture",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sourceType", "confidence", "candidates"],
    properties: {
      sourceType: { type: "string", enum: ["receipt", "bank_capture", "card_capture", "unknown"] },
      confidence: { type: "number" },
      // 이미지에서 찾은 개별 결제 한 건 한 건. 영수증 한 장이면 1개, 카드 앱 내역 목록이면 여러 개.
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["storeName", "totalAmount", "paidAt", "paymentMethod", "lineItems", "isCancelled"],
          properties: {
            storeName: { type: ["string", "null"] },
            totalAmount: { type: ["integer", "null"] },
            paidAt: { type: ["string", "null"] },
            paymentMethod: { type: "string", enum: ["card", "transfer", "cash", "unknown"] },
            lineItems: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "amount"],
                properties: { name: { type: "string" }, amount: { type: ["integer", "null"] } },
              },
            },
            isCancelled: { type: "boolean" },
          },
        },
      },
    },
  },
};

const OCR_SYSTEM_PROMPT = [
  "영수증 사진이나 은행·카드 앱 결제 내역 캡처에서 결제 정보를 읽어 JSON으로만 답하세요.",
  "- candidates: 이미지에서 찾은 개별 결제를 한 건씩 담습니다. 영수증 한 장이면 1건, 카드 앱 결제 내역 목록처럼 여러 건이 보이면 보이는 결제를 모두(최대 20건) 담으세요.",
  "- totalAmount: 그 결제의 최종 결제 금액(합계/결제금액/승인금액). 부가세·할인·봉사료가 따로 있으면 최종 결제 금액을 쓰세요.",
  "- 금액은 쉼표와 '원' 없이 정수로 쓰세요. 마이너스(-) 금액이면 취소 건입니다.",
  "- 승인취소·결제취소·환불된 건은 isCancelled를 true로 하세요. 취소 내역과, 그 취소로 상쇄된 원래 승인 건 둘 다 true입니다.",
  "- '이번 달 누적', '누적 사용금액', '총 이용금액'처럼 여러 결제를 합친 누적·합계 금액은 결제가 아니므로 candidates에 넣지 마세요. 금액으로도 쓰지 마세요.",
  "- paidAt: 결제 일시를 ISO 8601(한국 시간이면 +09:00)로 쓰세요. 시간 없이 날짜만 보이면 'YYYY-MM-DD'만 쓰세요. 연도가 없으면 오늘 날짜 기준으로 가장 가까운 과거 날짜로 보세요.",
  "- 은행 앱 이체 캡처라면 storeName에 받는 사람 또는 가게 이름을 넣고 sourceType은 bank_capture, 카드 앱 결제 캡처면 card_capture, 종이 영수증이면 receipt로 하세요.",
  "- lineItems는 그 결제의 품목과 금액이고 없으면 빈 배열입니다.",
  "- 읽을 수 없는 값은 null로 두고 절대 지어내지 마세요. 영수증이 아닌 이미지는 candidates를 빈 배열로, confidence를 0에 가깝게 하세요.",
  "- confidence는 0~1 사이로 전체 인식의 확신 정도입니다.",
].join("\n");

const OCR_FAILURE_MESSAGE = "인식하지 못했어요. 직접 입력해 주세요.";

function normalizePaidAt(value) {
  if (!value || typeof value !== "string") return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return Number.isNaN(Date.parse(`${text}T00:00:00+09:00`)) ? null : text;
  }
  const naive = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/);
  const time = Date.parse(naive ? `${naive[1]}T${naive[2]}:00+09:00` : text);
  if (Number.isNaN(time)) return null;
  const year = new Date(time).getUTCFullYear();
  if (year < 2000 || year > new Date().getUTCFullYear() + 1) return null;
  return new Date(time).toISOString();
}

const MAX_OCR_CANDIDATES = 20;

function normalizeCandidate(raw) {
  const warnings = [];
  const totalAmount =
    Number.isInteger(raw.totalAmount) && raw.totalAmount > 0 && raw.totalAmount <= 1_000_000_000
      ? raw.totalAmount
      : null;
  const storeName = typeof raw.storeName === "string" && raw.storeName.trim()
    ? raw.storeName.trim().slice(0, 60)
    : null;
  const lineItems = (Array.isArray(raw.lineItems) ? raw.lineItems : [])
    .filter((item) => item && typeof item.name === "string" && item.name.trim())
    .map((item) => ({
      name: item.name.trim().slice(0, 60),
      amount: Number.isInteger(item.amount) ? item.amount : null,
    }));

  const itemTotal = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  if (
    totalAmount != null &&
    lineItems.length > 0 &&
    lineItems.every((item) => item.amount != null) &&
    itemTotal !== totalAmount
  ) {
    warnings.push(
      `품목 합계(${itemTotal.toLocaleString("ko-KR")}원)와 결제 금액(${totalAmount.toLocaleString("ko-KR")}원)이 달라요. 합계가 맞는지 확인해 주세요.`
    );
  }

  return {
    storeName,
    totalAmount,
    paidAt: normalizePaidAt(raw.paidAt),
    paymentMethod: raw.paymentMethod || "unknown",
    lineItems,
    warnings,
  };
}

// 취소된 건, 금액이 마이너스인 건, "누적" 금액은 후보에서 뺀다. (모델이 놓친 경우를 서버에서 한 번 더 거른다)
function isUsableCandidate(raw) {
  if (!raw || raw.isCancelled === true) return false;
  if (Number.isInteger(raw.totalAmount) && raw.totalAmount <= 0) return false;
  if (typeof raw.storeName === "string" && /누적/.test(raw.storeName)) return false;
  return true;
}

function sameStore(a, b) {
  const clean = (value) => (typeof value === "string" ? value.replace(/\s+/g, "").toLowerCase() : "");
  return clean(a.storeName) !== "" && clean(a.storeName) === clean(b.storeName);
}

// 취소 내역(취소 표시 또는 마이너스 금액)이 있으면, 그 취소로 상쇄된 원래 승인 건도 함께 뺀다.
// 모델이 취소 내역만 표시하고 원래 승인 건을 놓치는 경우를 서버에서 보완한다.
function dropCancelledPairs(rawList) {
  const list = rawList.filter(Boolean);
  const cancellations = list.filter(
    (item) => item.isCancelled === true || (Number.isInteger(item.totalAmount) && item.totalAmount < 0)
  );
  const removed = new Set(cancellations);

  cancellations.forEach((cancellation) => {
    const amount = Math.abs(cancellation.totalAmount ?? 0);
    if (amount === 0) return;
    const original = list.find(
      (item) =>
        !removed.has(item) &&
        item.isCancelled !== true &&
        item.totalAmount === amount &&
        sameStore(item, cancellation)
    );
    if (original) removed.add(original);
  });

  return list.filter((item) => !removed.has(item));
}

function normalizeOcrResult(raw) {
  const warnings = [];
  const confidence = Math.min(1, Math.max(0, Number(raw.confidence) || 0));

  const seen = new Set();
  const candidates = dropCancelledPairs(Array.isArray(raw.candidates) ? raw.candidates : [])
    .filter(isUsableCandidate)
    .map(normalizeCandidate)
    // 아무것도 읽지 못한 후보는 뺀다.
    .filter((candidate) => candidate.storeName || candidate.totalAmount != null || candidate.paidAt)
    // 같은 결제가 두 번 읽힌 경우를 하나로 합친다.
    .filter((candidate) => {
      const signature = `${candidate.storeName}|${candidate.totalAmount}|${candidate.paidAt}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .slice(0, MAX_OCR_CANDIDATES);

  if (confidence < 0.5) warnings.push("인식이 확실하지 않아요. 내용을 꼭 확인해 주세요.");

  return {
    sourceType: raw.sourceType || "unknown",
    confidence,
    candidates,
    warnings,
  };
}

async function recognizeReceipt(jpeg) {
  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_schema", json_schema: OCR_SCHEMA },
        max_completion_tokens: 4000,
        messages: [
          { role: "system", content: OCR_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `오늘 날짜는 ${today}입니다. 이 이미지의 결제 정보를 읽어 주세요.` },
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
  } catch (error) {
    console.error("OCR 호출 실패:", error.name, error.message);
    throw new HttpError(504, OCR_FAILURE_MESSAGE);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("OCR OpenAI 응답 오류:", response.status, payload?.error?.message);
    throw new HttpError(502, OCR_FAILURE_MESSAGE);
  }

  let raw;
  try {
    raw = JSON.parse(payload?.choices?.[0]?.message?.content);
  } catch {
    console.error("OCR 응답 JSON 파싱 실패");
    throw new HttpError(502, OCR_FAILURE_MESSAGE);
  }

  const result = normalizeOcrResult(raw);
  // 사용할 수 있는 결제를 하나도 찾지 못했다면 실패로 본다.
  if (result.candidates.length === 0) {
    throw new HttpError(422, OCR_FAILURE_MESSAGE);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 응답 만들기
// ---------------------------------------------------------------------------
// 결제자를 뺀 참여자들의 송금 진행 현황
function shareProgress(shares) {
  return {
    total: shares.length,
    settled: shares.filter((share) => share.sentat || share.confirmedat).length,
    confirmed: shares.filter((share) => share.confirmedat).length,
  };
}

async function buildExpenseDetail(expense, viewer) {
  const client = getAdmin();
  const [{ data: shares, error: shareError }, schedule] = await Promise.all([
    client.from("expense_shares").select("*").eq("expenseid", expense.id).order("id", { ascending: true }),
    getSchedule(expense.scheduleid),
  ]);
  if (shareError) throw new Error(shareError.message);

  const participants = await getParticipants(expense.roomid, schedule.absentees);
  const byKey = new Map(participants.map((participant) => [key(participant), participant]));
  const nameOf = (type, id) => byKey.get(`${type}:${id}`)?.nickname || "참여자";

  const payerKey = `${expense.payertype}:${expense.payerid}`;
  const viewerKey = `${viewer.type}:${viewer.id}`;
  const shareRows = (shares || []).map((share) => ({
    id: share.id,
    memberid: share.memberid,
    membertype: share.membertype,
    nickname: nameOf(share.membertype, share.memberid),
    amount: share.amount,
    sentat: share.sentat,
    confirmedat: share.confirmedat,
    isMe: `${share.membertype}:${share.memberid}` === viewerKey,
    isPayer: `${share.membertype}:${share.memberid}` === payerKey,
  }));

  return {
    expense: {
      id: expense.id,
      scheduleid: expense.scheduleid,
      roomid: expense.roomid,
      title: expense.title,
      amount: expense.amount,
      paidat: expense.paidat,
      payer: { id: expense.payerid, type: expense.payertype, nickname: nameOf(expense.payertype, expense.payerid) },
      bankname: expense.bankname,
      accountMasked: maskAccount(expense.accountnumber),
      hasAccount: Boolean(expense.accountnumber),
      splitmode: expense.splitmode,
      source: expense.source,
      hasReceipt: Boolean(expense.receiptpath),
      createdby: { id: expense.createdby, type: expense.createdbytype },
      createdat: expense.createdat,
    },
    shares: shareRows,
    progress: shareProgress(shareRows.filter((share) => !share.isPayer)),
    schedule: { id: schedule.id, title: schedule.title, date: schedule.date, starttime: schedule.starttime },
    viewer: {
      ...viewer,
      isPayer: viewerKey === payerKey,
      isCreator: viewerKey === `${expense.createdbytype}:${expense.createdby}`,
      myShare: shareRows.find((share) => share.isMe)?.amount ?? null,
    },
  };
}

async function loadExpense(expenseId) {
  const { data, error } = await getAdmin().from("expenses").select("*").eq("id", expenseId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "정산을 찾을 수 없어요.");
  if (data.isdeleted) throw new HttpError(410, "삭제된 정산이에요.");
  return data;
}

// ---------------------------------------------------------------------------
// 라우트
// ---------------------------------------------------------------------------

async function getSavedAccount(viewer) {
  if (viewer.type !== "member") return null;
  const { data } = await getAdmin()
    .from("user_payment_accounts")
    .select("bankname, accountnumber")
    .eq("userid", viewer.id)
    .maybeSingle();
  return data?.accountnumber ? { bankname: data.bankname || "", accountnumber: data.accountnumber } : null;
}

// 정산 화면에 필요한 일정·참여자·내 정보
router.get(
  "/schedules/:scheduleId/context",
  handle(async (req, res) => {
    const schedule = await getSchedule(toId(req.params.scheduleId, "scheduleId"));
    const viewer = await authenticate(req, schedule.roomid);
    const participants = await getParticipants(schedule.roomid, schedule.absentees);

    res.json({
      schedule: {
        id: schedule.id,
        roomid: schedule.roomid,
        title: schedule.title,
        date: schedule.date,
        starttime: schedule.starttime,
        location: schedule.location,
      },
      participants: participants.map((participant) => ({
        ...participant,
        isMe: key(participant) === `${viewer.type}:${viewer.id}`,
      })),
      viewer,
      myAccount: await getSavedAccount(viewer),
    });
  })
);

// 요청 본문 하나를 검증해서 create_expense RPC 에 넘길 payload 로 만든다.
function buildExpensePayload(body, schedule, viewer) {
  const title = String(body.title || "").trim();
  if (!title) throw new HttpError(400, "지출 항목을 입력해 주세요.");
  if (title.length > 60) throw new HttpError(400, "지출 항목은 60자까지 입력할 수 있어요.");

  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000_000) {
    throw new HttpError(400, "결제 금액은 1원 이상의 정수로 입력해 주세요.");
  }

  let paidat = null;
  if (body.paidat) {
    const time = Date.parse(body.paidat);
    if (Number.isNaN(time)) throw new HttpError(400, "결제 일시가 올바르지 않아요.");
    paidat = new Date(time).toISOString();
  }

  if (!["member", "guest"].includes(body.payertype) || !body.payerid) {
    throw new HttpError(400, "결제자를 선택해 주세요.");
  }

  const splitmode = body.splitmode === "custom" ? "custom" : "equal";
  const shares = Array.isArray(body.shares) ? body.shares : [];
  if (shares.length === 0) throw new HttpError(400, "참여 인원을 1명 이상 선택해 주세요.");
  if (shares.some((share) => !Number.isInteger(share.amount) || share.amount < 0)) {
    throw new HttpError(400, "분배 금액은 0원 이상의 정수여야 해요.");
  }
  const total = shares.reduce((sum, share) => sum + share.amount, 0);
  if (total !== amount) {
    throw new HttpError(400, "분배 금액의 합계가 결제 금액과 달라요.");
  }
  // 균등 분배라면 모두 (몫) 또는 (몫+1)이고, +1 의 개수가 나머지와 같아야 한다.
  if (splitmode === "equal") {
    const base = Math.floor(amount / shares.length);
    const extra = amount - base * shares.length;
    const valid =
      shares.every((share) => share.amount === base || share.amount === base + 1) &&
      shares.filter((share) => share.amount === base + 1).length === (extra === 0 ? 0 : extra);
    if (!valid) throw new HttpError(400, "균등 분배 금액이 올바르지 않아요.");
  }

  return {
    scheduleid: schedule.id,
    roomid: schedule.roomid,
    title,
    amount,
    paidat,
    payerid: String(body.payerid),
    payertype: body.payertype,
    bankname: body.bankname ? String(body.bankname).slice(0, 30) : null,
    accountnumber: normalizeAccountNumber(body.accountnumber),
    splitmode,
    source: body.source === "ocr" ? "ocr" : "manual",
    receiptpath: null,
    ocrraw: sanitizeOcrRaw(body.ocrraw),
    createdby: viewer.id,
    createdbytype: viewer.type,
    shares: shares.map((share) => ({
      memberid: String(share.memberid),
      membertype: share.membertype,
      amount: share.amount,
    })),
  };
}

function translateRpcError(error) {
  console.error("지출 저장 RPC 실패:", error.message);
  if (/not a (member|guest)|invalid participant/.test(error.message)) {
    return new HttpError(400, "이 방의 참여자만 결제자나 분배 대상이 될 수 있어요.");
  }
  if (/does not match/.test(error.message)) {
    return new HttpError(400, "분배 금액의 합계가 결제 금액과 달라요.");
  }
  return new Error(error.message);
}

// 여러 건을 한 트랜잭션(create_expense_batch)으로 저장한다.
// 아직 마이그레이션 전이라 함수가 없으면 건별로 저장하고, 중간에 실패하면 먼저 저장한 건을 지운다.
async function createExpenses(payloads) {
  const client = getAdmin();
  const { data, error } = await client.rpc("create_expense_batch", { payload: { expenses: payloads } });
  if (!error) return data;
  if (error.code !== "PGRST202") throw translateRpcError(error);

  const ids = [];
  try {
    for (const payload of payloads) {
      const { data: id, error: itemError } = await client.rpc("create_expense", { payload });
      if (itemError) throw translateRpcError(itemError);
      ids.push(id);
    }
  } catch (failure) {
    if (ids.length > 0) await client.from("expenses").delete().in("id", ids);
    throw failure;
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 채팅 공유 / 알림
// ---------------------------------------------------------------------------
async function getSenderProfile(roomId, viewer) {
  const client = getAdmin();
  if (viewer.type === "member") {
    const [{ data: member }, { data: profile }] = await Promise.all([
      client.from("room_members").select("nickname").eq("roomid", roomId).eq("userid", viewer.id).maybeSingle(),
      client.from("profiles").select("nickname, profileimageurl").eq("id", viewer.id).maybeSingle(),
    ]);
    return {
      nickname: member?.nickname || profile?.nickname || "멤버",
      profileimageurl: profile?.profileimageurl || null,
    };
  }
  const { data: guest } = await client.from("room_guests").select("nickname").eq("id", viewer.id).maybeSingle();
  return { nickname: guest?.nickname || "게스트", profileimageurl: null };
}

// rows: [{ receiverId, receiverType, type, title, message, link }]
async function sendNotifications(roomId, senderId, rows) {
  if (rows.length === 0) return;
  const client = getAdmin();

  const { data: room } = await client.from("rooms").select("roomname").eq("id", roomId).maybeSingle();
  const prefix = room?.roomname ? `[${room.roomname}] ` : "";

  // 일정 알림 설정을 끈 사람에게는 토스트 없이 조용히(issilent) 쌓는다.
  const memberIds = rows.filter((row) => row.receiverType === "member").map((row) => row.receiverId);
  const guestIds = rows.filter((row) => row.receiverType === "guest").map((row) => row.receiverId);
  const [{ data: memberSettings }, { data: guestSettings }] = await Promise.all([
    memberIds.length
      ? client.from("room_members").select("userid, schedulenotifenabled").eq("roomid", roomId).in("userid", memberIds)
      : { data: [] },
    guestIds.length
      ? client.from("room_guests").select("id, schedulenotifenabled").eq("roomid", roomId).in("id", guestIds)
      : { data: [] },
  ]);
  const silent = new Set([
    ...(memberSettings || []).filter((row) => row.schedulenotifenabled === false).map((row) => String(row.userid)),
    ...(guestSettings || []).filter((row) => row.schedulenotifenabled === false).map((row) => String(row.id)),
  ]);

  const { error } = await client.from("notifications").insert(
    rows.map((row) => ({
      roomid: roomId,
      receiverid: String(row.receiverId),
      senderid: senderId ? String(senderId) : null,
      type: row.type,
      title: row.title,
      message: `${prefix}${row.message}`,
      link: row.link,
      isread: false,
      issilent: silent.has(String(row.receiverId)),
    }))
  );
  if (error) throw new Error(error.message);
}

// 등록한 지출을 방 채팅에 카드로 올리고, 관련된 사람에게 알림을 보낸다. (실패해도 등록은 유지)
async function shareExpenses(schedule, viewer, details) {
  const sender = await getSenderProfile(schedule.roomid, viewer);
  const expenseIds = details.map((detail) => detail.expense.id);

  const { error: chatError } = await getAdmin().from("room_messages").insert({
    roomid: schedule.roomid,
    userid: viewer.type === "member" ? viewer.id : null,
    nickname: sender.nickname,
    profileimageurl: sender.profileimageurl,
    content: JSON.stringify({ __type: "settlement", scheduleid: schedule.id, expenseIds }),
    imageurl: null,
  });
  if (chatError) throw new Error(`채팅 공유 실패: ${chatError.message}`);

  // 받는 사람별로 "보낼 돈"과 "받을 돈"을 합쳐서 한 번만 알린다.
  const viewerKey = `${viewer.type}:${viewer.id}`;
  const people = new Map();
  const touch = (type, id) => {
    const key = `${type}:${id}`;
    if (!people.has(key)) people.set(key, { id, type, owe: 0, receive: 0 });
    return people.get(key);
  };
  details.forEach((detail) => {
    const payerKey = `${detail.expense.payer.type}:${detail.expense.payer.id}`;
    detail.shares.forEach((share) => {
      if (`${share.membertype}:${share.memberid}` === payerKey) return;
      touch(share.membertype, share.memberid).owe += share.amount;
      touch(detail.expense.payer.type, detail.expense.payer.id).receive += share.amount;
    });
  });

  const link =
    details.length === 1
      ? `/schedules/${schedule.id}/settlement/${expenseIds[0]}`
      : `/schedules/${schedule.id}/settlement`;
  const rows = [...people.values()]
    .filter((person) => `${person.type}:${person.id}` !== viewerKey)
    .map((person) => ({
      receiverId: person.id,
      receiverType: person.type,
      type: "settlement_request",
      title: "정산 요청이 도착했어요",
      message:
        person.owe > 0
          ? `${sender.nickname}님이 정산을 요청했어요. 내가 보낼 금액 ${person.owe.toLocaleString("ko-KR")}원`
          : `${sender.nickname}님이 지출을 등록했어요. 받을 금액 ${person.receive.toLocaleString("ko-KR")}원`,
      link,
    }));
  await sendNotifications(schedule.roomid, viewer.id, rows);
}

async function shareSafely(schedule, viewer, details) {
  try {
    await shareExpenses(schedule, viewer, details);
    return true;
  } catch (error) {
    console.error("정산 공유 실패:", error.message);
    return false;
  }
}

// 지출 한 건 등록
router.post(
  "/schedules/:scheduleId/expenses",
  handle(async (req, res) => {
    const schedule = await getSchedule(toId(req.params.scheduleId, "scheduleId"));
    const viewer = await authenticate(req, schedule.roomid);
    const [expenseId] = await createExpenses([buildExpensePayload(req.body || {}, schedule, viewer)]);
    const detail = await buildExpenseDetail(await loadExpense(expenseId), viewer);
    const shared = await shareSafely(schedule, viewer, [detail]);
    res.status(201).json({ ...detail, shared });
  })
);

// 정산하기: 지출 여러 건을 한 번에 등록 (모두 저장되거나 모두 취소)
router.post(
  "/schedules/:scheduleId/expenses/batch",
  handle(async (req, res) => {
    const schedule = await getSchedule(toId(req.params.scheduleId, "scheduleId"));
    const viewer = await authenticate(req, schedule.roomid);

    const list = Array.isArray(req.body?.expenses) ? req.body.expenses : [];
    if (list.length === 0) throw new HttpError(400, "등록할 지출이 없어요.");
    if (list.length > 20) throw new HttpError(400, "한 번에 20건까지 등록할 수 있어요.");

    const payloads = list.map((item) => buildExpensePayload(item || {}, schedule, viewer));
    const ids = await createExpenses(payloads);
    const expenses = await Promise.all(
      ids.map(async (id) => buildExpenseDetail(await loadExpense(id), viewer))
    );
    const shared = await shareSafely(schedule, viewer, expenses);
    res.status(201).json({ expenses, shared });
  })
);

// 정산 내역: 이 약속의 지출 목록과 내 정산 요약
router.get(
  "/schedules/:scheduleId/expenses",
  handle(async (req, res) => {
    const schedule = await getSchedule(toId(req.params.scheduleId, "scheduleId"));
    const viewer = await authenticate(req, schedule.roomid);
    const client = getAdmin();

    const { data: expenses, error } = await client
      .from("expenses")
      .select("*")
      .eq("scheduleid", schedule.id)
      .eq("isdeleted", false)
      .order("paidat", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (expenses || []).map((expense) => expense.id);
    const { data: shares } = ids.length
      ? await client.from("expense_shares").select("*").in("expenseid", ids)
      : { data: [] };
    const participants = await getParticipants(schedule.roomid, schedule.absentees);
    const nameByKey = new Map(participants.map((participant) => [key(participant), participant.nickname]));
    const viewerKey = `${viewer.type}:${viewer.id}`;

    let totalAmount = 0;
    let mySend = 0;
    let myReceive = 0;
    const items = (expenses || []).map((expense) => {
      const payerKey = `${expense.payertype}:${expense.payerid}`;
      const own = (shares || []).filter((share) => share.expenseid === expense.id);
      const others = own.filter((share) => `${share.membertype}:${share.memberid}` !== payerKey);
      const mine = own.find((share) => `${share.membertype}:${share.memberid}` === viewerKey);
      const settled = (share) => Boolean(share.sentat || share.confirmedat);

      totalAmount += expense.amount;
      // 남은 정산액: 아직 보냈어요/받았어요 처리가 안 된 금액만 합친다.
      if (mine && payerKey !== viewerKey && !settled(mine)) mySend += mine.amount;
      if (payerKey === viewerKey) {
        myReceive += others.filter((share) => !settled(share)).reduce((sum, share) => sum + share.amount, 0);
      }

      return {
        id: expense.id,
        title: expense.title,
        amount: expense.amount,
        paidat: expense.paidat,
        payer: { id: expense.payerid, type: expense.payertype, nickname: nameByKey.get(payerKey) || "참여자" },
        participantCount: own.length,
        hasReceipt: Boolean(expense.receiptpath),
        myShare: mine ? mine.amount : null,
        iPaid: payerKey === viewerKey,
        progress: shareProgress(others),
      };
    });

    res.json({
      schedule: { id: schedule.id, roomid: schedule.roomid, title: schedule.title, date: schedule.date },
      summary: { count: items.length, totalAmount, mySend, myReceive },
      expenses: items,
    });
  })
);

// 채팅 카드용: 여러 지출의 요약을 보는 사람 기준으로 한 번에 돌려준다. (/expenses/:id 보다 먼저 선언)
router.get(
  "/expenses/summary",
  handle(async (req, res) => {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value) && value > 0)
      .slice(0, 20);
    if (ids.length === 0) throw new HttpError(400, "ids가 필요해요.");

    const client = getAdmin();
    const { data: rows, error } = await client.from("expenses").select("*").in("id", ids);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new HttpError(404, "정산을 찾을 수 없어요.");
    if (new Set(rows.map((row) => row.roomid)).size > 1) throw new HttpError(400, "같은 방의 정산만 조회할 수 있어요.");

    const roomId = rows[0].roomid;
    const viewer = await authenticate(req, roomId);
    const live = rows.filter((row) => !row.isdeleted);
    const { data: shares } = live.length
      ? await client.from("expense_shares").select("*").in("expenseid", live.map((row) => row.id))
      : { data: [] };
    const schedule = await getSchedule(rows[0].scheduleid);
    const participants = await getParticipants(roomId, schedule.absentees);
    const nameByKey = new Map(participants.map((participant) => [key(participant), participant.nickname]));
    const viewerKey = `${viewer.type}:${viewer.id}`;

    const items = ids.map((id) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) return { id, deleted: true };
      if (row.isdeleted) return { id, deleted: true };

      const payerKey = `${row.payertype}:${row.payerid}`;
      const own = (shares || []).filter((share) => share.expenseid === id);
      const others = own.filter((share) => `${share.membertype}:${share.memberid}` !== payerKey);
      const mine = own.find((share) => `${share.membertype}:${share.memberid}` === viewerKey);
      const settled = (share) => Boolean(share.sentat || share.confirmedat);
      const unsent = others.filter((share) => !settled(share));

      return {
        id,
        title: row.title,
        amount: row.amount,
        paidat: row.paidat,
        payer: { id: row.payerid, type: row.payertype, nickname: nameByKey.get(payerKey) || "참여자" },
        bankname: row.bankname,
        accountMasked: maskAccount(row.accountnumber),
        hasAccount: Boolean(row.accountnumber),
        hasReceipt: Boolean(row.receiptpath),
        isParticipant: Boolean(mine) || payerKey === viewerKey,
        iPaid: payerKey === viewerKey,
        myShare: mine ? mine.amount : null,
        mySettled: mine ? settled(mine) : false,
        receivable: {
          amount: unsent.reduce((sum, share) => sum + share.amount, 0),
          people: unsent.length,
        },
        progress: shareProgress(others),
      };
    });

    res.json({ scheduleid: rows[0].scheduleid, roomid: roomId, items });
  })
);

// 정산 상세
router.get(
  "/expenses/:expenseId",
  handle(async (req, res) => {
    const expense = await loadExpense(toId(req.params.expenseId, "expenseId"));
    const viewer = await authenticate(req, expense.roomid);
    res.json(await buildExpenseDetail(expense, viewer));
  })
);

// 참여자 본인이 "보냈어요"를 누르거나 취소한다. 결제자는 받는 사람이라 대상이 아니다.
router.post(
  "/expenses/:expenseId/sent",
  handle(async (req, res) => {
    const expense = await loadExpense(toId(req.params.expenseId, "expenseId"));
    const viewer = await authenticate(req, expense.roomid);
    const sent = req.body?.sent !== false;

    if (`${expense.payertype}:${expense.payerid}` === `${viewer.type}:${viewer.id}`) {
      throw new HttpError(400, "결제자는 보낼 금액이 없어요.");
    }

    const client = getAdmin();
    const { data: share } = await client
      .from("expense_shares")
      .select("*")
      .eq("expenseid", expense.id)
      .eq("membertype", viewer.type)
      .eq("memberid", viewer.id)
      .maybeSingle();
    if (!share) throw new HttpError(403, "이 정산의 참여자만 처리할 수 있어요.");
    if (!sent && share.confirmedat) {
      throw new HttpError(409, "결제자가 이미 받았다고 확인해서 취소할 수 없어요.");
    }

    const { error } = await client
      .from("expense_shares")
      .update({ sentat: sent ? new Date().toISOString() : null })
      .eq("id", share.id);
    if (error) throw new Error(error.message);

    if (sent && !share.sentat) {
      try {
        const sender = await getSenderProfile(expense.roomid, viewer);
        await sendNotifications(expense.roomid, viewer.id, [
          {
            receiverId: expense.payerid,
            receiverType: expense.payertype,
            type: "settlement_sent",
            title: "정산 금액을 보냈어요",
            message: `${sender.nickname}님이 "${expense.title}" ${share.amount.toLocaleString("ko-KR")}원을 보냈다고 알려왔어요. 확인해 주세요.`,
            link: `/schedules/${expense.scheduleid}/settlement/${expense.id}`,
          },
        ]);
      } catch (notifyError) {
        console.error("송금 알림 실패:", notifyError.message);
      }
    }

    res.json(await buildExpenseDetail(expense, viewer));
  })
);

// 결제자가 "받았어요"로 확인하거나 되돌린다.
router.post(
  "/expenses/:expenseId/shares/:shareId/confirm",
  handle(async (req, res) => {
    const expense = await loadExpense(toId(req.params.expenseId, "expenseId"));
    const viewer = await authenticate(req, expense.roomid);
    if (`${expense.payertype}:${expense.payerid}` !== `${viewer.type}:${viewer.id}`) {
      throw new HttpError(403, "결제자만 받았다고 확인할 수 있어요.");
    }

    const client = getAdmin();
    const { data: share } = await client
      .from("expense_shares")
      .select("*")
      .eq("id", toId(req.params.shareId, "shareId"))
      .eq("expenseid", expense.id)
      .maybeSingle();
    if (!share) throw new HttpError(404, "참여자를 찾을 수 없어요.");
    if (`${share.membertype}:${share.memberid}` === `${viewer.type}:${viewer.id}`) {
      throw new HttpError(400, "결제자 본인 몫은 확인할 필요가 없어요.");
    }

    const confirmed = req.body?.confirmed !== false;
    const { error } = await client
      .from("expense_shares")
      .update({ confirmedat: confirmed ? new Date().toISOString() : null })
      .eq("id", share.id);
    if (error) throw new Error(error.message);

    if (confirmed && !share.confirmedat) {
      try {
        const payer = await getSenderProfile(expense.roomid, viewer);
        await sendNotifications(expense.roomid, viewer.id, [
          {
            receiverId: share.memberid,
            receiverType: share.membertype,
            type: "settlement_received",
            title: "정산 금액을 확인했어요",
            message: `${payer.nickname}님이 "${expense.title}" ${share.amount.toLocaleString("ko-KR")}원을 받았다고 확인했어요.`,
            link: `/schedules/${expense.scheduleid}/settlement/${expense.id}`,
          },
        ]);
      } catch (notifyError) {
        console.error("확인 알림 실패:", notifyError.message);
      }
    }

    res.json(await buildExpenseDetail(expense, viewer));
  })
);

const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;

// 아직 안 보낸 참여자에게 다시 알린다. (결제자 또는 등록한 사람만, 같은 사람에게는 6시간에 한 번)
router.post(
  "/expenses/:expenseId/remind",
  handle(async (req, res) => {
    const expense = await loadExpense(toId(req.params.expenseId, "expenseId"));
    const viewer = await authenticate(req, expense.roomid);
    const viewerKey = `${viewer.type}:${viewer.id}`;
    const payerKey = `${expense.payertype}:${expense.payerid}`;
    if (viewerKey !== payerKey && viewerKey !== `${expense.createdbytype}:${expense.createdby}`) {
      throw new HttpError(403, "결제자나 등록한 사람만 다시 알림을 보낼 수 있어요.");
    }

    const client = getAdmin();
    const { data: shares } = await client.from("expense_shares").select("*").eq("expenseid", expense.id);
    // 결제자와 알림을 누르는 본인은 대상에서 뺀다.
    const pending = (shares || []).filter(
      (share) =>
        `${share.membertype}:${share.memberid}` !== payerKey &&
        `${share.membertype}:${share.memberid}` !== viewerKey &&
        !share.sentat &&
        !share.confirmedat
    );
    if (pending.length === 0) throw new HttpError(400, "아직 보내지 않은 사람이 없어요.");

    const link = `/schedules/${expense.scheduleid}/settlement/${expense.id}`;
    const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
    const { data: recent } = await client
      .from("notifications")
      .select("receiverid")
      .eq("type", "settlement_reminder")
      .eq("link", link)
      .gte("createdat", since)
      .in("receiverid", pending.map((share) => share.memberid));
    const recentlyReminded = new Set((recent || []).map((row) => String(row.receiverid)));
    const targets = pending.filter((share) => !recentlyReminded.has(String(share.memberid)));
    if (targets.length === 0) {
      throw new HttpError(429, "방금 알림을 보냈어요. 잠시 후에 다시 보낼 수 있어요.");
    }

    const payer = await getSenderProfile(expense.roomid, {
      id: expense.payerid,
      type: expense.payertype,
    });
    await sendNotifications(
      expense.roomid,
      viewer.id,
      targets.map((share) => ({
        receiverId: share.memberid,
        receiverType: share.membertype,
        type: "settlement_reminder",
        title: "정산 금액을 보내 주세요",
        message: `${payer.nickname}님에게 "${expense.title}" ${share.amount.toLocaleString("ko-KR")}원을 보내야 해요.`,
        link,
      }))
    );

    res.json({ notified: targets.length, skipped: pending.length - targets.length });
  })
);

// 증빙 이미지: 방 멤버에게만 짧게 만료되는 주소를 준다.
router.get(
  "/expenses/:expenseId/receipt",
  handle(async (req, res) => {
    const expense = await loadExpense(toId(req.params.expenseId, "expenseId"));
    await authenticate(req, expense.roomid);
    if (!expense.receiptpath) throw new HttpError(404, "등록된 증빙 이미지가 없어요.");

    const { data, error } = await getAdmin().storage.from("receipts").createSignedUrl(expense.receiptpath, 60);
    if (error || !data?.signedUrl) throw new Error(error?.message || "증빙 이미지 주소를 만들지 못했어요.");

    const uploader = await getSenderProfile(expense.roomid, {
      id: expense.createdby,
      type: expense.createdbytype,
    });
    res.json({ url: data.signedUrl, uploader: uploader.nickname });
  })
);

// 지출을 등록한 사람이나 결제자만 수정·삭제할 수 있다.
function assertCanManage(expense, viewer) {
  const viewerKey = `${viewer.type}:${viewer.id}`;
  if (
    viewerKey !== `${expense.createdbytype}:${expense.createdby}` &&
    viewerKey !== `${expense.payertype}:${expense.payerid}`
  ) {
    throw new HttpError(403, "지출을 등록한 사람이나 결제자만 수정하거나 삭제할 수 있어요.");
  }
}

// 수정에 쓰이는 알림 대상: 정산에 얽힌 사람(참여자 + 결제자) 중 처리한 본인은 뺀다.
function affectedPeople(expense, shares, viewer) {
  const viewerKey = `${viewer.type}:${viewer.id}`;
  const map = new Map();
  shares.forEach((share) => map.set(`${share.membertype}:${share.memberid}`, { id: share.memberid, type: share.membertype }));
  map.set(`${expense.payertype}:${expense.payerid}`, { id: expense.payerid, type: expense.payertype });
  map.delete(viewerKey);
  return [...map.values()];
}

// 지출 수정: 등록할 때와 같은 본문. 금액이 그대로인 참여자의 송금 기록은 유지된다.
router.put(
  "/expenses/:expenseId",
  handle(async (req, res) => {
    const expense = await loadExpense(toId(req.params.expenseId, "expenseId"));
    const viewer = await authenticate(req, expense.roomid);
    assertCanManage(expense, viewer);

    const schedule = await getSchedule(expense.scheduleid);
    const payload = buildExpensePayload(req.body || {}, schedule, viewer);
    // 증빙 이미지는 수정으로 지워지지 않게 키 자체를 뺀다.
    delete payload.receiptpath;

    const { error } = await getAdmin().rpc("update_expense", { p_expenseid: expense.id, payload });
    if (error) throw translateRpcError(error);

    const updated = await loadExpense(expense.id);
    const detail = await buildExpenseDetail(updated, viewer);

    try {
      const editor = await getSenderProfile(expense.roomid, viewer);
      await sendNotifications(
        expense.roomid,
        viewer.id,
        affectedPeople(updated, detail.shares.map((share) => ({ membertype: share.membertype, memberid: share.memberid })), viewer).map(
          (person) => ({
            receiverId: person.id,
            receiverType: person.type,
            type: "settlement_updated",
            title: "정산이 수정됐어요",
            message: `${editor.nickname}님이 "${updated.title}" 정산을 수정했어요. 금액을 다시 확인해 주세요.`,
            link: `/schedules/${expense.scheduleid}/settlement/${expense.id}`,
          })
        )
      );
    } catch (notifyError) {
      console.error("수정 알림 실패:", notifyError.message);
    }

    res.json(detail);
  })
);

// 지출 삭제: 목록에서 숨기고(복구용 기록은 남김) 증빙 이미지는 지운다. 채팅 카드는 "삭제된 정산"으로 보인다.
router.delete(
  "/expenses/:expenseId",
  handle(async (req, res) => {
    const expense = await loadExpense(toId(req.params.expenseId, "expenseId"));
    const viewer = await authenticate(req, expense.roomid);
    assertCanManage(expense, viewer);

    const client = getAdmin();
    const { data: shares } = await client.from("expense_shares").select("membertype, memberid").eq("expenseid", expense.id);

    const { error } = await client
      .from("expenses")
      .update({ isdeleted: true, receiptpath: null, updatedat: new Date().toISOString() })
      .eq("id", expense.id);
    if (error) throw new Error(error.message);

    if (expense.receiptpath) {
      const { error: removeError } = await client.storage.from("receipts").remove([expense.receiptpath]);
      if (removeError) console.error("증빙 이미지 삭제 실패:", removeError.message);
    }

    try {
      const editor = await getSenderProfile(expense.roomid, viewer);
      await sendNotifications(
        expense.roomid,
        viewer.id,
        affectedPeople(expense, shares || [], viewer).map((person) => ({
          receiverId: person.id,
          receiverType: person.type,
          type: "settlement_deleted",
          title: "정산이 삭제됐어요",
          message: `${editor.nickname}님이 "${expense.title}" 정산을 삭제했어요.`,
          link: `/schedules/${expense.scheduleid}/settlement`,
        }))
      );
    } catch (notifyError) {
      console.error("삭제 알림 실패:", notifyError.message);
    }

    res.json({ deleted: true });
  })
);

// 내 계좌 저장 (회원 전용). 다음 지출 등록 때 결제자가 나면 자동으로 채워진다.
router.put(
  "/me/account",
  handle(async (req, res) => {
    const member = await authenticateMember(req);
    const accountnumber = normalizeAccountNumber(req.body?.accountnumber);
    if (!accountnumber) throw new HttpError(400, "계좌번호를 입력해 주세요.");
    const bankname = req.body?.bankname ? String(req.body.bankname).slice(0, 30) : null;

    const { error } = await getAdmin()
      .from("user_payment_accounts")
      .upsert({ userid: member.id, bankname, accountnumber, updatedat: new Date().toISOString() }, { onConflict: "userid" });
    if (error) throw new Error(error.message);

    res.json({ account: { bankname: bankname || "", accountnumber } });
  })
);

// 계좌 복사: 이때만 전체 번호를 내려준다.
router.get(
  "/expenses/:expenseId/account",
  handle(async (req, res) => {
    const expense = await loadExpense(toId(req.params.expenseId, "expenseId"));
    await authenticate(req, expense.roomid);
    if (!expense.accountnumber) throw new HttpError(404, "등록된 계좌가 없어요.");
    res.json({ bankname: expense.bankname, accountnumber: expense.accountnumber });
  })
);

// 영수증/결제 캡처 이미지 1장을 읽어 입력값을 돌려준다. (scheduleId 로 방 멤버 확인)
router.post(
  "/ocr",
  receiveImage,
  handle(async (req, res) => {
    const schedule = await getSchedule(toId(req.body?.scheduleId, "scheduleId"));
    await authenticate(req, schedule.roomid);
    if (!process.env.OPENAI_API_KEY) {
      throw new HttpError(503, "AI 인식을 사용할 수 없어요. 직접 입력해 주세요.");
    }
    const jpeg = await prepareImage(req.file);
    res.json(await recognizeReceipt(jpeg));
  })
);

// 증빙 이미지 저장: 지출을 등록한 사람이 등록 직후 올린다. (비공개 receipts 버킷)
router.post(
  "/expenses/:expenseId/receipt",
  receiveImage,
  handle(async (req, res) => {
    const expense = await loadExpense(toId(req.params.expenseId, "expenseId"));
    const viewer = await authenticate(req, expense.roomid);
    if (`${viewer.type}:${viewer.id}` !== `${expense.createdbytype}:${expense.createdby}`) {
      throw new HttpError(403, "지출을 등록한 사람만 증빙 이미지를 올릴 수 있어요.");
    }

    const jpeg = await prepareImage(req.file);
    const path = `${expense.roomid}/${expense.id}/${crypto.randomUUID()}.jpg`;
    const client = getAdmin();
    const { error: uploadError } = await client.storage
      .from("receipts")
      .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { error: updateError } = await client
      .from("expenses")
      .update({ receiptpath: path, updatedat: new Date().toISOString() })
      .eq("id", expense.id);
    if (updateError) {
      await client.storage.from("receipts").remove([path]);
      throw new Error(updateError.message);
    }
    if (expense.receiptpath) await client.storage.from("receipts").remove([expense.receiptpath]);

    res.status(201).json({ hasReceipt: true });
  })
);

module.exports = router;
