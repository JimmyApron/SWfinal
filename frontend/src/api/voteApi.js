import { supabase } from "../lib/supabaseClient";
import { createRoomNotifications } from "./notificationApi";
import { updateRoomLocationTransportModes } from "./mapApi";

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return value !== "";
}

function normalizeCoordinate(primaryValue, fallbackValue) {
  if (hasValue(primaryValue)) {
    return Number(primaryValue);
  }

  if (hasValue(fallbackValue)) {
    return Number(fallbackValue);
  }

  return null;
}

const MIDDLE_PLACE_VOTE_TITLE = "중간 장소 투표";

function isLocationVoteType(votetype) {
  return ["location", "middle_location", "additional_location"].includes(votetype);
}

/**
 * 투표 옵션 정리 함수
 * - 일반 투표
 * - 일정 투표
 * - 중간 장소 투표
 * 전부 여기서 같은 형태로 정리함
 */
function normalizeVoteOption(option) {
  const optiontype = option.optiontype || "text";

  return {
    optiontype,

    // 일반 텍스트 / 장소명 공통 표시용
    optiontext: option.optiontext || option.placename || option.name || null,

    // 일정 투표용
    optiondate: option.optiondate || null,
    starttime: option.starttime || null,
    endtime: option.endtime || null,
    availablecount: option.availablecount || 0,

    // 중간 장소 투표용
    placename: option.placename || option.name || option.optiontext || null,
    placeaddress: option.placeaddress || option.address || null,
    placelat: normalizeCoordinate(option.placelat, option.lat),
    placelng: normalizeCoordinate(option.placelng, option.lng),
    kakaomapurl: option.kakaomapurl || option.kakaoMapUrl || null,
    travelresults: option.travelresults || option.travelResults || null,
  };
}

/**
 * 투표 생성
 */
export async function createVote({
  roomid,
  title,
  userid,
  nickname,
  options,
  ismultiple,
  isanonymous,
  allowaddoption,
  endtime,
  endtimeenabled,
  reminderenabled,
  votetype,
  locationkind,
  scheduleid,
}) {
  if (!roomid) {
    throw new Error("roomid가 없습니다. 투표를 생성할 방 정보가 필요합니다.");
  }

  const isUrgent = endtimeenabled && endtime && 
    (new Date(endtime).getTime() - new Date().getTime()) < 30 * 60 * 1000;

  const { data: vote, error: voteError } = await supabase
    .from("votes")
    .insert([
      {
        roomid: Number(roomid),
        title,
        createdby: userid,
        userid,
        nickname,
        ismultiple,
        isanonymous,
        allowaddoption,
        endtime: endtimeenabled ? endtime : null,
        endtimeenabled,
        reminderenabled,
        is_reminder_sent: isUrgent && reminderenabled,
        votetype: votetype || "general",
        locationkind: locationkind || null,
        scheduleid: scheduleid ? Number(scheduleid) : null,
      },
    ])
    .select()
    .single();

  if (voteError) {
    console.error("votes insert error:", voteError);
    throw voteError;
  }

  const optionRows = options.map((option) => ({
    voteid: vote.id,
    ...normalizeVoteOption(option),
  }));

  const { error: optionError } = await supabase
    .from("voteoptions")
    .insert(optionRows);

  if (optionError) {
    console.error("voteoptions insert error:", optionError);
    throw optionError;
  }

  return vote;
}

/**
 * 방의 투표 목록 불러오기
 */
export async function getVotes(roomid) {
  if (!roomid) {
    throw new Error("roomid가 없습니다. 투표 목록을 불러올 수 없습니다.");
  }

  const { data, error } = await supabase
    .from("votes")
    .select(`
      id,
      title,
      endtime,
      endtimeenabled,
      createdat,
      votetype,
      locationkind,
      isclosed,
      confirmedoptionid,
      scheduleid,
      confirmed_schedules:scheduleid(title, date, location),
      voteresponses(userid)
    `)
    .eq("roomid", Number(roomid))
    .order("createdat", { ascending: false });

  if (error) {
    console.error("투표 목록 조회 실패:", error);
    throw error;
  }

  return data;
}

/**
 * 투표 상세 불러오기
 */
