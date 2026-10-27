import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatWon, listExpenses } from "../../api/settlementApi";
import "./Settlement.css";

function formatDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function progressLabel(progress) {
  if (progress.total === 0) return "";
  if (progress.settled >= progress.total) return "정산 완료";
  return `송금 ${progress.settled}/${progress.total}`;
}

function SettlementListPage() {
  const navigate = useNavigate();
  const { scheduleId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listExpenses(scheduleId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      });
    return () => {
      active = false;
    };
  }, [scheduleId]);

  return (
    <main className="settle-page">
      <header className="settle-header">
        <button type="button" className="settle-back" onClick={() => navigate(-1)} aria-label="뒤로">←</button>
        <h1>정산 내역</h1>
        <span />
      </header>

      {error && <p className="settle-error" role="alert">{error}</p>}
      {!data && !error && <p className="settle-muted">불러오는 중...</p>}

      {data && (
        <>
          <section className="settle-amount-card">
            <span className="settle-coin">🪙</span>
            <div>
              <small>이번 약속 총지출</small>
              <strong>{formatWon(data.summary.totalAmount)}</strong>
              <small>등록된 지출 {data.summary.count}건</small>
            </div>
          </section>

          <section className="settle-summary-me">
            <div><small>내가 보낼 돈</small><strong>{formatWon(data.summary.mySend)}</strong></div>
            <div><small>내가 받을 돈</small><strong>{formatWon(data.summary.myReceive)}</strong></div>
          </section>
          <p className="settle-hint">이미 보냈거나 받았다고 확인한 금액은 빼고 계산해요.</p>

          <div className="settle-section-title">지출 목록</div>
          {data.expenses.length === 0 ? (
            <p className="settle-muted">아직 등록된 지출이 없어요.</p>
          ) : (
            <ul className="settle-expense-list">
              {data.expenses.map((expense) => {
                const label = progressLabel(expense.progress);
                const done = expense.progress.total > 0 && expense.progress.settled >= expense.progress.total;
                return (
                  <li key={expense.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/schedules/${scheduleId}/settlement/${expense.id}`)}
                    >
                      <span className="settle-expense-icon">🧾</span>
                      <span className="settle-expense-info">
                        <strong>{expense.title}</strong>
                        <b>{formatWon(expense.amount)}</b>
                        <small>
                          {expense.payer.nickname} 결제 &nbsp;|&nbsp; 참여 인원 {expense.participantCount}명
                        </small>
                        <small>{formatDateTime(expense.paidat)}</small>
                      </span>
                      <span className="settle-expense-side">
                        {label && <em className={done ? "done" : ""}>{label}</em>}
                        <span>›</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            className="settle-primary"
            onClick={() => navigate(`/schedules/${scheduleId}/settlement/new`)}
          >
            + 지출 추가
          </button>
        </>
      )}
    </main>
  );
}

export default SettlementListPage;
