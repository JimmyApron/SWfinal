import { useState } from "react";
import { createRoom } from "../api/roomApi";
import DatePicker from "react-multi-date-picker";

function RoomCreatePage() {
  const [roomName, setRoomName] = useState("");
  const [description, setDescription] = useState("");
  const [createdRoom, setCreatedRoom] = useState(null);

  const [candidateDates, setCandidateDates] = useState([]);
  const [candidateStartTime, setCandidateStartTime] = useState("");
  const [candidateEndTime, setCandidateEndTime] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [candidates, setCandidates] = useState([]);

  const handleAddCandidate = () => {
    if (candidateDates.length === 0) {
      alert("후보 날짜를 1개 이상 선택하세요.");
      return;
    }

    if (!isAllDay && (candidateStartTime === "" || candidateEndTime === "")) {
      alert("시작 시간과 종료 시간을 입력하세요.");
      return;
    }

    const newCandidates = candidateDates.map((date) => {
      const formattedDate =
        typeof date === "string"
          ? date
          : date.format("YYYY-MM-DD");

      return {
        date: formattedDate,
        startTime: candidateStartTime,
        endTime: candidateEndTime,
        isAllDay,
      };
    });

    console.log("추가되는 후보:", newCandidates);

    setCandidates([...candidates, ...newCandidates]);

    setCandidateDates([]);
    setCandidateStartTime("");
    setCandidateEndTime("");
    setIsAllDay(false);
  };

  const handleCreateRoom = async () => {
    if (roomName.trim() === "") {
      alert("방 이름을 입력하세요.");
      return;
    }

    if (candidates.length === 0) {
      alert("약속 후보 날짜를 1개 이상 추가하세요.");
      return;
    }

    try {
      const result = await createRoom({
        roomName,
        description,
        userId: "test-user-1",
        candidates,
      });

      setCreatedRoom(result.room);
      alert("방이 생성되었습니다.");
    } catch (error) {
      alert("방 생성 실패");
      console.error(error);
    }
  };

  const handleCopyInviteCode = async () => {
    try {
      await navigator.clipboard.writeText(createdRoom.invitecode);
      alert("초대코드가 복사되었습니다.");
    } catch (error) {
      alert("복사에 실패했습니다.");
      console.error(error);
    }
  };

  const handleGoRoom = () => {
    alert("방 상세 페이지는 다음 브랜치에서 구현 예정입니다.");
  };

  return (
    <div>
      <h1>방 생성</h1>

      <input
        type="text"
        placeholder="방 이름"
        value={roomName}
        onChange={(e) => setRoomName(e.target.value)}
      />

      <textarea
        placeholder="방 설명"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <h2>약속 후보 날짜 추가</h2>

      <DatePicker
        multiple
        value={candidateDates}
        onChange={setCandidateDates}
        format="YYYY-MM-DD"
        placeholder="후보 날짜 여러 개 선택"
      />

      <label>
        <input
          type="checkbox"
          checked={isAllDay}
          onChange={(e) => setIsAllDay(e.target.checked)}
        />
        하루종일 가능
      </label>

      {!isAllDay && (
        <div>
          <input
            type="time"
            value={candidateStartTime}
            onChange={(e) => setCandidateStartTime(e.target.value)}
          />

          <input
            type="time"
            value={candidateEndTime}
            onChange={(e) => setCandidateEndTime(e.target.value)}
          />
        </div>
      )}

      <button onClick={handleAddCandidate}>후보 추가</button>

      <h3>추가된 후보</h3>

      {candidates.map((candidate, index) => (
        <div key={index}>
          {candidate.date}{" "}
          {candidate.isAllDay
            ? "하루종일"
            : `${candidate.startTime} ~ ${candidate.endTime}`}
        </div>
      ))}

      <button onClick={handleCreateRoom}>방 만들기</button>

      {createdRoom && (
        <div>
          <h2>생성된 방</h2>
          <p>방 이름: {createdRoom.roomname}</p>
          <p>설명: {createdRoom.description}</p>
          <p>초대코드: {createdRoom.invitecode}</p>

          <button onClick={handleCopyInviteCode}>초대코드 복사하기</button>

          <button onClick={handleGoRoom}>생성된 방으로 바로가기</button>
        </div>
      )}
    </div>
  );
}

export default RoomCreatePage;

//import { useState } from "react";
// import { createRoom } from "../api/roomApi";

// function RoomCreatePage() {
//   const [roomName, setRoomName] = useState("");
//   const [description, setDescription] = useState("");
//   const [createdRoom, setCreatedRoom] = useState(null);

//   const handleCreateRoom = async () => {
//     if (roomName.trim() === "") {
//       alert("방 이름을 입력하세요.");
//       return;
//     }

//     try {
//       const result = await createRoom({
//         roomName,
//         description,
//         userId: "test-user-1"
//       });

//       setCreatedRoom(result.room);
//       alert("방이 생성되었습니다.");
//     } catch (error) {
//       alert("방 생성 실패");
//       console.error(error);
//     }
//   };

//   const handleCopyInviteCode = async () => {
//     try {
//       await navigator.clipboard.writeText(createdRoom.invitecode);
//       alert("초대코드가 복사되었습니다.");
//     } catch (error) {
//       alert("복사에 실패했습니다.");
//       console.error(error);
//     }
//   };

//   const handleGoRoom = () => {
//     alert("방 상세 페이지는 다음 브랜치에서 구현 예정입니다.");
//   };
//   //const handleGoRoom = () => {
//   //window.location.href = `/rooms/${createdRoom.id}`;
//   //}; 방페이지 생성 후 연결
//   return (
//     <div>
//       <h1>방 생성</h1>

//       <input
//         type="text"
//         placeholder="방 이름"
//         value={roomName}
//         onChange={(e) => setRoomName(e.target.value)}
//       />

//       <textarea
//         placeholder="방 설명"
//         value={description}
//         onChange={(e) => setDescription(e.target.value)}
//       />

//       <button onClick={handleCreateRoom}>방 만들기</button>

//       {createdRoom && (
//         <div>
//           <h2>생성된 방</h2>
//           <p>방 이름: {createdRoom.roomname}</p>
//           <p>설명: {createdRoom.description}</p>
//           <p>초대코드: {createdRoom.invitecode}</p>

//           <button onClick={handleCopyInviteCode}>
//             초대코드 복사하기
//           </button>

//           <button onClick={handleGoRoom}>
//             생성된 방으로 바로가기
//           </button>
//         </div>
//       )}
//     </div>
//   );
// }

// export default RoomCreatePage;