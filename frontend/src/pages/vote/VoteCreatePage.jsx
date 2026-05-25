import { useState, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { createVote } from "../../api/voteApi";

function VoteCreatePage() {
  const { roomid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const selectedSchedules = location.state?.selectedSchedules || [];
  const initialVoteType = location.state?.voteType || "text";
  const initialVotePurpose = location.state?.voteType === "date" ? "schedule" : "general";
  const returnTab = location.state?.returnTab || "vote";

  const [currentUser, setCurrentUser] = useState(null);
  const [nickname, setNickname] = useState("");

  useEffect(() => {
    const fetchUser = async () => {
      console.log("fetchUser 시작");
      const { data: { user } } = await supabase.auth.getUser();
      console.log("user:", user);
      if (!user) return;
      setCurrentUser(user);

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) console.error("프로필 조회 실패:", profileError);
      console.log("profile:", profile);
      setNickname(profile?.nickname || user.email);
    };
    fetchUser();
  }, []);

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

      return option.optiondate !== "" && option.starttime !== "";
    });

    if (validOptions.length === 0) {
      alert("투표 선택지를 1개 이상 입력하세요.");
      return;
    }

    try {
      await createVote({
        roomid: Number(roomid),
        title,
        userid: currentUser?.id,
        nickname,
        options: validOptions,
        ismultiple,
        isanonymous,
        allowaddoption,
        endtime,
        endtimeenabled,
        reminderenabled,
        votetype,
      });

      alert("투표가 생성되었습니다.");
      navigate(`/rooms/${roomid}?tab=vote`);
    } catch (error) {
      console.error("투표 생성 실패:", error);
      alert(error.message || "투표 생성 실패");
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
          style={{ border: "none", background: "none", fontSize: "24px" }}
        >
          ←
        </button>

        <h3 style={{ margin: 0 }}>투표 작성하기</h3>

        <button
          onClick={handleSubmit}
          style={{ border: "none", background: "none", fontSize: "16px" }}
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
              border: currentOptionType === "text"
                ? "2px solid #333"
                : "1px solid #ddd",
            }}
          >
            텍스트
          </button>

          <button
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
              border: currentOptionType === "date"
                ? "2px solid #333"
                : "1px solid #ddd",
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
                  onChange={(e) =>
                    handleChangeOption(index, "optiontext", e.target.value)
                  }
                  placeholder="텍스트 입력"
                  style={{
                    width: "100%",
                    height: "48px",
                    padding: "0 12px",
                    border: "1px solid #ddd",
                  }}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <input
                    type="date"
                    value={option.optiondate}
                    onChange={(e) => handleChangeOption(index, "optiondate", e.target.value)}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#888", whiteSpace: "nowrap" }}>시작</span>
                    <input
                      type="time"
                      value={option.starttime}
                      onChange={(e) => handleChangeOption(index, "starttime", e.target.value)}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#888", whiteSpace: "nowrap" }}>종료</span>
                    <input
                      type="time"
                      value={option.endtime}
                      onChange={(e) => handleChangeOption(index, "endtime", e.target.value)}
                      style={{ flex: 1 }}
                      placeholder="미정"
                    />
                  </div>
                  <p style={{ margin: 0, fontSize: "11px", color: "#bbb" }}>종료시간은 선택사항입니다</p>
                </div>
              )}
            </div>

            <button
              onClick={() => handleDeleteOption(index)}
              style={{ border: "none", background: "none", fontSize: "22px" }}
            >
              ×
            </button>
          </div>
        ))}

        <button
          onClick={handleAddOption}
          style={{
            width: "100%",
            height: "48px",
            fontSize: "28px",
            border: "1px solid #ddd",
            backgroundColor: "#fff",
            marginBottom: "20px",
          }}
        >
          +
        </button>

        <label>
          <input
            type="checkbox"
            checked={ismultiple}
            onChange={(e) => setIsmultiple(e.target.checked)}
          />
          복수 선택
        </label>

        <br />

        <label>
          <input
            type="checkbox"
            checked={isanonymous}
            onChange={(e) => setIsanonymous(e.target.checked)}
          />
          익명 투표
        </label>

        <br />

        <label>
          <input
            type="checkbox"
            checked={allowaddoption}
            onChange={(e) => setAllowaddoption(e.target.checked)}
          />
          선택항목 추가 허용
        </label>

        <hr />

        <label>
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
            }}
          />
        )}

        <br />

        <label>
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