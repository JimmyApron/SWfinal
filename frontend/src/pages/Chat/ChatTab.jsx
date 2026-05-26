import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { createRoomNotifications } from "../../api/notificationApi";
import "./ChatTab.css";

const WEEKDAY_KR = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

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
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAY_KR[date.getDay()]}`;
}

function getDateOnly(dateStr) {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isDeletedMsg(content) {
  try { return JSON.parse(content)?.__type === "deleted"; } catch { return false; }
}

function VoteMessageCard({ meta, navigate }) {
  const isClosed = meta.isclosed ||
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
        if (!data) { setLoaded(true); return; }
        const options = data.voteoptions || [];
        const responses = data.voteresponses || [];
        const counts = {};
        responses.forEach((r) => { counts[r.optionid] = (counts[r.optionid] || 0) + 1; });
        let winner = null;
        let maxCount = 0;
        options.forEach((opt) => {
          const c = counts[opt.id] || 0;
          if (c > maxCount) { maxCount = c; winner = { ...opt, count: c }; }
        });
        setTopOption(winner);
        setLoaded(true);
      });
  }, [isClosed, meta.voteid]);

  const goToVote = (e) => {
    e.stopPropagation();
    navigate(`/rooms/${meta.roomid}/votes/${meta.voteid}`);
  };

  const optionLabel = (opt) =>
    opt.optiontype === "date"
      ? `${opt.optiondate}${opt.starttime ? " " + opt.starttime : ""}${opt.endtime ? "~" + opt.endtime : ""}`
      : opt.optiontext;

  if (!isClosed) {
    return (
      <div onClick={goToVote} style={{ cursor: "pointer", minWidth: "160px" }}>
        <div style={{ display: "inline-block", fontSize: "11px", fontWeight: "bold", color: "#fff", backgroundColor: "#7c79ff", borderRadius: "10px", padding: "2px 8px", marginBottom: "6px" }}>
          📊 진행 중인 투표
        </div>
        <div style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "8px", lineHeight: 1.4 }}>{meta.title}</div>
        <div style={{ fontSize: "12px", color: "#7c79ff", borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: "6px" }}>
          탭하여 투표 참여 →
        </div>
      </div>
    );
  }

  return (
    <div style={{ minWidth: "180px" }}>
      <div style={{ display: "inline-block", fontSize: "11px", fontWeight: "bold", color: "#999", backgroundColor: "#e8e8e8", borderRadius: "10px", padding: "2px 8px", marginBottom: "6px" }}>
        📊 종료된 투표
      </div>
      <div style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "10px", lineHeight: 1.4 }}>{meta.title}</div>
      {!loaded ? (
        <div style={{ fontSize: "12px", color: "#aaa", marginBottom: "8px" }}>불러오는 중...</div>
      ) : topOption ? (
        <div style={{ backgroundColor: "rgba(0,0,0,0.05)", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px" }}>
          <span style={{ display: "inline-block", backgroundColor: "#4a90e2", color: "#fff", fontSize: "11px", fontWeight: "bold", borderRadius: "8px", padding: "1px 8px", marginBottom: "5px" }}>
            🏆 1위
          </span>
          <div style={{ fontSize: "13px", fontWeight: "bold" }}>{optionLabel(topOption)}</div>
          <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{topOption.count}표</div>
        </div>
      ) : (
        <div style={{ fontSize: "12px", color: "#aaa", marginBottom: "8px" }}>투표 결과 없음</div>
      )}
      <button
        onClick={goToVote}
        style={{ width: "100%", fontSize: "12px", color: "#555", backgroundColor: "rgba(0,0,0,0.06)", border: "none", borderRadius: "8px", padding: "7px 0", cursor: "pointer" }}
      >
        결과 확인하러 가기 →
      </button>
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
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, nickname, profileimageurl")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setCurrentProfile(
        profile || { nickname: user.user_metadata?.nickname || user.email || "익명", profileimageurl: null }
      );
    };

    // 컴포넌트 마운트 시 현재 세션 즉시 반영
    supabase.auth.getSession().then(({ data: { session } }) => {
      applyUser(session?.user ?? null);
    });

    // 로그인/로그아웃/계정 전환 시 자동 업데이트
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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

      if (error) { console.error("채팅 조회 실패:", error); return; }
      setMessages(data || []);
    };

    fetchMessages();

    const channel = supabase
      .channel(`room-chat-${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "room_messages", filter: `roomid=eq.${roomId}` },
        (payload) => { setMessages((prev) => [...prev, payload.new]); }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "room_messages", filter: `roomid=eq.${roomId}` },
        (payload) => { setMessages((prev) => prev.map((m) => m.id === payload.new.id ? payload.new : m)); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 팝업 외부 클릭시 닫기
  useEffect(() => {
    if (!selectedMsgId) return;
    const dismiss = () => setSelectedMsgId(null);
    document.addEventListener("click", dismiss);
    return () => document.removeEventListener("click", dismiss);
  }, [selectedMsgId]);

  const canDelete = (message) => {
    if (!currentUser || message.userid !== currentUser.id) return false;
    if (isDeletedMsg(message.content)) return false;
    try {
      const meta = JSON.parse(message.content);
      if (meta.__type === "vote") return false;
    } catch {}
    return Date.now() - new Date(message.createdat).getTime() < 10 * 60 * 1000;
  };

  const deleteMessage = async (messageId) => {
    const { error } = await supabase
      .from("room_messages")
      .update({ content: JSON.stringify({ __type: "deleted" }), imageurl: null })
      .eq("id", messageId);
    if (error) { alert("삭제 실패"); return; }
    setMessages((prev) =>
      prev.map((m) => m.id === messageId
        ? { ...m, content: JSON.stringify({ __type: "deleted" }), imageurl: null }
        : m
      )
    );
    setSelectedMsgId(null);
  };

  const handleSheetPointerDown = (e) => {
    dragStartY.current = e.clientY;
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleSheetPointerMove = (e) => {
    if (!isDragging.current) return;
    const delta = e.clientY - dragStartY.current;
    if (delta > 0 && sheetRef.current) {
      sheetRef.current.style.transition = "none";
      sheetRef.current.style.transform = `translateY(${delta}px)`;
    }
  };

  const handleSheetPointerUp = (e) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const delta = e.clientY - dragStartY.current;
    dragStartY.current = null;
    if (delta > 80) {
      if (sheetRef.current) {
        sheetRef.current.style.transition = "transform 0.22s ease";
        sheetRef.current.style.transform = "translateY(100%)";
      }
      setTimeout(() => setShowMediaOptions(false), 220);
    } else if (sheetRef.current) {
      sheetRef.current.style.transition = "transform 0.2s ease";
      sheetRef.current.style.transform = "translateY(0)";
    }
  };

  const sendMessage = async ({ text = "", imageUrl = "" }) => {
    if (!currentUser || !currentProfile) return;
    const newMessage = {
      roomid: Number(roomId),
      userid: currentUser.id === "guest" ? null : currentUser.id,
      nickname: currentProfile.nickname || "익명",
      profileimageurl: currentProfile.profileimageurl || null,
      content: text,
      imageurl: imageUrl || null,
    };
    const { error } = await supabase.from("room_messages").insert([newMessage]);
    if (error) { alert("메시지 전송 실패"); return; }
    try {
      await createRoomNotifications({
        roomId, senderId: currentUser.id, type: "chat",
        title: "새 채팅이 도착했습니다",
        message: `${currentProfile.nickname || "익명"}님이 메시지를 보냈습니다.`,
        link: `/rooms/${roomId}?tab=chat`,
      });
    } catch {}
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
    streamRef.current?.getTracks().forEach((t) => t.stop());
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
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `photo_${Date.now()}.jpg`, { type: "image/jpeg" });
      await handleImageFile(file);
    }, "image/jpeg", 0.9);
  };

  const handleImageFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setShowMediaOptions(false);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("chat-images")
        .upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("chat-images").getPublicUrl(fileName);
      await sendMessage({ imageUrl: data.publicUrl });
    } catch (err) {
      alert("이미지 전송 실패: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    if (!currentUser || !currentProfile) { alert("사용자 정보를 불러오는 중입니다."); return; }
    await sendMessage({ text: content.trim() });
    setContent("");
  };

  return (
    <div className="chat-container">
      <div className="chat-message-list">
        {messages.map((message, index) => {
          const prevMessage = messages[index - 1];
          const showDateSeparator = !prevMessage || getDateOnly(message.createdat) !== getDateOnly(prevMessage.createdat);

          const dateSep = showDateSeparator && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "16px 0 12px" }}>
              <div style={{ flex: 1, height: "1px", backgroundColor: "#ccc" }} />
              <span style={{ fontSize: "12px", color: "#888", whiteSpace: "nowrap" }}>
                {formatDateSeparator(message.createdat)}
              </span>
              <div style={{ flex: 1, height: "1px", backgroundColor: "#ccc" }} />
            </div>
          );

          // 삭제된 메시지 → 가운데 시스템 공지
          if (isDeletedMsg(message.content) && !message.imageurl) {
            return (
              <div key={message.id}>
                {dateSep}
                <div className="chat-deleted-notice">메시지가 삭제되었습니다</div>
              </div>
            );
          }

          const myId = currentUser?.id;
          const isMine = !!(myId && myId !== "guest" && message.userid && message.userid === myId);
          const deletable = canDelete(message);

          return (
            <div key={message.id}>
              {dateSep}
              <div className={`chat-row ${isMine ? "mine" : "other"}`}>
                {!isMine && (
                  <img
                    className="chat-profile-image"
                    src={message.profileimageurl || "https://via.placeholder.com/40?text=?"}
                    alt="프로필"
                  />
                )}
                <div className="chat-message-box">
                  {!isMine && <div className="chat-nickname">{message.nickname}</div>}
                  <div style={{ position: "relative" }}>
                    {selectedMsgId === message.id && (
                      <div
                        className="chat-delete-popup"
                        style={{ ...(isMine ? { right: 0 } : { left: 0 }) }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button onClick={() => deleteMessage(message.id)}>삭제</button>
                      </div>
                    )}
                    <div
                      className={`chat-bubble ${isMine ? "mine" : "other"}${deletable ? " deletable" : ""}`}
                      onClick={deletable ? (e) => { e.stopPropagation(); setSelectedMsgId((v) => v === message.id ? null : message.id); } : undefined}
                    >
                      {message.imageurl ? (
                        <img src={message.imageurl} alt="이미지" style={{ maxWidth: "200px", borderRadius: "8px", display: "block" }} />
                      ) : (() => {
                        try {
                          const meta = JSON.parse(message.content);
                          if (meta.__type === "vote") return <VoteMessageCard meta={meta} navigate={navigate} />;
                        } catch {}
                        return message.content;
                      })()}
                    </div>
                  </div>
                  <div style={{ fontSize: "11px", color: "#999", marginTop: "3px", textAlign: isMine ? "right" : "left" }}>
                    {formatTime(message.createdat)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 카카오 스타일 미디어 바텀 시트 */}
      {showMediaOptions && (
        <div className="chat-sheet-overlay" onClick={() => setShowMediaOptions(false)}>
          <div className="chat-sheet" ref={sheetRef} onClick={(e) => e.stopPropagation()}>
            <div
              className="chat-sheet-handle"
              onPointerDown={handleSheetPointerDown}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={handleSheetPointerUp}
              onPointerCancel={handleSheetPointerUp}
              style={{ cursor: "grab", padding: "8px 0" }}
            />
            <div className="chat-sheet-grid">
              <button className="chat-sheet-tile" onClick={openCamera}>
                <div className="chat-sheet-tile-icon">📷</div>
                <span>카메라</span>
              </button>
              <button className="chat-sheet-tile" onClick={() => { galleryInputRef.current?.click(); setShowMediaOptions(false); }}>
                <div className="chat-sheet-tile-icon">🖼️</div>
                <span>사진</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleImageFile(e.target.files[0])} />

      {/* 웹캠 모달 */}
      {showCamera && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.85)", zIndex: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <video ref={videoRef} style={{ width: "100%", maxWidth: "400px", borderRadius: "12px" }} playsInline />
          <div style={{ display: "flex", gap: "16px", marginTop: "20px" }}>
            <button onClick={closeCamera} style={{ padding: "12px 24px", borderRadius: "10px", border: "none", backgroundColor: "#555", color: "#fff", fontSize: "15px", cursor: "pointer" }}>
              취소
            </button>
            <button onClick={capturePhoto} style={{ padding: "12px 32px", borderRadius: "10px", border: "none", backgroundColor: "#7c79ff", color: "#fff", fontSize: "15px", cursor: "pointer" }}>
              📷 촬영
            </button>
          </div>
        </div>
      )}

      <form className="chat-input-area" onSubmit={handleSendMessage}>
        <button
          type="button"
          className={`chat-plus-btn${showMediaOptions ? " active" : ""}`}
          onClick={() => setShowMediaOptions((v) => !v)}
        >
          +
        </button>
        <input
          value={uploading ? "이미지 전송 중..." : content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="메시지를 입력하세요"
          disabled={uploading}
        />
        <button type="submit" disabled={uploading}>전송</button>
      </form>
    </div>
  );
}

export default ChatTab;
