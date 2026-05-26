// ✉️ 일정 등록 완료 직후 호출할 알림 연동 함수
const sendScheduleNotification = async (newScheduleTitle) => {
  try {
    // 1. 이 방에서 [일정 알림]을 ON 한 회원들만 조회
    const { data: activeMembers } = await supabase
      .from("room_members")
      .select("userid")
      .eq("roomid", Number(roomId))
      .eq("schedulenotifenabled", true); // 🎯 은혜님이 만든 회원용 컬럼 매칭!

    // 내가 만든 일정인데 나한테 알림 오면 짜증 나니까 내 아이디는 필터링!
    const filteredMemberIds = activeMembers
      ? activeMembers.map((m) => m.userid).filter((id) => id !== currentUser.id)
      : [];

    // 2. 알림을 켠 대상 회원이 존재할 때만 알림 API 호출
    if (filteredMemberIds.length > 0) {
      await createRoomNotifications({
        roomId,
        senderId: currentUser.id,
        type: "schedule_new", // 일정 전용 타입
        title: "📅 새로운 일정이 등록되었습니다",
        message: `'${newScheduleTitle}' 일정이 새롭게 추가되었으니 확인해 보세요!`,
        link: `/rooms/${roomId}?tab=schedule`, // 일정 탭으로 바로 가기 링크
        targetUserIds: filteredMemberIds,
      });
      console.log("📅 일정 알림 발송 대상자 필터링 성공!");
    }
  } catch (error) {
    console.error("일정 알림 연동 실패:", error);
  }
};