export async function getVoteDetail(voteid) {
  const { data, error } = await supabase
    .from("votes")
    .select(`
      *,
      confirmed_schedules:scheduleid(title, date, location),
      voteoptions!vote_options_voteid_fkey(*),
      voteresponses(optionid, userid, nickname)
    `)
    .eq("id", Number(voteid))
    .single();

  if (error) {
    console.error("투표 상세 조회 실패:", JSON.stringify(error));
    throw error;
  }

  return data;
}

export async function getVoteConfirmedAdditionalLocations(voteid) {
  const { data, error } = await supabase
    .from("confirmed_locations")
    .select("id, scheduleid, placename")
    .eq("voteid", Number(voteid));

  if (error) {
    console.error("추가 장소 등록 상태 조회 실패:", error);
    throw error;
  }

  return data || [];
}

export async function removeVoteConfirmedAdditionalLocation(locationId) {
  const { error } = await supabase
    .from("confirmed_locations")
    .delete()
    .eq("id", Number(locationId));

  if (error) {
    console.error("추가 장소 등록 취소 실패:", error);
    throw error;
  }
}

/**
 * 투표 제출
 * 기존에 같은 사용자가 투표한 기록은 지우고 새로 저장함
 */
export async function submitVote(voteid, optionids, userid, nickname) {
  await supabase
    .from("voteresponses")
    .delete()
    .eq("voteid", Number(voteid))
    .eq("userid", userid);

  const rows = optionids.map((optionid) => ({
    voteid: Number(voteid),
    optionid,
    userid,
    nickname,
  }));

  const { error } = await supabase.from("voteresponses").insert(rows);

  if (error) {
    console.error("투표 저장 실패:", error);
    throw error;
  }
}

/**
 * 투표 종료
 */
export async function closeVote(voteid) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("votes")
    .update({ isclosed: true, endtime: now })
    .eq("id", Number(voteid));

  if (error) {
    console.error("투표 종료 실패:", error);
    throw error;
  }
}

/**
 * 투표 삭제
 */
export async function deleteVote(voteid) {
  const { error } = await supabase
    .from("votes")
    .delete()
    .eq("id", Number(voteid));

  if (error) {
    console.error("투표 삭제 실패:", error);
    throw error;
  }
}

/**
 * 일정 또는 중간 장소 확정
 *
 * VoteDetailPage에서 5번째 인자는 상황에 따라 다르게 들어올 수 있음.
 * - schedule: appointmentTitle
 * - location: currentUser?.id
 */
