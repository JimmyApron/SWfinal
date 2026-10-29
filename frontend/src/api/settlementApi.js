import { supabase } from "../lib/supabaseClient";
import { getApiBaseUrl } from "./apiBaseUrl";

// 정산 데이터(계좌번호·증빙)는 DB에서 직접 읽지 못하게 막혀 있어서 전부 백엔드를 거친다.
// 회원은 로그인 토큰, 게스트는 guest_id 로 "그 방 사람인지" 확인한다.
async function buildHeaders(extra = {}) {
  const headers = { ...extra };
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const guestId = localStorage.getItem("guest_id");
  if (guestId) headers["X-Guest-Id"] = guestId;
  return headers;
}

async function requestSettlement(path, { json, ...options } = {}) {
  const headers = await buildHeaders(json ? { "Content-Type": "application/json" } : {});
  const response = await fetch(`${getApiBaseUrl()}/settlement${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
    ...(json ? { body: JSON.stringify(json) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || "정산 서비스를 사용할 수 없습니다.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function getSettlementContext(scheduleId) {
  return requestSettlement(`/schedules/${encodeURIComponent(scheduleId)}/context`);
}

// 정산하기: 지출 여러 건을 한 번에 등록한다. (모두 저장되거나 모두 취소)
export function createExpenseBatch(scheduleId, expenses) {
  return requestSettlement(`/schedules/${encodeURIComponent(scheduleId)}/expenses/batch`, {
    method: "POST",
    json: { expenses },
  });
}

export function createExpense(scheduleId, payload) {
  return requestSettlement(`/schedules/${encodeURIComponent(scheduleId)}/expenses`, {
    method: "POST",
    json: payload,
  });
}

// 영수증/결제 캡처 이미지 1장을 읽어 입력값을 받는다. (이미지는 서버에 남지 않는다)
export function ocrReceipt(scheduleId, file) {
  const formData = new FormData();
  formData.append("scheduleId", String(scheduleId));
  formData.append("image", file);
  return requestSettlement("/ocr", { method: "POST", body: formData });
}

// 지출 등록 직후 증빙 이미지를 비공개 저장소에 올린다.
export function uploadReceipt(expenseId, file) {
  const formData = new FormData();
  formData.append("image", file);
  return requestSettlement(`/expenses/${encodeURIComponent(expenseId)}/receipt`, {
    method: "POST",
    body: formData,
  });
}

// 정산 내역: 이 약속의 지출 목록과 내 정산 요약
export function listExpenses(scheduleId) {
  return requestSettlement(`/schedules/${encodeURIComponent(scheduleId)}/expenses`);
}

// 채팅 카드용 요약 (보는 사람 기준)
export function getExpenseSummaries(ids) {
  return requestSettlement(`/expenses/summary?ids=${ids.map(encodeURIComponent).join(",")}`);
}

// 참여자 본인이 "보냈어요"를 누르거나 취소한다.
export function markExpenseSent(expenseId, sent) {
  return requestSettlement(`/expenses/${encodeURIComponent(expenseId)}/sent`, {
    method: "POST",
    json: { sent },
  });
}

// 결제자가 "받았어요"로 확인하거나 되돌린다.
export function confirmExpenseShare(expenseId, shareId, confirmed) {
  return requestSettlement(
    `/expenses/${encodeURIComponent(expenseId)}/shares/${encodeURIComponent(shareId)}/confirm`,
    { method: "POST", json: { confirmed } }
  );
}

// 아직 안 보낸 참여자에게 다시 알린다.
export function remindExpense(expenseId) {
  return requestSettlement(`/expenses/${encodeURIComponent(expenseId)}/remind`, { method: "POST" });
}

// 증빙 이미지의 짧게 만료되는 주소
export function getReceiptUrl(expenseId) {
  return requestSettlement(`/expenses/${encodeURIComponent(expenseId)}/receipt`);
}

// 지출 수정 (등록한 사람 또는 결제자). 본문은 등록할 때와 같다.
export function updateExpense(expenseId, payload) {
  return requestSettlement(`/expenses/${encodeURIComponent(expenseId)}`, { method: "PUT", json: payload });
}

// 지출 삭제 (등록한 사람 또는 결제자)
export function deleteExpense(expenseId) {
  return requestSettlement(`/expenses/${encodeURIComponent(expenseId)}`, { method: "DELETE" });
}

// 내 계좌 저장 (회원 전용)
export function saveMyAccount(account) {
  return requestSettlement("/me/account", { method: "PUT", json: account });
}

export function getExpenseDetail(expenseId) {
  return requestSettlement(`/expenses/${encodeURIComponent(expenseId)}`);
}

export function getExpenseAccount(expenseId) {
  return requestSettlement(`/expenses/${encodeURIComponent(expenseId)}/account`);
}

export const SETTLEMENT_BANKS = [
  "토스뱅크",
  "카카오뱅크",
  "케이뱅크",
  "국민은행",
  "신한은행",
  "우리은행",
  "하나은행",
  "NH농협은행",
  "IBK기업은행",
  "SC제일은행",
  "씨티은행",
  "우체국",
  "새마을금고",
  "신협",
  "수협",
  "부산은행",
  "대구은행",
  "광주은행",
  "전북은행",
  "경남은행",
  "제주은행",
  "산업은행",
];

export function formatWon(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

// 1/N 균등 분배: 몫은 floor, 나머지 r원은 무작위 r명에게 1원씩. (키 배열을 순서대로 받아 몫을 돌려준다)
export function drawRemainderKeys(keys, amount) {
  const remainder = amount % keys.length;
  const pool = [...keys];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, remainder);
}

export function buildEqualShares(keys, amount, extraKeys) {
  const base = Math.floor(amount / keys.length);
  const extras = new Set(extraKeys);
  return keys.map((key) => ({ key, amount: base + (extras.has(key) ? 1 : 0) }));
}
