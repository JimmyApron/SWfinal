import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getReceiptUrl } from "../../api/settlementApi";
import "./Settlement.css";

// 증빙 이미지 전체 화면 뷰어. 더블탭으로 확대/축소하고, 모바일에서는 핀치 확대도 돼요.
function SettlementReceiptPage() {
  const navigate = useNavigate();
  const { expenseId } = useParams();
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let active = true;
    getReceiptUrl(expenseId)
      .then((data) => {
        if (active) setReceipt(data);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      });
    return () => {
      active = false;
    };
  }, [expenseId]);

  return (
    <main className="settle-viewer">
      <header className="settle-viewer-header">
        <button type="button" onClick={() => navigate(-1)} aria-label="뒤로">←</button>
        <h1>증빙 이미지</h1>
        <button type="button" onClick={() => navigate(-1)} aria-label="닫기">×</button>
      </header>

      <div className="settle-viewer-stage">
        {error && <p className="settle-viewer-message">{error}</p>}
        {!receipt && !error && <p className="settle-viewer-message">불러오는 중...</p>}
        {receipt && (
          <img
            src={receipt.url}
            alt="증빙 이미지"
            className={zoomed ? "zoomed" : ""}
            onDoubleClick={() => setZoomed((current) => !current)}
            onError={() => setError("이미지를 불러오지 못했어요. 다시 열어 주세요.")}
          />
        )}
      </div>

      {receipt && (
        <p className="settle-viewer-caption">{receipt.uploader}님이 등록한 증빙 이미지</p>
      )}
    </main>
  );
}

export default SettlementReceiptPage;
