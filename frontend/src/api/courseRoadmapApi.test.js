import { supabase } from "../lib/supabaseClient";
import { getFinalizedCourse } from "./courseFinalizationApi";
import { getCurrentRoomParticipantInfo } from "./courseApi";
import { getFinalizedRoadmap, shareFinalizedCourse } from "./courseRoadmapApi";
import { mockDatabase } from "../testUtils/mockDatabase";
import { externalMapLink, mapPlaces, numberInfo, orderedStops, parseCourseShare } from "../utils/courseRoadmapUtils";

jest.mock("../lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
jest.mock("./courseApi", () => ({ getCurrentRoomParticipantInfo: jest.fn() }));
jest.mock("./courseFinalizationApi", () => ({ getFinalizedCourse: jest.fn(), readResult: async (query) => {
  const result = await query; if (result.error) throw result.error; return result.data;
} }));
let db;
let state;
let result;
beforeEach(() => {
  db = { confirmed_schedules: [{ id: 3, roomid: 2, date: "2026-11-01" }], rooms: [{ id: 2, roomname: "모임" }],
    profiles: [{ id: "u", nickname: "회원" }], room_guests: [{ id: "g", roomid: 2, nickname: "손님" }], room_messages: [] };
  state = mockDatabase(supabase, db);
  result = { schedule_id: 3, course_id: 20, course: { id: 20, room_id: 2, schedule_id: 3, course_name: "최종 코스",
    stops: [{ id: 2, stop_order: 2, place_name: "둘", latitude: 37.1, longitude: 127.1 }, { id: 1, stop_order: 1, place_name: "하나", latitude: null, longitude: 127 }] } };
  getFinalizedCourse.mockReset().mockImplementation(async () => result);
  getCurrentRoomParticipantInfo.mockReset().mockResolvedValue({ participantType: "member", participantId: "u" });
});

test("저장된 최종 코스와 정렬된 장소만 조회", async () => {
  const roadmap = await getFinalizedRoadmap(2, 3);
  expect(roadmap.course.stops.map((s) => s.place_name)).toEqual(["하나", "둘"]);
  expect(mapPlaces(roadmap.course.stops)[0].orderNumber).toBe(2);
});
test("최종 확정 전에는 null", async () => {
  result = null;
  expect(await getFinalizedRoadmap(2, 3)).toBeNull();
  await expect(shareFinalizedCourse(2, 3)).rejects.toThrow("최종 확정된 코스가 없습니다");
});
test("다른 모임의 일정 경로는 최종 조회 전 거부", async () => {
  await expect(getFinalizedRoadmap(99, 3)).rejects.toBeDefined();
  expect(getFinalizedCourse).not.toHaveBeenCalled();
});
test.each(["room", "schedule", "course"])("공유 %s ID 변조 거부", async (kind) => {
  if (kind === "room") result.course.room_id = 99;
  if (kind === "schedule") result.course.schedule_id = 99;
  await expect(getFinalizedRoadmap(2, 3, kind === "course" ? 99 : 20)).rejects.toThrow("일치하지 않습니다");
});
test("참여자 확인 실패 시 차단", async () => {
  getCurrentRoomParticipantInfo.mockRejectedValue(new Error("참여자 아님"));
  await expect(getFinalizedRoadmap(2, 3)).rejects.toThrow("참여자 아님");
});
test("회원 채팅 공유는 기존 메시지 컬럼에 버전 있는 참조 저장", async () => {
  await shareFinalizedCourse(2, 3);
  expect(db.room_messages[0]).toMatchObject({ roomid: 2, userid: "u", nickname: "회원", imageurl: null });
  expect(parseCourseShare(db.room_messages[0].content)).toEqual({ __type: "finalized_course", version: 1, roomId: "2", scheduleId: "3", courseId: "20" });
});
test("게스트 공유는 기존 게스트 UUID와 닉네임 사용", async () => {
  getCurrentRoomParticipantInfo.mockResolvedValue({ participantType: "guest", participantId: "g" });
  await shareFinalizedCourse(2, 3);
  expect(db.room_messages[0]).toMatchObject({ userid: "g", nickname: "손님" });
});
test("전송 실패는 재시도 중복 가능성 안내", async () => {
  state.fail = "room_messages:insert";
  await expect(shareFinalizedCourse(2, 3)).rejects.toThrow("중복 메시지");
  expect(db.room_messages).toHaveLength(0);
});
test("장소 좌표 및 순서와 지도 번호 일치, 잘못된 좌표 제외", () => {
  const stops = orderedStops([{ stop_order: 3, latitude: 91, longitude: 127 }, { stop_order: 1, latitude: "", longitude: 127 }, { stop_order: 2, latitude: 37, longitude: 127 }]);
  expect(mapPlaces(stops).map((p) => p.orderNumber)).toEqual([2]);
  expect(mapPlaces(orderedStops([{ latitude: null, longitude: null }]))).toEqual([]);
});
test.each([null, undefined, "", "invalid", -1])("누락·잘못된 시간/비용은 0으로 만들지 않음: %s", (value) => {
  expect(numberInfo(value, "분")).toBe("정보 없음");
});
test("저장된 0은 실제 0으로 표시", () => { expect(numberInfo(0, "원")).toBe("0원"); });
test("검증된 지도 링크만 생성", () => {
  expect(externalMapLink({ place_source: "kakao", place_id: "123" })).toBe("https://place.map.kakao.com/123");
  expect(externalMapLink({ place_id: "javascript:alert(1)" })).toBeNull();
  expect(externalMapLink({ place_name: "카페", latitude: 37, longitude: 127 })).toContain("37,127");
});
test("기존 텍스트·다른 카드는 유지, 잘못된 코스 JSON은 안전하게 구분", () => {
  expect(parseCourseShare("일반 메시지")).toBeNull();
  expect(parseCourseShare('{"__type":"vote"}')).toBeNull();
  expect(parseCourseShare('{"__type":"finalized_course",')).toEqual({ invalid: true });
  expect(parseCourseShare('{"__type":"finalized_course","version":2}')).toEqual({ invalid: true });
});
