import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  SETTLEMENT_BANKS,
  buildEqualShares,
  createExpenseBatch,
  drawRemainderKeys,
  formatWon,
  getExpenseAccount,
  getExpenseDetail,
  getSettlementContext,
  ocrReceipt,
  saveMyAccount,
  updateExpense,
  uploadReceipt,
} from "../../api/settlementApi";
import "./Settlement.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ITEMS = 20;

function participantKey(participant) {
  return `${participant.type}:${participant.id}`;
}

function splitKey(key) {
  const [type, ...idParts] = key.split(":");
  return { type, id: idParts.join(":") };
}

function parseAmount(value) {
  return Number(String(value ?? "").replace(/\D/g, "")) || 0;
}

function formatDate(date) {
  if (!date) return "날짜 미정";
  const [year, month, day] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
  return `${year}. ${month}. ${day} (${weekday})`;
}

function formatDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLocalInputValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultPaidAt(schedule) {
  if (!schedule?.date) return toLocalInputValue(new Date());
  return `${schedule.date}T${(schedule.starttime || "12:00").slice(0, 5)}`;
}

// OCR 의 결제 일시(ISO 또는 날짜만)를 datetime-local 값으로 바꾼다.
function resolvePaidAt(value, fallback) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T${(fallback || "").slice(11, 16) || "12:00"}`;
  }
  return toLocalInputValue(new Date(value));
}

// OCR 응답 전체 + 고른 후보 하나를 지출 카드에 붙일 OCR 정보로 합친다.
function toOcrInfo(data, candidate) {
  return {
    ...candidate,
    sourceType: data.sourceType,
    confidence: data.confidence,
    warnings: [...(candidate.warnings || []), ...(data.warnings || [])],
  };
}

// 후보 목록에 보여줄 일시 (날짜만 있는 경우 날짜만)
function formatCandidateTime(paidAt) {
  if (!paidAt) return "일시 미인식";
  if (/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return formatDate(paidAt);
  return formatDateTime(paidAt);
}

function Initial({ name }) {
  return <span className="settle-initial">{(name || "?").slice(0, 1)}</span>;
}

let itemSequence = 0;

function createItem(base = {}) {
  itemSequence += 1;
  return {
    uid: itemSequence,
    title: "",
    amount: "",
    paidAt: base.paidAt || "",
    payerKey: base.payerKey || "",
    bankname: base.bankname || "",
    accountnumber: base.accountnumber || "",
    selected: new Set(base.selected || []),
    splitMode: "equal",
    extraKeys: [], // 1/N 에서 1원씩 더 내는 사람(랜덤). 금액·참여 인원이 바뀔 때만 다시 뽑는다.
    drawnFor: "",
    customValues: {},
    image: null,
    previewUrl: "",
    ocr: null,
    ocrStatus: "idle", // idle | running
    ocrError: "",
    paidTouched: false,
    showAccount: Boolean(base.bankname || base.accountnumber),
    showPeople: false,
    saveAccount: true, // "다음에도 이 계좌를 쓸까요?"
  };
}

// 수정할 지출(상세 응답)로 카드 하나를 만든다. 균등 분배는 기존에 1원 더 낸 사람을 그대로 유지한다.
function itemFromDetail(detail, account, participants) {
  const { expense, shares } = detail;
  const known = new Set(participants.map(participantKey));
  const shareKey = (share) => `${share.membertype}:${share.memberid}`;
  const selected = shares.map(shareKey).filter((key) => known.has(key));

  const item = {
    ...createItem({
      paidAt: toLocalInputValue(new Date(expense.paidat || Date.now())),
      payerKey: `${expense.payer.type}:${expense.payer.id}`,
      bankname: expense.bankname || "",
      accountnumber: account?.accountnumber || "",
      selected,
    }),
    title: expense.title,
    amount: String(expense.amount),
    splitMode: expense.splitmode === "custom" ? "custom" : "equal",
    paidTouched: true,
    saveAccount: false,
  };

  if (item.splitMode === "custom") {
    item.customValues = Object.fromEntries(shares.map((share) => [shareKey(share), String(share.amount)]));
  }
  const ordered = participants.map(participantKey).filter((key) => item.selected.has(key));
  const baseShare = ordered.length ? Math.floor(expense.amount / ordered.length) : 0;
  item.extraKeys = shares.filter((share) => share.amount === baseShare + 1).map(shareKey);
  item.drawnFor = `${expense.amount}|${ordered.join(",")}`;
  return item;
}

function orderedKeys(item, participants) {
  return participants.map(participantKey).filter((key) => item.selected.has(key));
}

// 금액이나 참여 인원이 바뀐 경우에만 나머지 1원을 다시 뽑는다.
function withDraw(item, participants) {
  const keys = orderedKeys(item, participants);
  const amount = parseAmount(item.amount);
  const drawKey = `${amount}|${keys.join(",")}`;
  if (item.drawnFor === drawKey) return item;
  return {
    ...item,
    drawnFor: drawKey,
    extraKeys: amount > 0 && keys.length > 0 ? drawRemainderKeys(keys, amount) : [],
  };
}

function computeItem(item, participants) {
  const keys = orderedKeys(item, participants);
  const amount = parseAmount(item.amount);
  const equalShares = keys.length && amount > 0 ? buildEqualShares(keys, amount, item.extraKeys) : [];
  const customShares = keys.map((key) => ({ key, amount: parseAmount(item.customValues[key]) }));
  const customTotal = customShares.reduce((sum, share) => sum + share.amount, 0);
  const customDiff = amount - customTotal;
  const shares = item.splitMode === "equal" ? equalShares : customShares;
  const splitValid =
    amount > 0 && keys.length > 0 && (item.splitMode === "equal" || customDiff === 0);
  return {
    keys,
    amount,
    shares,
    remainder: keys.length ? amount % keys.length : 0,
    customTotal,
    customDiff,
    untouched: keys.filter((key) => item.customValues[key] === undefined || item.customValues[key] === ""),
    valid: item.title.trim() !== "" && item.payerKey !== "" && splitValid,
  };
}

// 카드들을 좌우로 넘겨 보는 트랙. 현재 카드 높이에 맞춰 트랙 높이를 조절한다.
function usePager(keys, resetKey) {
  const trackRef = useRef(null);
  const slideRefs = useRef(new Map());
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState(null);
  const keyString = keys.join(",");

  const scrollTo = (index, smooth = true) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setActive((previous) => (previous === index ? previous : index));
  };

  // 내용이 바뀌면 첫 카드로 돌아간다.
  useEffect(() => {
    setActive(0);
    scrollTo(0, false);
  }, [keyString, resetKey]);

  useEffect(() => {
    const element = slideRefs.current.get(keys[active]);
    if (!element) return undefined;
    setHeight(element.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyString, active, resetKey]);

  return { trackRef, slideRefs, active, setActive, height, scrollTo, onScroll };
}

function SettlementCreatePage() {
  const navigate = useNavigate();
  const { scheduleId, expenseId } = useParams();
  const isEdit = Boolean(expenseId);

  const [ctx, setCtx] = useState(null);
  const [myAccount, setMyAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [items, setItems] = useState([]);
  const [view, setView] = useState("form"); // form | done
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [results, setResults] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [picker, setPicker] = useState(null); // OCR 결제 후보 고르기
  const resultPager = usePager(
    results.map((detail) => detail.expense.id),
    view
  );
  const [toast, setToast] = useState("");

  const fileInputRef = useRef(null);
  const pickTargetRef = useRef(null);
  // 지출 카드를 좌우로 넘겨 보는 트랙
  const trackRef = useRef(null);
  const slideRefs = useRef(new Map());
  const pendingFocusRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [slideHeight, setSlideHeight] = useState(null);
  const urlsRef = useRef(new Set());

  const participants = useMemo(() => ctx?.participants || [], [ctx]);
  const nameByKey = useMemo(
    () => new Map(participants.map((participant) => [participantKey(participant), participant.nickname])),
    [participants]
  );
  const meKey = ctx ? `${ctx.viewer.type}:${ctx.viewer.id}` : "";

  useEffect(() => {
    let active = true;
    Promise.all([
      getSettlementContext(scheduleId),
      isEdit ? getExpenseDetail(expenseId) : Promise.resolve(null),
      isEdit ? getExpenseAccount(expenseId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([data, detail, account]) => {
        if (!active) return;
        setCtx(data);
        setMyAccount(data.myAccount || null);
        const me = data.participants.find((participant) => participant.isMe);
        const mePayerKey = me ? participantKey(me) : "";

        if (detail) {
          if (!detail.viewer.isPayer && !detail.viewer.isCreator) {
            throw new Error("지출을 등록한 사람이나 결제자만 수정할 수 있어요.");
          }
          setItems([withDraw(itemFromDetail(detail, account, data.participants), data.participants)]);
          return;
        }

        const first = createItem({
          paidAt: defaultPaidAt(data.schedule),
          payerKey: mePayerKey,
          // 결제자가 나라면 저장해 둔 내 계좌를 자동으로 채운다.
          bankname: mePayerKey && data.myAccount ? data.myAccount.bankname : "",
          accountnumber: mePayerKey && data.myAccount ? data.myAccount.accountnumber : "",
          selected: data.participants.filter((participant) => !participant.absent).map(participantKey),
        });
        setItems([withDraw(first, data.participants)]);
      })
      .catch((error) => {
        if (active) setLoadError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scheduleId, expenseId, isEdit]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const updateItem = (uid, patch) =>
    setItems((prev) =>
      prev.map((item) =>
        item.uid === uid
          ? withDraw({ ...item, ...(typeof patch === "function" ? patch(item) : patch) }, participants)
          : item
      )
    );

  const computed = useMemo(
    () => items.map((item) => computeItem(item, participants)),
    [items, participants]
  );

  const scrollToIndex = (index, smooth = true) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };

  const handleTrackScroll = () => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setActiveIndex((previous) => (previous === index ? previous : index));
  };

  // 새로 추가한 지출 카드로 자동 이동
  useEffect(() => {
    if (pendingFocusRef.current == null) return;
    const index = items.findIndex((item) => item.uid === pendingFocusRef.current);
    pendingFocusRef.current = null;
    if (index >= 0) {
      setActiveIndex(index);
      scrollToIndex(index);
    }
  }, [items]);

  // 카드를 지워서 개수가 줄면 현재 위치를 범위 안으로 맞춘다
  useEffect(() => {
    if (items.length > 0 && activeIndex > items.length - 1) {
      const last = items.length - 1;
      setActiveIndex(last);
      scrollToIndex(last, false);
    }
  }, [items.length, activeIndex]);

  // 지금 보이는 카드 높이에 맞춰 트랙 높이를 조절한다 (짧은 카드 아래에 빈 공간이 생기지 않게)
  useEffect(() => {
    const current = items[activeIndex];
    const element = current && slideRefs.current.get(current.uid);
    if (!element) return undefined;
    setSlideHeight(element.offsetHeight);
    const observer = new ResizeObserver(() => setSlideHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [items, activeIndex, view]);

  const addItem = () => {
    if (items.length >= MAX_ITEMS) return;
    const last = items[items.length - 1];
    const next = withDraw(
      createItem({
        paidAt: defaultPaidAt(ctx.schedule),
        payerKey: last?.payerKey || meKey,
        bankname: last?.bankname,
        accountnumber: last?.accountnumber,
        selected: last ? last.selected : participants.filter((p) => !p.absent).map(participantKey),
      }),
      participants
    );
    pendingFocusRef.current = next.uid;
    setItems((prev) => [...prev, next]);
  };

  const removeItem = (uid) => {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((item) => item.uid !== uid));
  };

  const toggleParticipant = (item, key) => {
    updateItem(item.uid, (current) => {
      const next = new Set(current.selected);
      if (next.has(key)) {
        if (next.size === 1) return {}; // 최소 1명
        next.delete(key);
      } else {
        next.add(key);
      }
      return { selected: next };
    });
  };

  const switchSplitMode = (item, mode) => {
    const info = computeItem(item, participants);
    updateItem(item.uid, (current) => ({
      splitMode: mode,
      // 처음 직접 지정으로 바꿀 때는 균등 분배 금액에서 출발한다.
      customValues:
        mode === "custom" && Object.keys(current.customValues).length === 0
          ? Object.fromEntries(
              buildEqualShares(info.keys, info.amount, current.extraKeys).map((share) => [share.key, String(share.amount)])
            )
          : current.customValues,
    }));
  };

  const fillRemainingEvenly = (item, info) => {
    if (info.customDiff <= 0 || info.untouched.length === 0) return;
    const base = Math.floor(info.customDiff / info.untouched.length);
    const extra = info.customDiff - base * info.untouched.length;
    updateItem(item.uid, (current) => {
      const next = { ...current.customValues };
      info.untouched.forEach((key, index) => {
        next[key] = String(base + (index < extra ? 1 : 0));
      });
      return { customValues: next };
    });
  };

  // ----- 영수증으로 채우기 (카드마다) -----
  const openImagePicker = (uid) => {
    pickTargetRef.current = uid;
    fileInputRef.current?.click();
  };

  const applyCandidate = (uid, data, candidate) =>
    updateItem(uid, (item) => ({
      ocr: toOcrInfo(data, candidate),
      ocrStatus: "idle",
      title: candidate.storeName || item.title,
      amount: candidate.totalAmount ? String(candidate.totalAmount) : item.amount,
      paidAt: candidate.paidAt ? resolvePaidAt(candidate.paidAt, item.paidAt) : item.paidAt,
      paidTouched: Boolean(candidate.paidAt) || item.paidTouched,
    }));

  const togglePickerCandidate = (index) =>
    setPicker((current) => {
      const selected = new Set(current.selected);
      if (current.mode === "single") {
        return { ...current, selected: new Set([index]) };
      }
      if (selected.has(index)) selected.delete(index);
      else selected.add(index);
      return { ...current, selected };
    });

  const switchPickerMode = () =>
    setPicker((current) => {
      const mode = current.mode === "single" ? "multi" : "single";
      const first = [...current.selected].sort((a, b) => a - b)[0] ?? 0;
      return { ...current, mode, selected: mode === "single" ? new Set([first]) : current.selected };
    });

  // 고른 결제로 채운다. 여러 건을 골랐다면 첫 건은 이 카드에, 나머지는 새 지출 카드로 추가한다.
  const confirmPicker = () => {
    const { uid, data, selected } = picker;
    const indices = [...selected].sort((a, b) => a - b);
    if (indices.length === 0) return;

    const [first, ...rest] = indices;
    applyCandidate(uid, data, data.candidates[first]);

    if (rest.length > 0) {
      const room = Math.max(0, MAX_ITEMS - items.length);
      if (rest.length > room) setToast(`지출은 최대 ${MAX_ITEMS}건까지 추가할 수 있어요`);
      setItems((prev) => {
        const position = prev.findIndex((item) => item.uid === uid);
        const base = prev[position];
        const extras = rest.slice(0, room).map((index) => {
          const candidate = data.candidates[index];
          return withDraw(
            {
              ...createItem({
                paidAt: defaultPaidAt(ctx.schedule),
                payerKey: base.payerKey,
                bankname: base.bankname,
                accountnumber: base.accountnumber,
                selected: base.selected,
              }),
              title: candidate.storeName || "",
              amount: candidate.totalAmount ? String(candidate.totalAmount) : "",
              paidAt: candidate.paidAt
                ? resolvePaidAt(candidate.paidAt, defaultPaidAt(ctx.schedule))
                : defaultPaidAt(ctx.schedule),
              paidTouched: Boolean(candidate.paidAt),
              // 같은 캡처 이미지를 각 지출의 증빙으로 쓴다.
              image: base.image,
              previewUrl: base.previewUrl,
              ocr: toOcrInfo(data, candidate),
            },
            participants
          );
        });
        return [...prev.slice(0, position + 1), ...extras, ...prev.slice(position + 1)];
      });
    }
    setPicker(null);
  };

  const handleImagePicked = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const uid = pickTargetRef.current;
    if (!file || uid == null) return;
    if (!file.type.startsWith("image/")) {
      setToast("이미지 파일만 선택할 수 있어요");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setToast("이미지는 10MB 이하만 올릴 수 있어요");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    urlsRef.current.add(previewUrl);
    updateItem(uid, { image: file, previewUrl, ocr: null, ocrError: "", ocrStatus: "running" });

    try {
      const data = await ocrReceipt(scheduleId, file);
      const candidates = data.candidates || [];
      if (candidates.length === 1) {
        applyCandidate(uid, data, candidates[0]);
      } else {
        // 결제가 여러 건 보이면 어떤 결제를 등록할지 사용자가 고른다.
        updateItem(uid, { ocrStatus: "idle" });
        setPicker({ uid, data, mode: "single", selected: new Set([0]) });
      }
    } catch (error) {
      // 인식에 실패해도 이미지는 증빙으로 첨부된 채 직접 입력으로 이어진다.
      updateItem(uid, {
        ocrStatus: "idle",
        ocrError: error.message || "인식하지 못했어요. 직접 입력해 주세요.",
      });
    }
  };

  const removeImage = (uid) => updateItem(uid, { image: null, previewUrl: "", ocr: null, ocrError: "" });

  // ----- 합계 -----
  const totals = useMemo(() => {
    const perPerson = new Map();
    let send = 0;
    let receive = 0;
    let total = 0;
    items.forEach((item, index) => {
      const info = computed[index];
      if (!info.valid) return;
      total += info.amount;
      info.shares.forEach((share) => {
        perPerson.set(share.key, (perPerson.get(share.key) || 0) + share.amount);
        if (item.payerKey !== meKey && share.key === meKey) send += share.amount;
        if (item.payerKey === meKey && share.key !== meKey) receive += share.amount;
      });
    });
    return { perPerson, send, receive, total };
  }, [items, computed, meKey]);

  const allValid = items.length > 0 && computed.every((info) => info.valid);
  // 이번 정산에 포함된 모든 사람 (확인 창에서 보여준다)
  const involvedKeys = [...new Set(computed.flatMap((info) => info.keys))];

  // 회원이 결제자로 새 계좌를 입력했을 때만 "다음에도 이 계좌를 쓸까요?"를 보여준다. (게스트는 저장할 계정이 없다)
  const canSaveAccount = (item) =>
    !isEdit &&
    ctx?.viewer.type === "member" &&
    item.payerKey === meKey &&
    item.accountnumber.trim() !== "" &&
    (item.accountnumber.trim() !== (myAccount?.accountnumber || "") ||
      (item.bankname || "") !== (myAccount?.bankname || ""));

  const submit = async () => {
    if (!allValid || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const buildPayload = (item, index) => {
        const payer = splitKey(item.payerKey);
        return {
          title: item.title.trim(),
          amount: computed[index].amount,
          paidat: item.paidAt ? new Date(item.paidAt).toISOString() : null,
          payerid: payer.id,
          payertype: payer.type,
          bankname: item.bankname || null,
          accountnumber: item.accountnumber.trim() || null,
          splitmode: item.splitMode,
          source: item.ocr ? "ocr" : "manual",
          ocrraw: item.ocr || null,
          shares: computed[index].shares.map((share) => {
            const target = splitKey(share.key);
            return { memberid: target.id, membertype: target.type, amount: share.amount };
          }),
        };
      };

      if (isEdit) {
        await updateExpense(expenseId, buildPayload(items[0], 0));
        navigate(`/schedules/${scheduleId}/settlement/${expenseId}`, { replace: true });
        return;
      }

      const response = await createExpenseBatch(scheduleId, items.map(buildPayload));

      const details = response.expenses;
      let uploadFailed = false;
      await Promise.all(
        details.map(async (detail, index) => {
          if (!items[index].image) return;
          try {
            await uploadReceipt(detail.expense.id, items[index].image);
            detail.expense.hasReceipt = true;
          } catch (uploadError) {
            console.error("증빙 이미지 저장 실패:", uploadError);
            uploadFailed = true;
          }
        })
      );
      if (uploadFailed) setToast("지출은 등록됐지만 일부 증빙 이미지를 저장하지 못했어요");

      // 내 계좌 저장: 체크한 카드의 계좌를 기억해 다음에 자동으로 채운다. (실패해도 정산은 그대로)
      const accountToSave = items.find((item) => canSaveAccount(item) && item.saveAccount);
      if (accountToSave) {
        try {
          const saved = await saveMyAccount({
            bankname: accountToSave.bankname,
            accountnumber: accountToSave.accountnumber.trim(),
          });
          setMyAccount(saved.account);
          setToast("내 계좌를 저장했어요");
        } catch (saveError) {
          console.error("내 계좌 저장 실패:", saveError);
        }
      }

      setResults(details);
      setConfirming(false);
      setView("done");
    } catch (error) {
      setSubmitError(error.message || (isEdit ? "지출을 수정하지 못했어요." : "정산을 등록하지 못했어요."));
    } finally {
      setSubmitting(false);
    }
  };

  const copyAccount = async (expenseId) => {
    try {
      const account = await getExpenseAccount(expenseId);
      await navigator.clipboard.writeText(account.accountnumber);
      setToast("계좌번호를 복사했어요");
    } catch (error) {
      setToast(error.message || "계좌번호를 복사하지 못했어요");
    }
  };

  const startAnother = () => {
    const last = items[items.length - 1];
    const fresh = createItem({
      paidAt: defaultPaidAt(ctx.schedule),
      payerKey: last?.payerKey || meKey,
      bankname: last?.bankname,
      accountnumber: last?.accountnumber,
      selected: last ? last.selected : [],
    });
    setItems([withDraw(fresh, participants)]);
    setResults([]);
    setSubmitError("");
    setView("form");
  };

  if (loading) {
    return <main className="settle-page"><p className="settle-muted">불러오는 중...</p></main>;
  }

  if (loadError || !ctx) {
    return (
      <main className="settle-page">
        <header className="settle-header">
          <button type="button" className="settle-back" onClick={() => navigate(-1)} aria-label="뒤로">←</button>
          <h1>정산하기</h1>
          <span />
        </header>
        <p className="settle-error" role="alert">{loadError || "정산 정보를 불러오지 못했어요."}</p>
      </main>
    );
  }

  // ----- 등록 완료 -----
  if (view === "done") {
    const myTotals = results.reduce(
      (acc, detail) => {
        const mine = detail.shares.find((share) => share.isMe);
        const iPaid = detail.viewer.isPayer;
        if (mine && !iPaid) acc.send += mine.amount;
        if (iPaid) acc.receive += detail.shares.filter((share) => !share.isMe).reduce((sum, share) => sum + share.amount, 0);
        return acc;
      },
      { send: 0, receive: 0 }
    );

    return (
      <main className="settle-page">
        {toast && <div className="settle-toast" role="status">{toast}</div>}
        <header className="settle-header">
          <button type="button" className="settle-back" onClick={() => navigate(-1)} aria-label="뒤로">←</button>
          <h1>정산 결과</h1>
          <span />
        </header>

        <section className="settle-schedule-card">
          <strong>{results[0]?.schedule.title || "모임"}</strong>
          <span>{formatDate(results[0]?.schedule.date)}</span>
        </section>

        <div className="settle-section-title">등록된 지출 <small>{results.length}건</small></div>
        <div className="settle-pager-tabs result" role="tablist" aria-label="등록된 지출">
          {results.map((detail, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={resultPager.active === index}
              key={detail.expense.id}
              className={resultPager.active === index ? "on" : ""}
              onClick={() => {
                resultPager.setActive(index);
                resultPager.scrollTo(index);
              }}
            >
              지출 {index + 1}
            </button>
          ))}
        </div>
        <div
          className="settle-track"
          ref={resultPager.trackRef}
          onScroll={resultPager.onScroll}
          style={resultPager.height ? { height: resultPager.height } : undefined}
        >
        {results.map((detail) => (
          <div
            className="settle-slide"
            key={detail.expense.id}
            ref={(element) => {
              if (element) resultPager.slideRefs.current.set(detail.expense.id, element);
              else resultPager.slideRefs.current.delete(detail.expense.id);
            }}
          >
          <section className="settle-result-item">
            <div className="settle-expense-top">
              <strong>{detail.expense.title}</strong>
              <strong>{formatWon(detail.expense.amount)}</strong>
            </div>
            <span className="settle-sub">
              {detail.expense.payer.nickname} 결제 &nbsp;|&nbsp; 참여 인원 {detail.shares.length}명
              {detail.expense.paidat ? ` · ${formatDateTime(detail.expense.paidat)}` : ""}
            </span>
            <div className="settle-list settle-list-inner">
              {detail.shares.map((share) => (
                <div className={`settle-row compact ${share.isMe ? "me" : ""}`} key={share.id}>
                  <Initial name={share.nickname} />
                  <span className="settle-row-name">{share.nickname}{share.isPayer ? " (결제자)" : ""}</span>
                  <strong>{formatWon(share.amount)}</strong>
                </div>
              ))}
            </div>
            {detail.expense.hasAccount && (
              <section className="settle-account">
                <div>
                  <small>은행</small> <b>{detail.expense.bankname || "-"}</b>
                  <br />
                  <small>계좌번호</small> <b>{detail.expense.accountMasked}</b>
                </div>
                <button type="button" onClick={() => copyAccount(detail.expense.id)} aria-label="계좌번호 복사">복사</button>
              </section>
            )}
          </section>
          </div>
        ))}
        </div>

        <section className="settle-summary-me">
          <div><small>내가 보낼 돈</small><strong>{formatWon(myTotals.send)}</strong></div>
          <div><small>내가 받을 돈</small><strong>{formatWon(myTotals.receive)}</strong></div>
        </section>

        <section className="settle-done-note">
          <span className="settle-done-check">✓</span>
          <div>
            <strong>정산 요청이 등록되었습니다.</strong>
            <small>정산 내역이 방 채팅에 공유됩니다.</small>
          </div>
        </section>

        <button type="button" className="settle-outline settle-add-more" onClick={startAnother}>
          + 지출 추가
        </button>
        <div className="settle-actions">
          <button
            type="button"
            className="settle-secondary"
            onClick={() => navigate(`/rooms/${results[0].expense.roomid}?tab=chat`)}
          >
            💬 채팅으로 가기
          </button>
          <button type="button" className="settle-primary" onClick={() => navigate(-1)}>확인</button>
        </div>
      </main>
    );
  }

  // ----- 정산하기 (한 화면) -----
  return (
    <main className="settle-page">
      {toast && <div className="settle-toast" role="status">{toast}</div>}
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImagePicked} />
      <header className="settle-header">
        <button type="button" className="settle-back" onClick={() => navigate(-1)} aria-label="뒤로">←</button>
        <h1>{isEdit ? "지출 수정" : "정산하기"}</h1>
        <span />
      </header>

      <div className="settle-info">
        {isEdit ? (
          <>
            <strong>지출 정보를 수정해요.</strong>
            <span>금액이 바뀐 사람은 송금 기록이 초기화될 수 있어요.</span>
          </>
        ) : (
          <>
            <strong>지출을 입력하면 1인당 금액이 바로 계산돼요.</strong>
            <span>1차, 2차처럼 지출을 여러 개 추가하고 옆으로 넘겨서 한 번에 정산할 수 있어요.</span>
          </>
        )}
      </div>

      <div className={`settle-pager-tabs ${isEdit ? "hidden" : ""}`} role="tablist" aria-label="지출 목록">
        {items.map((item, index) => {
          const touched = item.title.trim() !== "" || computed[index].amount > 0;
          const invalid = touched && !computed[index].valid;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={activeIndex === index}
              key={item.uid}
              className={`${activeIndex === index ? "on" : ""} ${invalid ? "invalid" : ""}`}
              onClick={() => {
                setActiveIndex(index);
                scrollToIndex(index);
              }}
            >
              지출 {index + 1}
              {invalid && <i aria-label="입력이 더 필요해요">!</i>}
            </button>
          );
        })}
        {items.length < MAX_ITEMS && (
          <button type="button" className="add" onClick={addItem}>
            + 추가
          </button>
        )}
      </div>

      <div
        className="settle-track"
        ref={trackRef}
        onScroll={handleTrackScroll}
        style={slideHeight ? { height: slideHeight } : undefined}
      >
      {items.map((item, index) => {
        const info = computed[index];
        const needsTitle = item.ocr && !item.ocr.storeName && !item.title.trim();
        const needsAmount = item.ocr && item.ocr.totalAmount == null && !info.amount;
        const needsPaidAt = item.ocr && !item.ocr.paidAt && !item.paidTouched;
        return (
          <div
            className="settle-slide"
            key={item.uid}
            ref={(element) => {
              if (element) slideRefs.current.set(item.uid, element);
              else slideRefs.current.delete(item.uid);
            }}
          >
          <section className="settle-item">
            <div className="settle-item-head">
              <strong>지출 {index + 1}</strong>
              <span className="settle-item-actions">
                <button
                  type="button"
                  className="settle-chip-btn"
                  hidden={isEdit}
                  disabled={item.ocrStatus === "running"}
                  onClick={() => openImagePicker(item.uid)}
                >
                  📷 영수증으로 채우기
                </button>
                {items.length > 1 && (
                  <button type="button" className="settle-remove" aria-label={`지출 ${index + 1} 삭제`} onClick={() => removeItem(item.uid)}>×</button>
                )}
              </span>
            </div>

            {item.ocrStatus === "running" && (
              <div className="settle-loading small" role="status">
                <span className="settle-spinner" />
                영수증을 읽고 있어요…
              </div>
            )}
            {item.image && item.ocrStatus !== "running" && (
              <div className="settle-attach-row">
                <img src={item.previewUrl} alt="첨부한 결제 내역" />
                <span>
                  {item.ocr ? "결제 정보를 인식했어요. 내용을 확인해 주세요." : "증빙 이미지가 첨부돼요"}
                </span>
                <button type="button" aria-label="첨부 이미지 제거" onClick={() => removeImage(item.uid)}>×</button>
              </div>
            )}
            {item.ocrError && (
              <p className="settle-warnings" role="alert">⚠ {item.ocrError}</p>
            )}
            {item.ocr?.warnings?.length > 0 && (
              <ul className="settle-warnings" role="alert">
                {item.ocr.warnings.map((warning) => <li key={warning}>⚠ {warning}</li>)}
              </ul>
            )}

            <label className={`settle-field ${needsTitle ? "needs" : ""}`}>
              <span>지출 항목</span>
              <span className="settle-input-wrap">
                <input
                  value={item.title}
                  maxLength={60}
                  placeholder="예: 서면 파스타하우스"
                  onChange={(event) => updateItem(item.uid, { title: event.target.value })}
                />
                {item.title && (
                  <button type="button" className="settle-clear" aria-label="지우기" onClick={() => updateItem(item.uid, { title: "" })}>×</button>
                )}
              </span>
            </label>
            <label className={`settle-field ${needsAmount ? "needs" : ""}`}>
              <span>결제 금액</span>
              <span className="settle-input-wrap">
                <input
                  inputMode="numeric"
                  value={info.amount ? info.amount.toLocaleString("ko-KR") : ""}
                  placeholder="0"
                  onChange={(event) => updateItem(item.uid, { amount: event.target.value.replace(/\D/g, "").slice(0, 10) })}
                />
                <em>원</em>
              </span>
            </label>
            <label className={`settle-field ${needsPaidAt ? "needs" : ""}`}>
              <span>결제 일시</span>
              <input
                type="datetime-local"
                value={item.paidAt}
                onChange={(event) => updateItem(item.uid, { paidAt: event.target.value, paidTouched: true })}
              />
            </label>
            <label className="settle-field">
              <span>결제자</span>
              <select
                value={item.payerKey}
                onChange={(event) => {
                  const nextPayer = event.target.value;
                  updateItem(item.uid, (current) => ({
                    payerKey: nextPayer,
                    ...(!isEdit && nextPayer === meKey && myAccount && !current.accountnumber
                      ? { bankname: current.bankname || myAccount.bankname, accountnumber: myAccount.accountnumber, showAccount: true }
                      : {}),
                  }));
                }}
              >
                {participants.map((participant) => (
                  <option key={participantKey(participant)} value={participantKey(participant)}>
                    {participant.nickname}{participant.isMe ? " (나)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" className="settle-toggle" onClick={() => updateItem(item.uid, { showAccount: !item.showAccount })}>
              결제자 계좌 {item.accountnumber ? "· 입력됨" : "(선택)"} <span>{item.showAccount ? "▲" : "▼"}</span>
            </button>
            {item.showAccount && (
              <>
                <label className="settle-field">
                  <span>은행 선택</span>
                  <select value={item.bankname} onChange={(event) => updateItem(item.uid, { bankname: event.target.value })}>
                    <option value="">은행 선택 (선택)</option>
                    {SETTLEMENT_BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                  </select>
                </label>
                <label className="settle-field">
                  <span>계좌번호</span>
                  <input
                    inputMode="numeric"
                    value={item.accountnumber}
                    maxLength={30}
                    placeholder="계좌번호 입력 (선택)"
                    onChange={(event) => updateItem(item.uid, { accountnumber: event.target.value.replace(/[^0-9-]/g, "") })}
                  />
                </label>
                {canSaveAccount(item) && (
                  <label className="settle-save-account">
                    <input
                      type="checkbox"
                      checked={item.saveAccount}
                      onChange={(event) => updateItem(item.uid, { saveAccount: event.target.checked })}
                    />
                    다음에도 이 계좌를 쓸까요?
                  </label>
                )}
              </>
            )}

            <button type="button" className="settle-toggle" onClick={() => updateItem(item.uid, { showPeople: !item.showPeople })}>
              참여 인원 <b>{info.keys.length}명</b> <span>{item.showPeople ? "▲" : "▼"}</span>
            </button>
            {item.showPeople && (
              <div className="settle-chips settle-chips-inner">
                {participants.map((participant) => {
                  const key = participantKey(participant);
                  const on = item.selected.has(key);
                  return (
                    <button
                      type="button"
                      key={key}
                      className={on ? "on" : ""}
                      aria-pressed={on}
                      onClick={() => toggleParticipant(item, key)}
                    >
                      <span className="settle-check">{on ? "✓" : ""}</span>
                      {participant.nickname}
                      {participant.absent && <small>불참</small>}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="settle-split-toggle" role="tablist">
              <button type="button" role="tab" aria-selected={item.splitMode === "equal"} className={item.splitMode === "equal" ? "on" : ""} onClick={() => switchSplitMode(item, "equal")}>1/N 균등 분배</button>
              <button type="button" role="tab" aria-selected={item.splitMode === "custom"} className={item.splitMode === "custom" ? "on" : ""} onClick={() => switchSplitMode(item, "custom")}>금액 직접 지정</button>
            </div>

            {info.amount > 0 && (
              <>
                <div className="settle-list settle-list-inner">
                  {item.splitMode === "equal"
                    ? info.shares.map((share) => (
                        <div className="settle-row compact" key={share.key}>
                          <Initial name={nameByKey.get(share.key)} />
                          <span className="settle-row-name">{nameByKey.get(share.key)}</span>
                          <strong>{formatWon(share.amount)}</strong>
                        </div>
                      ))
                    : info.keys.map((key) => (
                        <div className="settle-row compact" key={key}>
                          <Initial name={nameByKey.get(key)} />
                          <span className="settle-row-name">{nameByKey.get(key)}</span>
                          <span className="settle-input-wrap settle-custom-input">
                            <input
                              inputMode="numeric"
                              value={item.customValues[key] === undefined || item.customValues[key] === "" ? "" : parseAmount(item.customValues[key]).toLocaleString("ko-KR")}
                              placeholder="0"
                              onChange={(event) =>
                                updateItem(item.uid, (current) => ({
                                  customValues: { ...current.customValues, [key]: event.target.value.replace(/\D/g, "").slice(0, 10) },
                                }))
                              }
                            />
                            <em>원</em>
                          </span>
                        </div>
                      ))}
                </div>

                {item.splitMode === "equal" ? (
                  info.remainder > 0 && (
                    <p className="settle-note">ⓘ 나머지 {info.remainder}원은 참여자 {info.remainder}명에게 1원씩 랜덤 배분됩니다.</p>
                  )
                ) : (
                  <div className="settle-custom-summary">
                    <div className="settle-custom-total">
                      <span>지정 금액 합계</span>
                      <strong>{formatWon(info.customTotal)}</strong>
                    </div>
                    {info.customDiff === 0 ? (
                      <p className="settle-ok">✓ 총 결제 금액과 일치합니다.</p>
                    ) : info.customDiff > 0 ? (
                      <p className="settle-bad">{formatWon(info.customDiff)}이 남았어요</p>
                    ) : (
                      <p className="settle-bad">{formatWon(-info.customDiff)} 초과했어요</p>
                    )}
                    <button
                      type="button"
                      className="settle-outline"
                      disabled={info.customDiff <= 0 || info.untouched.length === 0}
                      onClick={() => fillRemainingEvenly(item, info)}
                    >
                      남은 금액 나머지에게 1/N
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
          </div>
        );
      })}
      </div>

      {totals.total > 0 && (
        <section className="settle-total-card">
          <div className="settle-total-head">
            <span>총 지출 {items.length > 1 ? `(${items.length}건)` : ""}</span>
            <strong>{formatWon(totals.total)}</strong>
          </div>
          <div className="settle-section-title small">사람별 부담 금액</div>
          <div className="settle-list settle-list-inner">
            {[...totals.perPerson.entries()].map(([key, value]) => (
              <div className={`settle-row compact ${key === meKey ? "me" : ""}`} key={key}>
                <Initial name={nameByKey.get(key)} />
                <span className="settle-row-name">{nameByKey.get(key)}{key === meKey ? " (나)" : ""}</span>
                <strong>{formatWon(value)}</strong>
              </div>
            ))}
          </div>
          <div className="settle-summary-me">
            <div><small>내가 보낼 돈</small><strong>{formatWon(totals.send)}</strong></div>
            <div><small>내가 받을 돈</small><strong>{formatWon(totals.receive)}</strong></div>
          </div>
        </section>
      )}

      {submitError && !confirming && <p className="settle-error" role="alert">{submitError}</p>}
      <button
        type="button"
        className="settle-primary"
        disabled={!allValid || submitting}
        onClick={() => {
          setSubmitError("");
          setConfirming(true);
        }}
      >
        {isEdit ? "수정 저장" : "정산 요청 보내기"}
      </button>

      {confirming && (
        <div
          className="settle-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) setConfirming(false);
          }}
        >
          <section className="settle-confirm" role="dialog" aria-modal="true" aria-label="정산 요청 확인">
            <h2>{isEdit ? "정산을 수정할까요?" : "정산 요청을 보낼까요?"}</h2>
            <p className="settle-confirm-desc">
              {isEdit
                ? "수정한 내용이 정산 참여자에게 알림으로 전해져요."
                : `아래 지출 ${items.length}건이 방 참여자에게 요청돼요.`}
            </p>
            <ul className="settle-confirm-list">
              {items.map((item, index) => {
                const info = computed[index];
                const mine = info.shares.find((share) => share.key === meKey);
                return (
                  <li key={item.uid}>
                    <div className="settle-confirm-top">
                      <strong>{item.title.trim()}</strong>
                      <strong>{formatWon(info.amount)}</strong>
                    </div>
                    <span>
                      {nameByKey.get(item.payerKey) || "결제자"} 결제 &nbsp;|&nbsp; 참여 인원 {info.keys.length}명
                      {item.splitMode === "custom" ? " · 직접 지정" : " · 1/N"}
                    </span>
                    <span className="settle-confirm-people">
                      참여: {info.keys.map((personKey) => nameByKey.get(personKey)).filter(Boolean).join(", ")}
                    </span>
                    {mine && <span className="settle-confirm-mine">내 부담 {formatWon(mine.amount)}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="settle-confirm-all">
              정산 대상 <b>{involvedKeys.length}명</b>
              <span>{involvedKeys.map((personKey) => nameByKey.get(personKey)).filter(Boolean).join(", ")}</span>
            </p>
            <div className="settle-confirm-total">
              <span>총 지출</span>
              <strong>{formatWon(totals.total)}</strong>
            </div>
            {submitError && <p className="settle-error" role="alert">{submitError}</p>}
            <div className="settle-actions">
              <button type="button" className="settle-secondary" disabled={submitting} onClick={() => setConfirming(false)}>
                취소
              </button>
              <button type="button" className="settle-primary" disabled={submitting} onClick={submit}>
                {submitting ? (isEdit ? "저장 중..." : "보내는 중...") : isEdit ? "저장" : "보내기"}
              </button>
            </div>
          </section>
        </div>
      )}

      {picker && (
        <div className="settle-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPicker(null); }}>
          <section className="settle-confirm" role="dialog" aria-modal="true" aria-label="등록할 결제 선택">
            <h2>어떤 결제를 등록할까요?</h2>
            <p className="settle-confirm-desc">
              이미지에서 결제 {picker.data.candidates.length}건을 찾았어요. 승인취소된 건과 누적 금액은 뺐어요.
            </p>
            <ul className="settle-pick-list">
              {picker.data.candidates.map((candidate, index) => {
                const on = picker.selected.has(index);
                return (
                  <li key={`${candidate.storeName}-${candidate.paidAt}-${index}`}>
                    <button
                      type="button"
                      className={on ? "on" : ""}
                      aria-pressed={on}
                      onClick={() => togglePickerCandidate(index)}
                    >
                      <span className={picker.mode === "single" ? "settle-radio-mark" : "settle-check"}>
                        {on ? (picker.mode === "single" ? "●" : "✓") : ""}
                      </span>
                      <span className="settle-pick-info">
                        <strong>{candidate.storeName || "가게 이름 미인식"}</strong>
                        <small>{formatCandidateTime(candidate.paidAt)}</small>
                      </span>
                      <b>{candidate.totalAmount ? formatWon(candidate.totalAmount) : "금액 미인식"}</b>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="settle-link" onClick={switchPickerMode}>
              {picker.mode === "single" ? "여러 건을 각각 지출로 등록하기" : "하나만 고르기"}
            </button>
            <div className="settle-actions">
              <button type="button" className="settle-secondary" onClick={() => setPicker(null)}>
                직접 입력할게요
              </button>
              <button type="button" className="settle-primary" disabled={picker.selected.size === 0} onClick={confirmPicker}>
                {picker.mode === "single" ? "이 결제로 채우기" : `${picker.selected.size}건 지출로 추가`}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default SettlementCreatePage;
