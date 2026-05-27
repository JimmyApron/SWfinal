import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { createRoomNotifications } from "../../api/notificationApi";
import "./ChatTab.css";

const WEEKDAY_KR = [
  "일요일",
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일",
];

function formatTime(dateStr) {
  const date = new Date(dateStr);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours < 12 ? "오전" : "오후";
  const h = hours % 12 || 12;

  return `${ampm} ${h}:${String(minutes).padStart(2, "0")}`;
}

function formatDateSeparator(dateStr) {
  const date = new Date(dateStr);

  return `${date.getFullYear()}년 ${
    date.getMonth() + 1
  }월 ${date.getDate()}일 ${WEEKDAY_KR[date.getDay()]}`;
}

function getDateOnly(dateStr) {
  const date = new Date(dateStr);

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isDeletedMsg(content) {
  try {
    return JSON.parse(content)?.__type === "deleted";
  } catch {
    return false;
  }
}

function VoteMessageCard({ meta, navigate }) {
  const isClosed =
    meta.isclosed ||
    (meta.endtimeenabled && meta.endtime && new Date(meta.endtime) < new Date());

  const [topOption, setTopOption] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isClosed) return;

    supabase
      .from("votes")
      .select("voteoptions(*), voteresponses(*)")
      .eq("id", meta.voteid)
      .single()
      .then(({ data }) => {
        if (!data) {
          setLoaded(true);
          return;
        }

        const options = data.voteoptions || [];
        const responses = data.voteresponses || [];
        const counts = {};

        responses.forEach((response) => {
          counts[response.optionid] = (counts[response.optionid] || 0) + 1;
        });

        let winner = null;
        let maxCount = 0;

        options.forEach((option) => {
          const count = counts[option.id] || 0;

          if (count > maxCount) {
            maxCount = count;
            winner = { ...option, count };
          }
        });

        setTopOption(winner);
        setLoaded(true);
      });
  }, [isClosed, meta.voteid]);

  const goToVote = (event) => {
    event.stopPropagation();
    navigate(`/rooms/${meta.roomid}/votes/${meta.voteid}`);
  };

  const optionLabel = (option) => {
    if (option.optiontype === "date") {
      return `${option.optiondate}${option.starttime ? ` ${option.starttime}` : ""}${
        option.endtime ? `~${option.endtime}` : ""
      }`;
    }

    return option.placename || option.optiontext || "이름 없는 항목";
  };

  if (!isClosed) {
    return (
      <div onClick={goToVote} style={{ cursor: "pointer", minWidth: "160px" }}>
        <div
          style={{
            display: "inline-block",
            fontSize: "11px",
            fontWeight: "bold",
            color: "#fff",
            backgroundColor: "#7c79ff",
            borderRadius: "10px",
            padding: "2px 8px",
            marginBottom: "6px",
          }}
        >
          📊 진행 중인 투표
        </div>

        <div style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "8px" }}>
          {meta.title}
        </div>

        <div
          style={{
            fontSize: "12px",
            color: "#7c79ff",
            borderTop: "1px solid rgba(0,0,0,0.08)",
            paddingTop: "6px",
          }}
        >
          탭하여 투표 참여 →
        </div>
      </div>
    );
  }

  return (
    <div style={{ minWidth: "180px" }}>
      <div
        style={{
          display: "inline-block",
          fontSize: "11px",
          fontWeight: "bold",
          color: "#999",
          backgroundColor: "#e8e8e8",
          borderRadius: "10px",
          padding: "2px 8px",
          marginBottom: "6px",
        }}
      >
        📊 종료된 투표
      </div>

      <div style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "10px" }}>
        {meta.title}
      </div>

      {!loaded ? (
        <div style={{ fontSize: "12px", color: "#aaa", marginBottom: "8px" }}>
          불러오는 중...
        </div>
      ) : topOption ? (
        <div
          style={{
            backgroundColor: "rgba(0,0,0,0.05)",
            borderRadius: "8px",
            padding: "8px 10px",
            marginBottom: "8px",
          }}
        >
          <span
            style={{
              display: "inline-block",
              backgroundColor: "#4a90e2",
              color: "#fff",
              fontSize: "11px",
              fontWeight: "bold",
              borderRadius: "8px",
              padding: "1px 8px",
              marginBottom: "5px",
            }}
          >
            🏆 1위
          </span>

          <div style={{ fontSize: "13px", fontWeight: "bold" }}>
            {optionLabel(topOption)}
          </div>

          <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>
            {topOption.count}표
          </div>
        </div>
      ) : (
        <div style={{ fontSize: "12px", color: "#aaa", marginBottom: "8px" }}>
          투표 결과 없음
        </div>
      )}

      <button
        onClick={goToVote}
        style={{
          width: "100%",
          fontSize: "12px",
          color: "#555",
          backgroundColor: "rgba(0,0,0,0.06)",
          border: "none",
          borderRadius: "8px",
          padding: "7px 0",
          cursor: "pointer",
        }}
      >
        결과 확인하러 가기 →
      </button>
    </div>
  );
}

