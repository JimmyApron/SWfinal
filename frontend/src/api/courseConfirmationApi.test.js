import { supabase } from "../lib/supabaseClient";
import { ensureScheduleExists, getCurrentRoomParticipantInfo } from "./courseApi";
import { confirmMyVotedCourse, getMyCourseConfirmation, getParticipantKey } from "./courseConfirmationApi";
import { submitVote } from "./voteApi";

jest.mock("../lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
jest.mock("./courseApi", () => ({ ensureScheduleExists: jest.fn(), getCurrentRoomParticipantInfo: jest.fn() }));
jest.mock("./notificationApi", () => ({ createRoomNotifications: jest.fn() }));
jest.mock("./mapApi", () => ({ updateRoomLocationTransportModes: jest.fn() }));

let db;
let fail;
let operations;
beforeEach(() => {
  db = {
    votes: [{ id: 1, roomid: 2, scheduleid: 3, votetype: "course" }],
    voteoptions: [{ id: 10, voteid: 1, optiontype: "course" }, { id: 11, voteid: 1, optiontype: "course" }],
    vote_course_links: [{ vote_id: 1, vote_option_id: 10, course_id: 20 }, { vote_id: 1, vote_option_id: 11, course_id: 21 }],
    courses: [{ id: 20, room_id: 2, schedule_id: 3 }, { id: 21, room_id: 2, schedule_id: 3 }],
    voteresponses: [{ id: 100, voteid: 1, optionid: 10, userid: "u", nickname: "회원" }],
    course_member_confirmations: [],
    schedule_finalizations: [],
  };
  fail = null;
  operations = [];
  ensureScheduleExists.mockReset().mockResolvedValue({ id: 3, roomid: 2 });
  getCurrentRoomParticipantInfo.mockReset().mockResolvedValue({ participantType: "member", participantId: "u" });
  supabase.from.mockImplementation((table) => {
    let action = "select", payload, single = false;
    const filters = [];
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push((row) => String(row[key]) === String(value)); return query; },
      in: (key, values) => { filters.push((row) => values.includes(row[key])); return query; },
      single: () => { single = true; return query; },
      maybeSingle: () => { single = true; return query; },
      insert: (rows) => { action = "insert"; payload = rows; return query; },
      update: (row) => { action = "update"; payload = row; return query; },
      delete: () => { action = "delete"; return query; },
      then: (resolve, reject) => Promise.resolve().then(() => {
        operations.push(`${table}:${action}`);
        if (fail === `${table}:${action}`) return { data: null, error: { message: "DB failure" } };
        let rows = db[table].filter((row) => filters.every((filter) => filter(row)));
        if (action === "insert") {
          if (table === "course_member_confirmations" && payload.some((newRow) => db[table].some((row) =>
            row.is_active && row.schedule_id === newRow.schedule_id && row.participant_key === newRow.participant_key))) {
            return { data: null, error: { code: "23505" } };
          }
          rows = payload.map((row, index) => ({ id: db[table].length + 200 + index, ...row }));
          db[table].push(...rows);
        }
        if (action === "update") rows.forEach((row) => Object.assign(row, payload));
        if (action === "delete") db[table] = db[table].filter((row) => !rows.includes(row));
        return { data: single ? (rows[0] ? { ...rows[0] } : null) : rows.map((row) => ({ ...row })), error: null };
      }).then(resolve, reject),
    };
    return query;
  });
});

test("투표하지 않은 참여자는 확정 불가", async () => {
  db.voteresponses = [];
  await expect(confirmMyVotedCourse(1, 2)).rejects.toThrow("투표");
  expect(db.course_member_confirmations).toHaveLength(0);
});

test("다른 사람이 선택한 코스는 확정 불가", async () => {
  db.voteresponses.push({ id: 101, voteid: 1, optionid: 11, userid: "other" });
  await expect(confirmMyVotedCourse(1, 2, 21)).rejects.toThrow("본인이 투표한");
});

test("A 확정과 새 조회(재접속)의 DB 상태 일치", async () => {
  await confirmMyVotedCourse(1, 2, 20);
  const state = await getMyCourseConfirmation(1, 2);
  expect(state.isConfirmed).toBe(true);
  expect(state.confirmation).toMatchObject({ schedule_id: 3, course_id: 20, participant_key: "member:u" });
});

