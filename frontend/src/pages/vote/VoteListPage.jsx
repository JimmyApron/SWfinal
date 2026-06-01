import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { getVotes } from "../../api/voteApi";

function VoteListPage({ roomid }) {
  const navigate = useNavigate();
  const [votes, setVotes] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUser(user);
    });
  }, []);

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
  }, [roomid]);

  return (
    <div style={{ padding: "16px" }}>
      <h2>투표 목록</h2>

      <button onClick={() => navigate(`/rooms/${roomid}/vote-create`, {
        state: {
            returnTab: "vote",
        },
        })
        }>
        투표 작성하기
      </button>

      {votes.length === 0 && <p>아직 생성된 투표가 없습니다.</p>}

      {votes.map((vote) => {
        const votedCount = new Set(vote.voteresponses?.map((r) => r.userid)).size;
        const participated = vote.voteresponses?.some(
          (r) => r.userid === currentUser?.id
        );

        return (
          <div
            key={vote.id}
            onClick={() => navigate(`/rooms/${roomid}/votes/${vote.id}`)}
            style={{
              padding: "14px",
              borderBottom: "1px solid #ddd",
              cursor: "pointer",
            }}
          >
            <h3>{vote.title}</h3>
            {vote.scheduleid && (
              <p>대상 일정: {vote.confirmed_schedules?.title || "선택한 일정"}</p>
            )}
            <p>참여 인원: {votedCount}명</p>
            <p>{participated ? "✓ 참여 완료" : "미참여"}</p>
            {vote.endtimeenabled && vote.endtime && (
              <p>종료: {new Date(vote.endtime).toLocaleString("ko-KR")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default VoteListPage;
