import { supabase } from "../lib/supabaseClient";

function normalizeNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInteger(value, fallback = null) {
  const parsed = normalizeNumber(value, fallback);
  if (parsed === null) return null;
  return Number.isInteger(parsed) ? parsed : Math.round(parsed);
}

function toSafeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getStoredGuestId() {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem("guest_id");
}

export async function getCurrentRoomParticipantInfo(roomId) {
  const resolvedRoomId = Number(roomId);
  if (!Number.isFinite(resolvedRoomId)) {
    throw new Error("유효하지 않은 모임 ID입니다.");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && userError.name !== "AuthSessionMissingError") {
    throw new Error("로그인 정보를 확인하지 못했습니다.");
  }

  if (user?.id) {
    const { data: member, error: memberError } = await supabase
      .from("room_members")
      .select("id, userid")
      .eq("roomid", resolvedRoomId)
      .eq("userid", user.id)
      .maybeSingle();

    if (memberError) {
      throw new Error("회원 참여자 확인 중 오류가 발생했습니다.");
    }

    if (member) {
      return {
        participantType: "member",
        participantId: user.id,
        roomId: resolvedRoomId,
        memberId: member.id,
      };
    }
    throw new Error("현재 로그인한 회원은 이 모임의 참여자가 아닙니다.");
  }

  const guestId = getStoredGuestId();
  if (guestId) {
    const { data: guest, error: guestError } = await supabase
      .from("room_guests")
      .select("id, roomid")
      .eq("roomid", resolvedRoomId)
      .eq("id", guestId)
      .maybeSingle();

    if (guestError) {
      throw new Error("게스트 참여자 확인 중 오류가 발생했습니다.");
    }

    if (guest) {
      return {
        participantType: "guest",
        participantId: guestId,
        roomId: resolvedRoomId,
        guestId: guest.id,
      };
    }
  }

  throw new Error("로그인된 회원 또는 방 참여자 정보가 없어 코스를 저장할 수 없습니다.");
}

