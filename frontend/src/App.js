import { BrowserRouter, Routes, Route } from "react-router-dom";

import RoomCreatePage from "./pages/RoomCreatePage";
import RoomInvitePage from "./pages/RoomInvitePage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RoomCreatePage />} />
        <Route path="/room-invite" element={<RoomInvitePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;