function MapShareMessageCard({ meta }) {
  const titleMap = {
    current_location: "현재 위치 공유",
    middle_place: "확정된 중간장소",
    nearby_place: "중간장소 주변 추천 장소",
  };

  return (
    <div style={{ minWidth: "190px" }}>
      <div
        style={{
          display: "inline-block",
          fontSize: "11px",
          fontWeight: "bold",
          color: "#fff",
          backgroundColor: "#2f855a",
          borderRadius: "10px",
          padding: "2px 8px",
          marginBottom: "6px",
        }}
      >
        {titleMap[meta.sharetype] || "장소 공유"}
      </div>

      <div style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "6px" }}>
        {meta.name || "이름 없는 장소"}
      </div>

      {meta.address && (
        <div style={{ fontSize: "12px", color: "#555", marginBottom: "6px" }}>
          {meta.address}
        </div>
      )}

      {meta.rating !== null && meta.rating !== undefined && (
        <div style={{ fontSize: "12px", color: "#555", marginBottom: "6px" }}>
          평점 {Number(meta.rating).toFixed(1)}
          {meta.reviewcount ? ` / 리뷰 ${meta.reviewcount}` : ""}
        </div>
      )}

      {meta.lat && meta.lng && (
        <div style={{ fontSize: "11px", color: "#777", marginBottom: "8px" }}>
          {meta.lat}, {meta.lng}
        </div>
      )}

      {meta.url && (
        <a
          href={meta.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "block",
            textAlign: "center",
            fontSize: "12px",
            color: "#fff",
            backgroundColor: "#3182ce",
            borderRadius: "8px",
            padding: "7px 0",
            textDecoration: "none",
          }}
        >
          카카오맵에서 보기
        </a>
      )}
    </div>
  );
}