export async function ensureScheduleExists(scheduleId, requestedRoomId = null) {
  const resolvedScheduleId = Number(scheduleId);
  if (!Number.isFinite(resolvedScheduleId)) {
    throw new Error("유효하지 않은 일정 ID입니다.");
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from("confirmed_schedules")
    .select("id, roomid")
    .eq("id", resolvedScheduleId)
    .maybeSingle();

  if (scheduleError) {
    throw new Error("확정 일정 정보를 확인하는 중 오류가 발생했습니다.");
  }

  if (!schedule) {
    throw new Error("존재하지 않는 확정 일정입니다.");
  }

  if (requestedRoomId !== null && Number(requestedRoomId) !== schedule.roomid) {
    throw new Error("요청한 일정이 해당 모임에 속해 있지 않습니다.");
  }

  return schedule;
}

function normalizeCourseStop(stop, index) {
  const resolvedStop = stop || {};
  const title = toSafeText(resolvedStop.place_name ?? resolvedStop.placeName);
  if (!title) {
    throw new Error(`${index + 1}번째 방문 장소 이름이 필요합니다.`);
  }

  const latitude = normalizeNumber(resolvedStop.latitude ?? resolvedStop.lat, null);
  const longitude = normalizeNumber(resolvedStop.longitude ?? resolvedStop.lng, null);

  return {
    stop_order: normalizeInteger(resolvedStop.stop_order ?? resolvedStop.stopOrder ?? index + 1, index + 1),
    place_name: title,
    place_address: toSafeText(resolvedStop.place_address ?? resolvedStop.placeAddress),
    place_id: toSafeText(resolvedStop.place_id ?? resolvedStop.placeId),
    place_source: toSafeText(resolvedStop.place_source ?? resolvedStop.placeSource) || "manual",
    category: toSafeText(resolvedStop.category),
    latitude,
    longitude,
    visit_start_time: toSafeText(resolvedStop.visit_start_time ?? resolvedStop.visitStartTime) || null,
    visit_end_time: toSafeText(resolvedStop.visit_end_time ?? resolvedStop.visitEndTime) || null,
    expected_stay_min: normalizeInteger(resolvedStop.expected_stay_min ?? resolvedStop.expectedStayMin, 0),
    travel_time_from_prev_min: normalizeInteger(resolvedStop.travel_time_from_prev_min ?? resolvedStop.travelTimeFromPrevMin, 0),
    distance_from_prev_m: normalizeInteger(resolvedStop.distance_from_prev_m ?? resolvedStop.distanceFromPrevM, 0),
    image_url: toSafeText(resolvedStop.image_url ?? resolvedStop.imageUrl) || null,
    estimated_cost: normalizeNumber(resolvedStop.estimated_cost ?? resolvedStop.estimatedCost, null),
    rating: normalizeNumber(resolvedStop.rating, null),
  };
}

export async function createCourseWithStops(coursePayload = {}) {
  const roomId = Number(coursePayload.roomId ?? coursePayload.roomid);
  const scheduleId = Number(coursePayload.scheduleId ?? coursePayload.scheduleid);

  if (!Number.isFinite(roomId) || !Number.isFinite(scheduleId)) {
    throw new Error("모임 ID와 확정 일정 ID가 모두 필요합니다.");
  }

  const schedule = await ensureScheduleExists(scheduleId, roomId);
  const participantInfo = await getCurrentRoomParticipantInfo(roomId);

  if (schedule.roomid !== roomId) {
    throw new Error("해당 일정은 현재 모임에 속하지 않습니다.");
  }

  const courseName = toSafeText(coursePayload.courseName ?? coursePayload.course_name);
  if (!courseName) {
    throw new Error("코스 이름을 입력해 주세요.");
  }

  const stops = Array.isArray(coursePayload.stops) ? coursePayload.stops : [];
  if (stops.length === 0) {
    throw new Error("방문 장소를 최소 1개 이상 입력해 주세요.");
  }

  const { data: existingCourse, error: existingCourseError } = await supabase
    .from("courses")
    .select("id")
    .eq("room_id", roomId)
    .eq("schedule_id", scheduleId)
    .eq("course_name", courseName)
    .maybeSingle();

  if (existingCourseError) {
    throw new Error("기존 코스 조회 중 오류가 발생했습니다.");
  }

  if (existingCourse?.id) {
    const { data: existingStops, error: existingStopError } = await supabase
      .from("course_stops")
      .select("*")
      .eq("course_id", existingCourse.id)
      .order("stop_order", { ascending: true });

    if (existingStopError) {
      throw new Error("기존 코스 장소를 불러오지 못했습니다.");
    }

    return {
      ...existingCourse,
      stops: existingStops || [],
      isDuplicate: true,
    };
  }

  const normalizedStops = stops.map((stop, index) => normalizeCourseStop(stop, index));
  const insertCoursePayload = {
    schedule_id: scheduleId,
    room_id: roomId,
    course_name: courseName,
    recommendation_condition: toSafeText(
      coursePayload.recommendationCondition ?? coursePayload.recommendation_condition
    ) || null,
    estimated_total_duration_min: normalizeInteger(
      coursePayload.estimatedTotalDurationMin ?? coursePayload.estimated_total_duration_min,
      null
    ),
    estimated_travel_time_min: normalizeInteger(
      coursePayload.estimatedTravelTimeMin ?? coursePayload.estimated_travel_time_min,
      null
    ),
    estimated_cost_per_person: normalizeNumber(
      coursePayload.estimatedCostPerPerson ?? coursePayload.estimated_cost_per_person,
      null
    ),
    created_by_type: participantInfo.participantType,
    created_by_member_id:
      participantInfo.participantType === "member" ? participantInfo.participantId : null,
    created_by_guest_id:
      participantInfo.participantType === "guest" ? participantInfo.participantId : null,
  };

  let createdCourse = null;

  try {
    const { data: courseData, error: courseError } = await supabase
      .from("courses")
      .insert([insertCoursePayload])
      .select()
      .single();

    if (courseError) {
      throw new Error("코스 저장에 실패했습니다.");
    }

    createdCourse = courseData;

    const stopRows = normalizedStops.map((stop) => ({
      course_id: courseData.id,
      stop_order: stop.stop_order,
      place_name: stop.place_name,
      place_address: stop.place_address,
      place_id: stop.place_id,
      place_source: stop.place_source,
      category: stop.category,
      latitude: stop.latitude,
      longitude: stop.longitude,
      visit_start_time: stop.visit_start_time,
      visit_end_time: stop.visit_end_time,
      expected_stay_min: stop.expected_stay_min,
      travel_time_from_prev_min: stop.travel_time_from_prev_min,
      distance_from_prev_m: stop.distance_from_prev_m,
      image_url: stop.image_url,
      estimated_cost: stop.estimated_cost,
      rating: stop.rating,
    }));

    const { error: stopError } = await supabase
      .from("course_stops")
      .insert(stopRows);

    if (stopError) {
      throw new Error("코스 장소 저장에 실패했습니다.");
    }

    return {
      ...courseData,
      stops: stopRows,
      isDuplicate: false,
    };
  } catch (error) {
    if (createdCourse?.id) {
      try {
        await supabase.from("course_stops").delete().eq("course_id", createdCourse.id);
        await supabase.from("courses").delete().eq("id", createdCourse.id);
      } catch (cleanupError) {
        console.error("코스 생성 롤백 실패:", cleanupError);
      }
    }

    throw error;
  }
}

export async function getCoursesBySchedule(scheduleId, roomId = null) {
  const resolvedScheduleId = Number(scheduleId);
  if (!Number.isFinite(resolvedScheduleId)) {
    throw new Error("유효하지 않은 일정 ID입니다.");
  }

  const schedule = await ensureScheduleExists(resolvedScheduleId, roomId);
  const participantInfo = await getCurrentRoomParticipantInfo(schedule.roomid);

  if (participantInfo.roomId !== schedule.roomid) {
    throw new Error("접근 권한이 없습니다.");
  }

  const { data: courses, error: courseError } = await supabase
    .from("courses")
    .select("*")
    .eq("schedule_id", resolvedScheduleId)
    .order("created_at", { ascending: false });

  if (courseError) {
    throw new Error("일정별 코스 조회에 실패했습니다.");
  }

  const results = await Promise.all(
    (courses || []).map(async (course) => {
      const { data: stops, error: stopError } = await supabase
        .from("course_stops")
        .select("*")
        .eq("course_id", course.id)
        .order("stop_order", { ascending: true });

      if (stopError) {
        throw new Error("코스 장소 목록을 불러오지 못했습니다.");
      }

      return {
        ...course,
        stops: stops || [],
      };
    })
  );

  return results;
}

export async function getCourseDetail(courseId, roomId = null) {
  const resolvedCourseId = Number(courseId);
  if (!Number.isFinite(resolvedCourseId)) {
    throw new Error("유효하지 않은 코스 ID입니다.");
  }

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("*")
    .eq("id", resolvedCourseId)
    .maybeSingle();

  if (courseError) {
    throw new Error("코스 상세 조회 중 오류가 발생했습니다.");
  }

  if (!course) {
    throw new Error("존재하지 않는 코스입니다.");
  }

  if (roomId !== null && Number(roomId) !== course.room_id) {
    throw new Error("해당 모임의 코스가 아닙니다.");
  }

  const schedule = await ensureScheduleExists(course.schedule_id, course.room_id);
  await getCurrentRoomParticipantInfo(schedule.roomid);

  const { data: stops, error: stopError } = await supabase
    .from("course_stops")
    .select("*")
    .eq("course_id", course.id)
    .order("stop_order", { ascending: true });

  if (stopError) {
    throw new Error("코스의 장소 정보를 불러오지 못했습니다.");
  }

  return {
    ...course,
    stops: stops || [],
  };
}
