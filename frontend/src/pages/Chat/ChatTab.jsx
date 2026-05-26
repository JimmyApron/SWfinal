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

  // 📡 [원본 유지] 데이터 조회 후 실시간 구독 연동
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

  // ✉️ 메시지 전송 로직 (알림 온오프 데이터 바인딩 버그 수정 🎯)
  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!content.trim()) return;
    if (!currentUser || !currentProfile) {
      return;
    }

    const newMessage = {
      roomid: Number(roomId),
      userid: currentUser.id === "guest" ? null : currentUser.id,
      nickname: currentProfile.nickname || "익명",
      profileimageurl: currentProfile.profileimageurl || null,
      content: content.trim(),
    };

    const { error } = await supabase.from("room_messages").insert([newMessage]);

    if (error) {
      console.error("메시지 전송 실패:", error);
      return;
    }

    setContent("");

    // 2. 🔔 [알림 필터링 보호막 정밀 수술]
 // 🎯 [ChatTab.jsx 수정본] handleSendMessage 내부의 알림 생성 로직 구역
try {
  // 1. 알림을 켠 회원(Members) 조회
  const { data: activeMembers } = await supabase
    .from("room_members")
    .select("userid")
    .eq("roomid", Number(roomId))
    .eq("chatnotifenabled", true);

  // 2. 알림을 켠 비회원 게스트(Guests) 조회 🐱
  const { data: activeGuests } = await supabase
    .from("room_guests")
    .select("id")
    .eq("roomid", Number(roomId))
    .eq("chatnotifenabled", true);

  // 내 아이디 제외하고 회원 ID 리스트 추출
  const filteredMemberIds = activeMembers
    ? activeMembers.map((m) => m.userid).filter((id) => id !== currentUser.id)
    : [];

  // 🎯 [핵심 연동] 알림을 켠 회원들이 존재할 때만 정확하게 알림 발송!
  if (filteredMemberIds.length > 0) {
    await createRoomNotifications({
      roomId,
      senderId: currentUser.id,
      type: "chat_new",
      title: "새 채팅이 도착했습니다",
      message: `${currentProfile.nickname || "익명"}님이 메시지를 보냈습니다.`,
      link: `/rooms/${roomId}?tab=chat`,
      targetUserIds: filteredMemberIds, 
    });
    console.log("💬 알림 수신 대상자 필터링 및 발송 성공!");
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