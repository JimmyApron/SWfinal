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

    // 1. 알림 대상 (회원 + 게스트) 싹 긁어오기
    const [ { data: members }, { data: guests } ] = await Promise.all([
      supabase.from("room_members").select("userid").eq("roomid", rId).eq("votenotifenabled", true),
      supabase.from("room_guests").select("id").eq("roomid", rId).eq("votenotifenabled", true)
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

    // ⏰ 마감 임박 알림 추가 예약 (필요 시)
    if (endtimeenabled && reminderenabled && endtime && allReceivers.length > 0) {
      const formattedEndTime = endtime.includes("Z") || endtime.includes("+") 
        ? endtime 
        : `${endtime}:00+09:00`;

      const now = new Date();
      const end = new Date(formattedEndTime);
      const diffInMinutes = (end.getTime() - now.getTime()) / (1000 * 60);

      if (diffInMinutes > 0 && diffInMinutes <= 30) {
        const reminders = allReceivers.map((receiverId) => ({
          roomid: rId,
          receiverid: receiverId, 
          senderid: senderId,
          type: "vote_reminder",     
          title: "🗳️ 투표 마감 임박",  
          message: `⚠️ [${rName}] 방의 [${title}] 투표 마감 시간이 ${Math.max(1, Math.round(diffInMinutes))}분 남았습니다! 서둘러 참여해 주세요!`,
          isread: false,
          link: createdVoteId ? `/rooms/${rId}/votes/${createdVoteId}` : `/rooms/${rId}?tab=vote`, 
        }));
        await supabase.from("notifications").insert(reminders);
        console.log("⏱️ 마감 임박 알림 추가 적재 완료!");
      }
    }

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

    // 대상 조회 (회원 + 게스트)
    const [ { data: members }, { data: guests } ] = await Promise.all([
      supabase.from("room_members").select("userid").eq("roomid", rId).eq("votenotifenabled", true),
      supabase.from("room_guests").select("id").eq("roomid", rId).eq("votenotifenabled", true)
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

// ========================================================
// 🛡️ [무해한 프론트 체커] 은혜님 전용 투표 종료 알림 및 마감 처리 함수 🎯
// ========================================================
export const checkAndNotifyClosedVotes = async (roomid) => {
  try {
    if (!roomid) return;
    
    const nowIso = new Date().toISOString();

    // 1. 🔍 마감 시간은 지났는데 아직 데이터베이스에 'isclosed'가 false인 투표 사냥하기
    const { data: expiredVotes, error: fetchError } = await supabase
      .from("votes")
      .select("id, title")
      .eq("roomid", Number(roomid))
      .eq("endtimeenabled", true)
      .lte("endtime", nowIso) // 마감일시 <= 현재시간
      .eq("isclosed", false); // 🚀 은혜님 DB에 이미 있던 진짜 스키마 컬럼 매칭!

    if (fetchError || !expiredVotes || expiredVotes.length === 0) return;

    // 2. 📢 마감 투표가 발견되면 해당 방에 있는 사람들에게 알림 전송
    for (const vote of expiredVotes) {
      // 공통 알림 함수 호출 (회원 + 게스트)
      await sendVoteClosedNotification({
        roomid: roomid,
        voteid: vote.id,
        title: vote.title,
      });

      // 3. 🔒 [중요] 중복 알림이 가지 않도록, 알림 쏜 투표는 즉시 isclosed = true 처리!
      await supabase
        .from("votes")
        .update({ isclosed: true })
        .eq("id", vote.id);
        
      console.log(`🏁 [${vote.title}] 투표가 시간 만료되어 자동으로 마감 완료 처리되었습니다.`);
    }
  } catch (error) {
    console.error("🔒 투표 자동 마감 체크 중 실패:", error);
  }
};