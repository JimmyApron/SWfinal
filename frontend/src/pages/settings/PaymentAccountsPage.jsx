import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaChevronLeft } from "react-icons/fa";
import { supabase } from "../../lib/supabaseClient";
import {
  SETTLEMENT_BANKS,
  addMyAccount,
  deleteMyAccount,
  getMyAccounts,
  setDefaultMyAccount,
  updateMyAccount,
} from "../../api/settlementApi";
import "./SettingsPage.css";
import "./PaymentAccountsPage.css";

const EMPTY_FORM = { id: null, label: "", bankname: "", accountnumber: "", isdefault: false };

function PaymentAccountsPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState(null); // null이면 목록만 보인다
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          alert("계좌 관리는 로그인한 회원만 사용할 수 있어요.");
          navigate("/settings", { replace: true });
          return;
        }
        setAccounts((await getMyAccounts()).accounts);
      } catch (loadError) {
        console.error("계좌 목록 조회 실패:", loadError);
        setError(loadError.message || "계좌 목록을 불러오지 못했어요.");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [navigate]);

  const run = async (action) => {
    try {
      setIsSaving(true);
      setError("");
      setAccounts((await action()).accounts);
      return true;
    } catch (actionError) {
      setError(actionError.message || "처리하지 못했어요.");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const openAdd = () => {
    setError("");
    setForm({ ...EMPTY_FORM, isdefault: accounts.length === 0 });
  };

  const openEdit = (account) => {
    setError("");
    setForm({ ...account });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.bankname) return setError("은행을 선택해 주세요.");
    if (!form.accountnumber.trim()) return setError("계좌번호를 입력해 주세요.");

    const payload = {
      label: form.label.trim(),
      bankname: form.bankname,
      accountnumber: form.accountnumber.trim(),
      isdefault: form.isdefault,
    };
    const saved = await run(() => (form.id ? updateMyAccount(form.id, payload) : addMyAccount(payload)));
    if (saved) setForm(null);
  };

  const handleDelete = (account) => {
    if (!window.confirm(`"${account.label}" 계좌를 삭제할까요?`)) return;
    run(() => deleteMyAccount(account.id));
  };

  if (isLoading) return <div className="loading-container">계좌를 불러오는 중입니다...</div>;

  return (
    <div className="settings-page">
      <div className="settings-content">
        <header className="settings-header">
          <button type="button" className="back-button" onClick={() => navigate(-1)} aria-label="이전 화면으로 돌아가기">
            <FaChevronLeft />
          </button>
          <h2 className="settings-title">내 계좌 관리</h2>
        </header>

        <p className="pay-acc-desc">
          정산하기에서 내가 결제자일 때 <b>기본 계좌</b>가 자동으로 채워져요. 계좌는 최대 10개까지 저장할 수 있어요.
        </p>

        {error && <p className="pay-acc-error" role="alert">{error}</p>}

        {accounts.length === 0 && !form && <p className="pay-acc-empty">저장된 계좌가 없어요.</p>}

        <ul className="pay-acc-list">
          {accounts.map((account) => (
            <li key={account.id} className={`pay-acc-card${account.isdefault ? " is-default" : ""}`}>
              <div className="pay-acc-info">
                <div className="pay-acc-name">
                  <strong>{account.label}</strong>
                  {account.isdefault && <span className="pay-acc-badge">기본 계좌</span>}
                </div>
                <p>{account.bankname} {account.accountnumber}</p>
              </div>
              <div className="pay-acc-actions">
                {!account.isdefault && (
                  <button type="button" disabled={isSaving} onClick={() => run(() => setDefaultMyAccount(account.id))}>
                    기본으로 설정
                  </button>
                )}
                <button type="button" disabled={isSaving} onClick={() => openEdit(account)}>수정</button>
                <button type="button" className="is-danger" disabled={isSaving} onClick={() => handleDelete(account)}>삭제</button>
              </div>
            </li>
          ))}
        </ul>

        {form ? (
          <form className="pay-acc-form" onSubmit={handleSubmit}>
            <h3>{form.id ? "계좌 수정" : "새 계좌 추가"}</h3>
            <label>
              <span>계좌 이름</span>
              <input
                type="text"
                maxLength={20}
                value={form.label}
                placeholder="예: 생활비 통장 (비워두면 은행 이름)"
                onChange={(event) => setForm({ ...form, label: event.target.value })}
              />
            </label>
            <label>
              <span>은행</span>
              <select value={form.bankname} onChange={(event) => setForm({ ...form, bankname: event.target.value })}>
                <option value="">은행 선택</option>
                {SETTLEMENT_BANKS.map((bank) => (
                  <option key={bank} value={bank}>{bank}</option>
                ))}
              </select>
            </label>
            <label>
              <span>계좌번호</span>
              <input
                type="text"
                inputMode="numeric"
                value={form.accountnumber}
                placeholder="숫자와 -만 입력"
                onChange={(event) => setForm({ ...form, accountnumber: event.target.value.replace(/[^0-9-]/g, "") })}
              />
            </label>
            <label className="pay-acc-check">
              <input
                type="checkbox"
                checked={form.isdefault}
                disabled={accounts.find((account) => account.id === form.id)?.isdefault}
                onChange={(event) => setForm({ ...form, isdefault: event.target.checked })}
              />
              기본 계좌로 설정
            </label>
            <div className="pay-acc-form-actions">
              <button type="button" onClick={() => setForm(null)} disabled={isSaving}>취소</button>
              <button type="submit" className="is-primary" disabled={isSaving}>
                {isSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="pay-acc-add" disabled={accounts.length >= 10} onClick={openAdd}>
            + 계좌 추가
          </button>
        )}
      </div>
    </div>
  );
}

export default PaymentAccountsPage;
