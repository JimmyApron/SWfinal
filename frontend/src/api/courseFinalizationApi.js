import { supabase } from "../lib/supabaseClient";
import { getCurrentRoomParticipantInfo } from "./courseApi";

export async function readResult(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getScheduleCreator(scheduleId) {
  return readResult(supabase.from("schedule_creation_records").select("*")
    .eq("schedule_id", scheduleId).maybeSingle());
}

export async function getFinalizedCourse(scheduleId) {
  const record = await readResult(supabase.from("schedule_finalizations").select("*")
    .eq("schedule_id", scheduleId).maybeSingle());
  if (!record) return null;
  const schedule = await readResult(supabase.from("confirmed_schedules").select("id, roomid")
    .eq("id", scheduleId).single());
  await getCurrentRoomParticipantInfo(schedule.roomid);
  const course = await readResult(supabase.from("courses").select("*")
    .eq("id", record.course_id).eq("schedule_id", scheduleId).eq("room_id", schedule.roomid).single());
  const stops = await readResult(supabase.from("course_stops").select("*")
    .eq("course_id", record.course_id).order("stop_order", { ascending: true }));
  return { ...record, course: { ...course, stops } };
}

export function calculateEligibleParticipants(members, guests, absentees) {
  if (!Array.isArray(members) || !Array.isArray(guests) || (absentees != null && !Array.isArray(absentees))) {
    throw new Error("참석자 정보를 확인하지 못했습니다.");
  }
  const all = new Map();
  for (const [type, rows, column] of [["member", members, "userid"], ["guest", guests, "id"]]) {
    for (const row of rows) {
      if (!row[column]) throw new Error("참여자 식별 정보가 없습니다.");
      const id = String(row[column]).toLowerCase();
      all.set(`${type}:${id}`, { participantKey: `${type}:${id}`, participantType: type,
        participantId: id, nickname: row.nickname || (type === "member" ? "회원" : "게스트") });
    }
  }
  // Raw UUID responses and absentees carry no participant type. Never guess ownership.
  const ids = new Set();
  for (const participant of all.values()) {
    if (ids.has(participant.participantId)) throw new Error("회원·게스트 UUID가 같아 투표 및 불참자 소유권을 구분할 수 없습니다.");
    ids.add(participant.participantId);
  }
  const absentIds = new Set((absentees || []).map((id) => String(id).toLowerCase()));
  return [...all.values()].filter((p) => !absentIds.has(p.participantId));
}

export async function getEligibleParticipants(schedule) {
  const [members, guests] = await Promise.all([
    readResult(supabase.from("room_members").select("userid, nickname").eq("roomid", schedule.roomid)),
    readResult(supabase.from("room_guests").select("id, nickname").eq("roomid", schedule.roomid)),
  ]);
  return calculateEligibleParticipants(members, guests, schedule.absentees);
}

const same = (a, b) => a != null && b != null && String(a) === String(b);

export function evaluateCourseConsensus({ participants, responses, confirmations, links, options, courseId }) {
  return participants.map((participant) => {
    const votes = responses.filter((r) => String(r.userid).toLowerCase() === participant.participantId);
    const active = confirmations.filter((c) => c.is_active && c.participant_key === participant.participantKey);
    const response = votes.length === 1 ? votes[0] : null;
    const option = response && options.find((o) => same(o.id, response.optionid) && o.optiontype === "course");
    const matches = option ? links.filter((l) => same(l.vote_option_id, option.id)) : [];
    const votedCourseId = matches.length === 1 ? matches[0].course_id : null;
    const confirmation = active.length === 1 ? active[0] : null;
    const validIdentity = confirmation && confirmation.participant_type === participant.participantType &&
      (participant.participantType === "member"
        ? same(confirmation.member_user_id, participant.participantId) && confirmation.guest_id == null
        : same(confirmation.guest_id, participant.participantId) && confirmation.member_user_id == null);
    const confirmed = Boolean(validIdentity && same(votedCourseId, courseId) && same(confirmation.course_id, courseId));
    const differentCourse = Boolean((votedCourseId != null && !same(votedCourseId, courseId)) ||
      active.some((c) => !same(c.course_id, courseId)));
    return { ...participant, votedCourseId, confirmed, differentCourse,
      status: confirmed ? "확정 완료" : differentCourse ? "다른 코스 선택" : "미확정" };
  });
}

export async function getCourseConfirmationProgress({ scheduleId, roomId, voteId, courseId }) {
  // Explicit voteId is mandatory: schedules can have multiple course votes.
  if (!scheduleId || !roomId || !voteId || !courseId) throw new Error("일정·모임·대상 투표·코스 ID가 필요합니다.");
  const schedule = await readResult(supabase.from("confirmed_schedules").select("id, roomid, absentees")
    .eq("id", scheduleId).eq("roomid", Number(roomId)).single());
  const participant = await getCurrentRoomParticipantInfo(roomId);
  const vote = await readResult(supabase.from("votes").select("id, roomid, scheduleid, votetype")
    .eq("id", voteId).eq("roomid", Number(roomId)).eq("scheduleid", scheduleId).eq("votetype", "course").single());
  const course = await readResult(supabase.from("courses").select("*")
    .eq("id", courseId).eq("room_id", Number(roomId)).eq("schedule_id", scheduleId).single());
  if (!schedule || !vote || !course) throw new Error("일정·투표·코스 연결을 확인하지 못했습니다.");
  const [participants, finalization, responses, links, options] = await Promise.all([
    getEligibleParticipants(schedule), getFinalizedCourse(scheduleId),
    readResult(supabase.from("voteresponses").select("optionid, userid").eq("voteid", voteId)),
    readResult(supabase.from("vote_course_links").select("vote_option_id, course_id").eq("vote_id", voteId)),
    readResult(supabase.from("voteoptions").select("id, optiontype").eq("voteid", voteId)),
  ]);
  const targetLinks = links.filter(link => same(link.course_id, courseId));
  if (targetLinks.length !== 1 || !options.some(option => same(option.id, targetLinks[0].vote_option_id) && option.optiontype === "course") ||
      links.filter(link => same(link.vote_option_id, targetLinks[0].vote_option_id)).length !== 1) {
    throw new Error("해당 투표에 연결된 코스가 아니거나 연결이 불명확합니다.");
  }
  const counts = new Map(options.filter(option => option.optiontype === "course").map(option => [String(option.id), 0]));
  for (const voter of participants) {
    const rows = responses.filter(row => String(row.userid).toLowerCase() === voter.participantId);
    // Course votes are single-choice. Do not count ambiguous or duplicate responses.
    if (rows.length !== 1) continue;
    const optionId = String(rows[0].optionid);
    if (!counts.has(optionId) || links.filter(link => same(link.vote_option_id, optionId)).length !== 1) continue;
    counts.set(optionId, counts.get(optionId) + 1);
  }
  const totalVoters = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const courseVoteCount = counts.get(String(targetLinks[0].vote_option_id)) || 0;
  return { scheduleId: schedule.id, roomId: schedule.roomid, voteId: vote.id, course, participant,
    eligibleCount: participants.length, totalVoters, courseVoteCount, finalization,
    options: [...counts].map(([optionId, count]) => ({ optionId, count, percent: totalVoters ? Math.round(count / totalVoters * 100) : 0 })),
    canFinalize: !finalization,
    reason: "투표 여부와 관계없이 참여자 누구나 한 코스를 확정할 수 있습니다." };
}

export async function canFinalizeCourse(request) {
  return (await getCourseConfirmationProgress(request)).canFinalize;
}

export async function finalizeCourse(request) {
  // Re-read everything immediately before INSERT, regardless of UI state.
  const progress = await getCourseConfirmationProgress(request);
  if (progress.finalization) {
    if (!same(progress.finalization.course_id, request.courseId)) throw new Error("이미 다른 코스로 최종 확정되었습니다.");
    return finishFinalization(progress.finalization);
  }
  if (!progress.canFinalize) throw new Error(progress.reason);
  const actor = progress.participant;
  const { error } = await supabase.from("schedule_finalizations").insert([{
    schedule_id: progress.scheduleId, course_id: progress.course.id,
    finalized_by_type: actor.participantType,
    finalized_by_member_id: actor.participantType === "member" ? actor.participantId : null,
    finalized_by_guest_id: actor.participantType === "guest" ? actor.participantId : null,
    finalized_at: new Date().toISOString(),
  }]);
  if (error && error.code !== "23505") throw error;
  const saved = await getFinalizedCourse(progress.scheduleId);
  if (!saved || !same(saved.course_id, request.courseId)) throw new Error("최종 확정 결과가 변경되었습니다. 다시 확인해 주세요.");
  return finishFinalization(saved);
}

async function finishFinalization(saved) {
  // Result is already immutable in this client; closing votes is best effort and retryable.
  let error;
  try {
    ({ error } = await supabase.from("votes").update({ isclosed: true })
      .eq("scheduleid", saved.schedule_id).eq("votetype", "course"));
  } catch (failure) { error = failure; }
  return { ...saved, voteClosurePending: Boolean(error),
    warning: error ? "최종 확정은 저장되었지만 투표 종료 갱신에 실패했습니다. 다시 조회해 주세요." : null };
}

export async function assertCourseChangesAllowed(scheduleId) {
  const finalization = await readResult(supabase.from("schedule_finalizations").select("id")
    .eq("schedule_id", scheduleId).maybeSingle());
  if (finalization) throw new Error("최종 확정된 일정의 코스 투표와 개인 확정은 변경할 수 없습니다.");
}

// New-schedule flow: the schedule's recorded creator can choose a course
// directly, without manufacturing a vote. Existing vote finalization stays unchanged.
export async function finalizeDirectCourse({ roomId, scheduleId, courseId }) {
  if (!roomId || !scheduleId || !courseId) throw new Error('모임·일정·코스 정보가 필요합니다.');
  const schedule = await readResult(supabase.from('confirmed_schedules').select('id, roomid')
    .eq('id', scheduleId).eq('roomid', Number(roomId)).single());
  if (!schedule) throw new Error('현재 모임의 일정을 확인하지 못했습니다.');
  const actor = await getCurrentRoomParticipantInfo(roomId);
  const creator = await getScheduleCreator(scheduleId);
  if (!creator || creator.created_by_type !== actor.participantType ||
      !same(actor.participantId, actor.participantType === 'member' ? creator.created_by_member_id : creator.created_by_guest_id)) {
    throw new Error('직접 코스 지정은 해당 일정을 만든 참여자만 할 수 있습니다.');
  }
  const course = await readResult(supabase.from('courses').select('id')
    .eq('id', courseId).eq('schedule_id', scheduleId).eq('room_id', Number(roomId)).single());
  if (!course) throw new Error('해당 일정에 연결된 코스가 아닙니다.');
  const existing = await getFinalizedCourse(scheduleId);
  if (existing) {
    if (!same(existing.course_id, courseId)) throw new Error('이미 다른 코스로 최종 확정되었습니다.');
    return finishFinalization(existing);
  }
  const { error } = await supabase.from('schedule_finalizations').insert([{
    schedule_id: scheduleId, course_id: courseId, finalized_by_type: actor.participantType,
    finalized_by_member_id: actor.participantType === 'member' ? actor.participantId : null,
    finalized_by_guest_id: actor.participantType === 'guest' ? actor.participantId : null,
    finalized_at: new Date().toISOString(),
  }]);
  if (error && error.code !== '23505') throw error;
  const saved = await getFinalizedCourse(scheduleId);
  if (!saved || !same(saved.course_id, courseId)) throw new Error('최종 코스 저장 결과를 확인하지 못했습니다.');
  return finishFinalization(saved);
}
