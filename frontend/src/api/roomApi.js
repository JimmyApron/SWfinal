import { supabase } from "../lib/supabaseClient";
import { getVisibleNotifications } from "./notificationApi";

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function createRoom(roomData) {
  const newRoom = {
    roomname: roomData.roomName,
    invitecode: generateInviteCode(),
    createdby: roomData.userId,
  };

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .insert([newRoom])
    .select()
    .single();

  if (roomError) {
    console.error("방 생성 실패 상세:", roomError);
    throw new Error(roomError.message || "방 생성 실패");
  }

  const { error: memberError } = await supabase
    .from("room_members")
    .insert([
      {
        roomid: room.id,
        userid: roomData.userId,
        nickname: roomData.nickname,
      },
    ]);

  if (memberError) {
    console.error("방장 멤버 등록 실패:", memberError);
    throw new Error(memberError.message || "방장 멤버 등록 실패");
  }

  const candidateRows = roomData.candidates.map((candidate) => ({
    roomid: room.id,
    date: candidate.date,
    starttime: candidate.isAllDay ? null : candidate.startTime,
    endtime: candidate.isAllDay ? null : candidate.endTime,
    isallday: candidate.isAllDay,
  }));

  const { error: candidateError } = await supabase
    .from("schedule_candidates")
    .insert(candidateRows);

  if (candidateError) {
    console.error("후보 일정 저장 실패 상세:", candidateError);
    throw new Error(candidateError.message || "후보 일정 저장 실패");
  }

  return {
    message: "방 생성 완료",
    room,
  };
}

export async function joinRoomByInviteCode(inviteCode, userId, nickname) {
  const cleanInviteCode = inviteCode.trim().toUpperCase();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("invitecode", cleanInviteCode)
    .single();

  if (roomError || !room) {
    throw new Error("초대코드에 해당하는 방을 찾을 수 없습니다.");
  }

  const { data: existingMember } = await supabase
    .from("room_members")
    .select("*")
    .eq("roomid", room.id)
    .eq("userid", userId)
    .maybeSingle();

  if (existingMember) {
    throw new Error("이미 참가한 방입니다.");
  }

  const { error: memberError } = await supabase
    .from("room_members")
    .insert([
      {
        roomid: room.id,
        userid: userId,
        nickname: nickname,
      },
    ]);

  if (memberError) {
    console.error(memberError);
    throw new Error("방 참가 실패");
  }

  // 마지막 활동 시간 갱신
  const { error: activityError } = await supabase
    .from("rooms")
    .update({
      lastactivityat: new Date().toISOString(),
    })
    .eq("id", room.id);

  if (activityError) {
    console.error("마지막 활동 시간 갱신 실패:", activityError);
  }

  return {
    message: "방 참가 완료",
    room,
  };
}

export async function joinRoomById(roomId, userId, nickname) {
  const { data: existing } = await supabase
    .from("room_members")
    .select("id")
    .eq("roomid", Number(roomId))
    .eq("userid", userId)
    .maybeSingle();

  if (existing) throw new Error("이미 참가한 방입니다.");

  const { error } = await supabase
    .from("room_members")
    .insert([{ roomid: Number(roomId), userid: userId, nickname }]);

  if (error) throw new Error("방 참가 실패");

  await supabase
    .from("rooms")
    .update({ lastactivityat: new Date().toISOString() })
    .eq("id", Number(roomId));
}

