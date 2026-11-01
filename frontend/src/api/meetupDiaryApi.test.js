import { supabase } from "../lib/supabaseClient";
import { mockDatabase } from "../testUtils/mockDatabase";
import { getMeetingWithCurrentPlace } from "./meetupDiaryApi";

jest.mock("../lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
beforeEach(() => jest.clearAllMocks());

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
