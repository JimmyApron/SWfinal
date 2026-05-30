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
    // ==========================================
    // 🟢 1. 회원용 새 투표 알림 발송
    // ==========================================
    const { data: activeMembers, error: memberFetchError } = await supabase
      .from("room_members")
      .select("userid")
      .eq("roomid", Number(roomid))
      .eq("votenotifenabled", true);

    if (!memberFetchError && activeMembers && activeMembers.length > 0) {
      const filteredMembers = activeMembers.filter((m) => m.userid !== currentUser?.id);

      if (filteredMembers.length > 0) {
        const newVoteNotifications = filteredMembers.map((member) => ({
          roomid: Number(roomid),
          receiverid: member.userid,
          senderid: currentUser?.id,
          type: "vote_new", 
          title: "🗳️ 새 투표 등장",
          message: `🔔 [${roomName}] 방에 새로운 투표 [${title}]이(가) 생성되었습니다! 지금 바로 참여해 주세요.`,
          isread: false,
          link: createdVoteId ? `/rooms/${roomid}/votes/${createdVoteId}` : `/rooms/${roomid}?tab=vote`,
        }));

        await supabase.from("notifications").insert(newVoteNotifications);
        console.log("📢 새 투표 회원 알림 발송 성공!");
      }
    }

    // ==========================================
    // 🟡 2. 게스트용 새 투표 알림 발송
    // ==========================================
    const { data: activeGuests, error: guestFetchError } = await supabase
      .from("room_guests")
      .select("id")
      .eq("roomid", Number(roomid))
      .eq("votenotifenabled", true);

    if (!guestFetchError && activeGuests && activeGuests.length > 0) {
      const newVoteGuestNotifications = activeGuests.map((guest) => ({
        receiverid: guest.id,
        roomid: Number(roomid),
        senderid: currentUser?.id || null,
        type: "vote_new",
        title: "새 투표 생성",
        isread: false,
        link: createdVoteId ? `/rooms/${roomid}/votes/${createdVoteId}` : `/rooms/${roomid}?tab=vote`,
        message: `🔔 [${roomName}] 방에 새로운 투표 [${title}]이(가) 생성되었습니다!`,
      }));

      const { error: guestNotificationError } = await supabase
        .from("notifications")
        .insert(newVoteGuestNotifications);

      if (guestNotificationError) throw guestNotificationError;
      console.log("📢 새 투표 게스트 알림 발송 성공!");
    }

    // ==========================================
    // ⏰ 3. 마감 임박 알림 추가 예약
    // ==========================================
    if (endtimeenabled && reminderenabled && endtime) {
      const formattedEndTime = endtime.includes("Z") || endtime.includes("+") 
        ? endtime 
        : `${endtime}:00+09:00`;

      const now = new Date();
      const end = new Date(formattedEndTime);
      const diffInMinutes = (end.getTime() - now.getTime()) / (1000 * 60);

      if (diffInMinutes > 0 && diffInMinutes <= 30) {
        if (activeMembers && activeMembers.length > 0) {
          const memberReminders = activeMembers.map((member) => ({
            roomid: Number(roomid),
            receiverid: member.userid, 
            senderid: currentUser?.id,
            type: "vote_reminder",     
            title: "🗳️ 투표 마감 임박",  
            message: `⚠️ [${roomName}] 방의 [${title}] 투표 마감 시간이 ${Math.max(1, Math.round(diffInMinutes))}분 남았습니다! 서둘러 참여해 주세요!`,
            isread: false,
            link: createdVoteId ? `/rooms/${roomid}/votes/${createdVoteId}` : `/rooms/${roomid}?tab=vote`, 
          }));
          await supabase.from("notifications").insert(memberReminders);
        }

        if (activeGuests && activeGuests.length > 0) {
          const guestReminders = activeGuests.map((guest) => ({
            receiverid: guest.id,
            roomid: Number(roomid),
            senderid: currentUser?.id || null,
            type: "vote_reminder",
            title: "투표 마감 임박",
            isread: false,
            link: createdVoteId ? `/rooms/${roomid}/votes/${createdVoteId}` : `/rooms/${roomid}?tab=vote`,
            message: `⚠️ [${roomName}] 방의 [${title}] 투표 마감 시간이 ${Math.max(1, Math.round(diffInMinutes))}분 남았습니다!`,
          }));
          const { error: guestReminderError } = await supabase
            .from("notifications")
            .insert(guestReminders);

          if (guestReminderError) throw guestReminderError;
        }
        console.log("⏱️ 마감 임박 알림 추가 적재 완료!");
      }
    }

  } catch (error) {
    console.error("투표 알림 통합 연동 실패:", error);
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
      // 알림 수신 동의한 멤버 조회
      const { data: activeMembers } = await supabase
        .from("room_members")
        .select("userid")
        .eq("roomid", Number(roomid))
        .eq("votenotifenabled", true);

      if (activeMembers && activeMembers.length > 0) {
        const closeNotifications = activeMembers.map((member) => ({
          roomid: Number(roomid),
          receiverid: member.userid,
          type: "vote_closed", // 🎯 투표 종료 전용 타입
          title: "🔒 투표 마감 완료",
          message: `🏁 새로운 알림이 있습니다. 투표가 마감되었습니다! 최종 결과를 확인해 보세요.`,
          isread: false,
          link: `/rooms/${roomid}/votes/${vote.id}`, // 결과 상세 화면 프리패스
        }));

        await supabase.from("notifications").insert(closeNotifications);
      }

      const { data: activeGuests } = await supabase
        .from("room_guests")
        .select("id")
        .eq("roomid", Number(roomid))
        .eq("votenotifenabled", true);

      if (activeGuests && activeGuests.length > 0) {
        const closeGuestNotifications = activeGuests.map((guest) => ({
          roomid: Number(roomid),
          receiverid: guest.id,
          type: "vote_closed",
          title: "투표 마감 완료",
          message: "투표가 마감되었습니다. 최종 결과를 확인해 보세요.",
          isread: false,
          link: `/rooms/${roomid}/votes/${vote.id}`,
        }));

        const { error: guestCloseError } = await supabase
          .from("notifications")
          .insert(closeGuestNotifications);

        if (guestCloseError) throw guestCloseError;
      }

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