export async function confirmVote(
  voteid,
  option,
  roomid,
  votetype,
  extraValue = null,
  locationKindOverride = null
) {
  const { error: updateError } = await supabase
    .from("votes")
    .update({ confirmedoptionid: option.id })
    .eq("id", Number(voteid));

  if (updateError) {
    console.error("votes 확정 옵션 업데이트 실패:", updateError);
    throw updateError;
  }

  if (votetype === "schedule") {
    const appointmentTitle =
      typeof extraValue === "string" && extraValue.trim() !== ""
        ? extraValue.trim()
        : null;

    const { data: existing } = await supabase
      .from("confirmed_schedules")
      .select("id")
      .eq("voteid", Number(voteid))
      .maybeSingle();

    let confirmedScheduleId = existing?.id || null;

    if (existing) {
      // 기존 일정이 있으면 날짜/시간만 업데이트 (absentees, location 등 보존)
      const updatePayload = {
        date: option.optiondate,
        starttime: option.starttime || null,
        endtime: option.endtime || null,
        isallday: !option.starttime,
      };
      if (appointmentTitle) updatePayload.title = appointmentTitle;

      const { error } = await supabase
        .from("confirmed_schedules")
        .update(updatePayload)
        .eq("id", existing.id);

      if (error) {
        console.error("일정 확정 업데이트 실패:", error);
        throw error;
      }
    } else {
      const { data: insertedSchedule, error } = await supabase.from("confirmed_schedules").insert([
        {
          roomid: Number(roomid),
          voteid: Number(voteid),
          title: appointmentTitle,
          date: option.optiondate,
          starttime: option.starttime || null,
          endtime: option.endtime || null,
          isallday: !option.starttime,
          location: null,
          locationaddress: null,
        },
      ]).select("id").single();

      if (error) {
        console.error("일정 확정 저장 실패:", error);
        throw error;
      }

      confirmedScheduleId = insertedSchedule?.id || null;
    }

    // 알림 생성
    try {
      const { data: userData } = await supabase.auth.getUser();
      const scheduleTitle = appointmentTitle?.trim() ? `'${appointmentTitle}' ` : "";
      await createRoomNotifications({
        roomId: roomid,
        senderId: userData.user?.id,
        type: "schedule_confirmed",
        title: "🗓️ 일정 확정",
        message: `방에 ${scheduleTitle}일정이 확정되었습니다.`,
        link: `/rooms/${roomid}?tab=schedule${
          confirmedScheduleId ? `&scheduleId=${confirmedScheduleId}` : ""
        }`,
      });
    } catch (notifError) {
      console.error("일정 확정 알림 생성 실패:", notifError);
    }

    return { hasConfirmedSchedule: true };
  }

  if (isLocationVoteType(votetype)) {
    const placeName =
      getMeaningfulPlaceName(
        option.placename,
        option.optiontext,
        option.placeaddress
      ) || "확정된 중간 장소";

    const placeAddress = option.placeaddress || null;

    const placeLat =
      option.placelat !== null &&
      option.placelat !== undefined &&
      option.placelat !== ""
        ? Number(option.placelat)
        : null;

    const placeLng =
      option.placelng !== null &&
      option.placelng !== undefined &&
      option.placelng !== ""
        ? Number(option.placelng)
        : null;

    const { data: locationVote, error: voteError } = await supabase
      .from("votes")
      .select("title, votetype, locationkind, scheduleid")
      .eq("id", Number(voteid))
      .single();

    if (voteError) {
      console.error("위치 투표 조회 실패:", voteError);
      throw voteError;
    }

    const isMiddlePlaceVote =
      locationVote?.locationkind === "middle" ||
      (
        locationVote?.votetype === "location" &&
        !locationVote?.locationkind &&
        locationVote?.title?.trim() === MIDDLE_PLACE_VOTE_TITLE
      );

    const scheduleId = locationVote?.scheduleid || null;
    const effectiveLocationKind =
      locationKindOverride ||
      locationVote?.locationkind ||
      (isMiddlePlaceVote ? "middle" : "additional");

    if (!scheduleId) {
      return {
        isMiddlePlaceVote,
        locationKind: effectiveLocationKind,
        confirmedLocation: {
          roomid: Number(roomid),
          voteid: Number(voteid),
          scheduleid: null,
          placename: placeName,
          placeaddress: placeAddress,
          placelat: placeLat,
          placelng: placeLng,
        },
      };
    }

    /**
     * 위치 탭에서 확정 중간 장소로 다시 불러올 수 있도록 저장
     *
     * 주의:
     * room_middle_places 테이블에 kakaomapurl 컬럼이 없다면
     * 아래 upsert에서 에러가 날 수 있어서 kakaomapurl은 넣지 않음.
     */
    if (effectiveLocationKind === "middle" && placeLat !== null && placeLng !== null) {
      const { error: middlePlaceError } = await supabase
        .from("confirmed_schedules")
        .update({
          location: placeName,
          locationaddress: placeAddress,
          locationlat: placeLat,
          locationlng: placeLng,
        })
        .eq("id", Number(scheduleId));

      if (middlePlaceError) {
        console.error("room_middle_places 저장 실패:", middlePlaceError);
        throw middlePlaceError;
      }

      if (option.travelresults?.length > 0) {
        await updateRoomLocationTransportModes(roomid, option.travelresults, scheduleId);
      }
    } else {
      const { data: existingLocation, error: existingLocationError } =
        await supabase
          .from("confirmed_locations")
          .select("id")
          .eq("scheduleid", Number(scheduleId))
          .eq("placename", placeName)
          .limit(1)
          .maybeSingle();

      if (existingLocationError) {
        console.error("추가 장소 중복 확인 실패:", existingLocationError);
        throw existingLocationError;
      }

      if (existingLocation) {
        throw new Error("이미 있는 추가 장소입니다.");
      }

      const { error: locationError } = await supabase
        .from("confirmed_locations")
        .insert([{
          roomid: Number(roomid),
          scheduleid: Number(scheduleId),
          voteid: Number(voteid),
          placename: placeName,
        }]);

      if (locationError) {
        console.error("추가 장소 저장 실패:", locationError);
        throw locationError;
      }
    }

    return {
      isMiddlePlaceVote,
      locationKind: effectiveLocationKind,
      confirmedLocation: {
        roomid: Number(roomid),
        voteid: Number(voteid),
        scheduleid: Number(scheduleId),
        placename: placeName,
        placeaddress: placeAddress,
        placelat: placeLat,
        placelng: placeLng,
      },
    };
  }
}

