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

  useEffect(() => {
    const loadUser = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;

      if (!user) {
        const guestId = localStorage.getItem("guest_id");
        setCurrentUser({ id: guestId || "guest" });
        setCurrentProfile({
          nickname: localStorage.getItem("guest_nickname") || "게스트",
          profile_image_url: null,
        });
        return;
      }

      setCurrentUser(user);

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, nickname, profile_image_url")
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
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!content.trim()) return;
    if (!currentUser || !currentProfile) {
      alert("사용자 정보를 불러오는 중입니다.");
      return;
    }

    const newMessage = {
      roomid: Number(roomId),
      userid: currentUser.id === "guest" ? null : currentUser.id,
      nickname: currentProfile.nickname || "익명",
      profile_image_url: currentProfile.profile_image_url || null,
      content: content.trim(),
    };

    const { error } = await supabase.from("room_messages").insert([newMessage]);

    if (error) {
    console.error("메시지 전송 실패:", error);
    alert("메시지 전송에 실패했습니다.");
    return;
    }

    try {
    await createRoomNotifications({
        roomId,
        senderId: currentUser.id,
        type: "chat",
        title: "새 채팅이 도착했습니다",
        message: `${currentProfile.nickname || "익명"}님이 메시지를 보냈습니다.`,
        link: `/rooms/${roomId}?tab=chat`,
    });
    } catch (notificationError) {
    console.error("채팅 알림 생성 실패:", notificationError);
    }

    setContent("");
  };

  return (
    <div className="chat-container">
      <div className="chat-message-list">
        {messages.map((message) => {
          const isMine = currentUser && message.userid === currentUser.id;

          return (
            <div
              key={message.id}
              className={`chat-row ${isMine ? "mine" : "other"}`}
            >
              {!isMine && (
                <img
                  className="chat-profile-image"
                  src={
                    message.profile_image_url ||
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