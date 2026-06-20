import { useState, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { createVote } from "../../api/voteApi";
import { sendVoteNotification } from "../notification/VoteNotification";
import LocationPicker from "../../components/map/LocationPicker";
import { getMemberAvailabilities, getScheduleCandidates } from "../../api/scheduleApi";
import { getTopAvailableTimes, sortAvailableTimes, getTopConsecutiveDays } from "../../utils/scheduleUtils";

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

  const returnTab = location.state?.returnTab || 'vote';
  const locationKind = location.state?.locationKind || null;
  const fromScheduleId = location.state?.fromScheduleId || (() => {
    try {
      const s = sessionStorage.getItem("confirmFromSchedule");
      return s ? JSON.parse(s).id : null;
    } catch { return null; }
  })();
  const scheduleId = location.state?.scheduleId || null;
  const scheduleTitle = location.state?.scheduleTitle || '';

  const [currentUser, setCurrentUser] = useState(null);
  const [showAvailModal, setShowAvailModal] = useState(false);
  const [availabilities, setAvailabilities] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedAvailSlots, setSelectedAvailSlots] = useState([]);
  const [availMode, setAvailMode] = useState("당일");
  const [availNDays, setAvailNDays] = useState(2);
  const [selectedMultiDays, setSelectedMultiDays] = useState([]);
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("");

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setCurrentUser(user);
        const { data: profile } = await supabase
          .from("profiles")
          .select("nickname")
          .eq("id", user.id)
          .maybeSingle();
        setNickname(profile?.nickname || user.email);
      } else {
        const guestId = localStorage.getItem("guest_id");
        const guestNick = localStorage.getItem("guest_nickname") || "게스트";
        if (guestId) {
          setCurrentUser({ id: guestId, type: "guest" });
          setNickname(guestNick);
        }
      }
    };

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

      setRoomName(data?.roomname || "참여 중인 방");
    };

    fetchUser();
    fetchRoomName();
  }, [roomid]);

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
        travelresults: place.travelResults || place.travelresults || null,
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

  const [votetype, setVotetype] = useState(initialVotePurpose);

  const [ismultiple, setIsmultiple] = useState(false);
  const [isanonymous, setIsanonymous] = useState(false);
  const [allowaddoption, setAllowaddoption] = useState(false);
  const [endtimeenabled, setEndtimeenabled] = useState(false);
  const [endtime, setEndtime] = useState("");
  const [reminderenabled, setReminderenabled] = useState(false);
  const [openPlacePickerIndex, setOpenPlacePickerIndex] = useState(null);

  const handleVotetypeChange = (newType) => {
    setVotetype(newType);

    if (newType === "schedule") {
      setOptions((prev) =>
        prev.map((option) => ({
          ...makeEmptyOption("date"),
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
          optiontext: option.placename || option.optiontext || "",
          placename: option.placename || option.optiontext || "",
          placeaddress: option.placeaddress || "",
          placelat: option.placelat || "",
          placelng: option.placelng || "",
          kakaomapurl: option.kakaomapurl || "",
          travelresults: option.travelresults || null,
        }))
      );
      return;
    }

    setOptions((prev) =>
      prev.map((option) => ({
        ...makeEmptyOption("text"),
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

  const handleSelectPlaceOption = (index, name, address, place = {}) => {
    const newOptions = [...options];

    newOptions[index] = {
      ...newOptions[index],
      optiontext: name || "",
      placename: name || "",
      placeaddress: address || "",
      placelat: place.lat ?? "",
      placelng: place.lng ?? "",
      kakaomapurl: place.kakaoMapUrl || place.kakaomapurl || "",
      travelresults: null,
    };

    setOptions(newOptions);
    setOpenPlacePickerIndex(null);
  };

  const handleLoadAvailabilities = async () => {
    try {
      const [avail, cands] = await Promise.all([
        getMemberAvailabilities(roomid),
        getScheduleCandidates(roomid),
      ]);
      setAvailabilities(avail);
      setCandidates(cands);
      setSelectedAvailSlots([]);
      setSelectedMultiDays([]);
      setAvailMode("당일");
      setAvailNDays(2);
      setShowAvailModal(true);
    } catch {
      alert("가능 시간 불러오기 실패");
    }
  };

  const handleAddAvailSlotsAsOptions = () => {
    let newOpts = [];

    if (availMode === "당일") {
      newOpts = selectedAvailSlots.map((slot) => ({
        optiontype: "date",
        optiontext: "",
        optiondate: slot.date,
        starttime: slot.starttime,
        endtime: slot.endtime,
        isallday: false,
        availablecount: slot.availableCount || 0,
        placename: "", placeaddress: "", placelat: "", placelng: "", kakaomapurl: "",
      }));
    } else {
      newOpts = selectedMultiDays.flatMap((r) =>
        r.dates.map((date) => ({
          optiontype: "date",
          optiontext: "",
          optiondate: date,
          starttime: null,
          endtime: null,
          isallday: true,
          availablecount: r.availableCount || 0,
          placename: "", placeaddress: "", placelat: "", placelng: "", kakaomapurl: "",
        }))
      );
    }

    const existingKeys = new Set(
      options.filter((o) => o.optiondate).map((o) => `${o.optiondate}|${o.starttime || ""}`)
    );
    const filtered = newOpts.filter(
      (o) => !existingKeys.has(`${o.optiondate}|${o.starttime || ""}`)
    );
    setOptions((prev) => {
      const base = prev.filter((o) => o.optiondate || o.optiontext);
      return [...base, ...filtered];
    });
    setShowAvailModal(false);
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

    if (isLocationVoteType(votetype)) {
      if (locationKind && !scheduleId) {
        alert("장소 투표를 저장할 대상 일정이 없습니다.");
        return;
      }

      const invalidPlaceOption = options.some((option) => {
        if (option.optiontype !== "place") return false;

        return (
          !String(option.placename || option.optiontext || "").trim() ||
          !hasValue(option.placelat) ||
          !hasValue(option.placelng)
        );
      });

      if (invalidPlaceOption) {
        alert("선택지 장소를 카카오맵에서 선택해주세요.");
        return;
      }
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
        return option.optiondate !== "" && (option.isallday || option.starttime !== "");
      }

      return false;
    });

    if (validOptions.length === 0) {
      alert("투표 선택지를 1개 이상 입력하세요.");
      return;
    }

    let createdVoteId = null;

    try {
      const result = await createVote({
        roomid: Number(roomid),
        title,
        userid: currentUser.id,
        nickname,
        options: validOptions,
        ismultiple,
        isanonymous,
        allowaddoption,
        endtime: endtimeenabled && endtime ? endtime : null,
        endtimeenabled,
        reminderenabled,
        votetype,
        locationkind: votetype === 'location' ? locationKind : null,
        scheduleid: isLocationVoteType(votetype) ? scheduleId : (fromScheduleId || null),
      });

      createdVoteId = result?.id || result?.data?.id || null;
    } catch (error) {
      console.error("투표 생성 자체 실패:", error);
      alert(error.message || "투표 생성 실패");
      return;
    }

    // 기존 확정일정에서 진입한 경우 → 확정일정의 voteid를 새 투표로 연결
    if (fromScheduleId && createdVoteId) {
      await supabase
        .from("confirmed_schedules")
        .update({ voteid: createdVoteId })
        .eq("id", fromScheduleId);
      sessionStorage.removeItem("confirmFromSchedule");
    }

    await sendVoteNotification({
      roomid,
      title,
      createdVoteId,
      currentUser,
      roomName,
      endtimeenabled,
      reminderenabled,
      endtime,
      votetype,
    });

    alert("투표가 성공적으로 생성되었습니다.");
    navigate(`/rooms/${roomid}?tab=vote`);
  };

  const availTopTimes = sortAvailableTimes(getTopAvailableTimes(availabilities), "count");
  const availConsecutive = getTopConsecutiveDays(availabilities, candidates, availNDays);

  const makeAvailKey = (t) => `${t.date}_${t.starttime}_${t.endtime}`;
  const makeMultiKey = (r) => r.dates.join("_");

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${dateStr} (${days[d.getDay()]})`;
  };

  const availSelectedCount = availMode === "당일" ? selectedAvailSlots.length : selectedMultiDays.length;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff" }}>
      {showAvailModal && (
        <>
          <div
            onClick={() => setShowAvailModal(false)}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 300 }}
          />
          <div
            style={{
              position: "fixed",
              bottom: 0, left: 0, right: 0,
              backgroundColor: "#fff",
              borderRadius: "20px 20px 0 0",
              padding: "0 0 80px",
              zIndex: 301,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* 헤더 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 20px 0" }}>
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>가능 시간 선택</span>
              <button onClick={() => setShowAvailModal(false)} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", color: "#aaa" }}>✕</button>
            </div>

            {/* 당일 / 일별 탭 */}
            <div style={{ display: "flex", borderBottom: "1px solid #eee", margin: "12px 0 0" }}>
              {["당일", "일별"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setAvailMode(tab); setSelectedAvailSlots([]); setSelectedMultiDays([]); }}
                  style={{
                    flex: 1, padding: "10px", border: "none",
                    borderBottom: availMode === tab ? "2px solid #7c79ff" : "2px solid transparent",
                    backgroundColor: "transparent",
                    color: availMode === tab ? "#7c79ff" : "#888",
                    fontWeight: availMode === tab ? "bold" : "normal",
                    fontSize: "15px", cursor: "pointer",
                  }}
                >{tab}</button>
              ))}
            </div>

            {/* 일별 N일 선택 */}
            {availMode === "일별" && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 20px 0" }}>
                <span style={{ fontSize: "14px", fontWeight: "600", color: "#333" }}>며칠 연속?</span>
                <input
                  type="number" min="2" max="30" value={availNDays}
                  onChange={(e) => { setAvailNDays(Math.max(2, Number(e.target.value))); setSelectedMultiDays([]); }}
                  style={{ width: "60px", padding: "6px 10px", fontSize: "15px", border: "1px solid #ddd", borderRadius: "8px", textAlign: "center" }}
                />
                <span style={{ fontSize: "14px", color: "#555" }}>일</span>
              </div>
            )}

            {/* 리스트 */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 0" }}>
              {availMode === "당일" && availTopTimes.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                  <button
                    type="button"
                    onClick={() =>
                      selectedAvailSlots.length === availTopTimes.length
                        ? setSelectedAvailSlots([])
                        : setSelectedAvailSlots([...availTopTimes])
                    }
                    style={{ fontSize: "13px", color: "#7c79ff", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {selectedAvailSlots.length === availTopTimes.length ? "모두 해제" : "모두 선택"}
                  </button>
                </div>
              )}
              {availMode === "당일" && (
                availTopTimes.length === 0
                  ? <p style={{ color: "#aaa", textAlign: "center", marginTop: "30px" }}>가능한 시간이 없습니다.</p>
                  : availTopTimes.map((time, index) => {
                    const key = makeAvailKey(time);
                    const checked = selectedAvailSlots.some((s) => makeAvailKey(s) === key);
                    const hours = Math.floor(time.duration / 60);
                    const mins = time.duration % 60;
                    return (
                      <label key={index} style={{ display: "flex", alignItems: "flex-start", gap: "12px", border: `1px solid ${checked ? "#7c79ff" : "#eee"}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", backgroundColor: checked ? "#f5f5ff" : "#fff", cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedAvailSlots((prev) => checked ? prev.filter((s) => makeAvailKey(s) !== key) : [...prev, time])} style={{ marginTop: "3px", accentColor: "#7c79ff" }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: "bold", fontSize: "15px" }}>{index + 1}순위</span>
                            <span style={{ fontSize: "12px", backgroundColor: "#7c79ff", color: "#fff", borderRadius: "10px", padding: "2px 8px" }}>{time.availableCount}명 가능</span>
                          </div>
                          <p style={{ margin: "6px 0 2px", fontSize: "14px", color: "#333" }}>{formatDate(time.date)}</p>
                          <p style={{ margin: 0, fontSize: "13px", color: "#666" }}>
                            {time.starttime} ~ {time.endtime}
                            <span style={{ marginLeft: "8px", color: "#7c79ff" }}>({hours > 0 ? `${hours}시간 ` : ""}{mins > 0 ? `${mins}분` : ""})</span>
                          </p>
                        </div>
                      </label>
                    );
                  })
              )}
              {availMode === "일별" && availConsecutive.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                  <button
                    type="button"
                    onClick={() =>
                      selectedMultiDays.length === availConsecutive.length
                        ? setSelectedMultiDays([])
                        : setSelectedMultiDays([...availConsecutive])
                    }
                    style={{ fontSize: "13px", color: "#7c79ff", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {selectedMultiDays.length === availConsecutive.length ? "모두 해제" : "모두 선택"}
                  </button>
                </div>
              )}
              {availMode === "일별" && (
                availConsecutive.length === 0
                  ? <p style={{ color: "#aaa", textAlign: "center", marginTop: "30px" }}>{availNDays}일 연속 가능한 조합이 없습니다.</p>
                  : availConsecutive.map((result, index) => {
                    const key = makeMultiKey(result);
                    const checked = selectedMultiDays.some((s) => makeMultiKey(s) === key);
                    return (
                      <label key={index} style={{ display: "flex", alignItems: "flex-start", gap: "12px", border: `1px solid ${checked ? "#7c79ff" : "#eee"}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", backgroundColor: checked ? "#f5f5ff" : "#fff", cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedMultiDays((prev) => checked ? prev.filter((s) => makeMultiKey(s) !== key) : [...prev, result])} style={{ marginTop: "3px", accentColor: "#7c79ff" }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: "bold", fontSize: "15px" }}>{index + 1}순위</span>
                            <span style={{ fontSize: "12px", backgroundColor: "#7c79ff", color: "#fff", borderRadius: "10px", padding: "2px 8px" }}>{result.availableCount}명 가능</span>
                          </div>
                          <p style={{ margin: "6px 0 4px", fontSize: "14px", color: "#333" }}>{formatDate(result.startDate)} ~ {formatDate(result.endDate)}</p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {result.dates.map((d) => (
                              <span key={d} style={{ fontSize: "12px", backgroundColor: "#f0f0ff", color: "#7c79ff", borderRadius: "6px", padding: "2px 7px" }}>{d}</span>
                            ))}
                          </div>
                        </div>
                      </label>
                    );
                  })
              )}
            </div>

            {/* 추가 버튼 */}
            <div style={{ padding: "12px 20px 0" }}>
              <button
                onClick={handleAddAvailSlotsAsOptions}
                disabled={availSelectedCount === 0}
                style={{
                  width: "100%", padding: "13px",
                  backgroundColor: availSelectedCount > 0 ? "#7c79ff" : "#eee",
                  color: availSelectedCount > 0 ? "#fff" : "#aaa",
                  border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: "bold",
                  cursor: availSelectedCount > 0 ? "pointer" : "default",
                }}
              >
                {availSelectedCount > 0 ? `${availSelectedCount}개 후보로 추가` : "선택 후 추가"}
              </button>
            </div>
          </div>
        </>
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
          onClick={() => navigate(`/rooms/${roomid}?tab=${returnTab}`)}
          style={{
            border: "none",
            background: "none",
            fontSize: "24px",
            cursor: "pointer",
          }}
        >
          ←
        </button>

        <h3 style={{ margin: 0 }}>투표 작성하기</h3>

        <button
          onClick={handleSubmit}
          style={{
            border: "none",
            background: "none",
            fontSize: "16px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          완료
        </button>
      </div>

      <div style={{ padding: "20px" }}>
        {isLocationVoteType(votetype) && locationKind && scheduleId && (
          <p
            style={{
              padding: "10px",
              border: "1px solid #d8d8ff",
              borderRadius: "8px",
              backgroundColor: "#f8f8ff",
              fontSize: "14px",
              color: "#555",
            }}
          >
            대상 일정: <strong>{scheduleTitle || "선택한 일정"}</strong>
            <br />
            확정된 장소는 이 일정에 자동 저장됩니다.
          </p>
        )}

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
            { value: "location", label: "장소 확정" },
          ].map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => handleVotetypeChange(type.value)}
              style={{
                padding: "8px 16px",
                borderRadius: "24px",
                border:
                  isSelectedVoteType(votetype, type.value)
                    ? "2px solid #7c79ff"
                    : "1px solid #ddd",
                backgroundColor: isSelectedVoteType(votetype, type.value) ? "#f0f0ff" : "#fff",
                color: isSelectedVoteType(votetype, type.value) ? "#7c79ff" : "#333",
                fontWeight: isSelectedVoteType(votetype, type.value) ? "bold" : "normal",
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
                  ...makeEmptyOption("text"),
                  optiontext: option.optiontext || option.placename || "",
                }));

                setOptions(updated);
              }}
              style={{
                padding: "10px 22px",
                borderRadius: "24px",
                cursor: "pointer",
                border:
                  currentOptionType === "text"
                    ? "2px solid #333"
                    : "1px solid #ddd",
                fontWeight: currentOptionType === "text" ? "bold" : "normal",
              }}
            >
              텍스트
            </button>

            <button
              type="button"
              onClick={() => {
                const updated = options.map((option) => ({
                  ...makeEmptyOption("date"),
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
                border:
                  currentOptionType === "date"
                    ? "2px solid #333"
                    : "1px solid #ddd",
                fontWeight: currentOptionType === "date" ? "bold" : "normal",
              }}
            >
              날짜
            </button>
          </div>
        )}

        {selectedPlaces.length > 0 && isLocationVoteType(votetype) && (
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
            장소 탭에서 선택한 중간장소 후보들이 투표 항목으로 추가되었습니다.
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
                  style={inputStyle}
                />
              )}

              {option.optiontype === "date" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <input
                    type="date"
                    value={option.optiondate}
                    onChange={(e) =>
                      handleChangeOption(index, "optiondate", e.target.value)
                    }
                    style={inputStyle}
                  />

                  <button
                    type="button"
                    onClick={() => {
                      const newOptions = [...options];
                      const isAllDay = !newOptions[index].isallday;
                      newOptions[index].isallday = isAllDay;
                      if (isAllDay) {
                        newOptions[index].starttime = "";
                        newOptions[index].endtime = "";
                      }
                      setOptions(newOptions);
                    }}
                    style={{
                      padding: "0 12px",
                      height: "36px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      border: option.isallday ? "2px solid #333" : "1px solid #ddd",
                      backgroundColor: option.isallday ? "#333" : "#fff",
                      color: option.isallday ? "#fff" : "#333",
                      fontWeight: option.isallday ? "bold" : "normal",
                      fontSize: "13px",
                      alignSelf: "flex-start",
                    }}
                  >
                    하루종일
                  </button>

                  {!option.isallday && (
                    <>
                      <input
                        type="time"
                        value={option.starttime}
                        onChange={(e) =>
                          handleChangeOption(index, "starttime", e.target.value)
                        }
                        style={inputStyle}
                      />

                      <input
                        type="time"
                        value={option.endtime}
                        onChange={(e) =>
                          handleChangeOption(index, "endtime", e.target.value)
                        }
                        style={inputStyle}
                      />

                      <p style={{ margin: 0, fontSize: "11px", color: "#bbb" }}>
                        종료시간은 선택사항입니다
                      </p>
                    </>
                  )}
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
                    readOnly
                    onChange={(e) =>
                      handleChangeOption(index, "placename", e.target.value)
                    }
                    placeholder="장소명"
                    style={inputStyle}
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setOpenPlacePickerIndex((prev) =>
                        prev === index ? null : index
                      )
                    }
                    style={secondaryButtonStyle}
                  >
                    {openPlacePickerIndex === index
                      ? "장소 검색 닫기"
                      : "카카오맵에서 장소 검색"}
                  </button>

                  {openPlacePickerIndex === index && (
                    <LocationPicker
                      allowMapClick={false}
                      onSelect={(name, address, place) =>
                        handleSelectPlaceOption(index, name, address, place)
                      }
                    />
                  )}

                  <input
                    value={option.placeaddress}
                    readOnly
                    placeholder="주소"
                    style={inputStyle}
                  />

                  <input
                    value={option.kakaomapurl}
                    readOnly
                    placeholder="카카오맵 URL 선택 입력"
                    style={inputStyle}
                  />

                  {!hasValue(option.placelat) && !hasValue(option.placelng) && (
                    <p style={helperTextStyle}>
                      카카오맵에서 장소를 검색해 선택해주세요.
                    </p>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleDeleteOption(index)}
              style={{
                border: "none",
                background: "none",
                fontSize: "22px",
                cursor: "pointer",
                color: "#888",
              }}
            >
              ×
            </button>
          </div>
        ))}

        {votetype === "schedule" && (
          <button
            type="button"
            onClick={handleLoadAvailabilities}
            style={{
              width: "100%",
              padding: "12px",
              marginBottom: "8px",
              border: "1px solid #d8d8ff",
              borderRadius: "10px",
              backgroundColor: "#f9f9ff",
              color: "#5c58d8",
              fontSize: "14px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            📅 가능 시간 불러오기
          </button>
        )}

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
          }}
        >
          +
        </button>

        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={ismultiple}
            onChange={(e) => setIsmultiple(e.target.checked)}
          />
          복수 선택
        </label>

        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={isanonymous}
            onChange={(e) => setIsanonymous(e.target.checked)}
          />
          익명 투표
        </label>

        <label style={{ ...labelStyle, marginBottom: "16px" }}>
          <input
            type="checkbox"
            checked={allowaddoption}
            onChange={(e) => setAllowaddoption(e.target.checked)}
          />
          선택항목 추가 허용
        </label>

        <hr
          style={{
            border: "none",
            borderTop: "1px solid #eee",
            margin: "16px 0",
          }}
        />

        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={endtimeenabled}
            onChange={(e) => {
              setEndtimeenabled(e.target.checked);
              if (!e.target.checked) {
                setEndtime("");
                setReminderenabled(false);
              }
            }}
          />
          투표 종료시간 설정
        </label>

        {endtimeenabled && (
          <input
            type="datetime-local"
            value={endtime}
            onChange={(e) => {
              setEndtime(e.target.value);
              if (!e.target.value) setReminderenabled(false);
            }}
            style={inputStyle}
          />
        )}

        {(() => {
          const disabled = !endtimeenabled || !endtime;
          
          let labelText = "종료 30분 전 알림";
          if (endtimeenabled && endtime) {
            const diff = (new Date(endtime).getTime() - new Date().getTime()) / (1000 * 60);
            if (diff > 0 && diff < 30) {
              labelText = `마감 임박 알림 (현재 약 ${Math.ceil(diff)}분 남음)`;
            }
          }

          return (
            <label
              style={{
                ...labelStyle,
                marginTop: "12px",
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={reminderenabled}
                disabled={disabled}
                onChange={(e) => setReminderenabled(e.target.checked)}
              />
              {labelText}
            </label>
          );
        })()}
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
    isallday: false,
    availablecount: 0,
    placename: "",
    placeaddress: "",
    placelat: "",
    placelng: "",
    kakaomapurl: "",
  };
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return value !== "";
}

function isLocationVoteType(votetype) {
  return ["location", "middle_location", "additional_location"].includes(votetype);
}

function isSelectedVoteType(votetype, buttonType) {
  if (buttonType === "location") return isLocationVoteType(votetype);
  return votetype === buttonType;
}

const inputStyle = {
  width: "100%",
  height: "42px",
  padding: "0 12px",
  border: "1px solid #ddd",
  borderRadius: "6px",
  boxSizing: "border-box",
};

const labelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "8px",
  cursor: "pointer",
};

const secondaryButtonStyle = {
  width: "100%",
  height: "40px",
  border: "1px solid #ddd",
  borderRadius: "6px",
  backgroundColor: "#fff",
  cursor: "pointer",
};

const helperTextStyle = {
  margin: 0,
  fontSize: "12px",
  color: "#888",
};

export default VoteCreatePage;
