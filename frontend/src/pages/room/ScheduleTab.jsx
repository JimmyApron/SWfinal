import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getScheduleCandidates,
  getRoomMembers,
  getMemberAvailabilities,
  saveMemberAvailabilities,
  updateRoomLastActivity,
  addScheduleCandidate,
  updateScheduleCandidate,
  deleteScheduleCandidate,
} from "../../api/scheduleApi";
import { supabase } from "../../lib/supabaseClient";
import { createNotification } from "../../api/notificationApi";

function ScheduleTab({ roomId }) {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState([]);
  const [members, setMembers] = useState([]);
  const [availabilities, setAvailabilities] = useState([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState([]);
  const [dragMode, setDragMode] = useState(null);
  const [currentUser, setCurrentUser] = useState(null); //현재 로그인 유저 상태
  const [newDate, setNewDate] = useState("");
  const [newStartTime, setNewStartTime] = useState("");
  const [newEndTime, setNewEndTime] = useState("");
  const [newIsAllDay, setNewIsAllDay] = useState(false);
  const [editingCandidateId, setEditingCandidateId] = useState(null);

  const memberColors = [
    "#7c79ff",
    "#ff8a80",
    "#4dd0e1",
    "#81c784",
    "#ffd54f",
    "#ba68c8",
    "#ffb74d",
  ];

  const timeSlots = [];

  for (let hour = 0; hour < 24; hour++) {
    for (let minute of [0, 30]) {
      const h = String(hour).padStart(2, "0");
      const m = String(minute).padStart(2, "0");
      timeSlots.push(`${h}:${m}`);
    }
  }

  const getMemberColor = (userid) => {
    const index = members.findIndex((member) => member.userid === userid);
    return memberColors[index % memberColors.length];
  };

  const formatDateWithDay = (dateString) => {
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const days = ["일", "월", "화", "수", "목", "금", "토"];

    return `${month}.${day}(${days[date.getDay()]})`;
  };

  const getNextTime = (time) => {
    const [hour, minute] = time.split(":").map(Number);
    const date = new Date();
    date.setHours(hour);
    date.setMinutes(minute + 30);

    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");

    return `${h}:${m}`;
  };

  const getSlotKey = (candidateId, time) => {
    return `${candidateId}-${time}`;
  };

  const getSlotAvailabilities = (candidateId, time) => {
    return availabilities.filter(
      (item) =>
        item.candidateid === candidateId &&
        item.starttime?.slice(0, 5) <= time &&
        item.endtime?.slice(0, 5) > time
    );
  };

  const isTimeSelectable = (candidate, time) => {
    if (candidate.isallday) {
      return true;
    }

    const start = candidate.starttime?.slice(0, 5);
    const end = candidate.endtime?.slice(0, 5);

    return time >= start && time < end;
  };

  const handleSelectSlot = (candidate, time, mode) => {
    if (!isSelectMode) return;

    const key = getSlotKey(candidate.id, time);

    setSelectedSlots((prev) => {
      const alreadySelected = prev.some((slot) => slot.key === key);

      if (mode === "remove") {
        return prev.filter((slot) => slot.key !== key);
      }

      if (mode === "add" && !alreadySelected) {
        return [
          ...prev,
          {
            key,
            candidateId: candidate.id,
            date: candidate.date,
            starttime: time,
            endtime: getNextTime(time),
          },
        ];
      }

      return prev;
    });
  };

  const handleSaveAvailability = async () => {
    try {
      if (selectedSlots.length === 0) {
        alert("선택한 시간이 없습니다.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        alert("로그인이 필요합니다.");
        return;
      }

      const rows = selectedSlots.map((slot) => ({
        roomid: Number(roomId),
        candidateid: slot.candidateId,
        userid: user.id,
        nickname: user.user_metadata.nickname,
        date: slot.date,
        starttime: slot.starttime,
        endtime: slot.endtime,
      }));

      await saveMemberAvailabilities(roomId, user.id, rows);
      await updateRoomLastActivity(roomId);

      alert("가능한 일정이 저장되었습니다.");

      setSelectedSlots([]);
      setIsSelectMode(false);

      const newAvailabilities = await getMemberAvailabilities(roomId);
      setAvailabilities(newAvailabilities);
    } catch (error) {
      console.error(error);
      alert("일정 저장 실패");
    }
  };

  const reloadScheduleData = async () => {
    const candidateData = await getScheduleCandidates(roomId);
    const availabilityData = await getMemberAvailabilities(roomId);

    setCandidates(candidateData);
    setAvailabilities(availabilityData);
  };

  const handleAddOrUpdateCandidate = async () => {
    try {
      if (!newDate) {
        alert("날짜를 선택하세요.");
        return;
      }

      if (!newIsAllDay) {
        if (!newStartTime || !newEndTime) {
          alert("시작 시간과 종료 시간을 선택하세요.");
          return;
        }

        if (newStartTime >= newEndTime) {
          alert("시작 시간은 종료 시간보다 빨라야 합니다.");
          return;
        }
      }

      const candidateData = {
        roomid: Number(roomId),
        date: newDate,
        starttime: newIsAllDay ? null : newStartTime,
        endtime: newIsAllDay ? null : newEndTime,
        isallday: newIsAllDay,
      };

      if (editingCandidateId) {
        await updateScheduleCandidate(editingCandidateId, candidateData);
        alert("후보 일정이 수정되었습니다.");
      } else {
        const duplicated = candidates.some(
          (candidate) => candidate.date === newDate
        );

        if (duplicated) {
          alert("이미 추가된 날짜입니다.");
          return;
        }

        await addScheduleCandidate(candidateData);
        alert("후보 일정이 추가되었습니다.");
      }

      await updateRoomLastActivity(roomId);
      await reloadScheduleData();

      setNewDate("");
      setNewStartTime("");
      setNewEndTime("");
      setNewIsAllDay(false);
      setEditingCandidateId(null);
    } catch (error) {
      console.error(error);
      alert("후보 일정 저장 실패");
    }
  };

  const handleEditCandidate = (candidate) => {
    setEditingCandidateId(candidate.id);
    setNewDate(candidate.date);
    setNewStartTime(candidate.starttime?.slice(0, 5) || "");
    setNewEndTime(candidate.endtime?.slice(0, 5) || "");
    setNewIsAllDay(candidate.isallday);
  };

  const handleDeleteCandidate = async (candidateId) => {
    try {
      const confirmDelete = window.confirm(
        "이 후보를 삭제하면 해당 후보에 등록된 멤버 일정도 함께 삭제됩니다. 삭제할까요?"
      );

      if (!confirmDelete) return;

      await deleteScheduleCandidate(candidateId);
      await updateRoomLastActivity(roomId);
      await reloadScheduleData();

      alert("후보 일정이 삭제되었습니다.");
    } catch (error) {
      console.error(error);
      alert("후보 일정 삭제 실패");
    }
  };

  const handleRequestSchedule = async (member) => {
    try {
      if (!currentUser) {
        alert("사용자 정보를 불러오는 중입니다.");
        return;
      }

      await createNotification({
        roomId,
        receiverId: member.userid,
        senderId: currentUser.id,
        type: "schedule_request",
        title: "일정 등록 요청",
        message: "아직 가능한 일정을 등록하지 않았습니다. 일정을 등록해주세요!",
        link: `/rooms/${roomId}`,
      });

      alert(`${member.nickname || "상대방"}님에게 일정 등록 요청 알림을 보냈습니다.`);
    } catch (error) {
      console.error("일정 등록 요청 알림 전송 실패:", error);
      alert("일정 등록 요청 알림 전송에 실패했습니다.");
    }
  };

  const handleShowAvailableResult = () => {
    navigate(`/rooms/${roomId}/available-result`, {
      state: {
        availabilities: availabilities,
      },
    });
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        setCurrentUser(user);

        const candidateData = await getScheduleCandidates(roomId);
        const memberData = await getRoomMembers(roomId);
        const availabilityData = await getMemberAvailabilities(roomId);

        setCandidates(candidateData);
        setMembers(memberData);
        setAvailabilities(availabilityData);
      } catch (error) {
        console.error(error);
      }
    };

    loadData();
  }, [roomId]);

  const myAvailability = availabilities.some(
    (item) => item.userid === currentUser?.id
  );

  return (
    <div>
      <h2>일정 후보</h2>

      <div>
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
        />

        <label>
          <input
            type="checkbox"
            checked={newIsAllDay}
            onChange={(e) => setNewIsAllDay(e.target.checked)}
          />
          하루종일
        </label>

        {!newIsAllDay && (
          <>
            <select
              value={newStartTime}
              onChange={(e) => setNewStartTime(e.target.value)}
            >
              <option value="">시작 시간</option>

              {timeSlots.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>

            <select
              value={newEndTime}
              onChange={(e) => setNewEndTime(e.target.value)}
            >
              <option value="">종료 시간</option>

              {timeSlots.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </>
        )}

        <button onClick={handleAddOrUpdateCandidate}>
          {editingCandidateId ? "후보 수정 완료" : "후보 추가"}
        </button>

        {editingCandidateId && (
          <button
            onClick={() => {
              setEditingCandidateId(null);
              setNewDate("");
              setNewStartTime("");
              setNewEndTime("");
              setNewIsAllDay(false);
            }}
          >
            수정 취소
          </button>
        )}
      </div>

      <div
        style={{ overflowX: "auto", maxWidth: "100%" }}
        onMouseLeave={() => {
          setIsDragging(false);
          setDragMode(null);
        }}
        onMouseUp={() => {
          setIsDragging(false);
          setDragMode(null);
        }}
      >
        <table style={{ borderCollapse: "collapse", minWidth: "800px" }}>
          <thead>
            <tr>
              <th style={headerCellStyle}>시간</th>

              {candidates.map((candidate) => (
                <th key={candidate.id} style={headerCellStyle}>
                  <div>{formatDateWithDay(candidate.date)}</div>

                  <div>
                    {candidate.isallday
                      ? "하루종일"
                      : `${candidate.starttime?.slice(0, 5)} ~ ${candidate.endtime?.slice(0, 5)}`}
                  </div>

                  <button onClick={() => handleEditCandidate(candidate)}>
                    수정
                  </button>
                  <button onClick={() => handleDeleteCandidate(candidate.id)}>
                    삭제
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {timeSlots.map((time) => (
              <tr key={time}>
                <td style={timeCellStyle}>{time}</td>

                {candidates.map((candidate) => {
                  const key = getSlotKey(candidate.id, time);
                  const selectable = isTimeSelectable(candidate, time);
                  const isSelected = selectedSlots.some(
                    (slot) => slot.key === key
                  );

                  const slotMembers = getSlotAvailabilities(candidate.id, time);

                  const mySaved = slotMembers.some(
                    (member) => member.userid === currentUser?.id
                  );

                  return (
                    <td
                      key={key}
                      onMouseDown={() => {
                        if (!isSelectMode || !selectable) return;

                        const mode = isSelected ? "remove" : "add";

                        setDragMode(mode);
                        setIsDragging(true);
                        handleSelectSlot(candidate, time, mode);
                      }}
                      onMouseEnter={() => {
                        if (isDragging && dragMode && selectable) {
                          handleSelectSlot(candidate, time, dragMode);
                        }
                      }}
                      onMouseUp={() => {
                        setIsDragging(false);
                        setDragMode(null);
                      }}
                      style={{
                        ...slotCellStyle,
                        backgroundColor: !selectable
                          ? "#f1f1f1"
                          : isSelectMode
                          ? isSelected
                            ? "#dcdcff"
                            : "white"
                          : mySaved
                          ? "#7c79ff"
                          : "white",
                        cursor:
                          isSelectMode && selectable ? "pointer" : "not-allowed",
                      }}
                    >
                      {!isSelectMode && (
                        <div style={{ display: "flex", height: "100%" }}>
                          {slotMembers.map((member) => (
                            <div
                              key={member.id}
                              title={member.nickname}
                              style={{
                                flex: 1,
                                backgroundColor: getMemberColor(member.userid),
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isSelectMode ? (
        <button
          onClick={() => {
            const mySaveSlots = availabilities
              .filter((item) => item.userid === currentUser?.id)
              .map((item) => ({
                key: getSlotKey(item.candidateid, item.starttime.slice(0, 5)),
                candidateId: item.candidateid,
                date: item.date,
                starttime: item.starttime.slice(0, 5),
                endtime: item.endtime.slice(0, 5),
              }));

            setSelectedSlots(mySaveSlots);
            setIsSelectMode(true);
          }}
        >
          {myAvailability ? "내 일정 수정하기" : "내 일정 등록하기"}
        </button>
      ) : (
        <div>
          <button onClick={handleSaveAvailability}>저장하기</button>
          <button
            onClick={() => {
              setSelectedSlots([]);
              setIsSelectMode(false);
            }}
          >
            취소
          </button>
        </div>
      )}

      <h3>멤버 일정 등록 현황</h3>

      {members.map((member) => {
        const isRegistered = availabilities.some(
          (item) => item.userid === member.userid
        );

        const isMe = member.userid === currentUser?.id;

        return (
          <div key={member.id} style={{ display: "flex", gap: "10px" }}>
            <span>👤</span>
            <span>{member.nickname || "닉네임 없음"}</span>
            <span>
              {isRegistered
                ? "등록 완료"
                : isMe
                ? "내 일정 미등록"
                : "일정 등록 안 함"}
            </span>

            {!isRegistered && !isMe && (
              <button onClick={() => handleRequestSchedule(member)}>
                일정 등록 요청
              </button>
            )}
          </div>
        );
      })}

      <button onClick={handleShowAvailableResult}>가능한 시간 보기</button>
    </div>
  );
}

const headerCellStyle = {
  width: "140px",
  height: "55px",
  border: "1px solid #d8d8ff",
  textAlign: "center",
  fontWeight: "bold",
};

const timeCellStyle = {
  width: "80px",
  height: "32px",
  border: "1px solid #d8d8ff",
  textAlign: "center",
};

const slotCellStyle = {
  width: "140px",
  height: "32px",
  border: "1px solid #d8d8ff",
  padding: 0,
};

export default ScheduleTab;