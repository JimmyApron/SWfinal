const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/**
 * ⏰ 마감 시간이 지난 투표를 찾아 자동으로 닫고 알림을 보내는 작업 (로직 A)
 */
async function checkAndCloseExpiredVotes() {
  try {
    // KST 시간 (UTC + 9)으로 변환하여 DB의 'Z' 없는 시간과 맞춤
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const nowIso = kstNow.toISOString().replace('Z', ''); 

    // 1. 마감 시간은 지났는데 아직 'isclosed'가 false인 투표 사냥 및 즉시 마감 처리 (원자적)
    const { data: closedVotes, error: updateError } = await supabase
      .from("votes")
      .update({ isclosed: true })
      .eq("endtimeenabled", true)
      .lte("endtime", nowIso) // 마감일시 <= 현재시간 (KST)
      .eq("isclosed", false) // 아직 안 닫힌 것만
      .select("id, roomid, title");

    if (updateError) {
      console.error("❌ [백엔드-마감] 투표 자동 마감 처리 중 오류:", updateError);
      return;
    }

    if (!closedVotes || closedVotes.length === 0) return;

    console.log(`✅ [백엔드-마감] ${closedVotes.length}개의 투표가 시간이 만료되어 자동으로 마감 처리되었습니다.`);

    // 2. 실제로 마감 처리된 각 투표에 대해 방 멤버 전원에게 알림 발송
    for (const vote of closedVotes) {
      await sendClosedNotifications(vote);
    }
  } catch (err) {
    console.error("‼️ [백엔드-마감] 투표 마감 작업 전체 실패:", err);
  }
}

/**
 * 🔔 마감 30분 이내로 진입한 투표를 찾아 임박 알림을 보내는 작업 (로직 B)
 */
async function checkAndSendReminders() {
  try {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const thirtyMinsLater = new Date(kstNow.getTime() + 30 * 60 * 1000).toISOString().replace('Z', '');
    const nowIso = kstNow.toISOString().replace('Z', '');
    
    // isclosed = false 이고, 
    // is_reminder_sent = false 이며, 
    // endtime <= NOW() + 30분 인 투표 사냥 및 플래그 업데이트
    const { data: reminderVotes, error: updateError } = await supabase
      .from("votes")
      .update({ is_reminder_sent: true })
      .eq("endtimeenabled", true)
      .eq("reminderenabled", true)
      .eq("isclosed", false)
      .eq("is_reminder_sent", false)
      .lte("endtime", thirtyMinsLater) // 마감시간이 현재 기준 30분 이내로 들어옴 (KST)
      .gt("endtime", nowIso) // 단, 이미 마감된 것은 제외 (KST)
      .select("id, roomid, title, endtime");

    if (updateError) {
      console.error("❌ [백엔드-임박] 투표 임박 알림 처리 중 오류:", updateError);
      return;
    }

    if (!reminderVotes || reminderVotes.length === 0) return;

    console.log(`✅ [백엔드-임박] ${reminderVotes.length}개의 투표에 대해 마감 임박 알림을 발송합니다.`);

    for (const vote of reminderVotes) {
      await sendReminderNotifications(vote);
    }
  } catch (err) {
    console.error("‼️ [백엔드-임박] 투표 임박 알림 작업 전체 실패:", err);
  }
}

/**
 * 중복 알림 여부를 확인합니다.
 */
async function isDuplicateNotification(receiverId, type, roomId, link) {
  try {
    let query = supabase
      .from("notifications")
      .select("id")
      .eq("receiverid", String(receiverId))
      .eq("type", type);

    if (roomId) query = query.eq("roomid", Number(roomId));
    if (link) query = query.eq("link", link);
    
    // 최근 1시간 이내의 동일한 알림이 있는지 확인
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    query = query.gt("createdat", oneHourAgo);

    const { data, error } = await query.limit(1);
    if (error) return false;
    return data && data.length > 0;
  } catch (err) {
    return false;
  }
}

/**
 * 📢 마감된 투표에 대해 방 참여자 전원에게 알림을 보냅니다.
 */
