import { supabase } from "../lib/supabaseClient";
import { getCurrentRoomParticipantInfo } from "./courseApi";

jest.mock("../lib/supabaseClient", () => ({ supabase: { auth: { getUser: jest.fn() }, from: jest.fn() } }));

beforeEach(() => {
  localStorage.clear();
  supabase.from.mockReset();
});

function membership(data) {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data, error: null }) };
  supabase.from.mockReturnValue(query);
}

test("인증 세션 없는 기존 게스트는 방 참여 기록으로 조회", async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
  localStorage.setItem("guest_id", "guest-uuid");
  membership({ id: "guest-uuid", roomid: 2 });
  await expect(getCurrentRoomParticipantInfo(2)).resolves.toMatchObject({ participantType: "guest", participantId: "guest-uuid" });
});

test("인증된 회원은 남은 게스트 ID로 우회하지 않음", async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "member-uuid" } }, error: null });
  localStorage.setItem("guest_id", "guest-uuid");
  membership(null);
  await expect(getCurrentRoomParticipantInfo(2)).rejects.toThrow("참여자가 아닙니다");
  expect(supabase.from).toHaveBeenCalledTimes(1);
});

test("세션 검증 오류를 게스트로 우회하지 않음", async () => {
  supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "NetworkError" } });
  await expect(getCurrentRoomParticipantInfo(2)).rejects.toThrow("로그인 정보");
});
