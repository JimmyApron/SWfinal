import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { getVoteDetail, deleteVote, updateVote, submitVote, closeVote, addVoteOption, confirmVote } from "../../api/voteApi";

function VoteDetailPage() {
  const { roomid, voteid } = useParams();
  const navigate = useNavigate();

  const [vote, setVote] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [newOptionText, setNewOptionText] = useState("");
  const [isForceVoting, setIsForceVoting] = useState(false);
  const [showVotersForOption, setShowVotersForOption] = useState(null);
  const [showParticipants, setShowParticipants] = useState(false);

  const [isEditMode, setIsEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editEndtime, setEditEndtime] = useState("");
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [pendingOption, setPendingOption] = useState(null);
  const [appointmentTitle, setAppointmentTitle] = useState("");
  const [editEndtimeEnabled, setEditEndtimeEnabled] = useState(false);
  const [editReminderEnabled, setEditReminderEnabled] = useState(false);
  const [editIsmultiple, setEditIsmultiple] = useState(false);
  const [editIsanonymous, setEditIsanonymous] = useState(false);
  const [editAllowaddoption, setEditAllowaddoption] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUser(user));
  }, []);

  const loadVote = async () => {
    try {
      const data = await getVoteDetail(Number(voteid));
      setVote(data);
      setEditTitle(data.title);
      setEditEndtime(data.endtime ? data.endtime.slice(0, 16) : "");
      setEditEndtimeEnabled(data.endtimeenabled || false);
      setEditReminderEnabled(data.reminderenabled || false);
      setEditIsmultiple(data.ismultiple || false);
      setEditIsanonymous(data.isanonymous || false);
      setEditAllowaddoption(data.allowaddoption || false);
    } catch (error) {
      console.error("투표 상세 불러오기 실패:", error);
      alert("투표 상세 불러오기 실패");
    }
  };

  useEffect(() => {
    loadVote();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteid]);

  const getTimeRemaining = (endtime) => {
    const diff = new Date(endtime) - new Date();
    if (diff <= 0) return "종료된 투표입니다";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours >= 24) return `투표가 ${Math.floor(hours / 24)}일 후에 종료됩니다`;
    if (hours > 0) return `투표가 ${hours}시간 후에 종료됩니다`;
    return `투표가 ${minutes}분 후에 종료됩니다`;
  };

  if (!vote) return <div>불러오는 중...</div>;

  const responses = vote.voteresponses || [];
  const myResponses = responses.filter((r) => r.userid === currentUser?.id);
  const hasVoted = myResponses.length > 0;
  const totalVoters = new Set(responses.map((r) => r.userid)).size;
  const isCreator = currentUser?.id === vote.userid;
  const isClosed =
    vote.isclosed ||
    (vote.endtimeenabled && vote.endtime && new Date(vote.endtime) < new Date());
  const showVotingUI = !isClosed && (!hasVoted || isForceVoting);

  const getOptionCount = (optionId) =>
    responses.filter((r) => r.optionid === optionId).length;
  const getOptionVoters = (optionId) =>
    responses.filter((r) => r.optionid === optionId);
  const getOptionPercent = (optionId) => {
    if (totalVoters === 0) return 0;
    return Math.round((getOptionCount(optionId) / totalVoters) * 100);
  };

  const allParticipants = [...new Set(responses.map((r) => r.userid))].map((uid) => {
    const found = responses.find((r) => r.userid === uid);
    return { userid: uid, nickname: found?.nickname || uid };
  });

  const handleSelectOption = (optionid) => {
    if (!vote.ismultiple) {
      setSelectedOptions([optionid]);
      return;
    }
    if (selectedOptions.includes(optionid)) {
      setSelectedOptions(selectedOptions.filter((id) => id !== optionid));
    } else {
      setSelectedOptions([...selectedOptions, optionid]);
    }
  };

  const handleSelectAll = () => {
    setSelectedOptions(vote.voteoptions.map((o) => o.id));
  };

  const handleAddOption = async () => {
    if (!newOptionText.trim()) { alert("항목 내용을 입력하세요."); return; }
    try {
      const newOption = await addVoteOption(Number(voteid), newOptionText.trim());
      setVote((prev) => ({
        ...prev,
        voteoptions: [...prev.voteoptions, newOption],
      }));
      setNewOptionText("");
    } catch (error) {
      alert("항목 추가 실패: " + (error.message || JSON.stringify(error)));
    }
  };

  const handleSubmitVote = async () => {
    if (!currentUser) { alert("로그인이 필요합니다."); return; }
    if (selectedOptions.length === 0) { alert("투표 항목을 선택하세요."); return; }
    try {
      const nickname = currentUser.user_metadata?.nickname || currentUser.email;
      await submitVote(Number(voteid), selectedOptions, currentUser.id, nickname);
      await loadVote();
      setSelectedOptions([]);
      setIsForceVoting(false);
    } catch (error) {
      console.error("투표 실패:", error);
      alert("투표 실패: " + (error.message || JSON.stringify(error)));
    }
  };

  const handleConfirm = (option) => {
    const typeLabel = vote.votetype === "schedule" ? "일정" : "위치";
    if (!window.confirm(`"${option.optiontype === "date"
      ? `${option.optiondate} ${option.starttime}~${option.endtime}`
      : option.optiontext}" 을(를) ${typeLabel}으로 확정할까요?`)) return;

    if (vote.votetype === "schedule") {
      setPendingOption(option);
      setAppointmentTitle("");
      setShowLocationModal(true);
    } else {
      confirmVote(Number(voteid), option, Number(roomid), vote.votetype)
        .then(() => loadVote())
        .catch((error) => alert("확정 실패: " + (error.message || JSON.stringify(error))));
    }
  };

  const handleConfirmWithLocation = async (goToLocation) => {
    if (!appointmentTitle.trim()) {
      alert("약속 이름을 입력하세요.");
      return;
    }
    try {
      await confirmVote(Number(voteid), pendingOption, Number(roomid), vote.votetype, appointmentTitle.trim());
      await loadVote();
      setShowLocationModal(false);
      if (goToLocation) {
        navigate(`/rooms/${roomid}?tab=location`);
      } else {
        navigate("/home");
      }
    } catch (error) {
      alert("확정 실패: " + (error.message || JSON.stringify(error)));
    }
  };

  const handleReVote = () => {
    setSelectedOptions(myResponses.map((r) => r.optionid));
    setIsForceVoting(true);
  };

  const handleCloseVote = async () => {
    if (!window.confirm("투표를 종료할까요?")) return;
    try {
      await closeVote(Number(voteid));
      await loadVote();
    } catch (error) {
      alert("투표 종료 실패");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("투표를 삭제할까요? 되돌릴 수 없습니다.")) return;
    try {
      await deleteVote(Number(voteid));
      navigate(`/rooms/${roomid}?tab=vote`);
    } catch (error) {
      alert("투표 삭제 실패");
    }
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) { alert("투표 제목을 입력하세요."); return; }
    try {
      await updateVote(Number(voteid), {
        title: editTitle,
        endtime: editEndtime,
        endtimeenabled: editEndtimeEnabled,
        reminderenabled: editReminderEnabled,
        ismultiple: editIsmultiple,
        isanonymous: editIsanonymous,
        allowaddoption: editAllowaddoption,
      });
      setVote((prev) => ({
        ...prev,
        title: editTitle,
        endtime: editEndtimeEnabled ? editEndtime : null,
        endtimeenabled: editEndtimeEnabled,
        reminderenabled: editReminderEnabled,
        ismultiple: editIsmultiple,
        isanonymous: editIsanonymous,
        allowaddoption: editAllowaddoption,
      }));
      setIsEditMode(false);
    } catch (error) {
      alert("투표 수정 실패");
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff" }}>
      {showLocationModal && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: "#fff", borderRadius: "16px", padding: "24px",
            width: "300px", position: "relative",
          }}>
            <button
              onClick={() => setShowLocationModal(false)}
              style={{
                position: "absolute", top: "12px", right: "12px",
                border: "none", background: "none", fontSize: "18px",
                color: "#aaa", cursor: "pointer", lineHeight: 1,
              }}
            >
              ✕
            </button>
            <h3 style={{ marginBottom: "4px", textAlign: "center" }}>일정이 확정되었습니다!</h3>
            <p style={{ color: "#666", fontSize: "13px", textAlign: "center", marginBottom: "16px" }}>
              약속 이름을 입력해 주세요
            </p>
            <input
              type="text"
              placeholder="예: 팀 회식, 생일 파티..."
              value={appointmentTitle}
              onChange={(e) => setAppointmentTitle(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", fontSize: "14px",
                border: "1px solid #ddd", borderRadius: "10px",
                boxSizing: "border-box", marginBottom: "16px",
              }}
            />
            <p style={{ color: "#666", fontSize: "13px", textAlign: "center", marginBottom: "12px" }}>
              만날 위치를 지금 정하시겠어요?
            </p>
            <button
              onClick={() => handleConfirmWithLocation(true)}
              style={{
                width: "100%", padding: "12px", marginBottom: "8px",
                backgroundColor: "#7c79ff", color: "#fff",
                border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer",
              }}
            >
              위치 지금 정하기
            </button>
            <button
              onClick={() => handleConfirmWithLocation(false)}
              style={{
                width: "100%", padding: "12px",
                backgroundColor: "#f5f5f5", color: "#333",
                border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer",
              }}
            >
              나중에 정하기
            </button>
          </div>
        </div>
      )}
      <div
        style={{
          height: "56px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid #eee",
        }}
      >
        <button
          onClick={() => navigate(`/rooms/${roomid}?tab=vote`)}
          style={{ border: "none", background: "none", fontSize: "24px" }}
        >
          ←
        </button>
        <h3 style={{ margin: 0 }}>투표 상세보기</h3>
        {isCreator && !isEditMode ? (
          <div style={{ display: "flex", gap: "8px" }}>
            {!vote.isclosed && <button onClick={() => setIsEditMode(true)} style={{ border: "none", background: "none", fontSize: "14px", color: "#555" }}>수정</button>}
            <button onClick={handleDelete} style={{ border: "none", background: "none", fontSize: "14px", color: "#f44" }}>삭제</button>
          </div>
        ) : isEditMode ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={handleSaveEdit} style={{ border: "none", background: "none", fontSize: "14px", color: "#7c79ff" }}>저장</button>
            <button onClick={() => setIsEditMode(false)} style={{ border: "none", background: "none", fontSize: "14px", color: "#888" }}>취소</button>
          </div>
        ) : (
          <div style={{ width: "48px" }} />
        )}
      </div>

      <div style={{ padding: "16px" }}>
        <p style={{ color: "#888", fontSize: "14px" }}>
          작성자: {vote.nickname || vote.userid || "알 수 없음"}
        </p>

        {isClosed ? (
          <p style={{ color: "#aaa", fontSize: "14px" }}>종료된 투표입니다</p>
        ) : vote.endtimeenabled && vote.endtime ? (
          <p style={{ color: "#f66", fontSize: "14px" }}>{getTimeRemaining(vote.endtime)}</p>
        ) : null}

        {isEditMode ? (
          <div style={{ marginBottom: "16px" }}>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{ width: "100%", padding: "10px", fontSize: "18px", border: "1px solid #ddd", borderRadius: "8px", boxSizing: "border-box" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px" }}>
              <input type="checkbox" checked={editEndtimeEnabled} onChange={(e) => setEditEndtimeEnabled(e.target.checked)} />
              투표 종료시간 설정
            </label>
            {editEndtimeEnabled && (
              <input
                type="datetime-local"
                value={editEndtime}
                onChange={(e) => setEditEndtime(e.target.value)}
                style={{ display: "block", marginTop: "8px", width: "100%", padding: "8px", border: "1px solid #ddd", borderRadius: "8px", boxSizing: "border-box" }}
              />
            )}
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px" }}>
              <input type="checkbox" checked={editReminderEnabled} onChange={(e) => setEditReminderEnabled(e.target.checked)} />
              종료 30분 전 알림
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px" }}>
              <input type="checkbox" checked={editIsmultiple} onChange={(e) => setEditIsmultiple(e.target.checked)} />
              복수 선택 허용
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px" }}>
              <input type="checkbox" checked={editIsanonymous} onChange={(e) => setEditIsanonymous(e.target.checked)} />
              익명 투표
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px" }}>
              <input type="checkbox" checked={editAllowaddoption} onChange={(e) => setEditAllowaddoption(e.target.checked)} />
              항목 추가 허용
            </label>
          </div>
        ) : (
          <h2 style={{ margin: "8px 0" }}>{vote.title}</h2>
        )}

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          {vote.ismultiple && (
            <span style={{ padding: "4px 10px", borderRadius: "12px", backgroundColor: "#eee", fontSize: "13px" }}>복수선택</span>
          )}
          {vote.isanonymous && (
            <span style={{ padding: "4px 10px", borderRadius: "12px", backgroundColor: "#eee", fontSize: "13px" }}>익명투표</span>
          )}
        </div>

        {vote.voteoptions?.map((option) => {
          const count = getOptionCount(option.id);
          const percent = getOptionPercent(option.id);
          const voters = getOptionVoters(option.id);
          const isShowingVoters = showVotersForOption === option.id;
          const isConfirmed = vote.confirmedoptionid === option.id;

          return (
            <div key={option.id} style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
                  {showVotingUI && (
                    <input
                      type={vote.ismultiple ? "checkbox" : "radio"}
                      checked={selectedOptions.includes(option.id)}
                      onChange={() => handleSelectOption(option.id)}
                      style={{ cursor: "pointer", flexShrink: 0 }}
                    />
                  )}
                  <span>
                    {option.optiontype === "date"
                      ? `${option.optiondate} / ${option.starttime} ~${option.endtime ? ` ${option.endtime}` : ""}`
                      : option.optiontext
                    }
                  </span>
                  {!showVotingUI && isConfirmed && (
                    <span style={{ fontSize: "12px", padding: "2px 8px", backgroundColor: "#7c79ff", color: "#fff", borderRadius: "10px", flexShrink: 0 }}>
                      확정됨
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap" }}>
                  {vote.votetype !== "general" && (
                    <button
                      onClick={() => !isConfirmed && handleConfirm(option)}
                      disabled={isConfirmed}
                      style={{
                        fontSize: "12px", padding: "3px 10px",
                        border: isConfirmed ? "1px solid #7c79ff" : "1px solid #ddd",
                        borderRadius: "12px",
                        backgroundColor: isConfirmed ? "#f0f0ff" : "#fff",
                        color: isConfirmed ? "#7c79ff" : "#555",
                        cursor: isConfirmed ? "default" : "pointer",
                      }}
                    >
                      {isConfirmed ? "확정됨" : "확정"}
                    </button>
                  )}
                  {!showVotingUI && (
                    <span
                      onClick={() => !vote.isanonymous && setShowVotersForOption(isShowingVoters ? null : option.id)}
                      style={{ color: "#7c79ff", fontWeight: "bold", cursor: vote.isanonymous ? "default" : "pointer" }}
                    >
                      {count}명 ({percent}%)
                    </span>
                  )}
                </div>
              </div>
              {!showVotingUI && (
                <div style={{ height: "10px", backgroundColor: "#eee", borderRadius: "5px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${percent}%`, backgroundColor: "#7c79ff", borderRadius: "5px", transition: "width 0.4s" }} />
                </div>
              )}
              {!showVotingUI && !vote.isanonymous && isShowingVoters && (
                <div style={{ marginTop: "8px", padding: "8px", backgroundColor: "#f5f5ff", borderRadius: "8px", fontSize: "13px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {voters.length === 0
                    ? <span style={{ color: "#aaa" }}>투표한 사람이 없습니다</span>
                    : voters.map((r) => (
                      <span key={r.userid} style={{ padding: "2px 8px", backgroundColor: "#e8e8ff", borderRadius: "10px" }}>
                        {r.nickname || r.userid}
                      </span>
                    ))
                  }
                </div>
              )}
            </div>
          );
        })}

        {showVotingUI && vote.allowaddoption && (
          <>
            <button
              onClick={handleSelectAll}
              style={{ width: "100%", padding: "10px", marginBottom: "8px", border: "1px solid #ddd", borderRadius: "8px", backgroundColor: "#fff", cursor: "pointer" }}
            >
              전체 선택
            </button>
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              <input
                value={newOptionText}
                onChange={(e) => setNewOptionText(e.target.value)}
                placeholder="항목 추가"
                style={{ flex: 1, padding: "10px", border: "1px solid #ddd", borderRadius: "8px" }}
              />
              <button onClick={handleAddOption} style={{ padding: "10px 16px", border: "1px solid #ddd", borderRadius: "8px", backgroundColor: "#fff" }}>추가</button>
            </div>
          </>
        )}

        {showVotingUI ? (
          <button
            onClick={handleSubmitVote}
            style={{ width: "100%", padding: "14px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "8px", fontSize: "16px", cursor: "pointer", marginTop: "8px" }}
          >
            투표하기
          </button>
        ) : (
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            {!isClosed && (
              <button
                onClick={handleReVote}
                style={{ flex: 1, padding: "12px", border: "1px solid #7c79ff", borderRadius: "8px", backgroundColor: "#fff", color: "#7c79ff", fontSize: "15px", cursor: "pointer" }}
              >
                다시 투표하기
              </button>
            )}
            {isCreator && !isClosed && (
              <button
                onClick={handleCloseVote}
                style={{ flex: 1, padding: "12px", border: "1px solid #f44", borderRadius: "8px", backgroundColor: "#fff", color: "#f44", fontSize: "15px", cursor: "pointer" }}
              >
                투표 종료
              </button>
            )}
          </div>
        )}

        <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #eee" }}>
          <div
            onClick={() => !vote.isanonymous && setShowParticipants(!showParticipants)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: vote.isanonymous ? "default" : "pointer" }}
          >
            <span style={{ fontSize: "15px", fontWeight: "bold" }}>총 참여 인원</span>
            <span style={{ color: "#7c79ff", fontWeight: "bold" }}>{totalVoters}명</span>
          </div>
          {!vote.isanonymous && showParticipants && (
            <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {allParticipants.map((p) => (
                <span key={p.userid} style={{ padding: "4px 10px", backgroundColor: "#eee", borderRadius: "12px", fontSize: "13px" }}>
                  {p.nickname}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default VoteDetailPage;
