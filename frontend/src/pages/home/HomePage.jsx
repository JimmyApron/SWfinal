import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  getAdditionalConfirmedLocations,
  getMyConfirmedSchedules,
} from "../../api/scheduleApi";
import {
  sendFriendRequest,
  getFriends,
  getPendingRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
} from "../../api/friendApi";
import RoomListPage from "../room/RoomListPage";

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTimeUntil(date, starttime) {
  const today = getTodayStr();

  if (date === today) return "오늘 약속입니다";

  const target = new Date(`${date}T${starttime || "00:00:00"}`);
  const diff = target - new Date();

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `일정 ${days}일 ${hours}시간 전입니다`;
  if (hours > 0) return `일정 ${hours}시간 ${minutes}분 전입니다`;

  return `일정 ${minutes}분 전입니다`;
}

function Avatar({ url, nickname, size = 40 }) {
  return url ? (
    <img
      src={url}
      alt={nickname}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
      }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: "#e0e0ff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.45,
        flexShrink: 0,
      }}
    >
      👤
    </div>
  );
}

function HomePage() {
  const navigate = useNavigate();

  const [confirmedSchedules, setConfirmedSchedules] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  const [showFriendPanel, setShowFriendPanel] = useState(false);
  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [friendEmail, setFriendEmail] = useState("");
  const [friendLoading, setFriendLoading] = useState(false);

  const assignUniqueNickname = async (user) => {
    const baseName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "소셜유저";

    let nickname = baseName;
    let isDuplicate = true;

    while (isDuplicate) {
      const { data } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("nickname", nickname)
        .maybeSingle();

      if (!data) {
        isDuplicate = false;
      } else {
        const rand = Math.floor(1000 + Math.random() * 9000);
        nickname = `${baseName}#${rand}`;
      }
    }

    await supabase.from("profiles").upsert({
      id: user.id,
      nickname,
      email: user.email,
    });
  };

  const loadConfirmedSchedules = useCallback(async (userId) => {
    const data = await getMyConfirmedSchedules(userId, {
      includeLocationOnly: true,
    });

    const roomIds = [...new Set((data || []).map((schedule) => schedule.roomid))];

    const additionalLocationEntries = await Promise.all(
      roomIds.map(async (roomid) => [
        roomid,
        await getAdditionalConfirmedLocations(roomid),
      ])
    );

    const additionalLocationMap = new Map(additionalLocationEntries);

    setConfirmedSchedules(
      (data || []).map((schedule) => ({
        ...schedule,
        additionalLocations: additionalLocationMap.get(schedule.roomid) || [],
      }))
    );
  }, []);

  const loadAll = useCallback(async (userId) => {
    const [friendList, requestList] = await Promise.all([
      getFriends(userId).catch(() => []),
      getPendingRequests(userId).catch(() => []),
    ]);

    setFriends(friendList);
    setPendingRequests(requestList);
  }, []);

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      setCurrentUser(user);

      const provider = user.app_metadata?.provider;

      if (provider === "google" || provider === "kakao") {
        const { data: profile } = await supabase
          .from("profiles")
          .select("nickname")
          .eq("id", user.id)
          .maybeSingle();

        if (!profile?.nickname) {
          await assignUniqueNickname(user);
        }
      }

      try {
        await loadConfirmedSchedules(user.id);
      } catch (error) {
        console.error("확정 일정 조회 실패:", error);
      }

      try {
        const reqs = await getPendingRequests(user.id);
        setPendingRequests(reqs);
      } catch (error) {
        console.error("친구 요청 조회 실패:", error);
      }
    };

    init();
  }, [loadConfirmedSchedules]);

  const handleOpenFriendPanel = async () => {
    setShowFriendPanel(true);

    if (currentUser) {
      await loadAll(currentUser.id);
    }
  };

  const handleSendRequest = async () => {
    if (!friendEmail.trim() || !currentUser) return;

    setFriendLoading(true);

    try {
      await sendFriendRequest(currentUser.id, friendEmail);
      setFriendEmail("");
      alert("친구 요청을 보냈습니다.");
    } catch (error) {
      alert(error.message);
    } finally {
      setFriendLoading(false);
    }
  };

  const handleAccept = async (request) => {
    try {
      await acceptFriendRequest(request.requestId, currentUser.id, request.id);
      await loadAll(currentUser.id);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleReject = async (request) => {
    try {
      await rejectFriendRequest(request.requestId);

      setPendingRequests((prev) =>
        prev.filter((item) => item.requestId !== request.requestId)
      );
    } catch (error) {
      alert(error.message);
    }
  };

  const handleRemoveFriend = async (friendId) => {
    if (!window.confirm("친구를 삭제할까요?")) return;

    try {
      await removeFriend(currentUser.id, friendId);

      setFriends((prev) => prev.filter((friend) => friend.id !== friendId));
    } catch (error) {
      alert(error.message);
    }
  };

  const upcomingSchedules = confirmedSchedules.filter(
    (schedule) => !schedule.date || schedule.date >= getTodayStr()
  );

  return (
    <div className="home-container">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "8px",
        }}
      >
        <h1 style={{ margin: 0 }}>홈</h1>

        <button
          onClick={handleOpenFriendPanel}
          style={{
            position: "relative",
            border: "none",
            background: "none",
            fontSize: "22px",
            cursor: "pointer",
            color: "#555",
            lineHeight: 1,
            padding: "4px",
          }}
        >
          ⋮

          {pendingRequests.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                backgroundColor: "#f44",
                color: "#fff",
                fontSize: "10px",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {pendingRequests.length}
            </span>
          )}
        </button>
      </div>

      {showFriendPanel && (
        <>
          <div
            onClick={() => setShowFriendPanel(false)}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.3)",
              zIndex: 200,
            }}
          />

          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "300px",
              backgroundColor: "#fff",
              zIndex: 201,
              boxShadow: "-2px 0 12px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "20px 20px 16px",
                borderBottom: "1px solid #eee",
              }}
            >
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>친구</span>

              <button
                onClick={() => setShowFriendPanel(false)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  color: "#aaa",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#555",
                }}
              >
                이메일로 친구 요청
              </p>

              <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
                <input
                  value={friendEmail}
                  onChange={(event) => setFriendEmail(event.target.value)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && handleSendRequest()
                  }
                  placeholder="이메일 입력"
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    fontSize: "14px",
                    outline: "none",
                  }}
                />

                <button
                  onClick={handleSendRequest}
                  disabled={friendLoading}
                  style={{
                    padding: "10px 16px",
                    backgroundColor: "#7c79ff",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "14px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {friendLoading ? "..." : "요청"}
                </button>
              </div>

              {pendingRequests.length > 0 && (
                <div style={{ marginBottom: "24px" }}>
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#555",
                    }}
                  >
                    친구 요청
                    <span
                      style={{
                        marginLeft: "6px",
                        backgroundColor: "#f44",
                        color: "#fff",
                        borderRadius: "10px",
                        padding: "1px 7px",
                        fontSize: "11px",
                      }}
                    >
                      {pendingRequests.length}
                    </span>
                  </p>

                  {pendingRequests.map((request) => (
                    <div
                      key={request.requestId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 0",
                        borderBottom: "1px solid #f5f5f5",
                      }}
                    >
                      <Avatar
                        url={request.profileimageurl}
                        nickname={request.nickname}
                      />

                      <span
                        style={{
                          flex: 1,
                          fontSize: "14px",
                          fontWeight: "500",
                        }}
                      >
                        {request.nickname || "닉네임 없음"}
                      </span>

                      <button
                        onClick={() => handleAccept(request)}
                        style={{
                          padding: "5px 10px",
                          backgroundColor: "#7c79ff",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        수락
                      </button>

                      <button
                        onClick={() => handleReject(request)}
                        style={{
                          padding: "5px 10px",
                          backgroundColor: "#fff",
                          color: "#999",
                          border: "1px solid #ddd",
                          borderRadius: "6px",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        거절
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#555",
                }}
              >
                친구 목록 {friends.length > 0 && `(${friends.length})`}
              </p>

              {friends.length === 0 ? (
                <p
                  style={{
                    fontSize: "14px",
                    color: "#aaa",
                    textAlign: "center",
                    marginTop: "16px",
                  }}
                >
                  추가된 친구가 없습니다
                </p>
              ) : (
                friends.map((friend) => (
                  <div
                    key={friend.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 0",
                      borderBottom: "1px solid #f5f5f5",
                    }}
                  >
                    <Avatar
                      url={friend.profileimageurl}
                      nickname={friend.nickname}
                    />

                    <span
                      style={{
                        flex: 1,
                        fontSize: "14px",
                        fontWeight: "500",
                      }}
                    >
                      {friend.nickname || "닉네임 없음"}
                    </span>

                    <button
                      onClick={() => handleRemoveFriend(friend.id)}
                      style={{
                        border: "none",
                        background: "none",
                        fontSize: "16px",
                        cursor: "pointer",
                        color: "#ccc",
                        padding: "4px",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <div style={{ marginBottom: "20px" }}>
        <h3 style={{ marginBottom: "8px" }}>확정된 일정</h3>

        {upcomingSchedules.length === 0 ? (
          <p style={{ color: "#aaa", fontSize: "14px" }}>
            확정된 일정이 없습니다
          </p>
        ) : (
          upcomingSchedules.map((schedule) => {
            const dateLabel = !schedule.date
              ? null
              : schedule.isallday
              ? `${schedule.date} (하루종일)`
              : `${schedule.date} ${schedule.starttime ?? ""} ~${
                  schedule.endtime ? ` ${schedule.endtime}` : ""
                }`;

            return (
              <div
                key={schedule.id}
                onClick={() =>
                  navigate("/confirmed-schedule", {
                    state: { schedule },
                  })
                }
                style={{
                  padding: "12px 14px",
                  marginBottom: "8px",
                  border: "1px solid #e0e0ff",
                  borderRadius: "12px",
                  cursor: "pointer",
                  backgroundColor: "#f9f9ff",
                }}
              >
                <p style={{ margin: 0, fontSize: "13px", color: "#888" }}>
                  {schedule.roomname}
                </p>

                <p style={{ margin: "4px 0 0", fontWeight: "bold" }}>
                  {schedule.title || dateLabel || "일정 미정"}
                </p>

                {dateLabel ? (
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: "13px",
                      color: "#666",
                    }}
                  >
                    {dateLabel}
                  </p>
                ) : (
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: "13px",
                      color: "#aaa",
                    }}
                  >
                    일정 미정
                  </p>
                )}

                {schedule.date && (
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "12px",
                      color:
                        schedule.date === getTodayStr() ? "#7c79ff" : "#f90",
                      fontWeight:
                        schedule.date === getTodayStr() ? "bold" : "normal",
                    }}
                  >
                    {getTimeUntil(schedule.date, schedule.starttime)}
                  </p>
                )}

                {schedule.location ? (
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "13px",
                      color: "#7c79ff",
                    }}
                  >
                    📍 {schedule.location}
                  </p>
                ) : (
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: "13px",
                      color: "#aaa",
                    }}
                  >
                    위치 미정 (탭하여 설정)
                  </p>
                )}

                {schedule.additionalLocations?.map((place) => (
                  <p
                    key={place.id}
                    style={{
                      margin: "4px 0 0",
                      fontSize: "13px",
                      color: "#666",
                    }}
                  >
                    추가장소: {place.placename}
                  </p>
                ))}
              </div>
            );
          })
        )}
      </div>

      <RoomListPage />

      <button onClick={() => navigate("/rooms/create")}>방 만들기</button>
      <button onClick={() => navigate("/rooms/invite")}>
        초대코드 입력하기
      </button>
    </div>
  );
}

export default HomePage;