function ChatTab({ roomId }) {
  const navigate = useNavigate();

  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [selectedMsgId, setSelectedMsgId] = useState(null);

  const bottomRef = useRef(null);
  const galleryInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const sheetRef = useRef(null);
  const dragStartY = useRef(null);
  const isDragging = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const applyUser = async (user) => {
      if (cancelled) return;

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

      if (cancelled) return;

      if (error) {
        console.error("프로필 조회 실패:", error);

        setCurrentProfile({
          nickname: user.user_metadata?.nickname || user.email || "익명",
          profileimageurl: null,
        });

        return;
      }

      setCurrentProfile(
        profile || {
          nickname: user.user_metadata?.nickname || user.email || "익명",
          profileimageurl: null,
        }
      );
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      applyUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
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
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "room_messages",
          filter: `roomid=eq.${roomId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === payload.new.id ? payload.new : message
            )
          );
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

  useEffect(() => {
    if (!selectedMsgId) return;

    const dismiss = () => setSelectedMsgId(null);

    document.addEventListener("click", dismiss);

    return () => {
      document.removeEventListener("click", dismiss);
    };
  }, [selectedMsgId]);

  const canDelete = (message) => {
    if (!currentUser || message.userid !== currentUser.id) return false;
    if (isDeletedMsg(message.content)) return false;

    try {
      const meta = JSON.parse(message.content);
      if (meta.__type === "vote") return false;
    } catch {
      // 일반 텍스트 메시지
    }

    return Date.now() - new Date(message.createdat).getTime() < 10 * 60 * 1000;
  };

  const deleteMessage = async (messageId) => {
    const { error } = await supabase
      .from("room_messages")
      .update({
        content: JSON.stringify({ __type: "deleted" }),
        imageurl: null,
      })
      .eq("id", messageId);

    if (error) {
      alert("삭제 실패");
      return;
    }

    setSelectedMsgId(null);
  };

  const sendChatNotification = async () => {
    try {
      const { data: activeMembers } = await supabase
        .from("room_members")
        .select("userid")
        .eq("roomid", Number(roomId))
        .eq("chatnotifenabled", true);

      const filteredMemberIds = activeMembers
        ? activeMembers.map((m) => m.userid).filter((id) => id !== currentUser.id)
        : [];

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
      }
    } catch (notificationError) {
      console.error("채팅 알림 생성 실패:", notificationError);
    }
  };

  const sendMessage = async ({ text = "", imageUrl = "" }) => {
    if (!currentUser || !currentProfile) {
      alert("사용자 정보를 불러오는 중입니다.");
      return;
    }

    const newMessage = {
      roomid: Number(roomId),
      userid: currentUser.id === "guest" ? null : currentUser.id,
      nickname: currentProfile.nickname || "익명",
      profileimageurl: currentProfile.profileimageurl || null,
      content: text,
      imageurl: imageUrl || null,
    };

    const { error } = await supabase.from("room_messages").insert([newMessage]);

    if (error) {
      console.error("메시지 전송 실패:", error);
      alert("메시지 전송에 실패했습니다.");
      return;
    }

    await sendChatNotification();
  };

  const openCamera = async () => {
    setShowMediaOptions(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });

      streamRef.current = stream;
      setShowCamera(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 100);
    } catch {
      alert("카메라 접근 권한이 필요합니다.");
    }
  };

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setShowCamera(false);
  };

  const capturePhoto = async () => {
    const video = videoRef.current;

    if (!video) return;

    const canvas = document.createElement("canvas");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);

    closeCamera();

    canvas.toBlob(
      async (blob) => {
        if (!blob) return;

        const file = new File([blob], `photo_${Date.now()}.jpg`, {
          type: "image/jpeg",
        });

        await handleImageFile(file);
      },
      "image/jpeg",
      0.9
    );
  };

  const handleImageFile = async (file) => {
    if (!file) return;

    setUploading(true);
    setShowMediaOptions(false);

    try {
      const ext = file.name.split(".").pop();
      const fileName = `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("chat-images")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("chat-images")
        .getPublicUrl(fileName);

      await sendMessage({ imageUrl: data.publicUrl });
    } catch (error) {
      alert("이미지 전송 실패: " + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();

    if (!content.trim()) return;

    await sendMessage({ text: content.trim() });
    setContent("");
  };

  return (
    <div className="chat-container">
      <div className="chat-message-list">
        {messages.map((message, index) => {
          const prevMessage = messages[index - 1];
          const showDateSeparator =
            !prevMessage ||
            getDateOnly(message.createdat) !== getDateOnly(prevMessage.createdat);

          const dateSep = showDateSeparator && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                margin: "16px 0 12px",
              }}
            >
              <div style={{ flex: 1, height: "1px", backgroundColor: "#ccc" }} />

              <span style={{ fontSize: "12px", color: "#888" }}>
                {formatDateSeparator(message.createdat)}
              </span>

              <div style={{ flex: 1, height: "1px", backgroundColor: "#ccc" }} />
            </div>
          );

          if (isDeletedMsg(message.content) && !message.imageurl) {
            return (
              <div key={message.id}>
                {dateSep}
                <div className="chat-deleted-notice">메시지가 삭제되었습니다</div>
              </div>
            );
          }

          const myId = currentUser?.id;
          const isMine = !!(
            myId &&
            myId !== "guest" &&
            message.userid &&
            message.userid === myId
          );
          const deletable = canDelete(message);

          return (
            <div key={message.id}>
              {dateSep}

              <div className={`chat-row ${isMine ? "mine" : "other"}`}>
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

                  <div style={{ position: "relative" }}>
                    {selectedMsgId === message.id && (
                      <div
                        className="chat-delete-popup"
                        style={isMine ? { right: 0 } : { left: 0 }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button onClick={() => deleteMessage(message.id)}>
                          삭제
                        </button>
                      </div>
                    )}

                    <div
                      className={`chat-bubble ${isMine ? "mine" : "other"}${
                        deletable ? " deletable" : ""
                      }`}
                      onClick={
                        deletable
                          ? (event) => {
                              event.stopPropagation();
                              setSelectedMsgId((value) =>
                                value === message.id ? null : message.id
                              );
                            }
                          : undefined
                      }
                    >
                      {message.imageurl ? (
                        <img
                          src={message.imageurl}
                          alt="이미지"
                          style={{
                            maxWidth: "200px",
                            borderRadius: "8px",
                            display: "block",
                          }}
                        />
                      ) : (
                        (() => {
                          try {
                            const meta = JSON.parse(message.content);

                            if (meta.__type === "vote") {
                              return (
                                <VoteMessageCard
                                  meta={meta}
                                  navigate={navigate}
                                />
                              );
                            }

                            if (meta.__type === "map_share") {
                              return <MapShareMessageCard meta={meta} />;
                            }
                          } catch {
                            // 일반 텍스트 메시지
                          }

                          return message.content;
                        })()
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: "11px",
                      color: "#999",
                      marginTop: "3px",
                      textAlign: isMine ? "right" : "left",
                    }}
                  >
                    {formatTime(message.createdat)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {showMediaOptions && (
        <div
          className="chat-sheet-overlay"
          onClick={() => setShowMediaOptions(false)}
        >
          <div
            className="chat-sheet"
            ref={sheetRef}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="chat-sheet-handle"
              onMouseDown={(e) => {
                dragStartY.current = e.clientY;
                isDragging.current = true;
                if (sheetRef.current) sheetRef.current.style.transition = "none";
              }}
              onMouseMove={(e) => {
                if (!isDragging.current) return;
                const delta = e.clientY - dragStartY.current;
                if (delta > 0 && sheetRef.current) {
                  sheetRef.current.style.transform = `translateY(${delta}px)`;
                }
              }}
              onMouseUp={(e) => {
                if (!isDragging.current) return;
                isDragging.current = false;
                const delta = e.clientY - dragStartY.current;
                if (sheetRef.current) {
                  if (delta > 80) {
                    sheetRef.current.style.transition = "transform 0.2s";
                    sheetRef.current.style.transform = "translateY(100%)";
                    setTimeout(() => setShowMediaOptions(false), 200);
                  } else {
                    sheetRef.current.style.transition = "transform 0.2s";
                    sheetRef.current.style.transform = "";
                    setTimeout(() => {
                      if (sheetRef.current) sheetRef.current.style.transition = "";
                    }, 200);
                  }
                }
                dragStartY.current = null;
              }}
              onMouseLeave={() => {
                if (!isDragging.current) return;
                isDragging.current = false;
                if (sheetRef.current) {
                  sheetRef.current.style.transition = "transform 0.2s";
                  sheetRef.current.style.transform = "";
                  setTimeout(() => {
                    if (sheetRef.current) sheetRef.current.style.transition = "";
                  }, 200);
                }
                dragStartY.current = null;
              }}
            />

            <div className="chat-sheet-grid">
              <button className="chat-sheet-tile" onClick={openCamera}>
                <div className="chat-sheet-tile-icon">📷</div>
                <span>카메라</span>
              </button>

              <button
                className="chat-sheet-tile"
                onClick={() => {
                  galleryInputRef.current?.click();
                  setShowMediaOptions(false);
                }}
              >
                <div className="chat-sheet-tile-icon">🖼️</div>
                <span>사진</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(event) => handleImageFile(event.target.files[0])}
      />

      {showCamera && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.85)",
            zIndex: 300,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <video
            ref={videoRef}
            style={{
              width: "100%",
              maxWidth: "400px",
              borderRadius: "12px",
            }}
            playsInline
          />

          <div style={{ display: "flex", gap: "16px", marginTop: "20px" }}>
            <button onClick={closeCamera}>취소</button>
            <button onClick={capturePhoto}>📷 촬영</button>
          </div>
        </div>
      )}

      <form className="chat-input-area" onSubmit={handleSendMessage}>
        <button
          type="button"
          className={`chat-plus-btn${showMediaOptions ? " active" : ""}`}
          onClick={() => setShowMediaOptions((value) => !value)}
        >
          +
        </button>

        <input
          value={uploading ? "이미지 전송 중..." : content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="메시지를 입력하세요"
          disabled={uploading}
        />

        <button type="submit" disabled={uploading}>
          전송
        </button>
      </form>
    </div>
  );
}

export default ChatTab;