/**
 * 투표 항목 추가
 * - 일반 투표: 문자열로 추가 가능
 * - 중간 장소 투표: 객체로 좌표/주소/URL까지 추가 가능
 */
export async function addVoteOption(voteid, option) {
  const optionData =
    typeof option === "string"
      ? {
          optiontype: "text",
          optiontext: option,
        }
      : option;

  const { data, error } = await supabase
    .from("voteoptions")
    .insert([
      {
        voteid: Number(voteid),
        ...normalizeVoteOption(optionData),
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("옵션 추가 실패:", error);
    throw error;
  }

  return data;
}

/**
 * 투표 기본 정보 수정
 * - 제목
 * - 종료시간
 * - 알림
 * - 복수선택
 * - 익명투표
 * - 항목추가허용
 */
export async function updateVote(
  voteid,
  {
    title,
    endtime,
    endtimeenabled,
    reminderenabled,
    ismultiple,
    isanonymous,
    allowaddoption,
  }
) {
  const updateData = {
    title,
    endtime: endtimeenabled ? endtime : null,
    endtimeenabled,
    reminderenabled,
    updatedat: new Date().toISOString(),
  };

  if (ismultiple !== undefined) {
    updateData.ismultiple = ismultiple;
  }

  if (isanonymous !== undefined) {
    updateData.isanonymous = isanonymous;
  }

  if (allowaddoption !== undefined) {
    updateData.allowaddoption = allowaddoption;
  }

  const { error } = await supabase
    .from("votes")
    .update(updateData)
    .eq("id", Number(voteid));

  if (error) {
    console.error("투표 수정 실패:", error);
    throw error;
  }
}

/**
 * 중간 장소 투표 항목 수정
 */
export async function updateVoteOption(optionid, option) {
  const { data, error } = await supabase
    .from("voteoptions")
    .update(normalizeVoteOption(option))
    .eq("id", Number(optionid))
    .select()
    .single();

  if (error) {
    console.error("투표 옵션 수정 실패:", error);
    throw error;
  }

  return data;
}

/**
 * 일정 투표 확정 시 기존 위치-전용 확정일정에 날짜/시간 연결
 * - 위치 투표의 applyConfirmedLocationToSchedule 패턴과 동일
 */
export async function applyScheduleVoteToExisting(scheduleId, option, voteid, roomid) {
  const { error: voteError } = await supabase
    .from("votes")
    .update({ confirmedoptionid: option.id })
    .eq("id", Number(voteid));

  if (voteError) throw voteError;

  // title은 의도적으로 포함하지 않음 - 기존 위치 항목의 이름을 보존하기 위해
  const updatePayload = {
    date: option.optiondate,
    starttime: option.starttime || null,
    endtime: option.endtime || null,
    isallday: !option.starttime,
    voteid: Number(voteid),
  };

  const { error } = await supabase
    .from("confirmed_schedules")
    .update(updatePayload)
    .eq("id", Number(scheduleId));

  if (error) throw error;

  try {
    const { data: userData } = await supabase.auth.getUser();
    await createRoomNotifications({
      roomId: roomid,
      senderId: userData.user?.id,
      type: "schedule_confirmed",
      title: "🗓️ 일정 확정",
      message: "확정된 일정이 업데이트되었습니다.",
      link: `/rooms/${roomid}?tab=schedule&scheduleId=${Number(scheduleId)}`,
    });
  } catch (notifError) {
    console.error("알림 생성 실패:", notifError);
  }
}

function getMeaningfulPlaceName(...values) {
  for (const value of values) {
    const trimmedValue = typeof value === "string" ? value.trim() : "";

    if (trimmedValue && !isPlaceholderPlaceName(trimmedValue)) {
      return trimmedValue;
    }
  }

  return "";
}

function isPlaceholderPlaceName(name) {
  const normalizedName = String(name || "").trim();

  return (
    /^meeting\s*place$/i.test(normalizedName) ||
    /^place$/i.test(normalizedName) ||
    /^만날\s*장소(?:\s*미정)?$/.test(normalizedName)
  );
}
