import { useState, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { createVote } from "../../api/voteApi";
import { sendVoteNotification } from "../notification/VoteNotification";


function VoteCreatePage() {
  const { roomid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const selectedSchedules = location.state?.selectedSchedules || [];
  const initialVoteType = location.state?.voteType || "text";
  const initialVotePurpose = location.state?.voteType === "date" ? "schedule" : "general";
  const returnTab = location.state?.returnTab || "vote";

  const [currentUser, setCurrentUser] = useState(null);
  const [roomName, setRoomName] = useState(""); 

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUser(user);
    });

    // 📡 방 정보 바인딩용 조회 로직
    const fetchRoomName = async () => {
      if (!roomid) return;
      const { data, error } = await supabase
        .from("rooms")
        .select("roomname")
        .eq("id", Number(roomid))
        .single();
      
      if (error) {
        console.warn("방 이름 조회 실패:", error);
        setRoomName("참여 중인 방");
        return;
      }
      
      if (data) {
        setRoomName(data.roomname);
      }
    };

    fetchRoomName();
  }, [roomid]);

  const [title, setTitle] = useState("");

  const [options, setOptions] = useState(() => {
    if (selectedSchedules.length > 0) {
      return selectedSchedules.map((schedule) => ({
        optiontype: "date",
        optiontext: "",
        optiondate: schedule.date,
        starttime: schedule.starttime,
        endtime: schedule.endtime,
        availablecount: schedule.availableCount || 0,
      }));
    }

    return [
      {
        optiontype: initialVoteType,
        optiontext: "",
        optiondate: "",
        starttime: "",
        endtime: "",
        availablecount: 0,
      },
    ];
  });

  const currentOptionType = options[0]?.optiontype || "text";

  const [votetype, setVotetype] = useState(initialVotePurpose);

  const handleVotetypeChange = (newType) => {
    setVotetype(newType);
    if (newType === "schedule") {
      setOptions((prev) => prev.map((o) => ({ ...o, optiontype: "date", optiontext: "" })));
    } else if (newType === "location" || newType === "general") {
      setOptions((prev) => prev.map((o) => ({ ...o, optiontype: "text", optiondate: "", starttime: "", endtime: "" })));
    }
  };
  const [ismultiple, setIsmultiple] = useState(false);
  const [isanonymous, setIsanonymous] = useState(false);
  const [allowaddoption, setAllowaddoption] = useState(false);
  const [endtimeenabled, setEndtimeenabled] = useState(false);
  const [endtime, setEndtime] = useState("");
  const [reminderenabled, setReminderenabled] = useState(false);

  const handleChangeOption = (index, field, value) => {
    const newOptions = [...options];
    newOptions[index][field] = value;
    setOptions(newOptions);
  };

  const handleAddOption = () => {
    const currentType = options[0]?.optiontype || "text";

    setOptions([
      ...options,
      {
        optiontype: currentType,
        optiontext: "",
        optiondate: "",
        starttime: "",
        endtime: "",
        availablecount: 0,
      },
    ]);
  };

  const handleDeleteOption = (index) => {
    setOptions(options.filter((_, i) => i !== index));
  };

  // 📝 투표 완료 버튼 클릭 시 실행되는 함수
  const handleSubmit = async () => {
    if (!currentUser) {
      alert("로그인이 필요합니다.");
      return;
    }

    if (title.trim() === "") {
      alert("투표 제목을 입력하세요.");
      return;
    }

    const validOptions = options.filter((option) => {
      if (option.optiontype === "text") {
        return option.optiontext.trim() !== "";
      }
      return option.optiondate !== "" && option.starttime !== "" && option.endtime !== "";
    });

    if (validOptions.length === 0) {
      alert("투표 선택지를 1개 이상 입력하세요.");
      return;
    }

    let isCreateVoteSuccess = false;
    let createdVoteId = null; // 🎯 [에러 완벽 박멸] 생성된 투표 ID를 가둘 주머니 안전하게 선언!

    try {
      // 1. 오리지널 투표 생성 API 호출 (종료시간 공백 에러 완벽 대처 완료!)
      const result = await createVote({
        roomid: Number(roomid),
        title,
        userid: currentUser?.id,
        nickname: currentUser?.user_metadata?.nickname || currentUser?.email,
        options: validOptions,
        ismultiple,
        isanonymous,
        allowaddoption,
        endtime: endtimeenabled && endtime ? endtime : null, 
        endtimeenabled,
        reminderenabled,
        votetype,
      });

      // 🎯 [링크 생성용 ID 추출] 서버가 던져준 고유 투표 일련번호 가로채기
      createdVoteId = result?.id || result?.data?.id || null;
      isCreateVoteSuccess = true;

    } catch (error) {
      console.error("투표 생성 자체 실패:", error);
      alert(error.message || "투표 생성 실패");
      return; 
    }

    // 🚀 [시동 버튼 작동] 투표 생성이 확인되면 분리된 알림 모듈로 연료를 주입하고 가동시킵니다!
    if (isCreateVoteSuccess) {
      await sendVoteNotification({
        roomid,
        title,
        createdVoteId, // 파라미터로 넘겨주어 상세페이지 점프 링크 확보!
        currentUser,
        roomName,
        endtimeenabled,
        reminderenabled,
        endtime
      });
    }

    // 3. 🎉 최종 완료 안내 및 탭 이동
    if (isCreateVoteSuccess) {
      alert("투표가 성공적으로 생성되었습니다.");
      navigate(`/rooms/${roomid}?tab=vote`);
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
          onClick={() => navigate(`/rooms/${roomid}?tab=${returnTab}`)}
          style={{ border: "none", background: "none", fontSize: "24px", cursor: "pointer" }}
        >
          ←
        </button>

        <h3 style={{ margin: 0 }}>투표 작성하기</h3>

        <button
          onClick={handleSubmit}
          style={{ border: "none", background: "none", fontSize: "16px", cursor: "pointer", fontWeight: "bold" }}
        >
          완료
        </button>
      </div>

      <div style={{ padding: "20px" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="투표 제목"
          style={{
            width: "100%",
            height: "52px",
            padding: "0 12px",
            fontSize: "18px",
            border: "1px solid #ddd",
            marginBottom: "16px",
            boxSizing: "border-box",
          }}
        />

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          {[
            { value: "general", label: "일반 투표" },
            { value: "schedule", label: "일정 확정" },
            { value: "location", label: "위치 확정" },
          ].map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => handleVotetypeChange(type.value)}
              style={{
                padding: "8px 16px",
                borderRadius: "24px",
                border: votetype === type.value ? "2px solid #7c79ff" : "1px solid #ddd",
                backgroundColor: votetype === type.value ? "#f0f0ff" : "#fff",
                color: votetype === type.value ? "#7c79ff" : "#333",
                fontWeight: votetype === type.value ? "bold" : "normal",
                cursor: "pointer",
              }}
            >
              {type.label}
            </button>
          ))}
        </div>

        {votetype === "general" && (
          <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
            <button
              type="button"
              onClick={() => {
                const updated = options.map((option) => ({
                  ...option,
                  optiontype: "text",
                  optiontext: option.optiontext || "",
                  optiondate: "",
                  starttime: "",
                  endtime: "",
                }));

                setOptions(updated);
              }}
              style={{
                padding: "10px 22px",
                borderRadius: "24px",
                cursor: "pointer",
                border: currentOptionType === "text" ? "2px solid #333" : "1px solid #ddd",
                fontWeight: currentOptionType === "text" ? "bold" : "normal",
              }}
            >
              텍스트
            </button>

            <button
              type="button"
              onClick={() => {
                const updated = options.map((option) => ({
                  ...option,
                  optiontype: "date",
                  optiontext: "",
                  optiondate: option.optiondate || "",
                  starttime: option.starttime || "",
                  endtime: option.endtime || "",
                }));

                setOptions(updated);
              }}
              style={{
                padding: "10px 22px",
                borderRadius: "24px",
                cursor: "pointer",
                border: currentOptionType === "date" ? "2px solid #333" : "1px solid #ddd",
                fontWeight: currentOptionType === "date" ? "bold" : "normal",
              }}
            >
              날짜
            </button>
          </div>
        )}

        {options.map((option, index) => (
          <div
            key={index}
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              marginBottom: "10px",
            }}
          >
            <div style={{ flex: 1 }}>
              {option.optiontype === "text" ? (
                <input
                  value={option.optiontext}
                  onChange={(e) => handleChangeOption(index, "optiontext", e.target.value)}
                  placeholder="텍스트 입력"
                  style={{
                    width: "100%",
                    height: "48px",
                    padding: "0 12px",
                    border: "1px solid #ddd",
                    boxSizing: "border-box",
                  }}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <input
                    type="date"
                    value={option.optiondate}
                    onChange={(e) => handleChangeOption(index, "optiondate", e.target.value)}
                    style={{ height: "36px", padding: "0 8px", border: "1px solid #ddd" }}
                  />
                  <input
                    type="time"
                    value={option.starttime}
                    onChange={(e) => handleChangeOption(index, "starttime", e.target.value)}
                    style={{ height: "36px", padding: "0 8px", border: "1px solid #ddd" }}
                  />
                  <input
                    type="time"
                    value={option.endtime}
                    onChange={(e) => handleChangeOption(index, "endtime", e.target.value)}
                    style={{ height: "36px", padding: "0 8px", border: "1px solid #ddd" }}
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleDeleteOption(index)}
              style={{ border: "none", background: "none", fontSize: "22px", cursor: "pointer", color: "#888" }}
            >
              ×
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={handleAddOption}
          style={{
            width: "100%",
            height: "48px",
            fontSize: "28px",
            border: "1px solid #ddd",
            backgroundColor: "#fff",
            marginBottom: "20px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          +
        </button>

        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={ismultiple}
            onChange={(e) => setIsmultiple(e.target.checked)}
          />
          복수 선택
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isanonymous}
            onChange={(e) => setIsanonymous(e.target.checked)}
          />
          익명 투표
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={allowaddoption}
            onChange={(e) => setAllowaddoption(e.target.checked)}
          />
          선택항목 추가 허용
        </label>

        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "16px 0" }} />

        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={endtimeenabled}
            onChange={(e) => setEndtimeenabled(e.target.checked)}
          />
          투표 종료시간 설정
        </label>

        {endtimeenabled && (
          <input
            type="datetime-local"
            value={endtime}
            onChange={(e) => setEndtime(e.target.value)}
            style={{
              display: "block",
              marginTop: "10px",
              width: "100%",
              height: "42px",
              padding: "0 8px",
              border: "1px solid #ddd",
              boxSizing: "border-box",
            }}
          />
        )}

        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={reminderenabled}
            onChange={(e) => setReminderenabled(e.target.checked)}
          />
          종료 30분 전 알림
        </label>
      </div>
    </div>
  );
}

export default VoteCreatePage;