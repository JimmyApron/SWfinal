import { supabase } from "../lib/supabaseClient";
import { getCurrentRoomParticipantInfo } from "./courseApi";

// Only used for INSERT paths. Never assign a creator to an existing schedule.
export async function createScheduleWithCreator(payload) {
  let createdScheduleId = null;
  try {
    const participant = await getCurrentRoomParticipantInfo(payload.roomid);
    const { data: schedule, error } = await supabase.from("confirmed_schedules")
      .insert([payload]).select("*").single();
    if (error) return { data: null, error };
    createdScheduleId = schedule.id;
    const record = {
      schedule_id: schedule.id,
      created_by_type: participant.participantType,
      created_by_member_id: participant.participantType === "member" ? participant.participantId : null,
      created_by_guest_id: participant.participantType === "guest" ? participant.participantId : null,
    };
    // Retry once, checking for an acknowledged or response-lost insert first.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { error: recordError } = await supabase.from("schedule_creation_records").insert([record]);
      if (!recordError) return { data: schedule, error: null };
      const { data: saved, error: readError } = await supabase.from("schedule_creation_records")
        .select("*").eq("schedule_id", schedule.id).maybeSingle();
      if (!readError && saved && saved.created_by_type === record.created_by_type &&
          saved.created_by_member_id === record.created_by_member_id && saved.created_by_guest_id === record.created_by_guest_id) {
        return { data: schedule, error: null };
      }
      if (saved) break;
    }
    const failure = new Error(`일정 ${schedule.id}은 생성되었지만 생성자 기록 저장을 확인하지 못했습니다. 일정을 다시 생성하지 말고 관리자에게 문의해 주세요. 최종 코스 확정은 차단됩니다.`);
    failure.scheduleId = schedule.id;
    return { data: null, error: failure };
  } catch (error) {
    if (createdScheduleId) {
      const failure = new Error(`일정 ${createdScheduleId}은 생성되었지만 생성자 기록 저장을 확인하지 못했습니다. 일정을 다시 생성하지 말고 관리자에게 문의해 주세요. 최종 코스 확정은 차단됩니다.`);
      failure.scheduleId = createdScheduleId;
      return { data: null, error: failure };
    }
    return { data: null, error };
  }
}
