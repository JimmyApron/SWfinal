import { supabase } from "../lib/supabaseClient";

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
  const { data: vote, error: voteError } = await supabase
    .from("votes")
    .insert([
      {
        roomid,
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
    optiontype: option.optiontype,
    optiontext: option.optiontext || null,
    optiondate: option.optiondate || null,
    starttime: option.starttime || null,
    endtime: option.endtime || null,
    availablecount: option.availablecount || 0,
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
  const { data, error } = await supabase
    .from("votes")
    .select(`
      id,
      title,
      endtime,
      endtimeenabled,
      createdat,
      voteresponses(userid)
    `)
    .eq("roomid", roomid)
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
    .eq("id", voteid)
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
    .eq("voteid", voteid)
    .eq("userid", userid);

  const rows = optionids.map((optionid) => ({ voteid, optionid, userid, nickname }));

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
    .eq("id", voteid);

  if (error) {
    console.error("투표 종료 실패:", error);
    throw error;
  }
}

export async function deleteVote(voteid) {
  const { error } = await supabase
    .from("votes")
    .delete()
    .eq("id", voteid);

  if (error) {
    console.error("투표 삭제 실패:", error);
    throw error;
  }
}

export async function confirmVote(voteid, option, roomid, votetype, title) {
  const { error: updateError } = await supabase
    .from("votes")
    .update({ confirmedoptionid: option.id })
    .eq("id", voteid);

  if (updateError) throw updateError;

  if (votetype === "schedule") {
    await supabase.from("confirmed_schedules").delete().eq("voteid", voteid);
    const { error } = await supabase.from("confirmed_schedules").insert([{
      roomid,
      voteid,
      title: title || null,
      date: option.optiondate,
      starttime: option.starttime || null,
      endtime: option.endtime || null,
      isallday: !option.starttime,
    }]);
    if (error) throw error;
  } else if (votetype === "location") {
    await supabase.from("confirmed_locations").delete().eq("voteid", voteid);
    const { error } = await supabase.from("confirmed_locations").insert([{
      roomid,
      voteid,
      placename: option.optiontext,
    }]);
    if (error) throw error;
  }
}

export async function addVoteOption(voteid, optiontext) {
  const { data, error } = await supabase
    .from("voteoptions")
    .insert([{ voteid, optiontype: "text", optiontext }])
    .select()
    .single();

  if (error) {
    console.error("옵션 추가 실패:", error);
    throw error;
  }

  return data;
}

export async function updateVote(voteid, { title, endtime, endtimeenabled, reminderenabled, ismultiple, isanonymous, allowaddoption }) {
  const { error } = await supabase
    .from("votes")
    .update({ title, endtime: endtimeenabled ? endtime : null, endtimeenabled, reminderenabled, ismultiple, isanonymous, allowaddoption })
    .eq("id", voteid);

  if (error) {
    console.error("투표 수정 실패:", error);
    throw error;
  }
}