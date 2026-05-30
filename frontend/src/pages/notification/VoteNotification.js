// 📄 src/notification/VoteNotification.js
// 🚀 은혜님이 기억하라고 박제해 주신 진짜 100% 정답 경로 (절대 사수!)
import { supabase } from "../../lib/supabaseClient";

/**
 * 투표 관련 알림을 통합하여 발송하는 함수
 *
 * 유지한 기능:
 * - 투표 생성 시 방 참여자에게 알림
 * - 일정/중간장소/일반 투표 타입 구분
 * - 마감 시간이 30분 미만으로 남은 투표를 생성하면 긴급 알림 문구로 발송
 * - 작성자 본인에게도 긴급 마감 임박 알림 발송
 * - 실제 30분 전 반복 체크 알림은 voteJob.js에서 처리하도록 프론트에서는 예약하지 않음
 */
export const sendVoteNotification = async ({
  roomid,
  title,
  createdVoteId,
  currentUser,
  roomName,
  endtimeenabled,
  reminderenabled,
  endtime,
  votetype,
}) => {
  try {
    const rId = Number(roomid);

    if (!rId) {
      console.warn("투표 알림 발송 생략: roomid가 없습니다.");
      return;
    }

    const rName = roomName || "참여 중인 방";
    const senderId = currentUser?.id || null;

    const typeLabel =
      votetype === "schedule"
        ? "일정"
        : votetype === "location"
        ? "중간장소"
        : "일반";

    const typeTitle =
      votetype === "schedule"
        ? "📅 일정 투표"
        : votetype === "location"
        ? "📍 중간장소 투표"
        : "🗳️ 일반 투표";

    console.log(
      `🚀 [투표 알림 준비] 방: ${rName}(${rId}), 투표: ${title}, 타입: ${typeLabel}`
    );

    const [{ data: members, error: memberError }, { data: guests, error: guestError }] =
      await Promise.all([
        supabase.from("room_members").select("userid").eq("roomid", rId),
        supabase.from("room_guests").select("id").eq("roomid", rId),
      ]);

    if (memberError) throw memberError;
    if (guestError) throw guestError;

    const allReceivers = Array.from(
      new Set([
        ...(members || []).map((member) => member.userid),
        ...(guests || []).map((guest) => guest.id),
      ])
    ).filter(Boolean);

    if (allReceivers.length === 0) {
      console.log("투표 알림 발송 대상이 없습니다.");
      return;
    }

    let isUrgent = false;
    let diffInMinutes = 0;

    if (endtimeenabled && reminderenabled && endtime) {
      const endDate = new Date(endtime);
      const nowDate = new Date();

      if (!Number.isNaN(endDate.getTime())) {
        diffInMinutes = Math.ceil(
          (endDate.getTime() - nowDate.getTime()) / (1000 * 60)
        );

        if (diffInMinutes > 0 && diffInMinutes < 30) {
          isUrgent = true;
        }
      }
    }

    const link = createdVoteId
      ? `/rooms/${rId}/votes/${createdVoteId}`
      : `/rooms/${rId}?tab=vote`;

    const notifications = [];

    // 1. 작성자를 제외한 참여자들에게 새 투표 알림 발송
    const otherReceivers = allReceivers.filter(
      (receiverId) => receiverId !== senderId
    );

    otherReceivers.forEach((receiverId) => {
      notifications.push({
        roomid: rId,
        receiverid: receiverId,
        senderid: senderId,
        type: "vote_new",
        title: isUrgent
          ? `⚠️ [긴급] ${typeLabel} 투표 마감 임박`
          : `${typeTitle} 등장`,
        message: isUrgent
          ? `⚠️ [${rName}] 방에 마감이 ${diffInMinutes}분 남은 긴급 ${typeLabel} 투표 [${title}]이(가) 생성되었습니다!`
          : `🔔 [${rName}] 방에 새로운 ${typeLabel} 투표 [${title}]이(가) 생성되었습니다!`,
        isread: false,
        link,
      });
    });

    // 2. 마감까지 30분 미만이면 작성자 본인에게도 긴급 알림 발송
    if (isUrgent && senderId) {
      notifications.push({
        roomid: rId,
        receiverid: senderId,
        senderid: senderId,
        type: "vote_reminder",
        title: `⚠️ ${typeLabel} 투표 마감 임박`,
        message: `⚠️ 작성하신 [${title}] (${typeLabel} 투표)의 마감 시간이 ${diffInMinutes}분 남았습니다!`,
        isread: false,
        link,
      });
    }

    if (notifications.length === 0) {
      console.log("투표 알림 저장 생략: 작성자 외 수신자가 없습니다.");
      return;
    }

    const { error } = await supabase
      .from("notifications")
      .insert(notifications);

    if (error) {
      console.error("❌ 투표 알림 저장 실패:", error);
      throw error;
    }

    console.log(`📢 투표 알림 발송 성공! (${notifications.length}건)`);

    // 중요:
    // 마감 30분 전 알림을 프론트에서 직접 예약하지 않음.
    // 백엔드 voteJob.js가 1분마다 순회하면서 reminderenabled가 켜진 투표를 체크하고,
    // 마감 30분 전 알림을 발송하는 구조를 유지한다.
  } catch (error) {
    console.error("투표 알림 통합 연동 실패:", error);
  }
};

/**
 * 투표 마감 완료 알림 발송 함수
 *
 * 유지한 기능:
 * - 투표가 끝났을 때 방 참여자 전체에게 마감 알림
 * - 회원 + 게스트 모두 대상
 * - 어떤 방의 어떤 투표가 마감됐는지 메시지에 표시
 * - 실제 isclosed 처리는 이 함수 밖에서 처리하는 구조 유지
 */
export const sendVoteClosedNotification = async ({
  roomid,
  voteid,
  title,
  senderId,
  roomName,
}) => {
  try {
    const rId = Number(roomid);

    if (!rId || !voteid) {
      console.warn("투표 마감 알림 발송 생략: roomid 또는 voteid가 없습니다.");
      return;
    }

    let rName = roomName;

    if (!rName) {
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("roomname")
        .eq("id", rId)
        .maybeSingle();

      if (roomError) {
        console.error("방 이름 조회 실패:", roomError);
      }

      rName = roomData?.roomname || "참여 중인 방";
    }

    console.log(`🚀 [마감 알림 시작] 방: ${rName}(${rId}), 투표: ${title}`);

    const [{ data: members, error: memberError }, { data: guests, error: guestError }] =
      await Promise.all([
        supabase.from("room_members").select("userid").eq("roomid", rId),
        supabase.from("room_guests").select("id").eq("roomid", rId),
      ]);

    if (memberError) throw memberError;
    if (guestError) throw guestError;

    const allReceivers = Array.from(
      new Set([
        ...(members || []).map((member) => member.userid),
        ...(guests || []).map((guest) => guest.id),
      ])
    ).filter(Boolean);

    if (allReceivers.length === 0) {
      console.log("투표 마감 알림 발송 대상이 없습니다.");
      return;
    }

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

    const { error } = await supabase
      .from("notifications")
      .insert(closeNotifications);

    if (error) {
      console.error("❌ 마감 알림 저장 실패:", error);
      throw error;
    }

    console.log(`📢 투표 마감 알림 발송 성공! (${allReceivers.length}명)`);
  } catch (error) {
    console.error("‼️ 투표 마감 알림 발송 프로세스 전체 실패:", error);
  }
};