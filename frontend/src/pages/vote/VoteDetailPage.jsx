import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  getVoteDetail,
  deleteVote,
  updateVote,
  submitVote,
  closeVote,
  addVoteOption,
  confirmVote,
} from "../../api/voteApi";
import KakaoMapView from "../../components/map/KakaoMapView";

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
  const [editEndtimeEnabled, setEditEndtimeEnabled] = useState(false);
  const [editReminderEnabled, setEditReminderEnabled] = useState(false);

  // 중간장소 투표 지도 기능용
  const [mapOption, setMapOption] = useState(null);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [newPickedPlace, setNewPickedPlace] = useState(null);
  const [showPickMap, setShowPickMap] = useState(false);

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
  const isLocationVote = vote.votetype === "location";

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

  const allParticipants = [...new Set(responses.map((r) => r.userid))].map(
    (uid) => {
      const found = responses.find((r) => r.userid === uid);
      return { userid: uid, nickname: found?.nickname || uid };
    }
  );

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
    try {
      let newOption;

      if (isLocationVote) {
        if (!newPickedPlace?.lat || !newPickedPlace?.lng) {
          alert("지도에서 추가할 위치를 먼저 클릭하세요.");
          return;
        }

        const placeName = newPlaceName.trim() || "지도에서 선택한 위치";

        newOption = await addVoteOption(Number(voteid), {
          optiontype: "place",
          optiontext: placeName,
          placename: placeName,
          placeaddress: "직접 선택한 위치",
          placelat: newPickedPlace.lat,
          placelng: newPickedPlace.lng,
          kakaomapurl: null,
        });

        setNewPlaceName("");
        setNewPickedPlace(null);
        setShowPickMap(false);
      } else {
        if (!newOptionText.trim()) {
          alert("항목 내용을 입력하세요.");
          return;
        }

        newOption = await addVoteOption(Number(voteid), newOptionText.trim());
        setNewOptionText("");
      }

      setVote((prev) => ({
        ...prev,
        voteoptions: [...prev.voteoptions, newOption],
      }));
    } catch (error) {
      alert("항목 추가 실패: " + (error.message || JSON.stringify(error)));
    }
  };

  const handleSubmitVote = async () => {
    if (!currentUser) {
      alert("로그인이 필요합니다.");
      return;
    }

    if (selectedOptions.length === 0) {
      alert("투표 항목을 선택하세요.");
      return;
    }

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

  const handleConfirm = async (option) => {
    const typeLabel = vote.votetype === "schedule" ? "일정" : "중간장소";

    if (
      !window.confirm(
        `"${getOptionLabel(option)}" 을(를) ${typeLabel}으로 확정할까요?`
      )
    ) {
      return;
    }

    try {
      await confirmVote(
        Number(voteid),
        option,
        Number(roomid),
        vote.votetype,
        currentUser?.id
      );

      await loadVote();
    } catch (error) {
      alert("확정 실패: " + (error.message || JSON.stringify(error)));
    }
  };

  const handleReVote = () => {
    setSelectedOptions(myResponses.map((r) => r.optionid));
    setIsForceVoting(true);
  };

  const handleCloseVote = async () => {
    if (
      !window.confirm(
        "투표를 종료할까요? 종료되어도 확정 버튼을 누르기 전까지 중간장소는 확정되지 않습니다."
      )
    ) {
      return;
    }

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
      navigate(`/rooms/${roomid}`, { state: { selectedTab: "vote" } });
    } catch (error) {
      alert("투표 삭제 실패");
    }
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) {
      alert("투표 제목을 입력하세요.");
      return;
    }

    try {
      await updateVote(Number(voteid), {
        title: editTitle,
        endtime: editEndtime,
        endtimeenabled: editEndtimeEnabled,
        reminderenabled: editReminderEnabled,
      });

      setVote((prev) => ({
        ...prev,
        title: editTitle,
        endtime: editEndtimeEnabled ? editEndtime : null,
        endtimeenabled: editEndtimeEnabled,
        reminderenabled: editReminderEnabled,
      }));

      setIsEditMode(false);
    } catch (error) {
      alert("투표 수정 실패");
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff" }}>
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
          onClick={() =>
            navigate(`/rooms/${roomid}`, { state: { selectedTab: "vote" } })
          }
          style={{ border: "none", background: "none", fontSize: "24px" }}
        >
          ←
        </button>

        <h3 style={{ margin: 0 }}>투표 상세보기</h3>

        {isCreator && !isEditMode ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setIsEditMode(true)}
              style={{
                border: "none",
                background: "none",
                fontSize: "14px",
                color: "#555",
              }}
            >
              수정
            </button>
            <button
              onClick={handleDelete}
              style={{
                border: "none",
                background: "none",
                fontSize: "14px",
                color: "#f44",
              }}
            >
              삭제
            </button>
          </div>
        ) : isEditMode ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleSaveEdit}
              style={{
                border: "none",
                background: "none",
                fontSize: "14px",
                color: "#7c79ff",
              }}
            >
              저장
            </button>
            <button
              onClick={() => setIsEditMode(false)}
              style={{
                border: "none",
                background: "none",
                fontSize: "14px",
                color: "#888",
              }}
            >
              취소
            </button>
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
          <p style={{ color: "#f66", fontSize: "14px" }}>
            {getTimeRemaining(vote.endtime)}
          </p>
        ) : null}

        {isLocationVote && (
          <p
            style={{
              color: "#666",
              fontSize: "14px",
              padding: "10px",
              backgroundColor: "#fafafa",
              border: "1px solid #eee",
              borderRadius: "8px",
            }}
          >
            중간장소 투표는 투표 종료와 별개로, 생성자가
            <strong> 중간장소 확정하기 </strong>
            버튼을 눌러야 최종 확정됩니다.
          </p>
        )}

        {isEditMode ? (
          <div style={{ marginBottom: "16px" }}>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                fontSize: "18px",
                border: "1px solid #ddd",
                borderRadius: "8px",
                boxSizing: "border-box",
              }}
            />

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginTop: "12px",
              }}
            >
              <input
                type="checkbox"
                checked={editEndtimeEnabled}
                onChange={(e) => setEditEndtimeEnabled(e.target.checked)}
              />
              투표 종료시간 설정
            </label>

            {editEndtimeEnabled && (
              <input
                type="datetime-local"
                value={editEndtime}
                onChange={(e) => setEditEndtime(e.target.value)}
                style={{
                  display: "block",
                  marginTop: "8px",
                  width: "100%",
                  padding: "8px",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  boxSizing: "border-box",
                }}
              />
            )}

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginTop: "12px",
              }}
            >
              <input
                type="checkbox"
                checked={editReminderEnabled}
                onChange={(e) => setEditReminderEnabled(e.target.checked)}
              />
              종료 30분 전 알림
            </label>
          </div>
        ) : (
          <h2 style={{ margin: "8px 0" }}>{vote.title}</h2>
        )}

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          {vote.ismultiple && (
            <span style={badgeStyle}>복수선택</span>
          )}
          {vote.isanonymous && (
            <span style={badgeStyle}>익명투표</span>
          )}
          {isLocationVote && (
            <span style={badgeStyle}>중간장소 투표</span>
          )}
        </div>

        {mapOption && (
          <div
            style={{
              marginBottom: "16px",
              padding: "12px",
              border: "1px solid #ddd",
              borderRadius: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <strong>{getOptionLabel(mapOption)}</strong>

              <button
                onClick={() => setMapOption(null)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <KakaoMapView
              places={[optionToPlace(mapOption)]}
              selectedPlace={optionToPlace(mapOption)}
            />
          </div>
        )}

        {showVotingUI ? (
          <>
            {vote.voteoptions?.map((option) => (
              <label
                key={option.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "12px",
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  marginBottom: "10px",
                  cursor: "pointer",
                }}
              >
                <input
                  type={vote.ismultiple ? "checkbox" : "radio"}
                  checked={selectedOptions.includes(option.id)}
                  onChange={() => handleSelectOption(option.id)}
                />

                <div style={{ flex: 1 }}>{renderOptionContent(option)}</div>

                {isPlaceOption(option) && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMapOption(option);
                    }}
                    style={smallButtonStyle}
                  >
                    지도보기
                  </button>
                )}
              </label>
            ))}

            {vote.allowaddoption && (
              <>
                <button
                  onClick={handleSelectAll}
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginBottom: "8px",
                    border: "1px solid #ddd",
                    borderRadius: "8px",
                    backgroundColor: "#fff",
                    cursor: "pointer",
                  }}
                >
                  전체 선택
                </button>

                {isLocationVote ? (
                  <div
                    style={{
                      marginBottom: "16px",
                      padding: "12px",
                      border: "1px solid #eee",
                      borderRadius: "8px",
                    }}
                  >
                    <input
                      value={newPlaceName}
                      onChange={(e) => setNewPlaceName(e.target.value)}
                      placeholder="추가할 장소명"
                      style={{
                        width: "100%",
                        padding: "10px",
                        border: "1px solid #ddd",
                        borderRadius: "8px",
                        boxSizing: "border-box",
                        marginBottom: "8px",
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => setShowPickMap(!showPickMap)}
                      style={{ ...smallButtonStyle, marginBottom: "8px" }}
                    >
                      {showPickMap ? "지도 접기" : "지도에서 위치 선택"}
                    </button>

                    {newPickedPlace && (
                      <p style={{ fontSize: "13px", color: "#666" }}>
                        선택 좌표: {Number(newPickedPlace.lat).toFixed(6)},{" "}
                        {Number(newPickedPlace.lng).toFixed(6)}
                      </p>
                    )}

                    {showPickMap && (
                      <KakaoMapView
                        onMapClick={setNewPickedPlace}
                        pickedPlace={newPickedPlace}
                        places={newPickedPlace ? [newPickedPlace] : []}
                        selectedPlace={newPickedPlace}
                      />
                    )}

                    <button
                      onClick={handleAddOption}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        border: "1px solid #ddd",
                        borderRadius: "8px",
                        backgroundColor: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      지도 선택 항목 추가
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      marginBottom: "16px",
                    }}
                  >
                    <input
                      value={newOptionText}
                      onChange={(e) => setNewOptionText(e.target.value)}
                      placeholder="항목 추가"
                      style={{
                        flex: 1,
                        padding: "10px",
                        border: "1px solid #ddd",
                        borderRadius: "8px",
                      }}
                    />
                    <button
                      onClick={handleAddOption}
                      style={{
                        padding: "10px 16px",
                        border: "1px solid #ddd",
                        borderRadius: "8px",
                        backgroundColor: "#fff",
                      }}
                    >
                      추가
                    </button>
                  </div>
                )}
              </>
            )}

            <button
              onClick={handleSubmitVote}
              style={{
                width: "100%",
                padding: "14px",
                backgroundColor: "#7c79ff",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontSize: "16px",
                cursor: "pointer",
              }}
            >
              투표하기
            </button>
          </>
        ) : (
          <>
            {vote.voteoptions?.map((option) => {
              const count = getOptionCount(option.id);
              const percent = getOptionPercent(option.id);
              const voters = getOptionVoters(option.id);
              const isShowingVoters = showVotersForOption === option.id;
              const isConfirmed = vote.confirmedoptionid === option.id;

              return (
                <div key={option.id} style={{ marginBottom: "16px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "6px",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        flex: 1,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        {renderOptionContent(option)}
                      </div>

                      {isPlaceOption(option) && (
                        <button
                          type="button"
                          onClick={() => setMapOption(option)}
                          style={smallButtonStyle}
                        >
                          지도보기
                        </button>
                      )}

                      {isConfirmed && (
                        <span
                          style={{
                            fontSize: "12px",
                            padding: "2px 8px",
                            backgroundColor: "#7c79ff",
                            color: "#fff",
                            borderRadius: "10px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          확정
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isCreator && vote.votetype !== "general" && (
                        <button
                          onClick={() => handleConfirm(option)}
                          style={{
                            fontSize: "12px",
                            padding: "3px 10px",
                            border: isConfirmed
                              ? "1px solid #7c79ff"
                              : "1px solid #ddd",
                            borderRadius: "12px",
                            backgroundColor: isConfirmed ? "#f0f0ff" : "#fff",
                            color: isConfirmed ? "#7c79ff" : "#555",
                            cursor: "pointer",
                          }}
                        >
                          {isLocationVote
                            ? isConfirmed
                              ? "중간장소 확정됨"
                              : "중간장소 확정하기"
                            : isConfirmed
                            ? "확정됨"
                            : "확정"}
                        </button>
                      )}

                      <span
                        onClick={() => {
                          if (!vote.isanonymous) {
                            setShowVotersForOption(
                              isShowingVoters ? null : option.id
                            );
                          }
                        }}
                        style={{
                          color: "#7c79ff",
                          fontWeight: "bold",
                          cursor: vote.isanonymous ? "default" : "pointer",
                        }}
                      >
                        {count}명 ({percent}%)
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      height: "10px",
                      backgroundColor: "#eee",
                      borderRadius: "5px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${percent}%`,
                        backgroundColor: "#7c79ff",
                        borderRadius: "5px",
                        transition: "width 0.4s",
                      }}
                    />
                  </div>

                  {!vote.isanonymous && isShowingVoters && (
                    <div
                      style={{
                        marginTop: "8px",
                        padding: "8px",
                        backgroundColor: "#f5f5ff",
                        borderRadius: "8px",
                        fontSize: "13px",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px",
                      }}
                    >
                      {voters.length === 0 ? (
                        <span style={{ color: "#aaa" }}>
                          투표한 사람이 없습니다
                        </span>
                      ) : (
                        voters.map((r) => (
                          <span
                            key={r.userid}
                            style={{
                              padding: "2px 8px",
                              backgroundColor: "#e8e8ff",
                              borderRadius: "10px",
                            }}
                          >
                            {r.nickname || r.userid}
                          </span>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              {!isClosed && (
                <button
                  onClick={handleReVote}
                  style={{
                    flex: 1,
                    padding: "12px",
                    border: "1px solid #7c79ff",
                    borderRadius: "8px",
                    backgroundColor: "#fff",
                    color: "#7c79ff",
                    fontSize: "15px",
                    cursor: "pointer",
                  }}
                >
                  다시 투표하기
                </button>
              )}

              {isCreator && !isClosed && (
                <button
                  onClick={handleCloseVote}
                  style={{
                    flex: 1,
                    padding: "12px",
                    border: "1px solid #f44",
                    borderRadius: "8px",
                    backgroundColor: "#fff",
                    color: "#f44",
                    fontSize: "15px",
                    cursor: "pointer",
                  }}
                >
                  투표 종료
                </button>
              )}
            </div>

            <div
              style={{
                marginTop: "20px",
                paddingTop: "16px",
                borderTop: "1px solid #eee",
              }}
            >
              <div
                onClick={() =>
                  !vote.isanonymous && setShowParticipants(!showParticipants)
                }
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: vote.isanonymous ? "default" : "pointer",
                }}
              >
                <span style={{ fontSize: "15px", fontWeight: "bold" }}>
                  총 참여 인원
                </span>
                <span style={{ color: "#7c79ff", fontWeight: "bold" }}>
                  {totalVoters}명
                </span>
              </div>

              {!vote.isanonymous && showParticipants && (
                <div
                  style={{
                    marginTop: "10px",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  {allParticipants.map((p) => (
                    <span
                      key={p.userid}
                      style={{
                        padding: "4px 10px",
                        backgroundColor: "#eee",
                        borderRadius: "12px",
                        fontSize: "13px",
                      }}
                    >
                      {p.nickname}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function isPlaceOption(option) {
  return option.optiontype === "place" || option.placelat || option.placelng;
}

function getOptionLabel(option) {
  if (option.optiontype === "date") {
    return `${option.optiondate} ${option.starttime}~${option.endtime}`;
  }

  return option.placename || option.optiontext || "이름 없는 장소";
}

function renderOptionContent(option) {
  if (option.optiontype === "date") {
    return (
      <span>
        {option.optiondate} / {option.starttime} ~ {option.endtime}
      </span>
    );
  }

  if (isPlaceOption(option)) {
    return (
      <span>
        <strong>{option.placename || option.optiontext}</strong>
        {option.placeaddress && (
          <span
            style={{
              display: "block",
              fontSize: "13px",
              color: "#666",
              marginTop: "2px",
            }}
          >
            {option.placeaddress}
          </span>
        )}
      </span>
    );
  }

  return <span>{option.optiontext}</span>;
}

function optionToPlace(option) {
  return {
    id: option.id,
    name: option.placename || option.optiontext || "장소",
    address: option.placeaddress || "주소 정보 없음",
    lat: option.placelat,
    lng: option.placelng,
    kakaoMapUrl: option.kakaomapurl,
  };
}

const badgeStyle = {
  padding: "4px 10px",
  borderRadius: "12px",
  backgroundColor: "#eee",
  fontSize: "13px",
};

const smallButtonStyle = {
  padding: "6px 10px",
  border: "1px solid #ddd",
  borderRadius: "8px",
  backgroundColor: "#fff",
  fontSize: "12px",
  cursor: "pointer",
};

export default VoteDetailPage;