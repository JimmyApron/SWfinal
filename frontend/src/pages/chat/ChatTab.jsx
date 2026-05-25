import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { createRoomNotifications } from "../../api/notificationApi";
import "./ChatTab.css";

function ChatTab({ roomId }) {
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const bottomRef = useRef(null);

  // 👤 [원본 유지] 유저 로드 로직
  useEffect(() => {
    const loadUser = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;

      if (!user) {
        const guestId = localStorage.getItem("guest_id");
        setCurrentUser({ id: guestId || "guest" });
        setCurrentProfile({
          nickname: localStorage.getItem("guest_nickname") || "게스트",
          profileimageurl: null,
        });
        return;
      }

      setCurrentUser(user);

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, nickname, profileimageurl")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error("프로필 조회 실패:", error);
        return;
      }

      setCurrentProfile(profile);
    };

    loadUser();
  }, []);

  // 📡 [순서 교정 🎯] 데이터 조회 후 실시간 구독 연동
  useEffect(() => {
    if (!roomId) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from("room_messages")
        .select("*")
        .eq("roomid", Number(roomId))
        .order("createdat", { ascending: true });

      if (error) {
        console.error("채팅 조회 실패:", error);
        return;
      }

      setMessages(data || []);
    };

    fetchMessages();

    const channel = supabase
      .channel(`room-chat-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `roomid=eq.${roomId}`,
        },
        (payload) => {
          setMessages((prev) => {
            if (prev.some(m => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ✉️ 메시지 전송 로직 (알림 온오프 스위치 실시간 반영)
  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!content.trim()) return;
    if (!currentUser || !currentProfile) {
      alert("사용자 정보를 불러오는 중입니다.");
      return;
    }

    // 🌟 오리지널 스키마 구조 보존
    const newMessage = {
      roomid: Number(roomId),
      userid: currentUser.id === "guest" ? null : currentUser.id,
      nickname: currentProfile.nickname || "익명",
      profileimageurl: currentProfile.profileimageurl || null,
      content: content.trim(),
    };

    // 1. 메시지 테이블에 채팅 데이터 대입
    const { error } = await supabase.from("room_messages").insert([newMessage]);

    if (error) {
      console.error("메시지 전송 실패:", error);
      alert("메시지 전송에 실패했습니다.");
      return;
    }

    // 인풋 필드 초기화
    setContent("");

    // 2. 🔔 [알림 필터링 보호막 스타트] 
    try {
      // 🟢 이 방에 속한 회원들 중 '채팅 알림을 켠(true)' 유저 목록만 쿼리로 필터링해서 가져옵니다.
      const { data: activeMembers } = await supabase
        .from("room_members")
        .select("userid")
        .eq("roomid", Number(roomId))
        .eq("chatnotifenabled", true); // 🎯 알림을 오프한 사람은 리스트에서 제외

      // 🟡 이 방에 속한 게스트들 중 '채팅 알림을 켠(true)' 게스트 목록도 가져옵니다.
      const { data: activeGuests } = await supabase
        .from("room_guests")
        .select("nickname")
        .eq("roomid", Number(roomId))
        .eq("chatnotifenabled", true);

      // 내가 보낸 메시지 알림이 나한테 쌓이는 것을 방지하기 위해 내 아이디 필터링
      const filteredMemberIds = activeMembers
        ? activeMembers.map((m) => m.userid).filter((id) => id !== currentUser.id)
        : [];

      // 🎯 알림을 켠 유저가 방에 존재할 때만 알림 API를 호출하거나 알림을 쌓도록 파라미터 전달
      // (만약 createRoomNotifications 내부에서 대량 인서트를 처리하고 있다면, 해당 리스트를 넘겨주는 방식으로 고도화가 가능합니다.)
      if (filteredMemberIds.length > 0 || (activeGuests && activeGuests.length > 0)) {
        await createRoomNotifications({
          roomId,
          senderId: currentUser.id,
          type: "chat_new", // App.jsx에 새롭게 세팅한 키값 매칭
          title: "새 채팅이 도착했습니다",
          message: `${currentProfile.nickname || "익명"}님이 메시지를 보냈습니다.`,
          link: `/rooms/${roomId}?tab=chat`,
          targetUserIds: filteredMemberIds, // 알림 대상자 필터 리스트 전달
        });
      }
    } catch (notificationError) {
      console.error("채팅 알림 생성 실패:", notificationError);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-message-list">
        {messages.map((message) => {
          const isMine = currentUser && message.userid === currentUser.id;

          return (
            <div
              key={message.id || Math.random()}
              className={`chat-row ${isMine ? "mine" : "other"}`}
            >
              {!isMine && (
                <img
                  className="chat-profile-image"
                  src={
                    message.profileimageurl ||
                    "https://via.placeholder.com/40?text=?"
                  }
                  alt="프로필"
                />
              )}

              <div className="chat-message-box">
                {!isMine && (
                  <div className="chat-nickname">{message.nickname}</div>
                )}

                <div className={`chat-bubble ${isMine ? "mine" : "other"}`}>
                  {message.content}
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSendMessage}>
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="메시지를 입력하세요"
        />
        <button type="submit">전송</button>
      </form>
    </div>
  );
}

export default ChatTab;