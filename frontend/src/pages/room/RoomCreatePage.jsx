import { useNavigate } from "react-router-dom";
import RoomCreateForm from "../../components/room/RoomCreateForm";

function RoomCreatePage() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F7F7FA" }}>
      <div
        style={{
          height: "48px",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          backgroundColor: "#fff",
          borderBottom: "1px solid #E5E7EB",
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{ border: "none", background: "none", fontSize: "20px", color: "#1F2933", flex: "0 0 28px" }}
        >
          ←
        </button>
        <h3 style={{ margin: 0, flex: 1, textAlign: "center", fontSize: "15px", color: "#1F2933" }}>방 만들기</h3>
        <div style={{ flex: "0 0 28px" }} />
      </div>

      <div style={{ padding: "16px" }}>
        <RoomCreateForm
          onCreated={(roomId) => {
            alert("방이 생성되었습니다.");
            navigate(`/rooms/${roomId}`);
          }}
        />
      </div>
    </div>
  );
}

export default RoomCreatePage;
