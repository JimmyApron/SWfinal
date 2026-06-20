import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaCalendarAlt,
  FaMapMarkerAlt,
  FaVoteYea,
  FaUserFriends,
  FaClock,
} from "react-icons/fa";
import { supabase } from "../../lib/supabaseClient";
import { getVotes } from "../../api/voteApi";

const LOCATION_VOTE_TYPES = ["location", "middle_location", "additional_location"];
const VISIBLE_COUNT = 3;

function getVoteTypeMeta(votetype) {
  if (votetype === "schedule") {
    return { icon: FaCalendarAlt, label: "일정 확정" };
  }
  if (LOCATION_VOTE_TYPES.includes(votetype)) {
    return { icon: FaMapMarkerAlt, label: "장소 확정" };
  }
  return { icon: FaVoteYea, label: "일반 투표" };
}

function getDeadlineLabel(endtime) {
  const end = new Date(endtime);
  const now = new Date();
  const time = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (end.toDateString() === now.toDateString()) return `오늘 ${time} 마감`;
  if (end.toDateString() === tomorrow.toDateString()) return `내일 ${time} 마감`;
  return `${end.getMonth() + 1}.${end.getDate()} ${time} 마감`;
}

function VoteListPage({ roomid }) {
  const navigate = useNavigate();
  const [votes, setVotes] = useState([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [currentUser, setCurrentUser] = useState(null);
  const [showAllOngoing, setShowAllOngoing] = useState(false);
  const [showAllClosed, setShowAllClosed] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUser(user);
    });
  }, []);

  useEffect(() => {
    if (!roomid) return;

    const loadMemberCount = async () => {
      const [{ count: memberCount }, { count: guestCount }] = await Promise.all([
        supabase
          .from("room_members")
          .select("id", { count: "exact", head: true })
          .eq("roomid", Number(roomid)),
        supabase
          .from("room_guests")
          .select("id", { count: "exact", head: true })
          .eq("roomid", Number(roomid)),
      ]);
      setTotalMembers((memberCount || 0) + (guestCount || 0));
    };

    loadMemberCount();
  }, [roomid]);

  useEffect(() => {
    const loadVotes = async () => {
      try {
        const data = await getVotes(Number(roomid));
        setVotes(data);
      } catch (error) {
        console.error("투표 목록 불러오기 실패:", error);
        alert("투표 목록 불러오기 실패");
      }
    };

    loadVotes();

    const channel = supabase
      .channel(`votes-room-${roomid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes", filter: `roomid=eq.${roomid}` },
        loadVotes
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voteresponses" },
        loadVotes
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomid]);

  const now = Date.now();

  const decorated = votes.map((vote) => {
    const votedCount = new Set(vote.voteresponses?.map((r) => r.userid)).size;
    const notVotedCount = Math.max(totalMembers - votedCount, 0);
    const isExpired =
      vote.endtimeenabled && vote.endtime && new Date(vote.endtime).getTime() <= now;
    const isClosed = vote.isclosed || isExpired;
    const isUrgent =
      !isClosed &&
      vote.endtimeenabled &&
      vote.endtime &&
      new Date(vote.endtime).getTime() - now <= 24 * 60 * 60 * 1000;
    const participated = vote.voteresponses?.some((r) => r.userid === currentUser?.id);

    return { vote, votedCount, notVotedCount, isClosed, isUrgent, participated };
  });

  const ongoingVotes = decorated.filter((item) => !item.isClosed);
  const closedVotes = decorated.filter((item) => item.isClosed);
  const visibleOngoing = showAllOngoing ? ongoingVotes : ongoingVotes.slice(0, VISIBLE_COUNT);
  const visibleClosed = showAllClosed ? closedVotes : closedVotes.slice(0, VISIBLE_COUNT);

  const renderCard = ({ vote, votedCount, notVotedCount, isClosed, isUrgent, participated }) => {
    const { icon: Icon, label } = getVoteTypeMeta(vote.votetype);
    const statusBadge = isClosed
      ? { text: "마감됨", bg: "#F3F4F6", color: "#6B7280" }
      : isUrgent
      ? { text: "마감 임박", bg: "#FEF3E2", color: "#F59E0B" }
      : { text: "진행 중", bg: "#E7F6EC", color: "#22A06B" };

    return (
      <div
        key={vote.id}
        onClick={() => navigate(`/rooms/${roomid}/votes/${vote.id}`)}
        style={{
          backgroundColor: "var(--card-bg)",
          border: "1px solid var(--border-color)",
          borderRadius: "16px",
          padding: "16px",
          marginBottom: "12px",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", gap: "12px" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              backgroundColor: "#F0EEFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={18} color="#7c79ff" />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontWeight: "700",
                  fontSize: "16px",
                  color: "var(--text-color)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {vote.title}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    padding: "3px 8px",
                    borderRadius: "20px",
                    backgroundColor: statusBadge.bg,
                    color: statusBadge.color,
                    whiteSpace: "nowrap",
                  }}
                >
                  {statusBadge.text}
                </span>
              </div>
            </div>

            <span
              style={{
                display: "inline-block",
                marginTop: "6px",
                fontSize: "11px",
                fontWeight: "600",
                padding: "3px 8px",
                borderRadius: "6px",
                backgroundColor: "#F0EEFF",
                color: "#7c79ff",
              }}
            >
              {label}
            </span>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px", gap: "8px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--secondary-text)" }}>
                  <FaUserFriends size={12} />
                  <span>
                    {isClosed
                      ? `총 ${votedCount}명 참여`
                      : `참여 ${votedCount}명 · 미참여 ${notVotedCount}명`}
                  </span>
                </div>

                {vote.endtimeenabled && vote.endtime && !isClosed && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--secondary-text)" }}>
                    <FaClock size={12} />
                    <span>{getDeadlineLabel(vote.endtime)}</span>
                  </div>
                )}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/rooms/${roomid}/votes/${vote.id}`);
                }}
                style={{
                  width: "84px",
                  padding: "9px 0",
                  borderRadius: "10px",
                  border: isClosed || participated ? "1px solid var(--border-color)" : "none",
                  backgroundColor: isClosed || participated ? "var(--card-bg)" : "#7c79ff",
                  color: isClosed || participated ? "var(--text-color)" : "#fff",
                  fontSize: "13px",
                  fontWeight: "700",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                {isClosed ? "결과 보기" : participated ? "투표 완료" : "투표하기"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderMoreButton = (remaining, onClick) => (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        padding: "8px",
        marginBottom: "12px",
        backgroundColor: "transparent",
        color: "var(--accent-color)",
        border: "none",
        borderTop: "1px solid var(--border-color)",
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: "bold",
      }}
    >
      {`더보기 (+${remaining}) ▼`}
    </button>
  );

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ margin: 0, fontSize: "22px", fontWeight: "800", color: "var(--text-color)" }}>투표 목록</h2>
        <button
          onClick={() =>
            navigate(`/rooms/${roomid}/vote-create`, {
              state: { returnTab: "vote" },
            })
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
            borderRadius: "20px",
            border: "1.5px solid #7c79ff",
            backgroundColor: "transparent",
            color: "#7c79ff",
            fontSize: "13px",
            fontWeight: "700",
            cursor: "pointer",
          }}
        >
          + 새 투표
        </button>
      </div>

      {votes.length === 0 && (
        <p style={{ color: "var(--secondary-text)", textAlign: "center", marginTop: "40px" }}>
          아직 생성된 투표가 없습니다.
        </p>
      )}

      {ongoingVotes.length > 0 && (
        <>
          <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "var(--secondary-text)" }}>진행 중인 투표</h4>
          {visibleOngoing.map(renderCard)}
          {!showAllOngoing &&
            ongoingVotes.length > VISIBLE_COUNT &&
            renderMoreButton(ongoingVotes.length - VISIBLE_COUNT, () => setShowAllOngoing(true))}
        </>
      )}

      {closedVotes.length > 0 && (
        <>
          <h4 style={{ margin: "20px 0 10px", fontSize: "14px", color: "var(--secondary-text)" }}>마감된 투표</h4>
          {visibleClosed.map(renderCard)}
          {!showAllClosed &&
            closedVotes.length > VISIBLE_COUNT &&
            renderMoreButton(closedVotes.length - VISIBLE_COUNT, () => setShowAllClosed(true))}
        </>
      )}
    </div>
  );
}

export default VoteListPage;