test("동일 코스 반복 확정은 한 기록", async () => {
  await confirmMyVotedCourse(1, 2);
  await confirmMyVotedCourse(1, 2);
  expect(db.course_member_confirmations).toHaveLength(1);
});

test("동시 확정은 기존 UNIQUE 인덱스로 중복 방지", async () => {
  await Promise.all([confirmMyVotedCourse(1, 2), confirmMyVotedCourse(1, 2)]);
  expect(db.course_member_confirmations).toHaveLength(1);
});

test("A 확정 후 B 재투표는 A 비활성화, B 미확정", async () => {
  await confirmMyVotedCourse(1, 2);
  await submitVote(1, [11], "u", "회원");
  expect(db.course_member_confirmations[0].is_active).toBe(false);
  const state = await getMyCourseConfirmation(1, 2);
  expect(state.course.id).toBe(21);
  expect(state.isConfirmed).toBe(false);
});

test("같은 선택지 저장은 확정 유지", async () => {
  await confirmMyVotedCourse(1, 2);
  await submitVote(1, [10], "u", "회원");
  expect(db.course_member_confirmations[0].is_active).toBe(true);
});

test("재투표 저장 실패 시 기존 확정 유지", async () => {
  await confirmMyVotedCourse(1, 2);
  fail = "voteresponses:update";
  await expect(submitVote(1, [11], "u", "회원")).rejects.toMatchObject({ message: "DB failure" });
  expect(db.course_member_confirmations[0].is_active).toBe(true);
  expect(db.voteresponses[0].optionid).toBe(10);
});

test("확정 해제 실패 시 기존 응답 복구", async () => {
  await confirmMyVotedCourse(1, 2);
  fail = "course_member_confirmations:update";
  await expect(submitVote(1, [11], "u", "회원")).rejects.toBeDefined();
  expect(db.voteresponses[0].optionid).toBe(10);
  expect(db.course_member_confirmations[0].is_active).toBe(true);
});

test.each([[99, 3], [2, 99]])("다른 모임·일정 코스 거부 %s/%s", async (room, schedule) => {
  db.courses[0].room_id = room;
  db.courses[0].schedule_id = schedule;
  await expect(confirmMyVotedCourse(1, 2)).rejects.toThrow("다른 모임·일정");
});

test("다른 모임의 투표 거부", async () => {
  await expect(confirmMyVotedCourse(1, 99)).rejects.toThrow("해당 모임");
});

test("일정 검증 실패 시 저장 안 함", async () => {
  ensureScheduleExists.mockRejectedValue(new Error("일정 불일치"));
  await expect(confirmMyVotedCourse(1, 2)).rejects.toThrow("일정 불일치");
  expect(db.course_member_confirmations).toHaveLength(0);
});

test("회원·게스트 같은 UUID라도 서로 다른 키와 컬럼", async () => {
  await confirmMyVotedCourse(1, 2);
  getCurrentRoomParticipantInfo.mockResolvedValue({ participantType: "guest", participantId: "u" });
  expect(getParticipantKey({ participantType: "guest", participantId: "u" })).toBe("guest:u");
  await confirmMyVotedCourse(1, 2);
  expect(db.course_member_confirmations[1]).toMatchObject({ participant_key: "guest:u", member_user_id: null, guest_id: "u" });
});

test("저장 실패를 확정 성공으로 반환하지 않음", async () => {
  fail = "course_member_confirmations:insert";
  await expect(confirmMyVotedCourse(1, 2)).rejects.toBeDefined();
  expect((await getMyCourseConfirmation(1, 2)).isConfirmed).toBe(false);
});

test.each(["general", "schedule", "location"])("%s 투표는 확정 테이블에 접근하지 않음", async (type) => {
  db.votes[0].votetype = type;
  await submitVote(1, [11], "u", "회원");
  expect(db.voteresponses[0].optionid).toBe(11);
  expect(operations.some((operation) => operation.startsWith("course_member_confirmations:"))).toBe(false);
});

test("실제 참여 상태 확인 실패 거부", async () => {
  getCurrentRoomParticipantInfo.mockRejectedValue(new Error("참여자 아님"));
  await expect(confirmMyVotedCourse(1, 2)).rejects.toThrow("참여자 아님");
});

test("다른 사용자 ID로 재투표 거부", async () => {
  await expect(submitVote(1, [11], "other", "타인")).rejects.toThrow("현재 참여자");
});