async function sendClosedNotifications(vote) {
  try {
    const { id: voteId, roomid: roomId, title } = vote;

    // 방 이름 조회
    const { data: roomData } = await supabase
      .from("rooms")
      .select("roomname")
      .eq("id", roomId)
      .maybeSingle();
    
    const roomName = roomData?.roomname || "참여 중인 방";

    // 대상 조회 (설정값 포함)
    const [ { data: members }, { data: guests } ] = await Promise.all([
      supabase.from("room_members").select("userid, votenotifenabled").eq("roomid", roomId),
      supabase.from("room_guests").select("id, votenotifenabled").eq("roomid", roomId)
    ]);

    const allReceivers = [
      ...(members || []).map(m => ({ id: m.userid, enabled: m.votenotifenabled })),
      ...(guests || []).map(g => ({ id: g.id, enabled: g.votenotifenabled }))
    ];

    if (allReceivers.length > 0) {
      const link = `/rooms/${roomId}/votes/${voteId}`;
      const type = "vote_closed";
      const notifications = [];

      for (const receiver of allReceivers) {
        // 중복 체크
        const isDup = await isDuplicateNotification(receiver.id, type, roomId, link);
        if (!isDup) {
          notifications.push({
            roomid: roomId,
            receiverid: String(receiver.id),
            senderid: null,
            type: type,
            title: "🔒 투표 마감 완료",
            message: `🏁 [${roomName}] 방의 [${title}] 투표가 마감되었습니다! 최종 결과를 확인해 보세요.`,
            isread: false,
            issilent: receiver.enabled === false, // 설정이 꺼져 있으면 조용한 알림
            link: link,
          });
        }
      }

      if (notifications.length > 0) {
        const { error } = await supabase.from("notifications").insert(notifications);
        if (error) console.error(`❌ [백엔드-마감] 알림 저장 실패 (투표 ID: ${voteId}):`, error);
      }
    }
  } catch (err) {
    console.error(`‼️ [백엔드-마감] 알림 발송 중 오류 (투표 ID: ${vote.id}):`, err);
  }
}

/**
 * 📢 마감 임박 투표에 대해 방 참여자 전원에게 알림을 보냅니다.
 */
async function sendReminderNotifications(vote) {
  try {
    const { id: voteId, roomid: roomId, title, endtime } = vote;

    const { data: roomData } = await supabase
      .from("rooms")
      .select("roomname")
      .eq("id", roomId)
      .maybeSingle();
    
    const roomName = roomData?.roomname || "참여 중인 방";

    // 대상 조회 (설정값 포함)
    const [ { data: members }, { data: guests } ] = await Promise.all([
      supabase.from("room_members").select("userid, votenotifenabled").eq("roomid", roomId),
      supabase.from("room_guests").select("id, votenotifenabled").eq("roomid", roomId)
    ]);

    const allReceivers = [
      ...(members || []).map(m => ({ id: m.userid, enabled: m.votenotifenabled })),
      ...(guests || []).map(g => ({ id: g.id, enabled: g.votenotifenabled }))
    ];

    if (allReceivers.length > 0) {
      const link = `/rooms/${roomId}/votes/${voteId}`;
      const type = "vote_reminder";
      
      // 남은 시간(분) 계산
      const endTimestamp = new Date(endtime.replace(' ', 'T') + "+09:00").getTime();
      const nowTimestamp = new Date().getTime();
      const diffInMinutes = Math.max(1, Math.ceil((endTimestamp - nowTimestamp) / (1000 * 60)));
      
      const notifications = [];

      for (const receiver of allReceivers) {
        // 중복 체크
        const isDup = await isDuplicateNotification(receiver.id, type, roomId, link);
        if (!isDup) {
          notifications.push({
            roomid: roomId,
            receiverid: String(receiver.id),
            senderid: null,
            type: type,
            title: "🗳️ 투표 마감 임박",
            message: `⚠️ [${roomName}] 방의 [${title}] 투표 마감 시간이 ${diffInMinutes}분 남았습니다! 서둘러 참여해 주세요!`,
            isread: false,
            issilent: receiver.enabled === false, // 설정이 꺼져 있으면 조용한 알림
            link: link,
          });
        }
      }

      if (notifications.length > 0) {
        const { error } = await supabase.from("notifications").insert(notifications);
        if (error) console.error(`❌ [백엔드-임박] 알림 저장 실패 (투표 ID: ${voteId}):`, error);
      }
    }
  } catch (err) {
    console.error(`‼️ [백엔드-임박] 알림 발송 중 오류 (투표 ID: ${vote.id}):`, err);
  }
}

/**
 * 서비스 시작 (1분 주기로 실행)
 */
function startVoteCloserJob() {
  console.log("🚀 [백엔드] 투표 감시 프로세스 활성화됨 (1분 간격)");
  
  // 서버 시작 시 즉시 한 번 실행
  checkAndCloseExpiredVotes();
  checkAndSendReminders();
  
  // 이후 1분마다 주기적 실행
  setInterval(() => {
    checkAndCloseExpiredVotes();
    checkAndSendReminders();
  }, 60000);
}

module.exports = { startVoteCloserJob };
