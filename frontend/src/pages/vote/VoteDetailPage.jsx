import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  getVoteDetail,
  getVoteConfirmedAdditionalLocations,
  removeVoteConfirmedAdditionalLocation,
  deleteVote,
  updateVote,
  submitVote,
  closeVote,
  addVoteOption,
  updateVoteOption,
  confirmVote,
  applyScheduleVoteToExisting,
} from "../../api/voteApi";
import { sendVoteClosedNotification } from "../notification/VoteNotification";
import { addEventToGoogleCalendar } from "../../api/googleCalendarApi";
import {
  applyConfirmedLocationToSchedule,
  createDraftConfirmedSchedule,
  createLocationOnlyConfirmedSchedule,
  clearConfirmedScheduleLocation,
  getRoomConfirmedSchedules,
  getMemberAvailabilities,
  getScheduleCandidates,
} from "../../api/scheduleApi";
import { getTopAvailableTimes, sortAvailableTimes, getTopConsecutiveDays, getTodayStr } from "../../utils/scheduleUtils";
import KakaoMapView from "../../components/map/KakaoMapView";
import LocationPicker from "../../components/map/LocationPicker";

function VoteDetailPage() {
  const { roomid, voteid } = useParams();
  const navigate = useNavigate();

  const [vote, setVote] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [newOptionText, setNewOptionText] = useState("");
  const [newOptionDate, setNewOptionDate] = useState("");
  const [newOptionStarttime, setNewOptionStarttime] = useState("");
  const [newOptionEndtime, setNewOptionEndtime] = useState("");
  const [newOptionIsAllDay, setNewOptionIsAllDay] = useState(false);
  const [showAddOptionForm, setShowAddOptionForm] = useState(false);
  const [isForceVoting, setIsForceVoting] = useState(false);
  const [showVotersForOption, setShowVotersForOption] = useState(null);
  const [showParticipants, setShowParticipants] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

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
  const [showAddPlaceForm, setShowAddPlaceForm] = useState(false);

  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showLinkScheduleModal, setShowLinkScheduleModal] = useState(false);
  const [showReconfirmWarningModal, setShowReconfirmWarningModal] = useState(false);
  const [existingScheduleTitle, setExistingScheduleTitle] = useState("");
  const [pendingOption, setPendingOption] = useState(null);
  const [appointmentTitle, setAppointmentTitle] = useState("");
  const [pendingConfirmedLocation, setPendingConfirmedLocation] = useState(null);
  const [pendingLocationKind, setPendingLocationKind] = useState(null);
  const [confirmedAdditionalLocations, setConfirmedAdditionalLocations] = useState([]);
  const [isReconfirmation, setIsReconfirmation] = useState(false);
  const [existingHasLocation, setExistingHasLocation] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [roomConfirmedSchedules, setRoomConfirmedSchedules] = useState([]);
  const [locationOnlySchedules, setLocationOnlySchedules] = useState([]);
  const [pendingGoToLocation, setPendingGoToLocation] = useState(false);
  const [memberNicknames, setMemberNicknames] = useState({});
  const [showDetailAvailModal, setShowDetailAvailModal] = useState(false);
  const [detailAvailabilities, setDetailAvailabilities] = useState([]);
  const [detailCandidates, setDetailCandidates] = useState([]);
  const [detailSelectedSlots, setDetailSelectedSlots] = useState([]);
  const [detailAvailMode, setDetailAvailMode] = useState("당일");
  const [detailAvailNDays, setDetailAvailNDays] = useState(2);
  const [detailSelectedMultiDays, setDetailSelectedMultiDays] = useState([]);
  const [createdLocationOnlySchedule, setCreatedLocationOnlySchedule] = useState(null);
  const [confirmedLocationSchedulePrompt, setConfirmedLocationSchedulePrompt] =
    useState(null);
  const [showNameInputModal, setShowNameInputModal] = useState(false);
  const [nameInputMode, setNameInputMode] = useState(null); // "new_with_location" | "later"
  const [showNewScheduleConfirmModal, setShowNewScheduleConfirmModal] = useState(false);
  const [newScheduleTitleError, setNewScheduleTitleError] = useState("");
  const [showScheduleVoteLocationModal, setShowScheduleVoteLocationModal] = useState(false);
  const [createdScheduleId, setCreatedScheduleId] = useState(null);
  const [linkedSchedule, setLinkedSchedule] = useState(null);
  const [fromSchedule, setFromSchedule] = useState(null);
  const [pendingLinkSchedule, setPendingLinkSchedule] = useState(null);
  const [showDateChangeWarningModal, setShowDateChangeWarningModal] = useState(false);
  const [showAfterLinkLocationModal, setShowAfterLinkLocationModal] = useState(false);
  const [pendingLocationScheduleId, setPendingLocationScheduleId] = useState(null);
  const [showConfirmToast, setShowConfirmToast] = useState(false);
  const [showFromScheduleModal, setShowFromScheduleModal] = useState(false);
  const [showAfterUpdateLocationModal, setShowAfterUpdateLocationModal] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("confirmFromSchedule");
    if (stored) {
      try { setFromSchedule(JSON.parse(stored)); } catch {}
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUser(user));
  }, []);

  useEffect(() => {
    const timerId = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timerId);
  }, []);

  const makeEditablePlaceOptions = (options = []) =>
    options.map((option) => ({
      id: option.id,
      optiontype: option.optiontype || "text",
      optiontext: option.optiontext || "",
      optiondate: option.optiondate || "",
      starttime: option.starttime || "",
      endtime: option.endtime || "",
      isallday: option.optiontype === "date" && !option.starttime,
      availablecount: option.availablecount || 0,
      placename: option.placename || option.optiontext || "",
      placeaddress: option.placeaddress || "",
      placelat: option.placelat ?? "",
      placelng: option.placelng ?? "",
      kakaomapurl: option.kakaomapurl || option.kakaoMapUrl || "",
      travelresults: option.travelresults || null,
      isNew: false,
    }));

  const loadVote = async () => {
    try {
      const data = await getVoteDetail(Number(voteid));
      const additionalLocations =
        await getVoteConfirmedAdditionalLocations(Number(voteid));

      setVote(data);
      setConfirmedAdditionalLocations(additionalLocations);

      // 응답자 전원의 프로필 닉네임을 profiles 테이블에서 조회 (이메일 저장 문제 방지)
      const responses = data.voteresponses || [];
      const allUserIds = [...new Set(
        responses.map((r) => r.userid).filter(Boolean)
      )];
      if (allUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, nickname")
          .in("id", allUserIds);
        const map = {};
        (profiles || []).forEach((p) => { if (p.nickname) map[p.id] = p.nickname; });
        setMemberNicknames(map);
      }

      setEditTitle(data.title);
      setEditEndtime(data.endtime ? data.endtime.slice(0, 16) : "");
      setEditEndtimeEnabled(data.endtimeenabled || false);
      setEditReminderEnabled(data.reminderenabled || false);
      setEditIsmultiple(data.ismultiple || false);
      setEditIsanonymous(data.isanonymous || false);
      setEditAllowaddoption(data.allowaddoption || false);

      setEditPlaceOptions(makeEditablePlaceOptions(data.voteoptions || []));
      setEditDeletedOptionIds([]);

      if (data.votetype === "schedule") {
        const { data: scheduleViaVoteid } = await supabase
          .from("confirmed_schedules")
          .select("id, title, date")
          .eq("voteid", Number(voteid))
          .maybeSingle();
        if (scheduleViaVoteid) {
          setLinkedSchedule(scheduleViaVoteid);
        } else if (data.scheduleid && data.confirmed_schedules) {
          setLinkedSchedule({ id: data.scheduleid, ...data.confirmed_schedules });
        } else {
          setLinkedSchedule(null);
        }
      }
    } catch (error) {
      console.error("투표 상세 불러오기 실패:", error);
      alert("투표 상세 불러오기 실패");
    }
  };

  useEffect(() => {
    loadVote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteid]);

  useEffect(() => {
    if (!showScheduleModal && !showLocationModal) return;
    getRoomConfirmedSchedules(roomid)
      .then((data) => setRoomConfirmedSchedules(data))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScheduleModal, showLocationModal]);


  useEffect(() => {
    loadVote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteid]);

  useEffect(() => {
    const hasExpired =
      vote?.endtimeenabled &&
      vote.endtime &&
      new Date(vote.endtime).getTime() <= currentTime;

    if (isEditMode && (vote?.isclosed || hasExpired)) {
      setIsEditMode(false);
    }
  }, [currentTime, isEditMode, vote]);

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
  const isLocationVote = isLocationVoteType(vote.votetype);
  const isMiddlePlaceVote =
    vote.locationkind === "middle" ||
    (
      vote.votetype === "location" &&
      !vote.locationkind &&
      vote.title?.trim() === "중간 장소 투표"
    );
  const isManualLocationVote = isLocationVote && !vote.locationkind && !isMiddlePlaceVote;

  const isClosed =
    vote.isclosed ||
    (vote.endtimeenabled && vote.endtime && new Date(vote.endtime).getTime() <= currentTime);

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
      const nickname = memberNicknames[uid] || found?.nickname || "익명";
      return { userid: uid, nickname };
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
    if (isClosed) return;

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
    const optiontype = isLocationVote
      ? "place"
      : vote.votetype === "schedule"
      ? "date"
      : editPlaceOptions[0]?.optiontype || "text";

    setEditPlaceOptions((prev) => [
      ...prev,
      {
        id: null,
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

    if (!hasLat || !hasLng) {
      return "선택지 장소를 카카오맵에서 선택해주세요.";
    }

    if ((hasLat && !hasLng) || (!hasLat && hasLng)) {
      return "선택지 장소를 카카오맵에서 다시 선택해주세요.";
    }

    const latNumber = normalizeCoordinate(option.placelat);
    const lngNumber = normalizeCoordinate(option.placelng);

    if (
      (hasLat && Number.isNaN(latNumber)) ||
      (hasLng && Number.isNaN(lngNumber))
    ) {
      return "선택지 장소를 카카오맵에서 다시 선택해주세요.";
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
      travelresults: option.travelresults || null,
    };
  };

  const validateEditOptionForSave = (option) => {
    if (option.optiontype === "place") {
      return validatePlaceOptionForSave(option);
    }

    if (option.optiontype === "date") {
      if (!option.optiondate) return "일정 선택지의 날짜를 모두 입력하세요.";
      if (!option.isallday && !option.starttime) {
        return "일정 선택지의 시작 시간을 모두 입력하세요.";
      }
      if (
        !option.isallday &&
        option.starttime &&
        option.endtime &&
        option.starttime >= option.endtime
      ) {
        return "일정 선택지의 종료 시간은 시작 시간보다 늦어야 합니다.";
      }
      return null;
    }

    if (!option.optiontext.trim()) return "투표 선택지 내용을 모두 입력하세요.";
    return null;
  };

  const toEditOptionPayload = (option) => {
    if (option.optiontype === "place") return toPlaceOptionPayload(option);

    if (option.optiontype === "date") {
      return {
        optiontype: "date",
        optiontext: option.optiondate,
        optiondate: option.optiondate,
        starttime: option.isallday ? null : option.starttime || null,
        endtime: option.isallday ? null : option.endtime || null,
        availablecount: option.availablecount || 0,
      };
    }

    return {
      optiontype: "text",
      optiontext: option.optiontext.trim(),
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

        if (!placeName || !hasValue(newPlaceLat) || !hasValue(newPlaceLng)) {
          alert("선택지 장소를 카카오맵에서 선택해주세요.");
          return;
        }

        const inputLat = newPickedPlace?.lat ?? newPlaceLat.trim();
        const inputLng = newPickedPlace?.lng ?? newPlaceLng.trim();

        const hasLat = hasValue(inputLat);
        const hasLng = hasValue(inputLng);

        if ((hasLat && !hasLng) || (!hasLat && hasLng)) {
          alert("선택지 장소를 카카오맵에서 다시 선택해주세요.");
          return;
        }

        const latNumber = hasLat ? Number(inputLat) : null;
        const lngNumber = hasLng ? Number(inputLng) : null;

        if (
          (hasLat && Number.isNaN(latNumber)) ||
          (hasLng && Number.isNaN(lngNumber))
        ) {
          alert("선택지 장소를 카카오맵에서 다시 선택해주세요.");
          return;
        }

        if (
          !hasValue(newPlaceAddress) &&
          !(hasLat && hasLng) &&
          !hasValue(newKakaoMapUrl)
        ) {
          alert(
            "지도정보가 없습니다. 카카오맵에서 장소를 다시 선택해주세요."
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
      } else if (vote.votetype === "schedule") {
        if (!newOptionDate) {
          alert("날짜를 선택하세요.");
          return;
        }

        newOption = await addVoteOption(Number(voteid), {
          optiontype: "date",
          optiondate: newOptionDate,
          starttime: newOptionIsAllDay ? null : newOptionStarttime || null,
          endtime: newOptionIsAllDay ? null : newOptionEndtime || null,
          optiontext: newOptionDate,
        });

        setNewOptionDate("");
        setNewOptionStarttime("");
        setNewOptionEndtime("");
        setNewOptionIsAllDay(false);
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
      setShowAddOptionForm(false);
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

  const handleConfirm = async (option, requestedLocationKind = null) => {
    const typeLabel =
      vote.votetype === "schedule"
        ? "일정"
        : requestedLocationKind === "middle"
        ? "중간위치"
        : requestedLocationKind === "additional"
        ? "추가장소"
        : isMiddlePlaceVote
        ? "중간위치"
        : "추가장소";

    if (isLocationVote && !hasPlaceCoordinates(option)) {
      alert("선택지 장소를 카카오맵에서 선택해주세요.");
      return;
    }

    if (vote.votetype === "schedule") {
      if (option.optiondate) {
        const today = getTodayStr();
        if (option.optiondate < today) {
          alert(`이미 지난 날짜(${option.optiondate})로는 일정을 확정할 수 없습니다.`);
          return;
        }
      }

      const [{ data: existingSchedule }, { data: locOnly }] = await Promise.all([
        supabase
          .from("confirmed_schedules")
          .select("id, title, location, date")
          .eq("voteid", Number(voteid))
          .maybeSingle(),
        supabase
          .from("confirmed_schedules")
          .select("id, title, location, locationaddress")
          .eq("roomid", Number(roomid))
          .is("date", null)
          .not("location", "is", null),
      ]);

      setIsReconfirmation(Boolean(existingSchedule));
      setExistingHasLocation(Boolean(existingSchedule?.location));
      setLocationOnlySchedules(locOnly || []);
      setPendingOption(option);
      setAppointmentTitle(existingSchedule?.title || "");

      if (existingSchedule) {
        // 재확정: 경고 모달 먼저 표시
        setExistingScheduleTitle(
          existingSchedule.title || existingSchedule.date || "기존 일정"
        );
        setPendingLocationScheduleId(existingSchedule.id);
        setShowReconfirmWarningModal(true);
      } else {
        // 첫 확정: fromSchedule 있으면 인터셉트
        if (fromSchedule && fromSchedule.roomid === Number(roomid)) {
          setShowFromScheduleModal(true);
          return;
        }
        if (!window.confirm(`"${getOptionLabel(option)}" 을(를) 일정으로 확정할까요?`)) {
          return;
        }
        setShowLocationModal(true);
      }
      return;
    }

    if (
      !window.confirm(
        `"${getOptionLabel(option)}" 을(를) ${typeLabel}으로 확정할까요?`
      )
    ) {
      return;
    }

    try {
      const result = await confirmVote(
        Number(voteid),
        option,
        Number(roomid),
        vote.votetype,
        currentUser?.id,
        requestedLocationKind
      );

      await loadVote();

      if (!result.confirmedLocation?.scheduleid) {
        setPendingConfirmedLocation(result.confirmedLocation);
        setRoomConfirmedSchedules(await getRoomConfirmedSchedules(roomid));
        setAppointmentTitle("");
        setPendingLocationKind(result.locationKind);
        setShowScheduleModal(true);
        return;
      }

      const scheduleTitle = vote.confirmed_schedules?.title || "대상 일정";

      if (!vote.confirmed_schedules?.date) {
        setConfirmedLocationSchedulePrompt({ title: scheduleTitle });
        return;
      }

      alert(`${scheduleTitle}에 장소를 저장했어요.`);
    } catch (error) {
      alert(
        error.message === "이미 있는 추가장소입니다."
          ? error.message
          : "확정 실패: " + (error.message || JSON.stringify(error))
      );
    }
  };

  const handleApplyLocationToSchedule = async (scheduleId) => {
    try {
      await applyConfirmedLocationToSchedule(
        scheduleId,
        pendingConfirmedLocation,
        pendingLocationKind === "middle",
        true,
        isManualLocationVote ? null : pendingLocationKind
      );
      await loadVote();
      setShowScheduleModal(false);
      setPendingConfirmedLocation(null);
      setPendingLocationKind(null);
      setAppointmentTitle("");
      const schedule = roomConfirmedSchedules.find(
        (item) => Number(item.id) === Number(scheduleId)
      );

      if (!schedule?.date) {
        setConfirmedLocationSchedulePrompt({
          title: schedule?.title || "대상 일정",
        });
        return;
      }

      alert(`${schedule?.title || "대상 일정"}에 장소를 저장했어요.`);
    } catch (error) {
      alert(
        error.message === "이미 있는 추가장소입니다."
          ? error.message
          : "일정 위치 저장 실패: " + error.message
      );
    }
  };

  const getConfirmedAdditionalLocation = (option) =>
    confirmedAdditionalLocations.find(
      (location) =>
        location.placename === (option.placename || option.optiontext)
    );

  const handleToggleAdditionalLocation = async (option, locationKind = null) => {
    const confirmedLocation = getConfirmedAdditionalLocation(option);

    if (!confirmedLocation) {
      await handleConfirm(option, locationKind);
      return;
    }

    if (!window.confirm("추가장소 등록을 취소하시겠습니까?")) return;

    try {
      await removeVoteConfirmedAdditionalLocation(confirmedLocation.id);
      await loadVote();
      alert("추가장소 등록을 취소했습니다.");
    } catch (error) {
      alert("추가장소 등록 취소 실패: " + error.message);
    }
  };

  const isConfirmedMiddleLocation = (option) =>
    vote.scheduleid &&
    vote.confirmed_schedules?.location ===
      (option.placename || option.optiontext);

  const handleToggleMiddleLocation = async (option) => {
    if (!isConfirmedMiddleLocation(option)) {
      await handleConfirm(option, "middle");
      return;
    }

    if (!window.confirm("중간위치 확정을 취소하시겠습니까?")) return;

    try {
      await clearConfirmedScheduleLocation(vote.scheduleid);
      await loadVote();
      alert("중간위치 확정을 취소했습니다.");
    } catch (error) {
      alert("중간위치 확정 취소 실패: " + error.message);
    }
  };

  const handleCreateScheduleFromLocation = () => {
    if (!appointmentTitle.trim()) {
      setNewScheduleTitleError("일정 이름을 입력해주세요.");
      return;
    }
    setNewScheduleTitleError("");
    setShowNewScheduleConfirmModal(true);
  };

  const handleScheduleConfirmLater = async () => {
    try {
      const schedule = await createDraftConfirmedSchedule(
        Number(roomid),
        appointmentTitle.trim()
      );
      if (pendingConfirmedLocation) {
        await applyConfirmedLocationToSchedule(
          schedule.id,
          pendingConfirmedLocation,
          pendingLocationKind === "middle",
          true,
          isManualLocationVote ? null : pendingLocationKind
        );
      }
      setShowNewScheduleConfirmModal(false);
      setShowScheduleModal(false);
      setPendingConfirmedLocation(null);
      setPendingLocationKind(null);
      setAppointmentTitle("");
      setNewScheduleTitleError("");
      navigate(`/rooms/${roomid}?tab=schedule`);
    } catch (error) {
      alert("일정 생성 실패: " + error.message);
    }
  };

  const handleScheduleConfirmNow = async () => {
    try {
      if (pendingConfirmedLocation) {
        await createLocationOnlyConfirmedSchedule(
          pendingConfirmedLocation,
          pendingLocationKind === "middle",
          appointmentTitle.trim(),
          isManualLocationVote ? null : pendingLocationKind
        );
      } else {
        await createDraftConfirmedSchedule(Number(roomid), appointmentTitle.trim());
      }
      setShowNewScheduleConfirmModal(false);
      setShowScheduleModal(false);
      setPendingConfirmedLocation(null);
      setPendingLocationKind(null);
      setAppointmentTitle("");
      setNewScheduleTitleError("");
      navigate(`/rooms/${roomid}?tab=location`);
    } catch (error) {
      alert("일정 생성 실패: " + error.message);
    }
  };

  const handleOpenCreatedSchedule = () => {
    if (!createdLocationOnlySchedule) return;
    navigate(`/rooms/${roomid}?tab=location`);
  };

  const handleConfirmWithLocation = async (goToLocation) => {
    if (!pendingOption) {
      alert("확정할 일정을 찾을 수 없습니다.");
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
      setLocationOnlySchedules([]);

      if (goToLocation) {
        navigate(`/rooms/${roomid}?tab=location`, { state: { selectedScheduleId: pendingLocationScheduleId } });
      } else {
        navigate("/home");
      }
    } catch (error) {
      alert("확정 실패: " + (error.message || JSON.stringify(error)));
    }
  };

  const handleLinkDatelessSchedule = async (scheduleId) => {
    try {
      await applyScheduleVoteToExisting(scheduleId, pendingOption, Number(voteid), Number(roomid));
      await loadVote();
      setShowLocationModal(false);
      setPendingOption(null);
      setAppointmentTitle("");
      setLocationOnlySchedules([]);
      setShowConfirmToast(true);
      setTimeout(() => setShowConfirmToast(false), 2500);
    } catch (error) {
      alert("일정 연결 실패: " + error.message);
    }
  };

  const handleLinkToExisting = async (scheduleId) => {
    try {
      await applyScheduleVoteToExisting(
        scheduleId,
        pendingOption,
        Number(voteid),
        Number(roomid)
        // title을 전달하지 않음 - 기존 위치 항목의 이름을 덮어쓰지 않기 위해
      );

      await loadVote();
      setShowLinkScheduleModal(false);
      setPendingOption(null);
      setAppointmentTitle("");
      setLocationOnlySchedules([]);

      navigate(`/rooms/${roomid}?tab=location`);
    } catch (error) {
      alert("일정 연결 실패: " + error.message);
    }
  };

  const handleDateChangeConfirm = async () => {
    if (!pendingLinkSchedule) return;
    const linkScheduleId = pendingLinkSchedule.id;
    const linkScheduleHasLocation = !!pendingLinkSchedule.location;
    setShowDateChangeWarningModal(false);
    setShowLocationModal(false);
    setPendingLinkSchedule(null);
    try {
      await applyScheduleVoteToExisting(
        linkScheduleId,
        pendingOption,
        Number(voteid),
        Number(roomid)
      );
      await loadVote();
      setPendingOption(null);
      setAppointmentTitle("");
      setLocationOnlySchedules([]);

      if (linkScheduleHasLocation) {
        navigate("/home");
      } else {
        setPendingLocationScheduleId(linkScheduleId);
        setShowAfterLinkLocationModal(true);
      }
    } catch (error) {
      alert("일정 연결 실패: " + error.message);
    }
  };

  const handleConfirmWithNewName = async () => {
    if (!appointmentTitle.trim()) {
      setNewScheduleTitleError("일정 이름을 입력해주세요.");
      return;
    }
    setNewScheduleTitleError("");
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

      // 방금 생성된 일정 ID 조회 (위치탭 자동 선택에 사용)
      const { data: newSchedule } = await supabase
        .from("confirmed_schedules")
        .select("id")
        .eq("voteid", Number(voteid))
        .maybeSingle();
      setCreatedScheduleId(newSchedule?.id ?? null);

      setShowLocationModal(false);
      setPendingOption(null);
      setAppointmentTitle("");
      setLocationOnlySchedules([]);
      setShowScheduleVoteLocationModal(true);
    } catch (error) {
      alert("확정 실패: " + (error.message || JSON.stringify(error)));
    }
  };

  const handleGoToLocationNow = async () => {
    if (isReconfirmation) {
      await handleConfirmWithLocation(true);
      return;
    }
    if (locationOnlySchedules.length > 0) {
      setPendingGoToLocation(true);
      setShowLocationModal(false);
      setShowLinkScheduleModal(true);
    } else {
      setShowLocationModal(false);
      setAppointmentTitle("");
      setNameInputMode("new_with_location");
      setShowNameInputModal(true);
    }
  };

  const handleGoToLocationLater = async () => {
    if (isReconfirmation) {
      await handleConfirmWithLocation(false);
      return;
    }
    setShowLocationModal(false);
    setAppointmentTitle("");
    setNameInputMode("later");
    setShowNameInputModal(true);
  };

  const handleFromScheduleConfirm = async () => {
    if (!pendingOption || !fromSchedule) return;
    try {
      await applyScheduleVoteToExisting(
        fromSchedule.id,
        pendingOption,
        Number(voteid),
        Number(roomid)
      );
      await loadVote();
      sessionStorage.removeItem("confirmFromSchedule");
      setFromSchedule(null);
      setShowFromScheduleModal(false);
      setPendingOption(null);
      setAppointmentTitle("");
      if (fromSchedule.hasLocation) {
        navigate(`/rooms/${roomid}?tab=location`);
      } else {
        setPendingLocationScheduleId(fromSchedule.id);
        setShowAfterUpdateLocationModal(true);
      }
    } catch (error) {
      alert("일정 변경 실패: " + error.message);
    }
  };

  const handleFromScheduleDecline = () => {
    setShowFromScheduleModal(false);
    sessionStorage.removeItem("confirmFromSchedule");
    setFromSchedule(null);
    setShowLocationModal(true);
  };

  const handleSubmitWithName = async () => {
    if (!appointmentTitle.trim()) {
      alert("약속 이름을 입력해주세요.");
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
      setShowNameInputModal(false);
      setShowLinkScheduleModal(false);
      setPendingOption(null);
      setAppointmentTitle("");
      setLocationOnlySchedules([]);
      const currentMode = nameInputMode;
      setNameInputMode(null);

      if (currentMode === "new_with_location") {
        navigate(`/rooms/${roomid}?tab=location`);
      } else {
        navigate(`/rooms/${roomid}?tab=schedule`);
      }
    } catch (error) {
      alert("확정 실패: " + (error.message || JSON.stringify(error)));
    }
  };

  const handleLoadDetailAvailabilities = async () => {
    try {
      const [avail, cands] = await Promise.all([
        getMemberAvailabilities(roomid),
        getScheduleCandidates(roomid),
      ]);
      if (avail.length === 0) {
        alert("가능한 시간이 없습니다. 일정을 등록해주세요.");
        return;
      }
      setDetailAvailabilities(avail);
      setDetailCandidates(cands);
      setDetailSelectedSlots([]);
      setDetailSelectedMultiDays([]);
      setDetailAvailMode("당일");
      setDetailAvailNDays(2);
      setShowDetailAvailModal(true);
    } catch {
      alert("가능 시간 불러오기 실패");
    }
  };

  const handleAddDetailAvailAsOptions = async () => {
    const existingOptionDates = new Set(
      (vote.voteoptions || []).map((o) => `${o.optiondate}|${o.starttime || ""}`)
    );
    let newOpts = [];
    if (detailAvailMode === "당일") {
      newOpts = detailSelectedSlots.filter(
        (s) => !existingOptionDates.has(`${s.date}|${s.starttime || ""}`)
      );
    } else {
      newOpts = detailSelectedMultiDays.flatMap((r) =>
        r.dates
          .filter((d) => !existingOptionDates.has(`${d}|`))
          .map((d) => ({ date: d, starttime: null, endtime: null, isallday: true }))
      );
    }
    for (const opt of newOpts) {
      await addVoteOption(Number(voteid), {
        optiontype: "date",
        optiondate: detailAvailMode === "당일" ? opt.date : opt.date,
        starttime: opt.starttime || null,
        endtime: opt.endtime || null,
        isallday: detailAvailMode === "일별" ? true : Boolean(opt.isallday),
      });
    }
    setShowDetailAvailModal(false);
    setDetailSelectedSlots([]);
    setDetailSelectedMultiDays([]);
    await loadVote();
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

      // 📢 방에 소속된 모든 사람(회원+게스트)에게 마감 알림 발송
      await sendVoteClosedNotification({
        roomid: Number(roomid),
        voteid: Number(voteid),
        title: vote.title,
        senderId: currentUser?.id,
      });

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
    if (
      vote.isclosed ||
      (vote.endtimeenabled &&
        vote.endtime &&
        new Date(vote.endtime).getTime() <= Date.now())
    ) {
      setIsEditMode(false);
      alert("종료된 투표는 수정할 수 없습니다.");
      return;
    }

    if (!editTitle.trim()) {
      alert("투표 제목을 입력하세요.");
      return;
    }

    if (editPlaceOptions.length === 0) {
      alert("투표 선택지를 1개 이상 입력하세요.");
      return;
    }

    for (const option of editPlaceOptions) {
      const errorMessage = validateEditOptionForSave(option);

      if (errorMessage) {
        alert(errorMessage);
        return;
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

      for (const deletedOptionId of editDeletedOptionIds) {
        await deleteVoteOptionFromDatabase(deletedOptionId);
      }

      for (const option of editPlaceOptions) {
        const optionPayload = toEditOptionPayload(option);

        if (option.id) {
          await updateVoteOption(option.id, optionPayload);
        } else {
          await addVoteOption(Number(voteid), optionPayload);
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

    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 2500);
  };

  const detailTopTimes = sortAvailableTimes(getTopAvailableTimes(detailAvailabilities), "count");
  const detailConsecutive = getTopConsecutiveDays(detailAvailabilities, detailCandidates, detailAvailNDays);
  const detailSelectedCount = detailAvailMode === "당일" ? detailSelectedSlots.length : detailSelectedMultiDays.length;
  const detailMakeKey = (t) => `${t.date}_${t.starttime}_${t.endtime}`;
  const detailMakeMultiKey = (r) => r.dates.join("_");
  const detailFormatDate = (s) => { if (!s) return ""; const d = new Date(s + "T00:00:00"); return `${s} (${["일","월","화","수","목","금","토"][d.getDay()]})`; };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-color)" }}>
      {showDetailAvailModal && (
        <>
          <div onClick={() => setShowDetailAvailModal(false)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 400 }} />
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, backgroundColor: "var(--bg-color)", borderRadius: "20px 20px 0 0", padding: "0 0 80px", zIndex: 401, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 20px 0" }}>
              <span style={{ fontSize: "16px", fontWeight: "bold" }}>가능 시간 선택</span>
              <button onClick={() => setShowDetailAvailModal(false)} style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", color: "#aaa" }}>✕</button>
            </div>
            <div style={{ display: "flex", borderBottom: "1px solid #eee", margin: "12px 0 0" }}>
              {["당일", "일별"].map((tab) => (
                <button key={tab} onClick={() => { setDetailAvailMode(tab); setDetailSelectedSlots([]); setDetailSelectedMultiDays([]); }}
                  style={{ flex: 1, padding: "10px", border: "none", borderBottom: detailAvailMode === tab ? "2px solid #7c79ff" : "2px solid transparent", backgroundColor: "transparent", color: detailAvailMode === tab ? "#7c79ff" : "#888", fontWeight: detailAvailMode === tab ? "bold" : "normal", fontSize: "15px", cursor: "pointer" }}
                >{tab}</button>
              ))}
            </div>
            {detailAvailMode === "일별" && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 20px 0" }}>
                <span style={{ fontSize: "14px", fontWeight: "600" }}>며칠 연속?</span>
                <input type="number" min="2" max="30" value={detailAvailNDays} onChange={(e) => { setDetailAvailNDays(Math.max(2, Number(e.target.value))); setDetailSelectedMultiDays([]); }}
                  style={{ width: "60px", padding: "6px 10px", fontSize: "15px", border: "1px solid #ddd", borderRadius: "8px", textAlign: "center" }} />
                <span style={{ fontSize: "14px", color: "#555" }}>일</span>
              </div>
            )}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 0" }}>
              {detailAvailMode === "당일" && detailTopTimes.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                  <button type="button" onClick={() => detailSelectedSlots.length === detailTopTimes.length ? setDetailSelectedSlots([]) : setDetailSelectedSlots([...detailTopTimes])}
                    style={{ fontSize: "13px", color: "#7c79ff", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    {detailSelectedSlots.length === detailTopTimes.length ? "모두 해제" : "모두 선택"}
                  </button>
                </div>
              )}
              {detailAvailMode === "당일" && (
                detailTopTimes.length === 0
                  ? <p style={{ color: "#aaa", textAlign: "center", marginTop: "30px" }}>가능한 시간이 없습니다.</p>
                  : detailTopTimes.map((time, i) => {
                    const key = detailMakeKey(time); const checked = detailSelectedSlots.some((s) => detailMakeKey(s) === key);
                    const h = Math.floor(time.duration / 60), m = time.duration % 60;
                    return (
                      <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: "12px", border: `1px solid ${checked ? "#7c79ff" : "#eee"}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", backgroundColor: checked ? "#f5f5ff" : "var(--bg-color)", cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => setDetailSelectedSlots((prev) => checked ? prev.filter((s) => detailMakeKey(s) !== key) : [...prev, time])} style={{ marginTop: "3px", accentColor: "#7c79ff" }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: "bold" }}>{i + 1}순위</span><span style={{ fontSize: "12px", backgroundColor: "#7c79ff", color: "#fff", borderRadius: "10px", padding: "2px 8px" }}>{time.availableCount}명 가능</span></div>
                          <p style={{ margin: "6px 0 2px", fontSize: "14px" }}>{detailFormatDate(time.date)}</p>
                          <p style={{ margin: 0, fontSize: "13px", color: "#666" }}>{time.starttime} ~ {time.endtime}<span style={{ marginLeft: "8px", color: "#7c79ff" }}>({h > 0 ? `${h}시간 ` : ""}{m > 0 ? `${m}분` : ""})</span></p>
                        </div>
                      </label>
                    );
                  })
              )}
              {detailAvailMode === "일별" && detailConsecutive.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                  <button type="button" onClick={() => detailSelectedMultiDays.length === detailConsecutive.length ? setDetailSelectedMultiDays([]) : setDetailSelectedMultiDays([...detailConsecutive])}
                    style={{ fontSize: "13px", color: "#7c79ff", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    {detailSelectedMultiDays.length === detailConsecutive.length ? "모두 해제" : "모두 선택"}
                  </button>
                </div>
              )}
              {detailAvailMode === "일별" && (
                detailConsecutive.length === 0
                  ? <p style={{ color: "#aaa", textAlign: "center", marginTop: "30px" }}>{detailAvailNDays}일 연속 가능한 조합이 없습니다.</p>
                  : detailConsecutive.map((result, i) => {
                    const key = detailMakeMultiKey(result); const checked = detailSelectedMultiDays.some((s) => detailMakeMultiKey(s) === key);
                    return (
                      <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: "12px", border: `1px solid ${checked ? "#7c79ff" : "#eee"}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", backgroundColor: checked ? "#f5f5ff" : "var(--bg-color)", cursor: "pointer" }}>
                        <input type="checkbox" checked={checked} onChange={() => setDetailSelectedMultiDays((prev) => checked ? prev.filter((s) => detailMakeMultiKey(s) !== key) : [...prev, result])} style={{ marginTop: "3px", accentColor: "#7c79ff" }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: "bold" }}>{i + 1}순위</span><span style={{ fontSize: "12px", backgroundColor: "#7c79ff", color: "#fff", borderRadius: "10px", padding: "2px 8px" }}>{result.availableCount}명 가능</span></div>
                          <p style={{ margin: "6px 0 4px", fontSize: "14px" }}>{detailFormatDate(result.startDate)} ~ {detailFormatDate(result.endDate)}</p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>{result.dates.map((d) => <span key={d} style={{ fontSize: "12px", backgroundColor: "#f0f0ff", color: "#7c79ff", borderRadius: "6px", padding: "2px 7px" }}>{d}</span>)}</div>
                        </div>
                      </label>
                    );
                  })
              )}
            </div>
            <div style={{ padding: "12px 20px 0" }}>
              <button onClick={handleAddDetailAvailAsOptions} disabled={detailSelectedCount === 0}
                style={{ width: "100%", padding: "13px", backgroundColor: detailSelectedCount > 0 ? "#7c79ff" : "#eee", color: detailSelectedCount > 0 ? "#fff" : "#aaa", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: "bold", cursor: detailSelectedCount > 0 ? "pointer" : "default" }}>
                {detailSelectedCount > 0 ? `${detailSelectedCount}개 후보로 추가` : "선택 후 추가"}
              </button>
            </div>
          </div>
        </>
      )}

      {showReconfirmWarningModal && (
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
              backgroundColor: "var(--bg-color)",
              borderRadius: "16px",
              padding: "24px",
              width: "300px",
            }}
          >
            <h3 style={{ marginBottom: "12px", textAlign: "center" }}>
              ⚠️ 이미 확정된 일정입니다
            </h3>

            <p
              style={{
                fontSize: "14px",
                color: "var(--text-color)",
                textAlign: "center",
                lineHeight: "1.6",
                marginBottom: "20px",
              }}
            >
              일정을 변경하면 기존 확정일정{" "}
              <strong>"{existingScheduleTitle}"</strong>의 일정이 변경됩니다.
              {"\n"}계속하시겠어요?
            </p>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => {
                  setShowReconfirmWarningModal(false);
                  setPendingOption(null);
                  setAppointmentTitle("");
                }}
                style={{
                  flex: 1,
                  padding: "12px",
                  backgroundColor: "var(--btn-bg)",
                  color: "var(--text-color)",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "15px",
                  cursor: "pointer",
                }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowReconfirmWarningModal(false);
                  setShowLocationModal(true);
                }}
                style={{
                  flex: 1,
                  padding: "12px",
                  backgroundColor: "#7c79ff",
                  color: "#fff",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "15px",
                  cursor: "pointer",
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {showDateChangeWarningModal && pendingLinkSchedule && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
          <div style={{ backgroundColor: "var(--bg-color)", borderRadius: "16px", padding: "24px", width: "90%", maxWidth: "360px" }}>
            <h3 style={{ marginBottom: "8px", textAlign: "center" }}>⚠️ 날짜가 변경됩니다</h3>
            <p style={{ color: "var(--secondary-text)", fontSize: "13px", textAlign: "center", marginBottom: "20px" }}>
              <strong>"{pendingLinkSchedule.title || "일정"}"</strong>의 날짜가 이 투표 결과로 변경됩니다.
              {pendingLinkSchedule.location && (
                <><br /><span style={{ color: "#7c79ff" }}>위치는 기존 위치로 유지됩니다.</span></>
              )}
              <br />계속하시겠어요?
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setShowDateChangeWarningModal(false); setPendingLinkSchedule(null); }}
                style={{ flex: 1, padding: "12px", backgroundColor: "var(--card-bg)", color: "var(--text-color)", border: "1px solid var(--border-color)", borderRadius: "10px", fontSize: "15px", cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={handleDateChangeConfirm}
                style={{ flex: 1, padding: "12px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer" }}
              >
                변경하기
              </button>
            </div>
          </div>
        </div>
      )}

      {showAfterLinkLocationModal && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
          <div style={{ backgroundColor: "var(--bg-color)", borderRadius: "16px", padding: "24px", width: "90%", maxWidth: "360px" }}>
            <h3 style={{ marginBottom: "8px", textAlign: "center" }}>일정이 변경되었습니다!</h3>
            <p style={{ color: "var(--secondary-text)", fontSize: "13px", textAlign: "center", marginBottom: "20px" }}>
              지금 만날 위치를 등록하시겠어요?
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setShowAfterLinkLocationModal(false); navigate("/home"); }}
                style={{ flex: 1, padding: "12px", backgroundColor: "var(--card-bg)", color: "var(--text-color)", border: "1px solid var(--border-color)", borderRadius: "10px", fontSize: "15px", cursor: "pointer" }}
              >
                나중에 등록하기
              </button>
              <button
                onClick={() => { setShowAfterLinkLocationModal(false); navigate(`/rooms/${roomid}?tab=location`, { state: { selectedScheduleId: pendingLocationScheduleId } }); }}
                style={{ flex: 1, padding: "12px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer" }}
              >
                위치 등록하기
              </button>
            </div>
          </div>
        </div>
      )}

      {showFromScheduleModal && fromSchedule && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ backgroundColor: "var(--bg-color)", borderRadius: "16px", padding: "24px", width: "90%", maxWidth: "360px", position: "relative" }}>
            <h3 style={{ marginBottom: "8px", textAlign: "center" }}>일정 변경</h3>
            <p style={{ color: "var(--secondary-text)", fontSize: "13px", textAlign: "center", marginBottom: "20px" }}>
              <strong>"{fromSchedule.title}"</strong> 일정을 이 투표 결과로 변경하시겠어요?
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleFromScheduleDecline}
                style={{ flex: 1, padding: "12px", backgroundColor: "var(--card-bg)", color: "var(--text-color)", border: "1px solid var(--border-color)", borderRadius: "10px", fontSize: "15px", cursor: "pointer" }}
              >
                새 일정으로
              </button>
              <button
                onClick={handleFromScheduleConfirm}
                style={{ flex: 1, padding: "12px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer" }}
              >
                변경하기
              </button>
            </div>
          </div>
        </div>
      )}

      {showAfterUpdateLocationModal && (
        <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ backgroundColor: "var(--bg-color)", borderRadius: "16px", padding: "24px", width: "90%", maxWidth: "360px" }}>
            <h3 style={{ marginBottom: "8px", textAlign: "center" }}>일정이 변경되었습니다!</h3>
            <p style={{ color: "var(--secondary-text)", fontSize: "13px", textAlign: "center", marginBottom: "20px" }}>
              만날 위치를 지금 정하시겠어요?
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => { setShowAfterUpdateLocationModal(false); navigate("/home"); }}
                style={{ flex: 1, padding: "12px", backgroundColor: "var(--card-bg)", color: "var(--text-color)", border: "1px solid var(--border-color)", borderRadius: "10px", fontSize: "15px", cursor: "pointer" }}
              >
                나중에 정하기
              </button>
              <button
                onClick={() => { setShowAfterUpdateLocationModal(false); navigate(`/rooms/${roomid}?tab=location`, { state: { selectedScheduleId: pendingLocationScheduleId } }); }}
                style={{ flex: 1, padding: "12px", backgroundColor: "#7c79ff", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", cursor: "pointer" }}
              >
                지금 정하기
              </button>
            </div>
          </div>
        </div>
      )}

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
              backgroundColor: "var(--bg-color)",
              borderRadius: "16px",
              padding: "24px",
              width: "300px",
              maxHeight: "80vh",
              overflowY: "auto",
              position: "relative",
            }}
          >
            <button
              onClick={() => {
                setShowLocationModal(false);
                setPendingOption(null);
                setAppointmentTitle("");
                setNewScheduleTitleError("");
              }}
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                border: "none",
                background: "none",
                fontSize: "18px",
                color: "var(--secondary-text)",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ✕
            </button>

            <h3 style={{ marginBottom: "4px", textAlign: "center" }}>
              {isReconfirmation ? "일정이 변경되었습니다!" : "일정이 확정되었습니다!"}
            </h3>

            <p
              style={{
                color: "var(--secondary-text)",
                fontSize: "13px",
                textAlign: "center",
                marginBottom: "16px",
              }}
            >
              {existingHasLocation
                ? "기존 위치가 유지됩니다."
                : isReconfirmation
                ? "만날 위치를 지금 정하시겠어요?"
                : "일정을 등록할 일정을 선택하거나 새 일정을 만들어 주세요."}
            </p>
            {existingHasLocation ? (
              <button
                onClick={() => handleConfirmWithLocation(false)}
                style={{
                  width: "100%",
                  padding: "12px",
                  backgroundColor: "#7c79ff",
                  color: "#fff",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "15px",
                  cursor: "pointer",
                }}
              >
                확인
              </button>
            ) : isReconfirmation ? (
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => handleConfirmWithLocation(false)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    backgroundColor: "var(--card-bg)",
                    color: "var(--text-color)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "10px",
                    fontSize: "15px",
                    cursor: "pointer",
                  }}
                >
                  나중에 정하기
                </button>
                <button
                  onClick={() => handleConfirmWithLocation(true)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    backgroundColor: "#7c79ff",
                    color: "#fff",
                    border: "none",
                    borderRadius: "10px",
                    fontSize: "15px",
                    cursor: "pointer",
                  }}
                >
                  지금 정하기
                </button>
              </div>
            ) : (
              <>
                {/* 1. 확정된 일정에서 정하기 */}
                <div style={{ marginBottom: "20px" }}>
                  <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: "bold" }}>
                    1. 확정된 일정에서 정하기
                  </p>

                  {roomConfirmedSchedules.length === 0 ? (
                    <p style={{ fontSize: "13px", color: "#aaa", margin: "8px 0" }}>
                      확정된 일정이 없습니다.
                    </p>
                  ) : (
                    <div style={{ maxHeight: "180px", overflowY: "auto" }}>
                      {roomConfirmedSchedules.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            if (s.date) {
                              setPendingLinkSchedule(s);
                              setShowDateChangeWarningModal(true);
                            } else {
                              handleLinkDatelessSchedule(s.id);
                            }
                          }}
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            marginBottom: "6px",
                            backgroundColor: "var(--card-bg)",
                            color: "var(--text-color)",
                            border: "1px solid var(--border-color)",
                            borderRadius: "10px",
                            fontSize: "14px",
                            cursor: "pointer",
                            textAlign: "left",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "8px",
                            boxSizing: "border-box",
                          }}
                        >
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.title || "제목 없음"}
                          </span>
                          <span style={{ fontSize: "12px", color: "#888", whiteSpace: "nowrap", flexShrink: 0 }}>
                            {s.date ? `${s.date}${s.starttime ? ` ${s.starttime}` : ""}` : "날짜 미정"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. 새로운 확정 일정 추가하기 */}
                <div>
                  <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: "bold" }}>
                    2. 새로운 확정 일정 추가하기
                  </p>

                  <input
                    type="text"
                    placeholder="일정 이름 (예: 팀 회식, 생일 파티...)"
                    value={appointmentTitle}
                    onChange={(e) => {
                      setAppointmentTitle(e.target.value);
                      setNewScheduleTitleError("");
                    }}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: "14px",
                      border: `1px solid ${newScheduleTitleError ? "#e53935" : "var(--border-color)"}`,
                      borderRadius: "10px",
                      boxSizing: "border-box",
                      marginBottom: newScheduleTitleError ? "4px" : "8px",
                    }}
                  />

                  {newScheduleTitleError && (
                    <p style={{ fontSize: "12px", color: "#e53935", margin: "0 0 8px 2px" }}>
                      {newScheduleTitleError}
                    </p>
                  )}

                  <button
                    onClick={handleConfirmWithNewName}
                    style={{
                      width: "100%",
                      padding: "14px",
                      backgroundColor: "#7c79ff",
                      color: "#fff",
                      border: "none",
                      borderRadius: "12px",
                      fontSize: "15px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    새로운 확정 일정 추가하기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showScheduleModal && (
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
              backgroundColor: "var(--bg-color)",
              borderRadius: "16px",
              padding: "24px",
              width: "300px",
              maxHeight: "80vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <h3 style={{ marginBottom: "4px", textAlign: "center" }}>
              {pendingLocationKind === "middle"
                ? "만날 위치가 확정되었습니다!"
                : "추가 위치가 확정되었습니다!"}
            </h3>

            <p
              style={{
                color: "var(--secondary-text)",
                fontSize: "13px",
                textAlign: "center",
                marginBottom: "16px",
              }}
            >
              위치를 추가할 일정을 선택하거나 새 일정을 만들어 주세요.
            </p>

            {/* 1. 확정된 일정에서 정하기 */}
            <div style={{ marginBottom: "20px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: "bold" }}>
                1. 확정된 일정에서 정하기
              </p>

              {roomConfirmedSchedules.length === 0 ? (
                <p style={{ fontSize: "13px", color: "#aaa", margin: "8px 0" }}>
                  연결할 확정 일정이 없습니다. 새 일정을 추가해주세요.
                </p>
              ) : (
                <div className="location-confirmed-schedule-list">
                  {roomConfirmedSchedules.map((schedule) => (
                    <button
                      key={schedule.id}
                      onClick={() => handleApplyLocationToSchedule(schedule.id)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        marginBottom: "6px",
                        backgroundColor: "var(--card-bg)",
                        color: "var(--text-color)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "10px",
                        fontSize: "14px",
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {schedule.title || "제목 없음"}
                      </span>
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: "12px",
                          color: schedule.location ? "#888" : "#aaa",
                        }}
                      >
                        {schedule.location || "장소 미정"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 2. 새로운 확정 일정 추가하기 */}
            <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: "bold" }}>
              2. 새로운 확정 일정 추가하기
            </p>

            <input
              type="text"
              placeholder="일정 이름 (예: 팀 회식, 생일 파티...)"
              value={appointmentTitle}
              onChange={(e) => { setAppointmentTitle(e.target.value); setNewScheduleTitleError(""); }}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "14px",
                border: `1px solid ${newScheduleTitleError ? "#e53935" : "var(--border-color)"}`,
                borderRadius: "10px",
                boxSizing: "border-box",
                marginBottom: newScheduleTitleError ? "4px" : "8px",
              }}
            />

            {newScheduleTitleError && (
              <p style={{ fontSize: "12px", color: "#e53935", margin: "0 0 8px 2px" }}>
                {newScheduleTitleError}
              </p>
            )}

            <button
              onClick={handleCreateScheduleFromLocation}
              style={{
                width: "100%",
                padding: "14px",
                backgroundColor: "#7c79ff",
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                fontSize: "15px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              새로운 확정 일정 추가하기
            </button>
          </div>
        </div>
      )}

      {showNewScheduleConfirmModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
        >
          <div
            style={{
              width: "300px",
              padding: "28px 24px",
              borderRadius: "16px",
              backgroundColor: "var(--bg-color)",
              textAlign: "center",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: "8px", fontSize: "18px" }}>
              일정을 정하러 가시겠습니까?
            </h3>
            <p style={{ color: "var(--secondary-text)", fontSize: "13px", lineHeight: "1.6", marginBottom: "20px" }}>
              만날 날짜와 일정 이름은 저장되었습니다.{"\n"}날짜와 시간은 나중에 입력할 수도 있습니다.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={handleScheduleConfirmLater}
                style={{
                  flex: 1,
                  padding: "12px",
                  border: "none",
                  borderRadius: "10px",
                  backgroundColor: "var(--btn-bg)",
                  color: "var(--btn-text)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                나중에 하기
              </button>
              <button
                type="button"
                onClick={handleScheduleConfirmNow}
                style={{
                  flex: 1,
                  padding: "12px",
                  border: "none",
                  borderRadius: "10px",
                  backgroundColor: "#7c79ff",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                지금 위치 정하기
              </button>
            </div>
          </div>
        </div>
      )}

      {showScheduleVoteLocationModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
        >
          <div
            style={{
              width: "300px",
              padding: "28px 24px",
              borderRadius: "16px",
              backgroundColor: "var(--bg-color)",
              textAlign: "center",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: "8px", fontSize: "18px" }}>
              위치를 정하시겠습니까?
            </h3>
            <p style={{ color: "var(--secondary-text)", fontSize: "13px", lineHeight: "1.6", marginBottom: "20px" }}>
              만날 날짜와 일정 이름은 저장되었습니다.{"\n"}위치는 나중에 입력할 수도 있습니다.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => {
                  setShowScheduleVoteLocationModal(false);
                  navigate("/home");
                }}
                style={{
                  flex: 1,
                  padding: "12px",
                  border: "none",
                  borderRadius: "10px",
                  backgroundColor: "var(--btn-bg)",
                  color: "var(--btn-text)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                나중에 하기
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowScheduleVoteLocationModal(false);
                  navigate(`/rooms/${roomid}?tab=location`, {
                    state: { selectedScheduleId: createdScheduleId },
                  });
                }}
                style={{
                  flex: 1,
                  padding: "12px",
                  border: "none",
                  borderRadius: "10px",
                  backgroundColor: "#7c79ff",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                지금 위치 정하기
              </button>
            </div>
          </div>
        </div>
      )}

      {showLinkScheduleModal && (
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
              backgroundColor: "var(--bg-color)",
              borderRadius: "16px",
              padding: "24px",
              width: "300px",
            }}
          >
            <h3 style={{ marginBottom: "4px", textAlign: "center" }}>
              일정이 확정되었습니다!
            </h3>

            <p
              style={{
                color: "var(--secondary-text)",
                fontSize: "13px",
                textAlign: "center",
                marginBottom: "16px",
              }}
            >
              위치만 등록된 기존 항목에 이번 일정을 연결하거나, 새 위치를 정할 수 있어요.
            </p>

            <div style={{ marginBottom: "12px" }}>
              <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: "bold" }}>
                기존 위치 항목에 일정 연결
              </p>

              {locationOnlySchedules.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleLinkToExisting(s.id)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginBottom: "6px",
                    backgroundColor: "var(--card-bg)",
                    color: "var(--text-color)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "10px",
                    fontSize: "14px",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  📍 {s.location}
                  {s.title ? ` · ${s.title}` : ""}
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                setShowLinkScheduleModal(false);
                setAppointmentTitle("");
                setNameInputMode("new_with_location");
                setShowNameInputModal(true);
              }}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#7c79ff",
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                fontSize: "15px",
                cursor: "pointer",
              }}
            >
              새 위치 정하기
            </button>
          </div>
        </div>
      )}

      {showNameInputModal && (
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
              backgroundColor: "var(--bg-color)",
              borderRadius: "16px",
              padding: "24px",
              width: "300px",
              position: "relative",
            }}
          >
            <button
              onClick={() => {
                setShowNameInputModal(false);
                setPendingOption(null);
                setAppointmentTitle("");
                setNameInputMode(null);
              }}
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                border: "none",
                background: "none",
                fontSize: "18px",
                color: "var(--secondary-text)",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ✕
            </button>

            <h3 style={{ marginBottom: "4px", textAlign: "center" }}>약속 이름을 입력해주세요</h3>

            <p
              style={{
                color: "var(--secondary-text)",
                fontSize: "13px",
                textAlign: "center",
                marginBottom: "12px",
              }}
            >
              {nameInputMode === "later"
                ? "위치는 나중에 위치 탭에서 등록할 수 있어요."
                : "새 위치를 등록할 일정의 이름을 입력해주세요."}
            </p>

            <input
              type="text"
              placeholder="약속 이름"
              value={appointmentTitle}
              onChange={(e) => setAppointmentTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmitWithName()}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "14px",
                border: `1px solid ${appointmentTitle.trim() ? "#ddd" : "#ffbbbb"}`,
                borderRadius: "10px",
                boxSizing: "border-box",
                marginBottom: "4px",
              }}
            />

            {!appointmentTitle.trim() && (
              <p style={{ fontSize: "12px", color: "#e53935", margin: "0 0 10px 2px" }}>
                약속 이름을 입력해주세요.
              </p>
            )}
            {appointmentTitle.trim() && <div style={{ marginBottom: "10px" }} />}

            <button
              disabled={!appointmentTitle.trim()}
              onClick={handleSubmitWithName}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: appointmentTitle.trim() ? "#7c79ff" : "#ccc",
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                fontSize: "15px",
                cursor: appointmentTitle.trim() ? "pointer" : "not-allowed",
              }}
            >
              확인
            </button>
          </div>
        </div>
      )}

      {confirmedLocationSchedulePrompt && (
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
              width: "300px",
              padding: "24px",
              borderRadius: "16px",
              backgroundColor: "var(--bg-color)",
              textAlign: "center",
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              {confirmedLocationSchedulePrompt.title}에 등록됐어요.
            </h3>
            <p style={{ color: "var(--secondary-text)", fontSize: "13px" }}>
              아직 날짜와 시간이 정해지지 않았어요. 일정을 정하러 이동할까요?
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setConfirmedLocationSchedulePrompt(null)}
                style={{
                  flex: 1,
                  padding: "10px",
                  border: "none",
                  borderRadius: "8px",
                  backgroundColor: "var(--btn-bg)",
                  color: "var(--btn-text)",
                  cursor: "pointer",
                }}
              >
                나중에 하기
              </button>
              <button
                type="button"
                onClick={() => navigate(`/rooms/${roomid}?tab=schedule`)}
                style={{
                  flex: 1,
                  padding: "10px",
                  border: "none",
                  borderRadius: "8px",
                  backgroundColor: "#7c79ff",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                지금 하기
              </button>
            </div>
          </div>
        </div>
      )}

      {createdLocationOnlySchedule && (
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
              width: "300px",
              padding: "24px",
              borderRadius: "16px",
              backgroundColor: "var(--bg-color)",
              textAlign: "center",
            }}
          >
            <h3 style={{ marginTop: 0 }}>위치를 정하러 가시겠습니까?</h3>
            <p style={{ color: "var(--secondary-text)", fontSize: "13px" }}>
              만날 날짜와 일정이름은 저장되었습니다. 위치는 나중에 입력할 수 있습니다.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setCreatedLocationOnlySchedule(null)}
                style={{
                  flex: 1,
                  padding: "10px",
                  border: "none",
                  borderRadius: "8px",
                  backgroundColor: "var(--btn-bg)",
                  color: "var(--btn-text)",
                  cursor: "pointer",
                }}
              >
                나중에 하기
              </button>
              <button
                type="button"
                onClick={handleOpenCreatedSchedule}
                style={{
                  flex: 1,
                  padding: "10px",
                  border: "none",
                  borderRadius: "8px",
                  backgroundColor: "#7c79ff",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                지금 위치 정하기
              </button>
            </div>
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
          borderBottom: "1px solid var(--border-color)",
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
            {!isClosed && (
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
            )}

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

        <div style={{ color: "#aaa", fontSize: "12px", marginBottom: "4px", lineHeight: "1.8" }}>
          {vote.createdat && (() => {
            const ts = vote.createdat;
            const d = new Date(/[Z+]/.test(ts) ? ts : ts + "Z");
            return <div>생성: {d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>;
          })()}
          {vote.updatedat && (() => {
            const ts = vote.updatedat;
            const d = new Date(/[Z+]/.test(ts) ? ts : ts + "Z");
            return <div>수정: {d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>;
          })()}
          {(isClosed || vote.endtimeenabled) && vote.endtime && (() => {
            const ts = vote.endtime;
            const d = new Date(/[Z+]/.test(ts) ? ts : ts + "Z");
            return <div>종료: {d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>;
          })()}
        </div>

        {isClosed ? (
          <p style={{ color: "#aaa", fontSize: "14px" }}>종료된 투표입니다</p>
        ) : vote.endtimeenabled && vote.endtime ? (
          <p style={{ color: "#f66", fontSize: "14px" }}>
            {getTimeRemaining(vote.endtime)}
          </p>
        ) : null}

        {vote.votetype === "schedule" && linkedSchedule && (
          <p
            style={{
              color: "#555",
              fontSize: "14px",
              padding: "10px",
              backgroundColor: "#f8f8ff",
              border: "1px solid #d8d8ff",
              borderRadius: "8px",
            }}
          >
            연결된 일정: <strong>"{linkedSchedule.title || "일정"}"</strong>
            {linkedSchedule.date && (
              <><br /><span style={{ fontSize: "13px", color: "#888" }}>{linkedSchedule.date}</span></>
            )}
          </p>
        )}

        {isLocationVote && vote.scheduleid && (
          <p
            style={{
              color: "#555",
              fontSize: "14px",
              padding: "10px",
              backgroundColor: "#f8f8ff",
              border: "1px solid #d8d8ff",
              borderRadius: "8px",
            }}
          >
            대상 일정: <strong>{vote.confirmed_schedules?.title || "선택한 일정"}</strong>
            <br />
            확정된 장소는 이 일정에 자동 저장됩니다.
          </p>
        )}

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
            위치 투표는 투표 종료와 별개로, 생성자가
            <strong>
              {isManualLocationVote
                ? " 중간위치 확정 또는 추가장소 등록 "
                : isMiddlePlaceVote
                ? " 중간위치 확정하기 "
                : " 추가장소 확정하기 "}
            </strong>
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

            <EditVoteOptionsPanel
              votetype={vote.votetype}
              editOptions={editPlaceOptions}
              onChangeOption={handleChangeEditPlaceOption}
              onAddOption={handleAddEditPlaceOption}
              onRemoveOption={handleRemoveEditPlaceOption}
            />

            <label style={editCheckLabelStyle}>
              <input
                type="checkbox"
                checked={editEndtimeEnabled}
                onChange={(e) => {
                  setEditEndtimeEnabled(e.target.checked);
                  if (!e.target.checked) {
                    setEditEndtime("");
                    setEditReminderEnabled(false);
                  }
                }}
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
                disabled={!editEndtimeEnabled || !editEndtime}
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

          </div>
        ) : (
          <h2 style={{ margin: "8px 0" }}>{vote.title}</h2>
        )}

        {!isEditMode && (
          <>
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              {vote.ismultiple && <span style={badgeStyle}>복수선택</span>}
              {vote.isanonymous && <span style={badgeStyle}>익명투표</span>}
              {isLocationVote && (
                <span style={badgeStyle}>
                  {isManualLocationVote
                    ? "일반 위치 투표"
                    : isMiddlePlaceVote
                    ? "중간위치 투표"
                    : "추가장소 투표"}
                </span>
              )}
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

                    <button
                      onClick={() => setShowAddOptionForm((v) => !v)}
                      style={{
                        width: "100%",
                        padding: "10px",
                        marginBottom: "8px",
                        border: "1px dashed #bbb",
                        borderRadius: "8px",
                        backgroundColor: "#fafafa",
                        color: "#555",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      {showAddOptionForm ? "항목 추가 닫기 ✕" : "항목 추가 +"}
                    </button>

                    {showAddOptionForm && isLocationVote && (
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
                          readOnly
                          placeholder="추가할 장소명"
                          style={editInputStyle}
                        />

                        <input
                          value={newPlaceAddress}
                          readOnly
                          placeholder="주소 선택 입력"
                          style={editInputStyle}
                        />

                        <div style={{ display: "flex", gap: "8px" }}>
                          <input
                            value={newPlaceLat}
                            readOnly
                            placeholder="위도 선택 입력"
                            style={{ ...editInputStyle, flex: 1 }}
                          />

                          <input
                            value={newPlaceLng}
                            readOnly
                            placeholder="경도 선택 입력"
                            style={{ ...editInputStyle, flex: 1 }}
                          />
                        </div>

                        <input
                          value={newKakaoMapUrl}
                          readOnly
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
                          onClick={() => {
                            setShowAddPlaceForm((prev) => !prev);
                            setShowPickMap(false);
                          }}
                          style={{
                            width: "100%",
                            padding: "10px 16px",
                            marginBottom: "8px",
                            border: "1px solid #ddd",
                            borderRadius: "8px",
                            backgroundColor: "#fff",
                            cursor: "pointer",
                          }}
                        >
                          {showAddPlaceForm
                            ? "장소 검색 항목 추가 닫기"
                            : "장소 검색 항목 추가"}
                        </button>
                      </div>
                    )}

                    {showAddOptionForm && !isLocationVote && vote.votetype === "schedule" && (
                      <div style={{ marginBottom: "16px" }}>
                        <button
                          type="button"
                          onClick={handleLoadDetailAvailabilities}
                          style={{ width: "100%", padding: "10px", marginBottom: "10px", border: "1px solid #d8d8ff", borderRadius: "8px", backgroundColor: "#f9f9ff", color: "#5c58d8", fontSize: "14px", cursor: "pointer", fontWeight: "600" }}
                        >
                          📅 가능 시간 불러오기
                        </button>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", fontSize: "14px" }}>
                          <input
                            type="checkbox"
                            checked={newOptionIsAllDay}
                            onChange={(e) => {
                              setNewOptionIsAllDay(e.target.checked);
                              if (e.target.checked) {
                                setNewOptionStarttime("");
                                setNewOptionEndtime("");
                              }
                            }}
                          />
                          하루종일
                        </label>

                        <input
                          type="date"
                          value={newOptionDate}
                          onChange={(e) => setNewOptionDate(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "10px",
                            marginBottom: "8px",
                            border: "1px solid #ddd",
                            borderRadius: "8px",
                            boxSizing: "border-box",
                          }}
                        />

                        {!newOptionIsAllDay && (
                          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                            <input
                              type="time"
                              value={newOptionStarttime}
                              onChange={(e) => setNewOptionStarttime(e.target.value)}
                              placeholder="시작 시간"
                              style={{
                                flex: 1,
                                padding: "10px",
                                border: "1px solid #ddd",
                                borderRadius: "8px",
                              }}
                            />
                            <input
                              type="time"
                              value={newOptionEndtime}
                              onChange={(e) => setNewOptionEndtime(e.target.value)}
                              placeholder="종료 시간"
                              style={{
                                flex: 1,
                                padding: "10px",
                                border: "1px solid #ddd",
                                borderRadius: "8px",
                              }}
                            />
                          </div>
                        )}

                        <button
                          onClick={handleAddOption}
                          style={{
                            width: "100%",
                            padding: "10px",
                            border: "1px solid #ddd",
                            borderRadius: "8px",
                            backgroundColor: "#fff",
                            cursor: "pointer",
                          }}
                        >
                          일정 항목 추가
                        </button>
                      </div>
                    )}

                    {showAddOptionForm && !isLocationVote && vote.votetype !== "schedule" && (
                      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                        <input
                          value={newOptionText}
                          onChange={(e) => setNewOptionText(e.target.value)}
                          placeholder="항목 내용 입력"
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
                            cursor: "pointer",
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
                  const isAdditionalLocationRegistered =
                    Boolean(getConfirmedAdditionalLocation(option));
                  const isMiddleLocationRegistered =
                    Boolean(isConfirmedMiddleLocation(option));

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

                          {isConfirmed && vote.votetype === "general" && (
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
                          {isManualLocationVote ? (
                            <>
                              <button
                                onClick={() => handleToggleMiddleLocation(option)}
                                style={{
                                  fontSize: "12px",
                                  padding: "3px 10px",
                                  border: "1px solid #7c79ff",
                                  borderRadius: "12px",
                                  backgroundColor: isMiddleLocationRegistered
                                    ? "#7c79ff"
                                    : "#fff",
                                  color: isMiddleLocationRegistered
                                    ? "#fff"
                                    : "#7c79ff",
                                  cursor: "pointer",
                                }}
                              >
                                {isMiddleLocationRegistered
                                  ? "중간위치 확정됨"
                                  : "중간위치 확정"}
                              </button>
                              <button
                                onClick={() =>
                                  handleToggleAdditionalLocation(option, "additional")
                                }
                                style={{
                                  fontSize: "12px",
                                  padding: "3px 10px",
                                  border: isAdditionalLocationRegistered
                                    ? "1px solid #7c79ff"
                                    : "1px solid #ddd",
                                  borderRadius: "12px",
                                  backgroundColor: isAdditionalLocationRegistered
                                    ? "#7c79ff"
                                    : "#fff",
                                  color: isAdditionalLocationRegistered
                                    ? "#fff"
                                    : "#555",
                                  cursor: "pointer",
                                }}
                              >
                                {isAdditionalLocationRegistered
                                  ? "추가장소 등록됨"
                                  : "추가장소 등록"}
                              </button>
                            </>
                          ) : vote.locationkind === "additional" ? (
                            <button
                              onClick={() => handleToggleAdditionalLocation(option)}
                              style={{
                                fontSize: "12px",
                                padding: "3px 10px",
                                border: isAdditionalLocationRegistered
                                  ? "1px solid #7c79ff"
                                  : "1px solid #ddd",
                                borderRadius: "12px",
                                backgroundColor: isAdditionalLocationRegistered
                                  ? "#7c79ff"
                                  : "#fff",
                                color: isAdditionalLocationRegistered
                                  ? "#fff"
                                  : "#555",
                                cursor: "pointer",
                              }}
                            >
                              {isAdditionalLocationRegistered
                                ? "추가장소 등록됨"
                                : "추가장소 등록"}
                            </button>
                          ) : isMiddlePlaceVote ? (
                            <button
                              onClick={() => handleToggleMiddleLocation(option)}
                              style={{
                                fontSize: "12px",
                                padding: "3px 10px",
                                border: "1px solid #7c79ff",
                                borderRadius: "12px",
                                backgroundColor: isMiddleLocationRegistered
                                  ? "#7c79ff"
                                  : "#fff",
                                color: isMiddleLocationRegistered
                                  ? "#fff"
                                  : "#7c79ff",
                                cursor: "pointer",
                              }}
                            >
                              {isMiddleLocationRegistered
                                ? "중간위치 확정됨"
                                : "중간위치 확정"}
                            </button>
                          ) : vote.votetype !== "general" && (
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
                                  ? isMiddlePlaceVote
                                    ? "중간위치 확정됨"
                                    : "추가장소 확정됨"
                                  : isMiddlePlaceVote
                                  ? "중간위치 확정하기"
                                  : "추가장소 확정하기"
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
                                {memberNicknames[r.userid] || r.nickname || "익명"}
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
          </>
        )}

        {!isEditMode && (
          <button
            onClick={handleShareToChat}
            style={{
              width: "100%",
              marginTop: "16px",
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
        )}

        {!isEditMode && showShareToast && (
          <div
            style={{
              position: "fixed",
              bottom: "80px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "rgba(0,0,0,0.75)",
              color: "#fff",
              padding: "10px 20px",
              borderRadius: "20px",
              fontSize: "14px",
              zIndex: 9999,
              pointerEvents: "none",
            }}
          >
            채팅에 공유되었습니다
          </div>
        )}

        {showConfirmToast && (
          <div
            style={{
              position: "fixed",
              bottom: "80px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "rgba(124,121,255,0.9)",
              color: "#fff",
              padding: "10px 20px",
              borderRadius: "20px",
              fontSize: "14px",
              zIndex: 9999,
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            일정이 확정되었습니다!
          </div>
        )}
      </div>
    </div>
  );
}

function EditVoteOptionsPanel({
  votetype,
  editOptions,
  onChangeOption,
  onAddOption,
  onRemoveOption,
}) {
  const [openPickerIndex, setOpenPickerIndex] = useState(null);

  const handleSelectPlace = (index, name, address, place = {}) => {
    onChangeOption(index, "placename", name || "");
    onChangeOption(index, "optiontext", name || "");
    onChangeOption(index, "placeaddress", address || "");
    onChangeOption(index, "placelat", place.lat ?? "");
    onChangeOption(index, "placelng", place.lng ?? "");
    onChangeOption(
      index,
      "kakaomapurl",
      place.kakaoMapUrl || place.kakaomapurl || ""
    );
    onChangeOption(index, "travelresults", null);
    setOpenPickerIndex(null);
  };

  const isLocationVote = isLocationVoteType(votetype);
  const generalOptionType = editOptions.length > 0 && editOptions.every(
    (option) => option.optiontype === "date"
  )
    ? "date"
    : editOptions.every((option) => option.optiontype === "text")
    ? "text"
    : null;

  const handleChangeAllGeneralOptionTypes = (optiontype) => {
    editOptions.forEach((_, index) => {
      onChangeOption(index, "optiontype", optiontype);
    });
  };

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
      {votetype === "general" && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          {[
            { value: "text", label: "텍스트" },
            { value: "date", label: "날짜" },
          ].map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => handleChangeAllGeneralOptionTypes(type.value)}
              style={{
                ...smallButtonStyle,
                border:
                  generalOptionType === type.value
                    ? "2px solid #333"
                    : "1px solid #ddd",
                fontWeight: generalOptionType === type.value ? "bold" : "normal",
              }}
            >
              {type.label}
            </button>
          ))}
        </div>
      )}

      {isLocationVote && (
        <p style={{ fontSize: "12px", color: "#888" }}>
          장소는 카카오맵 검색 결과에서 선택해야 합니다.
        </p>
      )}

      {editOptions.map((option, index) => (
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

          {option.optiontype === "text" && (
            <input
              value={option.optiontext}
              onChange={(event) =>
                onChangeOption(index, "optiontext", event.target.value)
              }
              placeholder="텍스트 입력"
              style={editInputStyle}
            />
          )}

          {option.optiontype === "date" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <input
                type="date"
                value={option.optiondate}
                onChange={(event) =>
                  onChangeOption(index, "optiondate", event.target.value)
                }
                style={editInputStyle}
              />

              <button
                type="button"
                onClick={() => {
                  const isAllDay = !option.isallday;
                  onChangeOption(index, "isallday", isAllDay);
                  if (isAllDay) {
                    onChangeOption(index, "starttime", "");
                    onChangeOption(index, "endtime", "");
                  }
                }}
                style={{
                  ...smallButtonStyle,
                  alignSelf: "flex-start",
                  backgroundColor: option.isallday ? "#333" : "#fff",
                  color: option.isallday ? "#fff" : "#333",
                  fontWeight: option.isallday ? "bold" : "normal",
                }}
              >
                하루종일
              </button>

              {!option.isallday && (
                <>
                  <input
                    type="time"
                    value={option.starttime}
                    onChange={(event) =>
                      onChangeOption(index, "starttime", event.target.value)
                    }
                    style={editInputStyle}
                  />
                  <input
                    type="time"
                    value={option.endtime}
                    onChange={(event) =>
                      onChangeOption(index, "endtime", event.target.value)
                    }
                    style={editInputStyle}
                  />
                  <p style={{ margin: 0, fontSize: "11px", color: "#bbb" }}>
                    종료시간은 선택사항입니다
                  </p>
                </>
              )}
            </div>
          )}

          {option.optiontype === "place" && (
            <>
              <input
                value={option.placename}
                readOnly
                placeholder="장소명"
                style={editInputStyle}
              />

              <button
                type="button"
                onClick={() =>
                  setOpenPickerIndex((prev) => (prev === index ? null : index))
                }
                style={placeSearchButtonStyle}
              >
                {openPickerIndex === index ? "장소 검색 닫기" : "카카오맵에서 장소 검색"}
              </button>

              {openPickerIndex === index && (
                <LocationPicker
                  allowMapClick={false}
                  onSelect={(name, address, place) =>
                    handleSelectPlace(index, name, address, place)
                  }
                />
              )}

              <input
                value={option.placeaddress}
                readOnly
                placeholder="주소 선택 입력"
                style={editInputStyle}
              />

              <input
                value={option.kakaomapurl}
                readOnly
                placeholder="카카오맵 URL 선택 입력"
                style={editInputStyle}
              />
            </>
          )}
        </div>
      ))}

      <button type="button" onClick={onAddOption} style={smallButtonStyle}>
        선택지 추가
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

function isLocationVoteType(votetype) {
  return ["location", "middle_location", "additional_location"].includes(votetype);
}

function hasPlaceCoordinates(option) {
  return hasValue(option.placelat) && hasValue(option.placelng);
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
              color: "var(--secondary-text)",
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
  backgroundColor: "var(--btn-bg)",
  fontSize: "13px",
};

const smallButtonStyle = {
  padding: "6px 10px",
  border: "1px solid var(--border-color)",
  borderRadius: "8px",
  backgroundColor: "var(--bg-color)",
  fontSize: "12px",
  cursor: "pointer",
};

const placeSearchButtonStyle = {
  width: "100%",
  height: "40px",
  marginBottom: "8px",
  border: "1px solid var(--border-color)",
  borderRadius: "6px",
  backgroundColor: "var(--bg-color)",
  cursor: "pointer",
};

const editInputStyle = {
  width: "100%",
  padding: "10px",
  border: "1px solid var(--border-color)",
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
  border: "1px solid var(--border-color)",
  borderRadius: "8px",
  backgroundColor: "var(--card-bg)",
};

const mapInfoTextStyle = {
  fontSize: "12px",
  color: "var(--secondary-text)",
  marginTop: 0,
  marginBottom: "8px",
};

export default VoteDetailPage;
