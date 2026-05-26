import { useState, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { createVote } from "../../api/voteApi";

function VoteCreatePage() {
  const { roomid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const selectedSchedules = location.state?.selectedSchedules || [];
  const selectedPlaces = location.state?.selectedPlaces || [];

  const initialVoteType = location.state?.voteType || "text";

  const initialVotePurpose =
    location.state?.votePurpose ||
    location.state?.votetype ||
    (location.state?.voteType === "date" ? "schedule" : "general");

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

  const [title, setTitle] = useState(location.state?.title || "");

  const [options, setOptions] = useState(() => {
    if (selectedPlaces.length > 0) {
      return selectedPlaces.map((place) => ({
        optiontype: "place",
        optiontext: place.name || "",
        optiondate: "",
        starttime: "",
        endtime: "",
        availablecount: 0,

        placename: place.name || "",
        placeaddress: place.address || "",
        placelat: place.lat ?? "",
        placelng: place.lng ?? "",
        kakaomapurl: place.kakaoMapUrl || place.kakaomapurl || "",
      }));
    }

    if (selectedSchedules.length > 0) {
      return selectedSchedules.map((schedule) => ({
        optiontype: "date",
        optiontext: "",
        optiondate: schedule.date,
        starttime: schedule.starttime,
        endtime: schedule.endtime,
        availablecount: schedule.availableCount || 0,

        placename: "",
        placeaddress: "",
        placelat: "",
        placelng: "",
        kakaomapurl: "",
      }));
    }

    return [makeEmptyOption(initialVoteType)];
  });

  const currentOptionType = options[0]?.optiontype || "text";

  const [votetype, setVotetype] = useState(
    selectedPlaces.length > 0 ? "location" : initialVotePurpose
  );

  const [ismultiple, setIsmultiple] = useState(false);
  const [isanonymous, setIsanonymous] = useState(false);
  const [allowaddoption, setAllowaddoption] = useState(false);
  const [endtimeenabled, setEndtimeenabled] = useState(false);
  const [endtime, setEndtime] = useState("");
  const [reminderenabled, setReminderenabled] = useState(false);

  const handleVotetypeChange = (newType) => {
    setVotetype(newType);

    if (newType === "schedule") {
      setOptions((prev) =>
        prev.map((option) => ({
          ...makeEmptyOption("date"),
          optiontype: "date",
          optiondate: option.optiondate || "",
          starttime: option.starttime || "",
          endtime: option.endtime || "",
          availablecount: option.availablecount || 0,
        }))
      );
      return;
    }

    if (newType === "location") {
      setOptions((prev) =>
        prev.map((option) => ({
          ...makeEmptyOption("place"),
          optiontype: "place",
          optiontext: option.placename || option.optiontext || "",
          placename: option.placename || option.optiontext || "",
          placeaddress: option.placeaddress || "",
          placelat: option.placelat || "",
          placelng: option.placelng || "",
          kakaomapurl: option.kakaomapurl || "",
        }))
      );
      return;
    }

    setOptions((prev) =>
      prev.map((option) => ({
        ...makeEmptyOption("text"),
        optiontype: "text",
        optiontext: option.optiontext || option.placename || "",
      }))
    );
  };

  const handleChangeOption = (index, field, value) => {
    const newOptions = [...options];

    newOptions[index][field] = value;

    if (field === "placename") {
      newOptions[index].optiontext = value;
    }

    if (field === "optiontext" && newOptions[index].optiontype === "place") {
      newOptions[index].placename = value;
    }

    setOptions(newOptions);
  };

  const handleAddOption = () => {
    const currentType = options[0]?.optiontype || "text";

    setOptions([...options, makeEmptyOption(currentType)]);
  };

  const handleDeleteOption = (index) => {
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!currentUser) {
      alert("로그인이 필요합니다.");
      return;
    }

    if (!roomid) {
      alert("방 정보를 찾을 수 없습니다.");
      return;
    }

    if (title.trim() === "") {
      alert("투표 제목을 입력하세요.");
      return;
    }

    const validOptions = options.filter((option) => {
      if (option.optiontype === "text") {
        return String(option.optiontext || "").trim() !== "";
      }

      if (option.optiontype === "place") {
        return (
          String(option.placename || option.optiontext || "").trim() !== "" &&
          option.placelat !== "" &&
          option.placelng !== ""
        );
      }

      if (option.optiontype === "date") {
        return option.optiondate !== "" && option.starttime !== "";
      }

      return false;
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
            boxSizing: "border-box",
          }}
        />

        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          {[
            { value: "general", label: "일반 투표" },
            { value: "schedule", label: "일정 확정" },
            { value: "location", label: "중간장소 확정" },
          ].map((type) => (
            <button
              key={type.value}
              onClick={() => handleVotetypeChange(type.value)}
              style={{
                padding: "8px 16px",
                borderRadius: "24px",
                border:
                  votetype === type.value
                    ? "2px solid #7c79ff"
                    : "1px solid #ddd",
                backgroundColor:
                  votetype === type.value ? "#f0f0ff" : "#fff",
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
                  ...makeEmptyOption("text"),
                  optiontype: "text",
                  optiontext: option.optiontext || option.placename || "",
                }));

                setOptions(updated);
              }}
              style={{
                padding: "10px 22px",
                borderRadius: "24px",
                border:
                  currentOptionType === "text"
                    ? "2px solid #333"
                    : "1px solid #ddd",
              }}
            >
              텍스트
            </button>

            <button
              onClick={() => {
                const updated = options.map((option) => ({
                  ...makeEmptyOption("date"),
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
                border:
                  currentOptionType === "date"
                    ? "2px solid #333"
                    : "1px solid #ddd",
              }}
            >
              날짜
            </button>
          </div>
        )}

        {selectedPlaces.length > 0 && votetype === "location" && (
          <p
            style={{
              padding: "10px",
              border: "1px solid #eee",
              borderRadius: "8px",
              backgroundColor: "#fafafa",
              fontSize: "14px",
              color: "#555",
              marginBottom: "16px",
            }}
          >
            위치 탭에서 선택한 중간장소 후보들이 투표 항목으로 추가되었습니다.
          </p>
        )}

        {options.map((option, index) => (
          <div
            key={index}
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "flex-start",
              marginBottom: "10px",
            }}
          >
            <div style={{ flex: 1 }}>
              {option.optiontype === "text" && (
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
                    boxSizing: "border-box",
                  }}
                />
              )}

              {option.optiontype === "date" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
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

              {option.optiontype === "place" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    padding: "10px",
                    border: "1px solid #eee",
                    borderRadius: "8px",
                    backgroundColor: "#fafafa",
                  }}
                >
                  <input
                    value={option.placename}
                    onChange={(e) =>
                      handleChangeOption(index, "placename", e.target.value)
                    }
                    placeholder="장소명"
                    style={inputStyle}
                  />

                  <input
                    value={option.placeaddress}
                    onChange={(e) =>
                      handleChangeOption(
                        index,
                        "placeaddress",
                        e.target.value
                      )
                    }
                    placeholder="주소"
                    style={inputStyle}
                  />

                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      value={option.placelat}
                      onChange={(e) =>
                        handleChangeOption(index, "placelat", e.target.value)
                      }
                      placeholder="위도"
                      style={inputStyle}
                    />

                    <input
                      value={option.placelng}
                      onChange={(e) =>
                        handleChangeOption(index, "placelng", e.target.value)
                      }
                      placeholder="경도"
                      style={inputStyle}
                    />
                  </div>

                  <input
                    value={option.kakaomapurl}
                    onChange={(e) =>
                      handleChangeOption(index, "kakaomapurl", e.target.value)
                    }
                    placeholder="카카오맵 URL 선택 입력"
                    style={inputStyle}
                  />
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

function makeEmptyOption(optiontype) {
  return {
    optiontype,
    optiontext: "",
    optiondate: "",
    starttime: "",
    endtime: "",
    availablecount: 0,

    placename: "",
    placeaddress: "",
    placelat: "",
    placelng: "",
    kakaomapurl: "",
  };
}

const inputStyle = {
  width: "100%",
  height: "42px",
  padding: "0 12px",
  border: "1px solid #ddd",
  borderRadius: "6px",
  boxSizing: "border-box",
};

export default VoteCreatePage;