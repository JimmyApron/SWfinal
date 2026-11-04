import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import MeetingDiaryDetailPage from "./MeetingDiaryDetailPage";
import { cancelLightningMeeting, getMeetingDiaryDetails, getMeetingDiaryProgress, getMeetingWithCurrentPlace, getRoomDiaryIdentity, getRoomMeetings, updateLightningMeeting } from "../../api/meetupDiaryApi";
import { supabase } from "../../lib/supabaseClient";

jest.mock("../../api/meetupDiaryApi", () => ({
  cancelLightningMeeting: jest.fn(), deleteDiaryPhotosAndRecord: jest.fn(), getDiaryPhotos: jest.fn(),
  getMeetingDiaryDetails: jest.fn(), getMeetingDiaryProgress: jest.fn(), getMeetingWithCurrentPlace: jest.fn(),
  getRoomDiaryIdentity: jest.fn(), getRoomMeetings: jest.fn(), saveDiaryReaction: jest.fn(), updateLightningMeeting: jest.fn(),
}));
jest.mock("../../lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));

const meeting = {
  id: "meeting-1", room_id: 7, source_type: "lightning", meeting_date: "2020-11-01",
  title: "산책", lifecycle_status: "unknown", created_by_identity_id: "identity-1",
  updated_at: "2020-11-01T12:00:00Z", participant_user_ids: ["member-1"],
};

beforeEach(() => {
  jest.clearAllMocks();
  getRoomDiaryIdentity.mockResolvedValue({ identityId: "identity-1", user: { id: "member-1" } });
  getRoomMeetings.mockResolvedValue([meeting]);
  getMeetingWithCurrentPlace.mockImplementation(async (_roomId, value) => value);
  getMeetingDiaryDetails.mockResolvedValue([]);
  getMeetingDiaryProgress.mockResolvedValue({ published_count: 0, target_count: 1, published_member_ids: [] });
  cancelLightningMeeting.mockResolvedValue(undefined);
  updateLightningMeeting.mockResolvedValue(undefined);
  supabase.from.mockImplementation((table) => ({ select: () => ({ eq: () => table === "rooms"
    ? { single: async () => ({ data: { id: 7, roomname: "모임" }, error: null }) }
    : Promise.resolve({ data: [{ userid: "member-1", nickname: "등록자" }, { userid: "member-2", nickname: "다른 멤버" }], error: null }) }) }));
  window.confirm = jest.fn(() => true);
});

function renderDetail() {
  return render(<MemoryRouter initialEntries={[{ pathname: "/rooms/7/meetings/meeting-1/diary", state: { from: "/rooms/7?tab=calendar" } }]}>
    <Routes>
      <Route path="/rooms/:roomId/meetings/:meetingId/diary" element={<MeetingDiaryDetailPage />} />
      <Route path="/rooms/:roomId" element={<div>방 캘린더</div>} />
    </Routes>
  </MemoryRouter>);
}

test("번개 만남 등록자는 상세 화면에서 삭제하고 캘린더로 돌아간다", async () => {
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "번개 만남 삭제" }));
  expect(window.confirm).toHaveBeenCalled();
  expect(await screen.findByText("방 캘린더")).toBeInTheDocument();
  expect(cancelLightningMeeting).toHaveBeenCalledWith({ roomId: "7", meetingId: "meeting-1", expectedUpdatedAt: meeting.updated_at });
});

test("번개 만남 등록자는 상세 화면에서 만남 정보를 저장한다", async () => {
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "번개 만남 수정" }));
  fireEvent.change(screen.getByRole("textbox", { name: "이름" }), { target: { value: "새 산책" } });
  fireEvent.click(screen.getByRole("button", { name: "저장하기" }));
  await waitFor(() => expect(getMeetingDiaryDetails).toHaveBeenCalledTimes(2));
  expect(updateLightningMeeting).toHaveBeenCalledWith(expect.objectContaining({
    roomId: "7", meetingId: "meeting-1", expectedUpdatedAt: meeting.updated_at,
    title: "새 산책", participantUserIds: ["member-1"],
  }));
});

test("번개 만남 등록자가 아닌 방 멤버도 만남을 수정하고 삭제할 수 있다", async () => {
  getRoomDiaryIdentity.mockResolvedValue({ identityId: "identity-2", user: { id: "member-2" } });
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "번개 만남 수정" }));
  fireEvent.change(screen.getByRole("textbox", { name: "장소 (선택)" }), { target: { value: "새 장소" } });
  fireEvent.click(screen.getByRole("button", { name: "저장하기" }));
  await waitFor(() => expect(updateLightningMeeting).toHaveBeenCalledWith(expect.objectContaining({ location: "새 장소", participantUserIds: ["member-1"] })));
  await waitFor(() => expect(screen.getByRole("button", { name: "번개 만남 삭제" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "번개 만남 삭제" }));
  await waitFor(() => expect(cancelLightningMeeting).toHaveBeenCalledWith(expect.objectContaining({ meetingId: "meeting-1" })));
});

test("방 게스트에게는 번개 만남 수정과 삭제가 보이지 않는다", async () => {
  getRoomDiaryIdentity.mockResolvedValue({ identityId: "guest-identity", user: { id: "guest-user" } });
  renderDetail();
  await screen.findByText("우리의 기록");
  expect(screen.queryByRole("button", { name: "번개 만남 수정" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "번개 만남 삭제" })).not.toBeInTheDocument();
});
