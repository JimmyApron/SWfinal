import { useEffect, useState, useCallback } from "react";
import { getRooms } from "../../api/roomApi";
import { supabase } from "../../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

function formatRelativeTime(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHr < 24) return `${diffHr}시간 전`;
  if (diffDay < 7) return `${diffDay}일 전`;
  
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function RoomListPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  // 고정된 방 관리 (Local Storage 사용)
  const [pinnedRooms, setPinnedRooms] = useState(() => {
    const saved = localStorage.getItem("pinned_rooms");
    return saved ? JSON.parse(saved) : {}; // { roomId: pinnedAt }
  });

  const [contextMenu, setContextMenu] = useState(null); // { x, y, roomId }
  const [isRoomsExpanded, setIsRoomsExpanded] = useState(false);

  // 방별 팝업 끄기 관리 (Local Storage 사용)
  const [mutedRooms, setMutedRooms] = useState(() => {
    const saved = localStorage.getItem("muted_rooms");
    return saved ? JSON.parse(saved) : []; // [roomId1, roomId2, ...]
  });

  const toggleMute = (roomId) => {
    const isMuted = mutedRooms.includes(roomId);
    let newMuted;
    if (isMuted) {
      newMuted = mutedRooms.filter(id => id !== roomId);
    } else {
      newMuted = [...mutedRooms, roomId];
    }
    setMutedRooms(newMuted);
    localStorage.setItem("muted_rooms", JSON.stringify(newMuted));
    if (isMuted) {
      window.dispatchEvent(new CustomEvent("popup-setting-enabled", {
        detail: { roomId: Number(roomId), allTabs: true },
      }));
    }
    setContextMenu(null);
  };

  // 고정 토글 함수
  const togglePin = (roomId) => {
    const isPinned = !!pinnedRooms[roomId];
    const newPinned = { ...pinnedRooms };

    if (isPinned) {
      delete newPinned[roomId];
    } else {
      // 최대 3개 제한
      const pinnedIds = Object.keys(newPinned);
      if (pinnedIds.length >= 3) {
        alert("방 고정은 최대 3개까지만 가능합니다.");
        return;
      }
      newPinned[roomId] = new Date().toISOString();
    }

    setPinnedRooms(newPinned);
    localStorage.setItem("pinned_rooms", JSON.stringify(newPinned));
    setContextMenu(null);
  };

  // 방 목록 동기화 함수
  const handleGetRooms = useCallback(async (currentId) => {
    const id = currentId || userId;
    if (!id) return;
    try {
      const result = await getRooms(id);
      if (result && result.rooms) {
        setRooms(result.rooms);
      }
    } catch (e) {
      console.error("방 목록 로딩 실패:", e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // 정렬된 방 목록 계산
  const sortedRooms = [...rooms].sort((a, b) => {
    const pinA = pinnedRooms[a.id];
    const pinB = pinnedRooms[b.id];

    // 1. 둘 다 고정된 경우: 최신 고정 순 (가장 최근에 고정한 게 위로)
    if (pinA && pinB) {
      return new Date(pinB).getTime() - new Date(pinA).getTime();
    }
    // 2. 하나만 고정된 경우: 고정된 방이 우선
    if (pinA) return -1;
    if (pinB) return 1;

    // 3. 둘 다 고정 안 된 경우: 최신 알림/활동 시간이 우선
    const tA = new Date(a.lastactivityat || a.createdat).getTime();
    const tB = new Date(b.lastactivityat || b.createdat).getTime();
    if (tB !== tA) {
      return tB - tA;
    }

    return (b.unreadCount || 0) - (a.unreadCount || 0);
  });

  useEffect(() => {
    const handleOutsideClick = () => setContextMenu(null);
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let currentId = user?.id || localStorage.getItem("guest_id");

      if (currentId) {
        setUserId(currentId);
        handleGetRooms(currentId);
      } else {
        setLoading(false);
      }
    };
    init();
  }, [handleGetRooms]);

  useEffect(() => {
    if (!userId) return;

    const channelName = `room-list-engine-${userId}-${Date.now()}`;
    const channel = supabase.channel(channelName);

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `receiverid=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newNotif = payload.new;
            if (newNotif.roomid) {
              setRooms((prevRooms) => {
                const targetIdx = prevRooms.findIndex(r => String(r.id) === String(newNotif.roomid));
                
                if (targetIdx === -1) {
                  handleGetRooms(); 
                  return prevRooms;
                }

                const targetRoom = prevRooms[targetIdx];
                const updatedRoom = {
                  ...targetRoom,
                  unreadCount: (targetRoom.unreadCount || 0) + 1,
                  lastactivityat: newNotif.createdat || new Date().toISOString()
                };

                const filtered = prevRooms.filter(r => String(r.id) !== String(newNotif.roomid));
                return [updatedRoom, ...filtered];
              });
            }
          } else {
            handleGetRooms();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, handleGetRooms]);

  if (loading) {
    return <div style={{ padding: "20px", textAlign: "center" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: "0", backgroundColor: "var(--bg-color)", position: "relative" }}>
      <header style={{
        padding: "12px 0",
        borderBottom: "1px solid var(--border-color)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <h1 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "var(--text-color)" }}>방 목록</h1>
      </header>

      {sortedRooms.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "var(--secondary-text)" }}>
          <p>참여 중인 방이 없습니다.</p>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {(isRoomsExpanded ? sortedRooms : sortedRooms.slice(0, 2)).map((room) => {
            const isPinned = !!pinnedRooms[room.id];
            
            return (
              <li 
                key={room.id}
                onClick={() => navigate(`/rooms/${room.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, roomId: room.id });
                }}
                style={{
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border-color)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  transition: "background-color 0.2s",
                  backgroundColor: isPinned ? "rgba(124, 121, 255, 0.05)" : "transparent"
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = isPinned ? "rgba(124, 121, 255, 0.1)" : "var(--btn-bg)"}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isPinned ? "rgba(124, 121, 255, 0.05)" : "transparent"}
              >
                <div style={{
                  width: "40px",
                  height: "40px",
                  marginRight: "10px",
                  flexShrink: 0,
                  position: "relative",
                }}>
                  {/* 이미지/아이콘 영역 (프레임) */}
                  <div style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "14px",
                    backgroundColor: isPinned ? "var(--accent-color)" : "var(--btn-bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "20px",
                    overflow: "hidden"
                  }}>
                    {room.roomimageurl ? (
                      <img 
                        src={room.roomimageurl} 
                        alt={room.roomname} 
                        style={{ width: "100%", height: "100%", objectFit: "cover" }} 
                      />
                    ) : (
                      "🏠"
                    )}
                  </div>

                  {/* 핀 아이콘 (프레임 밖으로 튀어나오게 배치) */}
                  {isPinned && (
                    <div style={{
                      position: "absolute",
                      top: "-6px",
                      right: "-6px",
                      backgroundColor: "white",
                      borderRadius: "50%",
                      width: "22px",
                      height: "22px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "12px",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                      border: "1.5px solid var(--accent-color)",
                      zIndex: 1
                    }}>
                      📌
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                      <span style={{
                        fontWeight: "bold",
                        fontSize: "14px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--text-color)"
                      }}>
                        {room.roomname}
                      </span>

                      {mutedRooms.includes(room.id) && (
                        <span style={{ marginLeft: "4px", fontSize: "11px", opacity: 0.5 }}>🔕</span>
                      )}

                      <span style={{ marginLeft: "6px", color: "var(--secondary-text)", fontSize: "12px", flexShrink: 0 }}>
                        {(room.room_members?.[0]?.count || 0) + (room.room_guests?.[0]?.count || 0)}
                      </span>
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--secondary-text)", flexShrink: 0 }}>
                      {formatRelativeTime(room.lastactivityat)}
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", color: "var(--secondary-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {room.unreadCount > 0 ? "새로운 알림이 있습니다." : "최근 활동 없음"}
                    </span>

                    {room.unreadCount > 0 && (
                      <div style={{
                        backgroundColor: mutedRooms.includes(room.id) ? "#ccc" : "#ff4d4f",
                        color: "white",
                        borderRadius: "10px",
                        padding: "3px 5px",
                        fontSize: "10px",
                        fontWeight: "bold",
                        marginLeft: "8px",
                        minWidth: "16px",
                        textAlign: "center",
                        flexShrink: 0,
                        lineHeight: "1.4"
                      }}>
                        {room.unreadCount > 99 ? "99+" : room.unreadCount}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {sortedRooms.length > 2 && (
        <button
          onClick={() => setIsRoomsExpanded((prev) => !prev)}
          style={{
            width: "100%",
            padding: "8px",
            backgroundColor: "transparent",
            color: "var(--accent-color)",
            border: "none",
            borderTop: "1px solid var(--border-color)",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: "bold",
          }}
        >
          {isRoomsExpanded ? "접기 ▲" : `더보기 (+${sortedRooms.length - 2}) ▼`}
        </button>
      )}

      {/* 우클릭 메뉴 (Context Menu) */}
      {contextMenu && (
        <div style={{
          position: "fixed",
          top: contextMenu.y,
          left: contextMenu.x,
          backgroundColor: "var(--card-bg)",
          boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
          borderRadius: "8px",
          padding: "4px 0",
          zIndex: 1000,
          minWidth: "120px",
          border: "1px solid var(--border-color)"
        }} onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => togglePin(contextMenu.roomId)}
            style={{
              width: "100%",
              padding: "10px 16px",
              border: "none",
              background: "none",
              textAlign: "left",
              fontSize: "14px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "var(--text-color)"
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--btn-bg)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
          >
            {pinnedRooms[contextMenu.roomId] ? "📌 고정 해제" : "📌 상단 고정"}
          </button>

          <button 
            onClick={() => toggleMute(contextMenu.roomId)}
            style={{
              width: "100%",
              padding: "10px 16px",
              border: "none",
              background: "none",
              textAlign: "left",
              fontSize: "14px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "var(--text-color)"
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--btn-bg)"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
          >
            {mutedRooms.includes(contextMenu.roomId) ? "🔔 알림 켜기" : "🔕 알림 끄기"}
          </button>
        </div>
      )}
    </div>
  );
}

export default RoomListPage;
