import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  confirmExpenseShare,
  deleteExpense,
  formatWon,
  getExpenseAccount,
  getExpenseDetail,
  markExpenseSent,
  remindExpense,
} from "../../api/settlementApi";
import "./Settlement.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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

function Initial({ name }) {
  return <span className="settle-initial">{(name || "?").slice(0, 1)}</span>;
}

function SettlementDetailPage() {
  const navigate = useNavigate();
  const { scheduleId, expenseId } = useParams();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await getExpenseDetail(expenseId));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [expenseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const run = async (action, successMessage) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (result && result.expense) setDetail(result);
      if (successMessage) setToast(successMessage);
    } catch (actionError) {
      setToast(actionError.message || "처리하지 못했어요");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const copyAccount = async () => {
    try {
      const account = await getExpenseAccount(expenseId);
      await navigator.clipboard.writeText(account.accountnumber);
      setToast("계좌번호를 복사했어요");
    } catch (copyError) {
      setToast(copyError.message || "계좌번호를 복사하지 못했어요");
    }
  };

  // 지출을 등록한 사람이나 결제자만 수정·삭제할 수 있다.
  const canManage = Boolean(detail && (detail.viewer.isPayer || detail.viewer.isCreator));

  const header = (
    <header className={`settle-header ${canManage ? "with-actions" : ""}`}>
      <button type="button" className="settle-back" onClick={() => navigate(-1)} aria-label="뒤로">←</button>
      <h1>정산 상세</h1>
      {canManage ? (
        <span className="settle-header-actions">
          <button type="button" onClick={() => navigate(`/schedules/${scheduleId}/settlement/${expenseId}/edit`)}>수정</button>
          <button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>삭제</button>
        </span>
      ) : (
        <span />
      )}
    </header>
  );

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteExpense(expenseId);
      navigate(`/schedules/${scheduleId}/settlement`, { replace: true });
    } catch (deleteError) {
      setToast(deleteError.message || "정산을 삭제하지 못했어요");
      setConfirmingDelete(false);
      setBusy(false);
    }
  };

  if (error) {
    return (
      <main className="settle-page">
        {header}
        <p className="settle-error" role="alert">{error}</p>
        <button type="button" className="settle-primary" onClick={() => navigate(`/schedules/${scheduleId}/settlement`)}>
          정산 내역으로
        </button>
      </main>
    );
  }
  if (!detail) {
    return <main className="settle-page">{header}<p className="settle-muted">불러오는 중...</p></main>;
  }

  const { expense, shares, progress, viewer, schedule } = detail;
  const myShare = shares.find((share) => share.isMe);
  const owes = myShare && !viewer.isPayer;
  const pendingOthers = shares.filter((share) => !share.isPayer && !share.sentat && !share.confirmedat);
  const canRemind = (viewer.isPayer || viewer.isCreator) && pendingOthers.some((share) => !share.isMe);
  const percent = progress.total ? Math.round((progress.settled / progress.total) * 100) : 0;

  return (
    <main className="settle-page">
      {toast && <div className="settle-toast" role="status">{toast}</div>}
      {header}

      <section className="settle-schedule-card">
        <strong>{schedule.title || "모임"}</strong>
        <span>{formatDate(schedule.date)}</span>
      </section>

      <section className="settle-expense-card">
        <div className="settle-expense-top">
          <strong>{expense.title}</strong>
          <strong>{formatWon(expense.amount)}</strong>
        </div>
        <span>{expense.payer.nickname} 결제 &nbsp;|&nbsp; 참여 인원 {shares.length}명</span>
        {expense.paidat && <small>{formatDateTime(expense.paidat)}</small>}
      </section>

      {expense.hasReceipt && (
        <button
          type="button"
          className="settle-receipt-row"
          onClick={() => navigate(`/schedules/${scheduleId}/settlement/${expense.id}/receipt`)}
        >
          <span className="settle-receipt-icon">🧾</span>
          <span>
            <strong>증빙 이미지</strong>
            <small>등록된 영수증 1장</small>
          </span>
          <em>이미지 보기 ›</em>
        </button>
      )}

      {owes && (
        <section className="settle-highlight">
          <small>내 부담 금액 ({myShare.nickname})</small>
          <strong>{formatWon(myShare.amount)}</strong>
          <span>{expense.payer.nickname}에게 보내야 할 금액</span>
        </section>
      )}
      {viewer.isPayer && (
        <section className="settle-highlight">
          <small>받을 금액</small>
          <strong>
            {formatWon(
              shares.filter((share) => !share.isPayer && !share.sentat && !share.confirmedat).reduce((sum, share) => sum + share.amount, 0)
            )}
          </strong>
          <span>아직 받지 못한 {pendingOthers.length}명의 금액이에요</span>
        </section>
      )}

      {progress.total > 0 && (
        <section className="settle-progress">
          <div className="settle-progress-head">
            <span>송금 현황</span>
            <strong>{progress.total}명 중 {progress.settled}명 완료</strong>
          </div>
          <div className="settle-progress-bar"><span style={{ width: `${percent}%` }} /></div>
        </section>
      )}

      <div className="settle-section-title">참여자별 부담 금액</div>
      <section className="settle-list">
        {shares.map((share) => (
          <div className={`settle-row ${share.isMe ? "me" : ""}`} key={share.id}>
            <Initial name={share.nickname} />
            <span className="settle-row-name">
              {share.nickname}{share.isMe ? " (나)" : ""}
              <small className="settle-status-line">
                {share.isPayer
                  ? "결제자"
                  : share.confirmedat
                    ? "✓ 결제자가 확인했어요"
                    : share.sentat
                      ? "보냈어요 · 확인 대기"
                      : "아직 보내지 않았어요"}
              </small>
            </span>
            <span className="settle-share-side">
              <strong>{formatWon(share.amount)}</strong>
              {!share.isPayer && share.isMe && (
                share.sentat && !share.confirmedat ? (
                  <button type="button" className="settle-mini" disabled={busy} onClick={() => run(() => markExpenseSent(expense.id, false), "보냈어요를 취소했어요")}>
                    보냈어요 취소
                  </button>
                ) : !share.sentat ? (
                  <button type="button" className="settle-mini on" disabled={busy} onClick={() => run(() => markExpenseSent(expense.id, true), "결제자에게 알렸어요")}>
                    보냈어요
                  </button>
                ) : null
              )}
              {!share.isPayer && !share.isMe && viewer.isPayer && (
                share.confirmedat ? (
                  <button type="button" className="settle-mini" disabled={busy} onClick={() => run(() => confirmExpenseShare(expense.id, share.id, false))}>
                    확인 취소
                  </button>
                ) : (
                  <button type="button" className="settle-mini on" disabled={busy} onClick={() => run(() => confirmExpenseShare(expense.id, share.id, true), "받았다고 확인했어요")}>
                    받았어요
                  </button>
                )
              )}
            </span>
          </div>
        ))}
      </section>

      {canRemind && (
        <button
          type="button"
          className="settle-outline settle-add-more"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await remindExpense(expense.id);
              setToast(`${result.notified}명에게 다시 알림을 보냈어요`);
              return null;
            })
          }
        >
          🔔 아직 안 보낸 사람에게 다시 알림
        </button>
      )}

      {expense.hasAccount && (
        <>
          <div className="settle-section-title">결제자 계좌 정보</div>
          <section className="settle-account">
            <div>
              <small>은행</small> <b>{expense.bankname || "-"}</b>
              <br />
              <small>계좌번호</small> <b>{expense.accountMasked}</b>
            </div>
            <button type="button" onClick={copyAccount} aria-label="계좌번호 복사">계좌 복사</button>
          </section>
        </>
      )}

      <button type="button" className="settle-primary" onClick={() => navigate(`/schedules/${scheduleId}/settlement`)}>
        정산 내역 보기
      </button>

      {confirmingDelete && (
        <div
          className="settle-overlay center"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setConfirmingDelete(false);
          }}
        >
          <section className="settle-confirm center" role="alertdialog" aria-modal="true" aria-label="정산 삭제 확인">
            <h2>정산을 삭제할까요?</h2>
            <p className="settle-confirm-desc">
              "{expense.title}" {formatWon(expense.amount)} 정산이 삭제돼요. 참여자들에게 알림이 가고, 채팅의 정산 카드는
              "삭제된 정산이에요"로 바뀌어요. 되돌릴 수 없어요.
            </p>
            {pendingOthers.length > 0 && (
              <p className="settle-confirm-warning" role="alert">
                ⚠ 아직 정산하지 않은 항목이 있어요
                <br />
                미정산 {pendingOthers.length}명 · {formatWon(pendingOthers.reduce((sum, share) => sum + share.amount, 0))}
              </p>
            )}
            <div className="settle-actions">
              <button type="button" className="settle-secondary" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                취소
              </button>
              <button type="button" className="settle-primary settle-danger" disabled={busy} onClick={handleDelete}>
                {busy ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default SettlementDetailPage;