export async function getRooms(userId) {
  // 1. 방 목록 및 본인의 가입 시간(joinedat) 가져오기
  const { data: memberData, error: memberError } = await supabase
    .from("room_members")
    .select(`
      joinedat,
      rooms (
        *,
        room_members(count),
        room_guests(count)
      )
    `)
    .eq("userid", userId);

  if (memberError) {
    console.error(memberError);
    throw new Error("방 목록 조회 실패");
  }

  // 2. 안 읽은 알림 전체 조회 (receiverid === 본인, isread === false)
  const { data: notifications, error: notifError } = await supabase
    .from("notifications")
    .select("roomid, createdat")
    .eq("receiverid", userId)
    .eq("isread", false);

  if (notifError) {
    console.error(notifError);
    throw new Error("알림 데이터 조회 실패");
  }

  // 3. 가시성 필터링 및 방별 unreadCount 집계 (Reduce 사용)
  const unreadCountMap = (notifications || []).reduce((acc, notif) => {
    const myParticipation = memberData.find(m => Number(m.rooms.id) === Number(notif.roomid));
    
    // 가시성 규칙: 가입 시간(joinedat) 이후에 생성된 알림만 합산
    if (myParticipation && new Date(notif.createdat) >= new Date(myParticipation.joinedat)) {
      acc[notif.roomid] = (acc[notif.roomid] || 0) + 1;
    }
    return acc;
  }, {});

  // 4. 데이터 결합 및 초기 정렬
  const rooms = memberData
    .map((item) => ({
      ...item.rooms,
      unreadCount: unreadCountMap[item.rooms.id] || 0
    }))
    .sort((a, b) => {
      // 규칙 1순위: unreadCount 내림차순
      if (b.unreadCount !== a.unreadCount) {
        return b.unreadCount - a.unreadCount;
      }
      // 규칙 2순위: 최신 활동 시간(또는 생성일) 내림차순
      const timeA = new Date(a.lastactivityat || a.createdat).getTime();
      const timeB = new Date(b.lastactivityat || b.createdat).getTime();
      return timeB - timeA;
    });

  return {
    rooms,
  };
}

export async function getRoomDetail(roomId) {
  const { data, error } = await supabase
    .from("rooms")
    .select(`
      *,
      room_members(count)
    `)
    .eq("id", roomId)
    .single();

  if (error) {
    console.error(error);
    throw new Error("방 상세 조회 실패");
  }

  return data;
}

export async function updateRoomLastActivity(roomId) {
  const { error } = await supabase
    .from("rooms")
    .update({
      lastactivityat: new Date().toISOString(),
    })
    .eq("id", Number(roomId));

  if (error) {
    console.error("방 활동 시간 갱신 실패:", error);
  }
}

export async function transferRoomOwnership(roomId, newHostId) {
  const { error } = await supabase
    .from("rooms")
    .update({
      createdby: newHostId,
    })
    .eq("id", Number(roomId));

  if (error) {
    console.error("방장 권한 양도 실패:", error);
    throw new Error("방장 권한 양도 중 오류가 발생했습니다.");
  }
}

export async function kickParticipantApi(roomId, participantId, type) {
  const table = type === "member" ? "room_members" : "room_guests";
  const idColumn = type === "member" ? "userid" : "id";

  const { error } = await supabase
    .from(table)
    .delete()
    .eq("roomid", Number(roomId))
    .eq(idColumn, participantId);

  if (error) {
    console.error("추방 실패:", error);
    throw new Error("멤버 추방에 실패했습니다.");
  }
}

export async function updateRoomNameApi(roomId, newName) {
  const { error } = await supabase
    .from("rooms")
    .update({ roomname: newName })
    .eq("id", Number(roomId));

  if (error) {
    console.error("방 이름 수정 실패:", error);
    throw new Error("방 이름 수정에 실패했습니다.");
  }
}

export async function updateRoomImageApi(file, roomId, userId) {
  try {
    const fileExt = file.name.split(".").pop();
    // RLS 정책을 준수하기 위해 userId를 파일명 앞에 추가 (avatars 버킷 정책 기준)
    const fileName = `${userId}_room_${roomId}_${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, { upsert: true });

    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(filePath);

    const { error: roomError } = await supabase
      .from("rooms")
      .update({ roomimageurl: publicUrl })
      .eq("id", Number(roomId));

    if (roomError) throw roomError;

    return {
      success: true,
      publicUrl,
      message: "방 대표 이미지가 성공적으로 변경되었습니다.",
    };
  } catch (error) {
    console.error("방 이미지 업로드 오류:", error.message);
    throw error;
  }
}

export async function getRoomById(roomId) {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", Number(roomId))
    .single();

  if (error) {
    console.error("방 조회 실패:", error);
    throw error;
  }

  return data;
}
