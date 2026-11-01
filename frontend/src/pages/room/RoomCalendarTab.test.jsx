import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RoomCalendarTab from "./RoomCalendarTab";
import {
  getCalendarDiaryThumbnails,
  getMeetingDiaryProgress,
  getRoomDiaries,
  getRoomDiaryIdentity,
  getRoomMeetings,
  updateLightningMeetingPlace,
} from "../../api/meetupDiaryApi";

jest.mock("../../api/meetupDiaryApi", () => ({
  createLightningMeeting: jest.fn(),
  getCalendarDiaryThumbnails: jest.fn(),
  getMeetingDiaryProgress: jest.fn(),
  getRoomDiaries: jest.fn(),
  getRoomDiaryIdentity: jest.fn(),
  getRoomMeetings: jest.fn(),
  updateLightningMeetingPlace: jest.fn(),
}));

test("다른 방 구성원도 번개 만남 장소를 수정할 수 있다", async () => {
  sessionStorage.setItem("room-calendar-state:2", JSON.stringify({
    month: "2026-10-28", selectedDate: "2026-10-28", selectedMeetingIndex: 0,
  }));
  let savedLocation = "기존 장소";
  getRoomDiaryIdentity.mockResolvedValue({ identityId: "identity-2", user: { id: "member-2" } });
  getRoomMeetings.mockImplementation(async () => [{
    id: "meeting-1", room_id: 2, source_type: "lightning", meeting_date: "2026-10-28",
    title: "번개 만남", location: savedLocation, location_address: "", lifecycle_status: "unknown",
    created_by_identity_id: "identity-1",
  }]);
  getRoomDiaries.mockResolvedValue([]);
  getCalendarDiaryThumbnails.mockResolvedValue({});
  getMeetingDiaryProgress.mockResolvedValue({ published_count: 0, target_count: 2, published_member_ids: [] });
  updateLightningMeetingPlace.mockImplementation(async ({ location }) => { savedLocation = location; });

  const { container } = render(<MemoryRouter><RoomCalendarTab roomId={2} participants={[]} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "장소 수정" }));
  fireEvent.change(screen.getByLabelText("장소"), { target: { value: "새 장소" } });
  fireEvent.click(screen.getByRole("button", { name: "장소 저장" }));

  await waitFor(() => expect(updateLightningMeetingPlace).toHaveBeenCalledWith({
    roomId: 2, meetingId: "meeting-1", location: "새 장소", address: "",
  }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "번개 만남 장소 수정" })).not.toBeInTheDocument());
  await waitFor(() => expect(container.querySelector(".calendar-meeting-info span")).toHaveTextContent("새 장소"));
});
