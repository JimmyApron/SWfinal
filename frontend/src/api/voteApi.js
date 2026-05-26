import { supabase } from "../lib/supabaseClient";

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

/**
 * 투표 옵션 정리 함수
 * 일반 투표, 일정 투표, 중간장소 투표를 모두 처리함
 */
function normalizeVoteOption(option) {
  return {
    optiontype: option.optiontype || "text",

    // 일반 텍스트 / 장소명 공통 표시용
    optiontext:
      option.optiontext ||
      option.placename ||
      option.name ||
      null,

    // 일정 투표용
    optiondate: option.optiondate || null,
    starttime: option.starttime || null,
    endtime: option.endtime || null,
    availablecount: option.availablecount || 0,

    // 중간장소 투표용
    placename:
      option.placename ||
      option.name ||
      option.optiontext ||
      null,
    placeaddress:
      option.placeaddress ||
      option.address ||
      null,
    placelat: normalizeCoordinate(option.placelat, option.lat),
    placelng: normalizeCoordinate(option.placelng, option.lng),
    kakaomapurl:
      option.kakaomapurl ||
      option.kakaoMapUrl ||
      null,
  };
}

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
}) {
  if (!roomid) {
    throw new Error("roomid가 없습니다. 투표를 생성할 방 정보가 필요합니다.");
  }

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
        votetype: votetype || "general",
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
 * 중요:
 * - 투표가 종료되었다고 자동 확정되지 않음
 * - 사용자가 확정 버튼을 눌렀을 때만 실행됨
 */
export async function confirmVote(
  voteid,
  option,
  roomid,
  votetype,
  confirmedBy = null
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
    await supabase
      .from("confirmed_schedules")
      .delete()
      .eq("voteid", Number(voteid));

    const { error } = await supabase
      .from("confirmed_schedules")
      .insert([
        {
          roomid: Number(roomid),
          voteid: Number(voteid),
          date: option.optiondate,
          starttime: option.starttime || null,
          endtime: option.endtime || null,
          isallday: !option.starttime,
        },
      ]);

    if (error) {
      console.error("일정 확정 저장 실패:", error);
      throw error;
    }

    return;
  }

  if (votetype === "location") {
    const placeName =
      option.placename ||
      option.optiontext ||
      "확정된 중간장소";

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

    const { error } = await supabase
      .from("confirmed_locations")
      .insert([
        {
          roomid: Number(roomid),
          voteid: Number(voteid),
          placename: placeName,
        },
      ]);

    if (error) {
      console.error("중간장소 확정 저장 실패:", error);
      throw error;
    }

    /**
     * 위치 탭에서 확정 중간장소로 다시 불러올 수 있도록 저장
     * 이 테이블은 새로 만들어야 함.
     */
    if (placeLat !== null && placeLng !== null) {
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
    }
  }
}

/**
 * 투표 항목 추가
 * - 일반 투표: 문자열로 추가 가능
 * - 중간장소 투표: 객체로 좌표까지 추가 가능
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

export async function updateVote(
  voteid,
  { title, endtime, endtimeenabled, reminderenabled }
) {
  const { error } = await supabase
    .from("votes")
    .update({
      title,
      endtime: endtimeenabled ? endtime : null,
      endtimeenabled,
      reminderenabled,
    })
    .eq("id", Number(voteid));

  if (error) {
    console.error("투표 수정 실패:", error);
    throw error;
  }
}

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