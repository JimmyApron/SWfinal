import { supabase } from "../lib/supabaseClient";
import { getCurrentRoomParticipantInfo } from "./courseApi";
import { createScheduleWithCreator } from "./scheduleCreationApi";
import { getCourseConfirmationProgress, finalizeCourse, getFinalizedCourse, calculateEligibleParticipants } from "./courseFinalizationApi";
import { submitCourseVote, confirmMyVotedCourse, deactivateCourseConfirmation } from "./courseConfirmationApi";
import { createConfirmedScheduleForRoom, createDraftConfirmedSchedule, createLocationOnlyConfirmedSchedule } from "./scheduleApi";
import { confirmVote, deleteVote, updateVote, addVoteOption, updateVoteOption } from "./voteApi";
import { mockDatabase } from "../testUtils/mockDatabase";

jest.mock("../lib/supabaseClient", () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
jest.mock("./courseApi", () => ({ getCurrentRoomParticipantInfo: jest.fn(), ensureScheduleExists: jest.fn().mockResolvedValue({ id: 3, roomid: 2 }) }));
jest.mock("./notificationApi", () => ({ createRoomNotifications: jest.fn() }));
jest.mock("./mapApi", () => ({ updateRoomLocationTransportModes: jest.fn() }));

let state;
let db;
const request = { scheduleId: 3, roomId: 2, voteId: 1, courseId: 20 };
const confirmation = (type, id, course = 20) => ({ id, schedule_id: 3, course_id: course,
  participant_key: `${type}:${id}`, participant_type: type, is_active: true,
  member_user_id: type === "member" ? id : null, guest_id: type === "guest" ? id : null });

beforeEach(() => {
  getCurrentRoomParticipantInfo.mockReset().mockResolvedValue({ participantType: "member", participantId: "u", roomId: 2 });
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
  db = {
    confirmed_schedules: [{ id: 3, roomid: 2, absentees: [] }],
    room_members: [{ roomid: 2, userid: "u", nickname: "생성자" }, { roomid: 2, userid: "v", nickname: "참석자" }],
    room_guests: [{ roomid: 2, id: "g", nickname: "게스트" }],
    schedule_creation_records: [{ schedule_id: 3, created_by_type: "member", created_by_member_id: "u", created_by_guest_id: null }],
    schedule_finalizations: [],
    votes: [{ id: 1, roomid: 2, scheduleid: 3, votetype: "course" }, { id: 2, roomid: 2, scheduleid: 3, votetype: "course" }],
    voteoptions: [{ id: 10, voteid: 1, optiontype: "course" }, { id: 11, voteid: 1, optiontype: "course" }],
    vote_course_links: [{ vote_id: 1, vote_option_id: 10, course_id: 20 }, { vote_id: 1, vote_option_id: 11, course_id: 21 }],
    courses: [{ id: 20, room_id: 2, schedule_id: 3, course_name: "코스 A" }, { id: 21, room_id: 2, schedule_id: 3, course_name: "코스 B" }],
    course_stops: [{ id: 5, course_id: 20, stop_order: 1, place_name: "카페" }],
    voteresponses: ["u", "v", "g"].map((userid, id) => ({ id: id + 10, voteid: 1, optionid: 10, userid })),
    course_member_confirmations: [confirmation("member", "u"), confirmation("member", "v"), confirmation("guest", "g")],
    confirmed_locations: [],
  };
  state = mockDatabase(supabase, db);
});

test.each(["member", "guest"])("%s 일정 생성자 기록 저장", async (type) => {
  getCurrentRoomParticipantInfo.mockResolvedValue({ participantType: type, participantId: "u" });
  const result = await createScheduleWithCreator({ roomid: 2, title: "새 일정" });
  expect(result.error).toBeNull();
  expect(db.schedule_creation_records[1]).toMatchObject({ schedule_id: result.data.id, created_by_type: type,
    created_by_member_id: type === "member" ? "u" : null, created_by_guest_id: type === "guest" ? "u" : null });
});

test("생성자 기록 저장 재시도 실패는 일정 ID를 포함해 알리고 기존·신규 일정 삭제 안 함", async () => {
  state.fail = "schedule_creation_records:insert";
  const result = await createScheduleWithCreator({ roomid: 2 });
  expect(result.error.scheduleId).toBeDefined();
  expect(db.confirmed_schedules).toHaveLength(2);
  expect(state.operations.some((op) => op.action === "delete")).toBe(false);
});

test("생성자 기록 일시 오류는 재시도", async () => {
  let failed = false;
  state.fail = (table, action) => {
    if (table === "schedule_creation_records" && action === "insert" && !failed) { failed = true; return true; }
    return false;
  };
  expect((await createScheduleWithCreator({ roomid: 2 })).error).toBeNull();
});

test.each(["direct", "draft", "location", "vote"])("실제 %s 생성 경로에 생성자 기록 연결", async (path) => {
  if (path === "direct") await createConfirmedScheduleForRoom(2, { title: "일정", date: "2026-11-01" });
  if (path === "draft") await createDraftConfirmedSchedule(2, "새 일정");
  if (path === "location") await createLocationOnlyConfirmedSchedule({ roomid: 2, placename: "카페" }, true, "장소 일정");
  if (path === "vote") await confirmVote(1, { id: 10, optiondate: "2026-11-01" }, 2, "schedule", "투표 일정");
  expect(db.schedule_creation_records).toHaveLength(2);
});

test("모임 생성자라도 일정 생성자가 아니면 거부", async () => {
  db.rooms = [{ id: 2, createdby: "v" }];
  getCurrentRoomParticipantInfo.mockResolvedValue({ participantType: "member", participantId: "v" });
  await expect(finalizeCourse(request)).rejects.toThrow("일정 생성자만");
});

test("생성자 기록 없는 과거 일정은 추정 안 함", async () => {
  db.schedule_creation_records = [];
  const progress = await getCourseConfirmationProgress(request);
  expect(progress.canFinalize).toBe(false);
  expect(progress.reason).toContain("기록이 없어");
  await expect(finalizeCourse(request)).rejects.toThrow("일정 생성자만");
});

test("전원 동일 코스 확정 성공 및 STEP 07 장소 재조회", async () => {
  const result = await finalizeCourse(request);
  expect(result.course_id).toBe(20);
  expect(result.finalized_by_member_id).toBe("u");
  expect((await getFinalizedCourse(3)).course.stops[0].place_name).toBe("카페");
  expect(db.votes.every((vote) => vote.isclosed)).toBe(true);
});

test("게스트 일정 생성자 최종 확정", async () => {
  db.schedule_creation_records[0] = { schedule_id: 3, created_by_type: "guest", created_by_member_id: null, created_by_guest_id: "g" };
  getCurrentRoomParticipantInfo.mockResolvedValue({ participantType: "guest", participantId: "g" });
  expect((await finalizeCourse(request)).finalized_by_guest_id).toBe("g");
});

test("같은 UUID라도 생성자 유형이 다르면 권한 없음", async () => {
  getCurrentRoomParticipantInfo.mockResolvedValue({ participantType: "guest", participantId: "u" });
  await expect(finalizeCourse(request)).rejects.toThrow("일정 생성자만");
});

test.each(["missing", "inactive", "other", "responseMismatch", "wrongIdentity"])("%s 개인 확정이면 실패", async (mode) => {
  if (mode === "missing") db.course_member_confirmations.pop();
  if (mode === "inactive") db.course_member_confirmations[2].is_active = false;
  if (mode === "other") db.course_member_confirmations[2].course_id = 21;
  if (mode === "responseMismatch") db.voteresponses[2].optionid = 11;
  if (mode === "wrongIdentity") db.course_member_confirmations[2].guest_id = "other";
  await expect(finalizeCourse(request)).rejects.toThrow("참석자 전원");
});

test("불참자 제외 및 중복 참여자 정리", async () => {
  db.confirmed_schedules[0].absentees = ["g"];
  db.room_members.push({ ...db.room_members[0] });
  db.course_member_confirmations.pop();
  const progress = await getCourseConfirmationProgress(request);
  expect(progress.eligibleCount).toBe(2);
  expect(progress.canFinalize).toBe(true);
});

test("참석자 0명 차단", async () => {
  db.confirmed_schedules[0].absentees = ["u", "v", "g"];
  await expect(finalizeCourse(request)).rejects.toThrow("참석 대상자가 없습니다");
});

test("같은 개수라도 탈퇴자의 확정으로 누락 참석자를 대신할 수 없음", async () => {
  db.course_member_confirmations[2] = confirmation("guest", "left");
  expect((await getCourseConfirmationProgress(request)).confirmedCount).toBe(2);
  await expect(finalizeCourse(request)).rejects.toThrow("참석자 전원");
});

test("투표 안 한 실제 참여자도 참석자 집합에 포함", async () => {
  db.room_members.push({ userid: "new", roomid: 2 });
  expect((await getCourseConfirmationProgress(request)).eligibleCount).toBe(4);
  await expect(finalizeCourse(request)).rejects.toThrow("참석자 전원");
});

test("회원·게스트 UUID 충돌은 불참 배열 포함 여부와 관계없이 거부", async () => {
  db.room_guests.push({ id: "u", roomid: 2 });
  db.confirmed_schedules[0].absentees = ["u"];
  await expect(finalizeCourse(request)).rejects.toThrow("UUID가 같아");
});

test("회원과 게스트 키 구분", () => {
  expect(calculateEligibleParticipants([{ userid: "u" }], [{ id: "g" }], []).map((p) => p.participantKey)).toEqual(["member:u", "guest:g"]);
});

test.each(["room", "schedule", "link", "vote"])("%s 연결 불일치 차단", async (kind) => {
  if (kind === "room") db.courses[0].room_id = 99;
  if (kind === "schedule") db.courses[0].schedule_id = 99;
  if (kind === "link") db.vote_course_links = [];
  if (kind === "vote") request.voteId = 2;
  try { await expect(finalizeCourse(request)).rejects.toBeDefined(); }
  finally { request.voteId = 1; }
  expect(db.schedule_finalizations).toHaveLength(0);
});

test("복수 코스 투표 중 지정한 투표의 응답만 확인", async () => {
  db.voteresponses.forEach((row) => { row.voteid = 2; });
  await expect(finalizeCourse(request)).rejects.toThrow("참석자 전원");
});

test("중복·동시 최종 확정은 UNIQUE로 하나만 저장", async () => {
  await Promise.all([finalizeCourse(request), finalizeCourse(request)]);
  await finalizeCourse(request);
  expect(db.schedule_finalizations).toHaveLength(1);
});

test("이미 다른 코스로 최종 확정했다면 재확정 거부", async () => {
  await finalizeCourse(request);
  await expect(finalizeCourse({ ...request, courseId: 21 })).rejects.toThrow("이미 다른 코스");
});

test("최종 확정 후 재투표·개인 확정·해제 차단", async () => {
  await finalizeCourse(request);
  await expect(submitCourseVote(db.votes[0], [11], "u", "회원")).rejects.toThrow("변경할 수 없습니다");
  await expect(confirmMyVotedCourse(1, 2, 20)).rejects.toThrow("변경할 수 없습니다");
  await expect(deactivateCourseConfirmation({ vote: db.votes[0] })).rejects.toThrow("변경할 수 없습니다");
});

test("최종 저장 실패는 성공 표시 안 함", async () => {
  state.fail = "schedule_finalizations:insert";
  await expect(finalizeCourse(request)).rejects.toMatchObject({ message: "DB failure" });
  expect(db.schedule_finalizations).toHaveLength(0);
  expect(db.votes[0].isclosed).toBeUndefined();
});

test("진행 조회 성공 후 상태가 바뀌면 최종 저장에서 재검증", async () => {
  expect((await getCourseConfirmationProgress(request)).canFinalize).toBe(true);
  db.course_member_confirmations.pop();
  await expect(finalizeCourse(request)).rejects.toThrow("참석자 전원");
});

test("필수 조회 실패는 확정 불가", async () => {
  state.fail = "room_members:select";
  await expect(finalizeCourse(request)).rejects.toBeDefined();
  expect(db.schedule_finalizations).toHaveLength(0);
});

test("투표 종료 실패에도 저장된 최종 확정 유지, 경고 반환 및 변경 차단", async () => {
  state.fail = "votes:update";
  const result = await finalizeCourse(request);
  expect(result.voteClosurePending).toBe(true);
  expect(db.schedule_finalizations).toHaveLength(1);
  await expect(submitCourseVote(db.votes[0], [11], "u", "회원")).rejects.toThrow("변경할 수 없습니다");
});

test("최종 확정 후 코스 투표 삭제·편집·선택지 변경 차단", async () => {
  await finalizeCourse(request);
  await expect(deleteVote(1)).rejects.toThrow("변경할 수 없습니다");
  await expect(updateVote(1, { title: "수정" })).rejects.toThrow("변경할 수 없습니다");
  await expect(addVoteOption(1, "추가")).rejects.toThrow("변경할 수 없습니다");
  await expect(updateVoteOption(10, { optiontext: "수정" })).rejects.toThrow("변경할 수 없습니다");
});

test("한계 검증: 마지막 조회와 INSERT 사이 변경은 클라이언트가 원자적으로 차단할 수 없음", async () => {
  state.fail = (table, action) => {
    if (table === "schedule_finalizations" && action === "insert") db.voteresponses[2].optionid = 11;
    return false;
  };
  // Documents the remaining transaction gap; this is not a concurrency-safety guarantee.
  await finalizeCourse(request);
  expect(db.schedule_finalizations).toHaveLength(1);
  expect((await getCourseConfirmationProgress(request)).allConfirmed).toBe(false);
});
