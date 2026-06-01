// 📄 src/notification/VoteNotification.js
import { createRoomNotifications } from "../../api/notificationApi";

/**
 * 투표 관련 알림을 통합하여 발송하는 함수
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
    if (!rId) return;

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

    // 1. 작성자를 제외한 참여자들에게 새 투표 알림 발송 (createRoomNotifications 사용)
    await createRoomNotifications({
      roomId: rId,
      senderId,
      type: "vote_new",
      title: isUrgent
        ? `⚠️ [긴급] ${typeLabel} 투표 마감 임박`
        : `${typeTitle} 등장`,
      message: isUrgent
        ? `⚠️ [${rName}] 방에 마감이 ${diffInMinutes}분 남은 긴급 ${typeLabel} 투표 [${title}]이(가) 생성되었습니다!`
        : `🔔 [${rName}] 방에 새로운 ${typeLabel} 투표 [${title}]이(가) 생성되었습니다!`,
      link,
    });

    // 2. 마감까지 30분 미만이면 작성자 본인에게도 긴급 알림 발송 (작성자는 createRoomNotifications에서 필터링되므로 따로 생성)
    if (isUrgent && senderId) {
      const { createNotification } = await import("../../api/notificationApi");
      await createNotification({
        roomId: rId,
        receiverId: senderId,
        senderId,
        type: "vote_reminder",
        title: `⚠️ ${typeLabel} 투표 마감 임박`,
        message: `⚠️ 작성하신 [${title}] (${typeLabel} 투표)의 마감 시간이 ${diffInMinutes}분 남았습니다!`,
        link,
      });
    }

  } catch (error) {
    console.error("투표 알림 통합 연동 실패:", error);
  }
};

/**
 * 투표 마감 완료 알림 발송 함수
 */
export const sendVoteClosedNotification = async ({
  roomid,
  voteid,
  title,
  senderId,
}) => {
  try {
    const rId = Number(roomid);
    if (!rId || !voteid) return;

    // createRoomNotifications 내부에서 방 이름을 조회하지 않으므로, 
    // 메시지 구성을 위해 필요한 경우 여기서 조회하거나 일반적인 문구 사용
    // 여기서는 type에 따른 설정을 적용하기 위해 createRoomNotifications 호출
    
    await createRoomNotifications({
      roomId: rId,
      senderId: null, // 마감 알림은 시스템 성격이므로 senderId를 null로 하거나 senderId 유지
      type: "vote_closed",
      title: "🔒 투표 마감 완료",
      message: `🏁 방의 [${title}] 투표가 마감되었습니다! 최종 결과를 확인해 보세요.`,
      link: `/rooms/${rId}/votes/${voteid}`,
    });

  } catch (error) {
    console.error("‼️ 투표 마감 알림 발송 프로세스 전체 실패:", error);
  }
};
