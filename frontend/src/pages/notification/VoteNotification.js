// 📄 src/notification/VoteNotification.js
// 🚀 은혜님이 기억하라고 박제해 주신 진짜 100% 정답 경로 (절대 사수!)
import { supabase } from "../../lib/supabaseClient"; 

/**
 * 🗳️ 투표 관련 알림을 통합하여 발송하는 함수 (기존 로직 보존)
 */
export const sendVoteNotification = async ({
  roomid,
  title,
  createdVoteId,
  currentUser,
  roomName,
  endtimeenabled,
  reminderenabled,
  endtime
}) => {
  try {
    const rId = Number(roomid);
    const rName = roomName || "참여 중인 방";
    const senderId = currentUser?.id || null;

    console.log(`🚀 [알림 준비] 방: ${rName}(${rId}), 투표: ${title}, 발송자: ${senderId}`);

    // 1. 알림 대상 (회원 + 게스트) 싹 긁어오기 (설정 여부 상관없이 모든 참여자에게 발송)
    const [ { data: members }, { data: guests } ] = await Promise.all([
      supabase.from("room_members").select("userid").eq("roomid", rId),
      supabase.from("room_guests").select("id").eq("roomid", rId)
    ]);

    const allReceivers = [
      ...(members || []).map(m => m.userid),
      ...(guests || []).map(g => g.id)
    ].filter(id => id !== senderId); // 본인 제외

    if (allReceivers.length > 0) {
      const notifications = allReceivers.map((receiverId) => ({
        roomid: rId,
        receiverid: receiverId,
        senderid: senderId,
        type: "vote_new", 
        title: "🗳️ 새 투표 등장",
        message: `🔔 [${rName}] 방에 새로운 투표 [${title}]이(가) 생성되었습니다! 지금 바로 참여해 주세요.`,
        isread: false,
        link: createdVoteId ? `/rooms/${rId}/votes/${createdVoteId}` : `/rooms/${rId}?tab=vote`,
      }));

      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) console.error("❌ 새 투표 알림 저장 실패:", error);
      else console.log(`📢 새 투표 알림 발송 성공! (${allReceivers.length}명)`);
    }

    // ⏰ 마감 임박 알림 추가 로직은 프론트엔드에서 완전히 제거되었습니다.
    // 백엔드의 voteJob.js가 1분마다 순회하며 마감 30분 전 투표에 대해 알림을 발송합니다.

  } catch (error) {
    console.error("투표 알림 통합 연동 실패:", error);
  }
};


export const sendVoteClosedNotification = async ({
  roomid,
  voteid,
  title, 
  senderId,
  roomName,
}) => {
  try {
    const rId = Number(roomid);
    if (!rId || !voteid) return;

    let rName = roomName;
    if (!rName) {
      const { data: roomData } = await supabase.from("rooms").select("roomname").eq("id", rId).maybeSingle();
      rName = roomData?.roomname || "참여 중인 방";
    }

    console.log(`🚀 [마감 알림 시작] 방: ${rName}(${rId}), 투표: ${title}`);

    // 대상 조회 (회원 + 게스트) (설정 여부 상관없이 모든 참여자에게 발송)
    const [ { data: members }, { data: guests } ] = await Promise.all([
      supabase.from("room_members").select("userid").eq("roomid", rId),
      supabase.from("room_guests").select("id").eq("roomid", rId)
    ]);

    const allReceivers = [
      ...(members || []).map(m => m.userid),
      ...(guests || []).map(g => g.id)
    ];

    if (allReceivers.length > 0) {
      const closeNotifications = allReceivers.map((receiverId) => ({
        roomid: rId,
        receiverid: receiverId,
        senderid: senderId || null,
        type: "vote_closed", 
        title: "🔒 투표 마감 완료",
        message: `🏁 [${rName}] 방의 [${title}] 투표가 마감되었습니다! 최종 결과를 확인해 보세요.`,
        isread: false,
        link: `/rooms/${rId}/votes/${voteid}`,
      }));

      const { error } = await supabase.from("notifications").insert(closeNotifications);
      if (error) console.error("❌ 마감 알림 저장 실패:", error);
      else console.log(`📢 투표 마감 알림 발송 성공! (${allReceivers.length}명)`);
    }
  } catch (error) {
    console.error("‼️ 투표 마감 알림 발송 프로세스 전체 실패:", error);
  }
};