import { supabase } from "../lib/supabaseClient";
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
 * - 중간장소 투표
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

    // 중간장소 투표용
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
      isclosed,
      confirmedoptionid,
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
  const { error } = await supabase
    .from("votes")
    .update({ isclosed: true })
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
 * 일정 또는 중간장소 확정
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
  extraValue = null
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
      const { error } = await supabase.from("confirmed_schedules").insert([
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
      ]);

      if (error) {
        console.error("일정 확정 저장 실패:", error);
        throw error;
      }
    }

    return { hasConfirmedSchedule: true };
  }

  if (isLocationVoteType(votetype)) {
    const confirmedBy = extraValue;

    const placeName =
      option.placename || option.optiontext || "확정된 중간장소";

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

    await supabase
      .from("confirmed_locations")
      .delete()
      .eq("voteid", Number(voteid));

    const { data: locationVote, error: voteError } = await supabase
      .from("votes")
      .select("title, votetype, locationkind")
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

    /**
     * 위치 탭에서 확정 중간장소로 다시 불러올 수 있도록 저장
     *
     * 주의:
     * room_middle_places 테이블에 kakaomapurl 컬럼이 없다면
     * 아래 upsert에서 에러가 날 수 있어서 kakaomapurl은 넣지 않음.
     */
    if (isMiddlePlaceVote && placeLat !== null && placeLng !== null) {
      const { error: middlePlaceError } = await supabase
        .from("room_middle_places")
        .upsert(
          {
            roomid: Number(roomid),
            name: placeName,
            address: placeAddress,
            lat: placeLat,
            lng: placeLng,
            confirmedby: confirmedBy,
          },
          { onConflict: "roomid" }
        );

      if (middlePlaceError) {
        console.error("room_middle_places 저장 실패:", middlePlaceError);
        throw middlePlaceError;
      }

      if (option.travelresults?.length > 0) {
        await updateRoomLocationTransportModes(roomid, option.travelresults);
      }
    }

    return {
      isMiddlePlaceVote,
      confirmedLocation: {
        roomid: Number(roomid),
        voteid: Number(voteid),
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
 * - 중간장소 투표: 객체로 좌표/주소/URL까지 추가 가능
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
 * 중간장소 후보 수정
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
