import { supabase } from "../lib/supabaseClient";
import { mockDatabase } from "../testUtils/mockDatabase";
import { createLightningMeeting, getMeetingDiaryProgress, getMeetingWithCurrentPlace, getRoomMeetings } from "./meetupDiaryApi";

jest.mock("../lib/supabaseClient", () => ({ supabase: { from: jest.fn(), rpc: jest.fn(), auth: { getSession: jest.fn() } } }));
beforeEach(() => jest.clearAllMocks());
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

test("기존 약속의 기록은 현재 만날 장소를 사용한다", async () => {
  mockDatabase(supabase, {
    confirmed_schedules: [{ id: 3, roomid: 2, location: "서울숲", locationaddress: "서울 성동구 뚝섬로" }],
  });
  const meeting = { source_type: "confirmed_schedule", source_schedule_id: 3, location: "예전 장소", location_address: "예전 주소" };

  await expect(getMeetingWithCurrentPlace(2, meeting)).resolves.toMatchObject({
    location: "서울숲",
    location_address: "서울 성동구 뚝섬로",
  });
});

test("기존 약속의 장소가 미정으로 바뀌면 예전 장소를 표시하지 않는다", async () => {
  mockDatabase(supabase, {
    confirmed_schedules: [{ id: 3, roomid: 2, location: null, locationaddress: null }],
  });
  const meeting = { source_type: "confirmed_schedule", source_schedule_id: 3, location: "예전 장소" };

  await expect(getMeetingWithCurrentPlace(2, meeting)).resolves.toMatchObject({ location: null });
});

test("번개 만남은 저장된 장소를 그대로 사용한다", async () => {
  const meeting = { source_type: "lightning", location: "한강공원" };
  expect(await getMeetingWithCurrentPlace(2, meeting)).toBe(meeting);
  expect(supabase.from).not.toHaveBeenCalled();
});

test("참여자를 선택하지 않으면 전체 멤버로 대체하지 않고 빈 선택을 저장한다", async () => {
  supabase.rpc.mockResolvedValue({ data: "meeting-1", error: null });
  await createLightningMeeting({ roomId: 2, date: "2026-11-03", title: "혼자 산책", requestId: "request-1" });
  expect(supabase.rpc).toHaveBeenCalledWith("create_room_lightning_meeting", expect.objectContaining({ p_participant_actor_ids: [] }));
});

test("번개 기록 진행 인원은 저장된 참여자 기준이다", async () => {
  supabase.rpc.mockResolvedValue({ data: { published_count: 1, target_count: 3, published_member_ids: ["me"] }, error: null });
  await expect(getMeetingDiaryProgress("meeting-1", { source_type: "lightning", participant_user_ids: ["me"] }))
    .resolves.toEqual({ published_count: 1, target_count: 1, published_member_ids: ["me"] });
});

function mockLightningQuery() {
  const query = {
    select: () => query, eq: () => query, order: () => query,
    range: async () => ({ data: [{ id: "meeting-1", source_type: "lightning" }], error: null }),
  };
  supabase.from.mockReturnValue(query);
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
}

test("캘린더는 참여자 API에 JSON을 요청하고 실제 참여자를 연결한다", async () => {
  mockLightningQuery();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, headers: { get: () => "application/json; charset=utf-8" },
    json: async () => ({ participantsByMeeting: { "meeting-1": ["me"] } }) });
  await expect(getRoomMeetings(7)).resolves.toEqual([{ id: "meeting-1", source_type: "lightning", participant_user_ids: ["me"] }]);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/diary/rooms/7/participants"), expect.objectContaining({
    headers: expect.objectContaining({ Accept: "application/json", Authorization: "Bearer test-token" }),
  }));
});

test("HTML 응답은 JSON으로 파싱하지 않고 연결 오류를 안내한다", async () => {
  mockLightningQuery();
  const json = jest.fn().mockRejectedValue(new SyntaxError("Unexpected token '<'"));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, headers: { get: () => "text/html" }, json });
  await expect(getRoomMeetings(7)).rejects.toThrow("API 서버에 연결하지 못했습니다.");
  expect(json).not.toHaveBeenCalled();
});

test("JSON 형식의 로그인 오류 메시지는 그대로 전달한다", async () => {
  mockLightningQuery();
  global.fetch = jest.fn().mockResolvedValue({ ok: false, headers: { get: () => "application/json" },
    json: async () => ({ message: "로그인을 다시 해 주세요." }) });
  await expect(getRoomMeetings(7)).rejects.toThrow("로그인을 다시 해 주세요.");
});
