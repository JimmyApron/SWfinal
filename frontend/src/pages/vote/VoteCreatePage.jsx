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

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUser(user);
    });
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

    // 🔥 [핵심 타격 구조] 투표 생성 자체는 무조건 성공해야 하므로 변수를 바깥으로 뺍니다.
    let isCreateVoteSuccess = false;

    try {
      // 1. 기존 오리지널 투표 생성 API 호출 (이것부터 확실하게 성공시킵니다)
      await createVote({
        roomid: Number(roomid),
        title,
        userid: currentUser?.id,
        nickname: currentUser?.user_metadata?.nickname || currentUser?.email,
        options: validOptions,
        ismultiple,
        isanonymous,
        allowaddoption,
        endtime,
        endtimeenabled,
        reminderenabled,
        votetype,
      });

      // 여기까지 통과하면 DB에 투표는 안전하게 들어간 것입니다!
      isCreateVoteSuccess = true;

    } catch (error) {
      console.error("투표 생성 자체 실패:", error);
      alert(error.message || "투표 생성 실패");
      return; // 투표 작성이 아예 실패했다면 여기서 중단합니다.
    }

    // 2. ⏰ [보호막 가동] 알림 적재 기능은 별도의 try-catch로 감싸서, 여기서 에러가 나더라도 투표 생성 완료를 방해하지 못하게 막습니다!
    try {
      if (endtimeenabled && reminderenabled && endtime) {
        // 타임존 오차 보정 결합
        const formattedEndTime = endtime.includes("Z") || endtime.includes("+") 
          ? endtime 
          : `${endtime}:00+09:00`;

        const now = new Date();
        const end = new Date(formattedEndTime);
        const diffInMinutes = (end.getTime() - now.getTime()) / (1000 * 60);

        console.log("⏱️ 디버깅 - 남은 마감 시간(분):", diffInMinutes);

        if (diffInMinutes > 0 && diffInMinutes <= 30) {
          
          // 🟢 [회원 조회] 테이블명이나 컬럼명이 달라서 생기는 에러 방어
          const { data: activeMembers, error: memberFetchError } = await supabase
            .from("room_members")
            .select("userid")
            .eq("roomid", Number(roomid))
            .eq("votenotifenabled", true); // ⚠️ 혹시 이 컬럼이 DB에 없다면 에러가 날 수 있음

          if (memberFetchError) {
            console.warn("방 멤버 알림 상태 조회 실패 (DB 컬럼 확인 필요):", memberFetchError);
          } else if (activeMembers && activeMembers.length > 0) {
            const memberNotifications = activeMembers.map((member) => ({
              roomid: Number(roomid),
              receiverid: member.userid, 
              senderid: currentUser?.id,
              type: "vote_reminder",     
              title: "🗳️ 투표 마감 임박",  
              message: `⚠️ [마감 임박] 방금 생성된 [${title}] 투표의 마감 시간이 ${Math.max(1, Math.round(diffInMinutes))}분 남았습니다! 서둘러 참여해 주세요!`,
              isread: false,
            }));

            await supabase.from("notifications").insert(memberNotifications);
          }

          // 🟡 [게스트 조회] 에러 방어
          const { data: activeGuests, error: guestFetchError } = await supabase
            .from("room_guests")
            .select("id")
            .eq("roomid", Number(roomid))
            .eq("votenotifenabled", true);

          if (guestFetchError) {
            console.warn("방 게스트 알림 상태 조회 실패 (DB 컬럼 확인 필요):", guestFetchError);
          } else if (activeGuests && activeGuests.length > 0) {
            const guestNotifications = activeGuests.map((guest) => ({
              guestid: guest.id,
              roomid: Number(roomid),
              message: `⚠️ [마감 임박] 방금 생성된 [${title}] 투표의 마감 시간이 ${Math.max(1, Math.round(diffInMinutes))}분 남았습니다!`,
            }));

            await supabase.from("guest_notifications").insert(guestNotifications);
          }
        }
      }
    } catch (notificationError) {
      // 🛡️ 알림 기능에서 컬럼 매칭 오류가 나더라도, 조용히 로그만 찍고 투표 성공 단계로 넘겨버립니다!
      console.error("⚠️ 임박 알림 로직 실행 중 에러가 발생했으나 투표 생성을 지속합니다:", notificationError);
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