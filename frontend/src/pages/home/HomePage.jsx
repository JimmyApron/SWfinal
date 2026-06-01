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
  getSentRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  removeFriend,
} from "../../api/friendApi";
import { createNotification, deleteFriendRequestNotification } from "../../api/notificationApi";
import RoomListPage from "../room/RoomListPage";
import ConfirmedScheduleCard from "../../components/ConfirmedScheduleCard";

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
        border: "1px solid var(--border-color)",
      }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: "var(--btn-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.45,
        flexShrink: 0,
        border: "1px solid var(--border-color)",
      }}
    >
      👤
    </div>
  );
}

function HomePage() {
  const navigate = useNavigate();

  const [confirmedSchedules, setConfirmedSchedules] = useState([]);
  const [isConfirmedExpanded, setIsConfirmedExpanded] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const [showFriendPanel, setShowFriendPanel] = useState(false);
  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
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

    const additionalLocationEntries = await Promise.all(
      (data || []).map(async (schedule) => [
        schedule.id,
        await getAdditionalConfirmedLocations(schedule.roomid, schedule.id),
      ])
    );

    const additionalLocationMap = new Map(additionalLocationEntries);

    setConfirmedSchedules(
      (data || []).map((schedule) => ({
        ...schedule,
        additionalLocations: additionalLocationMap.get(schedule.id) || [],
      }))
    );
  }, []);

  const loadAll = useCallback(async (userId) => {
    const [friendList, requestList, sentList] = await Promise.all([
      getFriends(userId).catch(() => []),
      getPendingRequests(userId).catch(() => []),
      getSentRequests(userId).catch(() => []),
    ]);

    setFriends(friendList);
    setPendingRequests(requestList);
    setSentRequests(sentList);
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

      const { data: myProfile } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", currentUser.id)
        .single();
      const myNickname = myProfile?.nickname || "알 수 없음";

      await createNotification({
        receiverId: request.id,
        senderId: currentUser.id,
        type: "friend_accepted",
        title: "친구 요청 수락",
        message: `${myNickname}님이 친구 요청을 수락했습니다. 이제 친구입니다!`,
      });

      // 알림탭에서도 해당 friend_request 알림 삭제
      await deleteFriendRequestNotification(request.id, currentUser.id);

      await loadAll(currentUser.id);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleCancelSentRequest = async (request) => {
    try {
      await cancelFriendRequest(request.requestId);
      setSentRequests((prev) => prev.filter((r) => r.requestId !== request.requestId));
    } catch (error) {
      alert(error.message);
    }
  };

  const handleReject = async (request) => {
    try {
      await rejectFriendRequest(request.requestId);
      // 알림탭에서도 해당 friend_request 알림 삭제
      await deleteFriendRequestNotification(request.id, currentUser.id);

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
    <div className="home-container" style={{ backgroundColor: "var(--bg-color)", color: "var(--text-color)", minHeight: "100vh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "8px",
        }}
      >
        <h1 style={{ margin: 0, color: "var(--text-color)" }}>홈</h1>

        <button
          onClick={handleOpenFriendPanel}
          style={{
            position: "relative",
            border: "none",
            background: "none",
            fontSize: "22px",
            cursor: "pointer",
            color: "var(--text-color)",
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
              backgroundColor: "rgba(0,0,0,0.5)",
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
              backgroundColor: "var(--header-bg)",
              zIndex: 201,
              boxShadow: "-2px 0 12px rgba(0,0,0,0.3)",
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
                borderBottom: "1px solid var(--border-color)",
              }}
            >
              <span style={{ fontSize: "16px", fontWeight: "bold", color: "var(--text-color)" }}>친구</span>

              <button
                onClick={() => setShowFriendPanel(false)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  color: "var(--secondary-text)",
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
                  color: "var(--secondary-text)",
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
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    fontSize: "14px",
                    outline: "none",
                    backgroundColor: "var(--input-bg)",
                    color: "var(--text-color)",
                  }}
                />

                <button
                  onClick={handleSendRequest}
                  disabled={friendLoading}
                  style={{
                    padding: "10px 16px",
                    backgroundColor: "var(--accent-color)",
                    color: "var(--accent-text)",
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
                      color: "var(--secondary-text)",
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
                        borderBottom: "1px solid var(--border-color)",
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
                          color: "var(--text-color)",
                        }}
                      >
                        {request.nickname || "닉네임 없음"}
                      </span>

                      <button
                        onClick={() => handleAccept(request)}
                        style={{
                          padding: "5px 10px",
                          backgroundColor: "var(--accent-color)",
                          color: "var(--accent-text)",
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
                          backgroundColor: "var(--btn-bg)",
                          color: "var(--btn-text)",
                          border: "1px solid var(--border-color)",
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

              {sentRequests.length > 0 && (
                <div style={{ marginBottom: "24px" }}>
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "var(--secondary-text)",
                    }}
                  >
                    보낸 요청
                    <span
                      style={{
                        marginLeft: "6px",
                        backgroundColor: "var(--btn-bg)",
                        color: "var(--btn-text)",
                        borderRadius: "10px",
                        padding: "1px 7px",
                        fontSize: "11px",
                      }}
                    >
                      {sentRequests.length}
                    </span>
                  </p>

                  {sentRequests.map((request) => (
                    <div
                      key={request.requestId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 0",
                        borderBottom: "1px solid var(--border-color)",
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
                          color: "var(--text-color)",
                        }}
                      >
                        {request.nickname || "닉네임 없음"}
                      </span>

                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--secondary-text)",
                          marginRight: "4px",
                        }}
                      >
                        대기 중
                      </span>

                      <button
                        onClick={() => handleCancelSentRequest(request)}
                        style={{
                          padding: "5px 10px",
                          backgroundColor: "var(--btn-bg)",
                          color: "var(--btn-text)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "6px",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        취소
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
                  color: "var(--secondary-text)",
                }}
              >
                친구 목록 {friends.length > 0 && `(${friends.length})`}
              </p>

              {friends.length === 0 ? (
                <p
                  style={{
                    fontSize: "14px",
                    color: "var(--secondary-text)",
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
                      borderBottom: "1px solid var(--border-color)",
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
                        color: "var(--text-color)",
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
                        color: "var(--secondary-text)",
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
        <h3 style={{ marginBottom: "8px", color: "var(--text-color)" }}>확정된 일정</h3>

        {upcomingSchedules.length === 0 ? (
          <p style={{ color: "var(--secondary-text)", fontSize: "14px" }}>
            확정된 일정이 없습니다
          </p>
        ) : (
          <div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {(isConfirmedExpanded ? upcomingSchedules : upcomingSchedules.slice(0, 3)).map((schedule) => (
                <ConfirmedScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  onClick={() =>
                    navigate("/confirmed-schedule", {
                      state: { schedule },
                    })
                  }
                />
              ))}
            </div>
            {upcomingSchedules.length > 3 && (
              <button
                onClick={() => setIsConfirmedExpanded(!isConfirmedExpanded)}
                style={{
                  width: "100%",
                  padding: "8px",
                  marginTop: "8px",
                  backgroundColor: "transparent",
                  color: "var(--accent-color)",
                  border: "1px solid var(--accent-color)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "bold"
                }}
              >
                {isConfirmedExpanded ? "접기 ▲" : `더보기 (+${upcomingSchedules.length - 3}) ▼`}
              </button>
            )}
          </div>
        )}
      </div>

      <RoomListPage />

      <button onClick={() => navigate("/rooms/create")} style={{ backgroundColor: "var(--accent-color)", color: "var(--accent-text)", padding: "12px", borderRadius: "8px", border: "none", width: "100%", marginBottom: "8px", fontWeight: "bold" }}>방 만들기</button>
      <button onClick={() => navigate("/rooms/invite")} style={{ backgroundColor: "var(--btn-bg)", color: "var(--btn-text)", padding: "12px", borderRadius: "8px", border: "1px solid var(--border-color)", width: "100%", fontWeight: "bold" }}>
        초대코드 입력하기
      </button>
    </div>
  );
}

export default HomePage;
