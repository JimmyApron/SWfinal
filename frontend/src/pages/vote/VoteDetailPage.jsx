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
  updateVoteOption,
  confirmVote,
} from "../../api/voteApi";
import { addEventToGoogleCalendar } from "../../api/googleCalendarApi";
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
  const [editIsmultiple, setEditIsmultiple] = useState(false);
  const [editIsanonymous, setEditIsanonymous] = useState(false);
  const [editAllowaddoption, setEditAllowaddoption] = useState(false);

  const [editPlaceOptions, setEditPlaceOptions] = useState([]);
  const [editDeletedOptionIds, setEditDeletedOptionIds] = useState([]);

  const [openedMapOptionIds, setOpenedMapOptionIds] = useState([]);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [newPlaceAddress, setNewPlaceAddress] = useState("");
  const [newPlaceLat, setNewPlaceLat] = useState("");
  const [newPlaceLng, setNewPlaceLng] = useState("");
  const [newKakaoMapUrl, setNewKakaoMapUrl] = useState("");
  const [newPickedPlace, setNewPickedPlace] = useState(null);
  const [showPickMap, setShowPickMap] = useState(false);

  const [showLocationModal, setShowLocationModal] = useState(false);
  const [pendingOption, setPendingOption] = useState(null);
  const [appointmentTitle, setAppointmentTitle] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUser(user));
  }, []);

  const makeEditablePlaceOptions = (options = []) =>
    options.map((option) => ({
      id: option.id,
      optiontype: option.optiontype || "place",
      optiontext: option.optiontext || "",
      placename: option.placename || option.optiontext || "",
      placeaddress: option.placeaddress || "",
      placelat: option.placelat ?? "",
      placelng: option.placelng ?? "",
      kakaomapurl: option.kakaomapurl || option.kakaoMapUrl || "",
      isNew: false,
    }));

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

      setEditPlaceOptions(makeEditablePlaceOptions(data.voteoptions || []));
      setEditDeletedOptionIds([]);
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

  const handleEnterEditMode = () => {
    setEditTitle(vote.title);
    setEditEndtime(vote.endtime ? vote.endtime.slice(0, 16) : "");
    setEditEndtimeEnabled(vote.endtimeenabled || false);
    setEditReminderEnabled(vote.reminderenabled || false);
    setEditIsmultiple(vote.ismultiple || false);
    setEditIsanonymous(vote.isanonymous || false);
    setEditAllowaddoption(vote.allowaddoption || false);
    setEditPlaceOptions(makeEditablePlaceOptions(vote.voteoptions || []));
    setEditDeletedOptionIds([]);
    setIsEditMode(true);
  };

  const handleCancelEditMode = () => {
    setEditTitle(vote.title);
    setEditEndtime(vote.endtime ? vote.endtime.slice(0, 16) : "");
    setEditEndtimeEnabled(vote.endtimeenabled || false);
    setEditReminderEnabled(vote.reminderenabled || false);
    setEditIsmultiple(vote.ismultiple || false);
    setEditIsanonymous(vote.isanonymous || false);
    setEditAllowaddoption(vote.allowaddoption || false);
    setEditPlaceOptions(makeEditablePlaceOptions(vote.voteoptions || []));
    setEditDeletedOptionIds([]);
    setIsEditMode(false);
  };

  const handleChangeEditPlaceOption = (index, field, value) => {
    setEditPlaceOptions((prev) =>
      prev.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
              ...(field === "placename" ? { optiontext: value } : {}),
            }
          : item
      )
    );
  };

  const handleAddEditPlaceOption = () => {
    setEditPlaceOptions((prev) => [
      ...prev,
      {
        id: null,
        optiontype: "place",
        optiontext: "",
        placename: "",
        placeaddress: "",
        placelat: "",
        placelng: "",
        kakaomapurl: "",
        isNew: true,
      },
    ]);
  };

  const handleRemoveEditPlaceOption = (index) => {
    const targetOption = editPlaceOptions[index];

    if (!targetOption) return;

    const optionName =
      targetOption.placename || targetOption.optiontext || "이 후보";

    if (!targetOption.isNew) {
      const ok = window.confirm(
        `"${optionName}" 후보를 삭제할까요? 저장 버튼을 눌러야 실제로 반영됩니다.`
      );

      if (!ok) return;
    }

    if (targetOption.id) {
      setEditDeletedOptionIds((prev) =>
        prev.includes(targetOption.id) ? prev : [...prev, targetOption.id]
      );

      setOpenedMapOptionIds((prev) =>
        prev.filter((id) => id !== targetOption.id)
      );
    }

    setEditPlaceOptions((prev) =>
      prev.filter((_, itemIndex) => itemIndex !== index)
    );
  };

  const handleToggleMapOption = (option) => {
    if (!hasAnyMapInfo(option)) {
      alert("지도정보가 없습니다.");
      return;
    }

    setOpenedMapOptionIds((prev) => {
      if (prev.includes(option.id)) {
        return prev.filter((id) => id !== option.id);
      }

      return [...prev, option.id];
    });
  };

  const validatePlaceOptionForSave = (option) => {
    if (!option.placename.trim()) {
      return "중간장소 후보의 장소명을 모두 입력하세요.";
    }

    const hasLat = hasValue(option.placelat);
    const hasLng = hasValue(option.placelng);

    if ((hasLat && !hasLng) || (!hasLat && hasLng)) {
      return "위도와 경도는 둘 다 입력해야 합니다.";
    }

    const latNumber = normalizeCoordinate(option.placelat);
    const lngNumber = normalizeCoordinate(option.placelng);

    if (
      (hasLat && Number.isNaN(latNumber)) ||
      (hasLng && Number.isNaN(lngNumber))
    ) {
      return "위도와 경도는 숫자로 입력해야 합니다.";
    }

    return null;
  };

  const toPlaceOptionPayload = (option) => {
    const latValue = normalizeCoordinate(option.placelat);
    const lngValue = normalizeCoordinate(option.placelng);

    return {
      optiontype: "place",
      optiontext: option.placename.trim(),
      placename: option.placename.trim(),
      placeaddress: option.placeaddress.trim() || null,
      placelat: latValue,
      placelng: lngValue,
      kakaomapurl: option.kakaomapurl.trim() || null,
    };
  };

  const deleteVoteOptionFromDatabase = async (optionId) => {
    const { error: responseDeleteError } = await supabase
      .from("voteresponses")
      .delete()
      .eq("optionid", optionId);

    if (responseDeleteError) {
      console.error("삭제할 후보의 투표 응답 삭제 실패:", responseDeleteError);
      throw responseDeleteError;
    }

    const { error: optionDeleteError } = await supabase
      .from("voteoptions")
      .delete()
      .eq("id", optionId);

    if (optionDeleteError) {
      console.error("투표 후보 삭제 실패:", optionDeleteError);
      throw optionDeleteError;
    }
  };

  const handleAddOption = async () => {
    try {
      let newOption;

      if (isLocationVote) {
        const placeName = newPlaceName.trim();

        if (!placeName) {
          alert("장소명을 입력하세요.");
          return;
        }

        const inputLat = newPickedPlace?.lat ?? newPlaceLat.trim();
        const inputLng = newPickedPlace?.lng ?? newPlaceLng.trim();

        const hasLat = hasValue(inputLat);
        const hasLng = hasValue(inputLng);

        if ((hasLat && !hasLng) || (!hasLat && hasLng)) {
          alert("위도와 경도는 둘 다 입력해야 합니다.");
          return;
        }

        const latNumber = hasLat ? Number(inputLat) : null;
        const lngNumber = hasLng ? Number(inputLng) : null;

        if (
          (hasLat && Number.isNaN(latNumber)) ||
          (hasLng && Number.isNaN(lngNumber))
        ) {
          alert("위도와 경도는 숫자로 입력해야 합니다.");
          return;
        }

        if (
          !hasValue(newPlaceAddress) &&
          !(hasLat && hasLng) &&
          !hasValue(newKakaoMapUrl)
        ) {
          alert(
            "지도정보가 없습니다. 주소, 위도/경도, 카카오맵 URL 중 하나는 입력해야 합니다."
          );
          return;
        }

        newOption = await addVoteOption(Number(voteid), {
          optiontype: "place",
          optiontext: placeName,
          placename: placeName,
          placeaddress: newPlaceAddress.trim() || null,
          placelat: latNumber,
          placelng: lngNumber,
          kakaomapurl: newKakaoMapUrl.trim() || null,
        });

        setNewPlaceName("");
        setNewPlaceAddress("");
        setNewPlaceLat("");
        setNewPlaceLng("");
        setNewKakaoMapUrl("");
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

    if (vote.votetype === "location" && !hasAnyMapInfo(option)) {
      alert("위치정보를 등록해주세요.");
      return;
    }

    if (
      !window.confirm(
        `"${getOptionLabel(option)}" 을(를) ${typeLabel}으로 확정할까요?`
      )
    ) {
      return;
    }

    if (vote.votetype === "schedule") {
      setPendingOption(option);
      setAppointmentTitle("");
      setShowLocationModal(true);
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

  const handleConfirmWithLocation = async (goToLocation) => {
    if (!pendingOption) {
      alert("확정할 일정을 찾을 수 없습니다.");
      return;
    }

    if (!appointmentTitle.trim()) {
      alert("약속 이름을 입력하세요.");
      return;
    }

    try {
      await confirmVote(
        Number(voteid),
        pendingOption,
        Number(roomid),
        vote.votetype,
        appointmentTitle.trim()
      );

      if (localStorage.getItem("google_calendar_auto_sync") === "true") {
        try {
          await addEventToGoogleCalendar({
            title: appointmentTitle.trim(),
            date: pendingOption.optiondate,
            starttime: pendingOption.starttime,
            endtime: pendingOption.endtime,
          });
        } catch (googleErr) {
          alert("일정은 확정됐지만 구글 캘린더 추가에 실패했습니다.\n설정에서 다시 연결해주세요.\n\n(" + googleErr.message + ")");
        }
      }

      await loadVote();

      setShowLocationModal(false);
      setPendingOption(null);
      setAppointmentTitle("");

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
      navigate(`/rooms/${roomid}?tab=vote`);
    } catch (error) {
      alert("투표 삭제 실패");
    }
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) {
      alert("투표 제목을 입력하세요.");
      return;
    }

    if (isLocationVote) {
      for (const option of editPlaceOptions) {
        const errorMessage = validatePlaceOptionForSave(option);

        if (errorMessage) {
          alert(errorMessage);
          return;
        }
      }
    }

    try {
      await updateVote(Number(voteid), {
        title: editTitle,
        endtime: editEndtimeEnabled ? editEndtime : null,
        endtimeenabled: editEndtimeEnabled,
        reminderenabled: editReminderEnabled,
        ismultiple: editIsmultiple,
        isanonymous: editIsanonymous,
        allowaddoption: editAllowaddoption,
      });

      if (isLocationVote) {
        for (const deletedOptionId of editDeletedOptionIds) {
          await deleteVoteOptionFromDatabase(deletedOptionId);
        }

        for (const option of editPlaceOptions) {
          const optionPayload = toPlaceOptionPayload(option);

          if (option.id) {
            await updateVoteOption(option.id, optionPayload);
          } else {
            await addVoteOption(Number(voteid), optionPayload);
          }
        }
      }

      await loadVote();
      setEditDeletedOptionIds([]);
      setIsEditMode(false);
    } catch (error) {
      console.error("투표 수정 실패:", error);
      alert("투표 수정 실패: " + (error.message || JSON.stringify(error)));
    }
  };

  const handleShareToChat = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("로그인이 필요합니다.");
      return;
    }

    const nickname = user?.user_metadata?.nickname || user?.email || "익명";

    const { data: profile } = await supabase
      .from("profiles")
      .select("nickname, profileimageurl")
      .eq("id", user.id)
      .maybeSingle();

    const meta = JSON.stringify({
      __type: "vote",
      voteid: Number(voteid),
      title: vote.title,
      roomid: Number(roomid),
      isclosed: vote.isclosed || false,
      endtime: vote.endtime || null,
      endtimeenabled: vote.endtimeenabled || false,
    });

    const { error } = await supabase.from("room_messages").insert([
      {
        roomid: Number(roomid),
        userid: user.id,
        nickname: profile?.nickname || nickname,
        profileimageurl: profile?.profileimageurl || null,
        content: meta,
      },
    ]);

    if (error) {
      alert("공유 실패: " + error.message);
      return;
    }

    navigate(`/rooms/${roomid}?tab=chat`);
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#fff" }}>
      {showLocationModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: "16px",
              padding: "24px",
              width: "300px",
              position: "relative",
            }}
          >
            <button
              onClick={() => {
                setShowLocationModal(false);
                setPendingOption(null);
                setAppointmentTitle("");
              }}
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                border: "none",
                background: "none",
                fontSize: "18px",
                color: "#aaa",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ✕
            </button>

            <h3 style={{ marginBottom: "4px", textAlign: "center" }}>
              일정이 확정되었습니다!
            </h3>

            <p
              style={{
                color: "#666",
                fontSize: "13px",
                textAlign: "center",
                marginBottom: "16px",
              }}
            >
              약속 이름을 입력해 주세요
            </p>

            <input
              type="text"
              placeholder="예: 팀 회식, 생일 파티..."
              value={appointmentTitle}
              onChange={(e) => setAppointmentTitle(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "14px",
                border: "1px solid #ddd",
                borderRadius: "10px",
                boxSizing: "border-box",
                marginBottom: "16px",
              }}
            />

            <p
              style={{
                color: "#666",
                fontSize: "13px",
                textAlign: "center",
                marginBottom: "12px",
              }}
            >
              만날 위치를 지금 정하시겠어요?
            </p>

            <button
              onClick={() => handleConfirmWithLocation(true)}
              style={{
                width: "100%",
                padding: "12px",
                marginBottom: "8px",
                backgroundColor: "#7c79ff",
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                fontSize: "15px",
                cursor: "pointer",
              }}
            >
              위치 지금 정하기
            </button>

            <button
              onClick={() => handleConfirmWithLocation(false)}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#f5f5f5",
                color: "#333",
                border: "none",
                borderRadius: "10px",
                fontSize: "15px",
                cursor: "pointer",
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
            <button
              onClick={handleEnterEditMode}
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
              onClick={handleCancelEditMode}
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

            <label style={editCheckLabelStyle}>
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

            <label style={editCheckLabelStyle}>
              <input
                type="checkbox"
                checked={editReminderEnabled}
                onChange={(e) => setEditReminderEnabled(e.target.checked)}
              />
              종료 30분 전 알림
            </label>

            <label style={editCheckLabelStyle}>
              <input
                type="checkbox"
                checked={editIsmultiple}
                onChange={(e) => setEditIsmultiple(e.target.checked)}
              />
              복수 선택 허용
            </label>

            <label style={editCheckLabelStyle}>
              <input
                type="checkbox"
                checked={editIsanonymous}
                onChange={(e) => setEditIsanonymous(e.target.checked)}
              />
              익명 투표
            </label>

            <label style={editCheckLabelStyle}>
              <input
                type="checkbox"
                checked={editAllowaddoption}
                onChange={(e) => setEditAllowaddoption(e.target.checked)}
              />
              항목 추가 허용
            </label>

            {isLocationVote && (
              <EditPlaceOptionsPanel
                editPlaceOptions={editPlaceOptions}
                onChangeOption={handleChangeEditPlaceOption}
                onAddOption={handleAddEditPlaceOption}
                onRemoveOption={handleRemoveEditPlaceOption}
              />
            )}
          </div>
        ) : (
          <h2 style={{ margin: "8px 0" }}>{vote.title}</h2>
        )}

        {!isEditMode && (
          <>
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              {vote.ismultiple && <span style={badgeStyle}>복수선택</span>}
              {vote.isanonymous && <span style={badgeStyle}>익명투표</span>}
              {isLocationVote && <span style={badgeStyle}>중간장소 투표</span>}
            </div>

            {showVotingUI ? (
              <>
                {vote.voteoptions?.map((option) => (
                  <div key={option.id}>
                    <label
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
                            handleToggleMapOption(option);
                          }}
                          style={smallButtonStyle}
                        >
                          {openedMapOptionIds.includes(option.id)
                            ? "지도접기"
                            : "지도보기"}
                        </button>
                      )}
                    </label>

                    {openedMapOptionIds.includes(option.id) && (
                      <div style={mapBoxStyle}>
                        <PlaceMapPreview option={option} />
                      </div>
                    )}
                  </div>
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
                          style={editInputStyle}
                        />

                        <input
                          value={newPlaceAddress}
                          onChange={(e) => setNewPlaceAddress(e.target.value)}
                          placeholder="주소 선택 입력"
                          style={editInputStyle}
                        />

                        <div style={{ display: "flex", gap: "8px" }}>
                          <input
                            value={newPlaceLat}
                            onChange={(e) => setNewPlaceLat(e.target.value)}
                            placeholder="위도 선택 입력"
                            style={{ ...editInputStyle, flex: 1 }}
                          />

                          <input
                            value={newPlaceLng}
                            onChange={(e) => setNewPlaceLng(e.target.value)}
                            placeholder="경도 선택 입력"
                            style={{ ...editInputStyle, flex: 1 }}
                          />
                        </div>

                        <input
                          value={newKakaoMapUrl}
                          onChange={(e) => setNewKakaoMapUrl(e.target.value)}
                          placeholder="카카오맵 URL 선택 입력"
                          style={editInputStyle}
                        />

                        <p
                          style={{
                            fontSize: "12px",
                            color: "#888",
                            marginTop: 0,
                          }}
                        >
                          장소명은 필수입니다. 주소, 위도/경도, 카카오맵 URL 중
                          하나는 입력해야 합니다.
                        </p>

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
                              onClick={() => handleToggleMapOption(option)}
                              style={smallButtonStyle}
                            >
                              {openedMapOptionIds.includes(option.id)
                                ? "지도접기"
                                : "지도보기"}
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
                              확정됨
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
                          {vote.votetype !== "general" && (
                            <button
                              onClick={() => !isConfirmed && handleConfirm(option)}
                              disabled={isConfirmed}
                              style={{
                                fontSize: "12px",
                                padding: "3px 10px",
                                border: isConfirmed
                                  ? "1px solid #7c79ff"
                                  : "1px solid #ddd",
                                borderRadius: "12px",
                                backgroundColor: isConfirmed
                                  ? "#f0f0ff"
                                  : "#fff",
                                color: isConfirmed ? "#7c79ff" : "#555",
                                cursor: isConfirmed ? "default" : "pointer",
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

                      {openedMapOptionIds.includes(option.id) && (
                        <div style={mapBoxStyle}>
                          <PlaceMapPreview option={option} />
                        </div>
                      )}

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
                                key={`${option.id}-${r.userid}`}
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

                <button
                  onClick={handleShareToChat}
                  style={{
                    width: "100%",
                    marginTop: "12px",
                    padding: "12px",
                    border: "1px solid #7c79ff",
                    borderRadius: "8px",
                    backgroundColor: "#fff",
                    color: "#7c79ff",
                    fontSize: "15px",
                    cursor: "pointer",
                  }}
                >
                  💬 채팅에 공유
                </button>

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
          </>
        )}
      </div>
    </div>
  );
}

function EditPlaceOptionsPanel({
  editPlaceOptions,
  onChangeOption,
  onAddOption,
  onRemoveOption,
}) {
  return (
    <div
      style={{
        marginTop: "16px",
        padding: "12px",
        border: "1px solid #eee",
        borderRadius: "8px",
        backgroundColor: "#fafafa",
      }}
    >
      <h4 style={{ marginTop: 0 }}>중간장소 후보 수정</h4>

      <p style={{ fontSize: "12px", color: "#888" }}>
        장소명은 필수입니다. 주소, 위도/경도, 카카오맵 URL 중 하나는 입력해야
        합니다. 위도와 경도는 둘 다 있거나 둘 다 없어야 합니다.
      </p>

      {editPlaceOptions.map((option, index) => (
        <div
          key={option.id || `new-${index}`}
          style={{
            position: "relative",
            marginBottom: "16px",
            padding: "12px",
            paddingTop: "36px",
            border: "1px solid #ddd",
            borderRadius: "8px",
            backgroundColor: "#fff",
          }}
        >
          <button
            type="button"
            onClick={() => onRemoveOption(index)}
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              border: "none",
              background: "none",
              fontSize: "18px",
              cursor: "pointer",
              color: "#f44",
            }}
          >
            ×
          </button>

          <input
            value={option.placename}
            onChange={(e) => onChangeOption(index, "placename", e.target.value)}
            placeholder="장소명"
            style={editInputStyle}
          />

          <input
            value={option.placeaddress}
            onChange={(e) =>
              onChangeOption(index, "placeaddress", e.target.value)
            }
            placeholder="주소 선택 입력"
            style={editInputStyle}
          />

          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={option.placelat}
              onChange={(e) => onChangeOption(index, "placelat", e.target.value)}
              placeholder="위도 선택 입력"
              style={{ ...editInputStyle, flex: 1 }}
            />

            <input
              value={option.placelng}
              onChange={(e) => onChangeOption(index, "placelng", e.target.value)}
              placeholder="경도 선택 입력"
              style={{ ...editInputStyle, flex: 1 }}
            />
          </div>

          <input
            value={option.kakaomapurl}
            onChange={(e) =>
              onChangeOption(index, "kakaomapurl", e.target.value)
            }
            placeholder="카카오맵 URL 선택 입력"
            style={editInputStyle}
          />
        </div>
      ))}

      <button type="button" onClick={onAddOption} style={smallButtonStyle}>
        후보 추가
      </button>
    </div>
  );
}

function PlaceMapPreview({ option }) {
  const [addressPlace, setAddressPlace] = useState(null);
  const [addressError, setAddressError] = useState("");

  const mapUrl = option.kakaomapurl || option.kakaoMapUrl;
  const hasCoords = hasValue(option.placelat) && hasValue(option.placelng);
  const hasAddress = hasValue(option.placeaddress);

  useEffect(() => {
    if (mapUrl || hasCoords || !hasAddress) return;

    if (!window.kakao?.maps?.services) {
      setAddressError("주소 검색 서비스를 불러오지 못했습니다.");
      return;
    }

    const geocoder = new window.kakao.maps.services.Geocoder();

    geocoder.addressSearch(option.placeaddress, (result, status) => {
      if (status === window.kakao.maps.services.Status.OK && result[0]) {
        setAddressPlace({
          id: option.id,
          name: option.placename || option.optiontext || "장소",
          address: option.placeaddress,
          lat: Number(result[0].y),
          lng: Number(result[0].x),
          kakaoMapUrl: option.kakaomapurl,
        });
        setAddressError("");
      } else {
        setAddressPlace(null);
        setAddressError("주소로 지도를 찾을 수 없습니다.");
      }
    });
  }, [mapUrl, hasCoords, hasAddress, option]);

  if (mapUrl) {
    if (hasCoords) {
      const place = optionToPlace(option);

      return (
        <>
          <p style={mapInfoTextStyle}>
            카카오맵 URL 기준 지도입니다. 저장된 좌표를 함께 사용해 표시합니다.
          </p>
          <KakaoMapView places={[place]} selectedPlace={place} />
        </>
      );
    }

    return (
      <>
        <p style={mapInfoTextStyle}>카카오맵 URL 기준 지도입니다.</p>
        <iframe
          title={`kakao-map-url-${option.id}`}
          src={mapUrl}
          style={{
            width: "100%",
            height: "320px",
            border: "1px solid #ddd",
            borderRadius: "8px",
          }}
        />
        <p style={{ fontSize: "12px", color: "#888", marginBottom: 0 }}>
          URL 미리보기가 표시되지 않으면 카카오맵에서 페이지 내 표시를 제한한
          경우입니다.
        </p>
      </>
    );
  }

  if (hasCoords) {
    const place = optionToPlace(option);

    return (
      <>
        <p style={mapInfoTextStyle}>좌표 기준 지도입니다.</p>
        <KakaoMapView places={[place]} selectedPlace={place} />
      </>
    );
  }

  if (hasAddress) {
    return (
      <>
        <p style={mapInfoTextStyle}>주소 기준 지도입니다.</p>

        {addressError ? (
          <p style={{ fontSize: "13px", color: "#f66" }}>{addressError}</p>
        ) : addressPlace ? (
          <KakaoMapView places={[addressPlace]} selectedPlace={addressPlace} />
        ) : (
          <p style={{ fontSize: "13px", color: "#888" }}>
            주소를 지도 좌표로 변환하는 중입니다.
          </p>
        )}
      </>
    );
  }

  return (
    <p style={{ fontSize: "13px", color: "#f66", margin: 0 }}>
      등록된 지도 정보가 없습니다.
    </p>
  );
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return value !== "";
}

function normalizeCoordinate(value) {
  if (value === null || value === undefined) return null;

  const stringValue = String(value).trim();

  if (stringValue === "") return null;

  return Number(stringValue);
}

function hasAnyMapInfo(option) {
  const mapUrl = option.kakaomapurl || option.kakaoMapUrl;
  const hasCoords = hasValue(option.placelat) && hasValue(option.placelng);
  const hasAddress = hasValue(option.placeaddress);

  return hasValue(mapUrl) || hasCoords || hasAddress;
}

function isPlaceOption(option) {
  return (
    option.optiontype === "place" ||
    option.placelat ||
    option.placelng ||
    option.placeaddress ||
    option.kakaomapurl ||
    option.kakaoMapUrl
  );
}

function getOptionLabel(option) {
  if (option.optiontype === "date") {
    return `${option.optiondate} ${option.starttime}~${option.endtime || ""}`;
  }

  return option.placename || option.optiontext || "이름 없는 장소";
}

function renderOptionContent(option) {
  if (option.optiontype === "date") {
    return (
      <span>
        {option.optiondate} / {option.starttime}
        {option.endtime ? ` ~ ${option.endtime}` : ""}
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
    lat: Number(option.placelat),
    lng: Number(option.placelng),
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

const editInputStyle = {
  width: "100%",
  padding: "10px",
  border: "1px solid #ddd",
  borderRadius: "8px",
  boxSizing: "border-box",
  marginBottom: "8px",
};

const editCheckLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginTop: "12px",
};

const mapBoxStyle = {
  marginTop: "-4px",
  marginBottom: "10px",
  padding: "12px",
  border: "1px solid #eee",
  borderRadius: "8px",
  backgroundColor: "#fafafa",
};

const mapInfoTextStyle = {
  fontSize: "12px",
  color: "#888",
  marginTop: 0,
  marginBottom: "8px",
};

export default VoteDetailPage;