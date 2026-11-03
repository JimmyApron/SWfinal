import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import DiaryCollection from "./DiaryCollection";
import { getDiaryPhotos, getMeetingDiaryDetails, getMyMeetingDiary, getRoomDiaryIdentity, getRoomMeetings } from "../../api/meetupDiaryApi";
import { supabase } from "../../lib/supabaseClient";

jest.mock("../../api/meetupDiaryApi", () => ({
  getDiaryPhotos: jest.fn(), getMeetingDiaryDetails: jest.fn(), getMyMeetingDiary: jest.fn(),
  getRoomDiaryIdentity: jest.fn(), getRoomMeetings: jest.fn(),
}));
jest.mock("../../lib/supabaseClient", () => ({ supabase: {
  auth: { getSession: jest.fn() }, from: jest.fn(),
} }));
jest.mock("./DiaryPhotoLightbox", () => () => <div role="dialog">사진 보기</div>);

const meeting = { id: "meeting-1", title: "함께 산책", meeting_date: "2026-11-02", lifecycle_status: "active" };
const diary = { id: "diary-1", meeting_id: meeting.id, status: "published", author_auth_user_id: "member-1", body: "즐거운 하루", published_at: "2026-11-02T12:00:00Z", visibility: "room" };

function CurrentRoute() {
  const location = useLocation();
  return <output data-testid="current-route">{location.pathname}{location.search}</output>;
}
function renderCollection({ from = "/rooms/7?tab=calendar", search = "?month=2026-11" } = {}) {
  return render(<MemoryRouter initialEntries={[{ pathname: "/rooms/7/diaries", search, state: from ? { from } : null }]}>
    <CurrentRoute />
    <Routes>
      <Route path="/rooms/:roomId/diaries" element={<DiaryCollection />} />
      <Route path="/rooms/:roomId" element={<div>방 캘린더</div>} />
      <Route path="/rooms/:roomId/meetings/:meetingId/diary" element={<div>기록 상세</div>} />
    </Routes>
  </MemoryRouter>);
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  window.scrollTo = jest.fn();
  getRoomDiaryIdentity.mockResolvedValue({ user: { id: "member-1" }, identityId: "identity-1" });
  getRoomMeetings.mockResolvedValue([meeting]);
  getMeetingDiaryDetails.mockResolvedValue([diary]);
  getMyMeetingDiary.mockResolvedValue(diary);
  getDiaryPhotos.mockResolvedValue([{ id: "photo-1", url: "https://example.invalid/photo.jpg" }]);
  supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  supabase.from.mockReturnValue({ select: () => ({ in: async () => ({ data: [], error: null }) }) });
});

test("monthly view settles after loading assets instead of repeatedly fetching and rendering", async () => {
  renderCollection();
  await screen.findByAltText("기록 사진");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(getRoomMeetings).toHaveBeenCalledTimes(1);
  expect(getDiaryPhotos).toHaveBeenCalledTimes(1);
  expect(supabase.from).toHaveBeenCalledTimes(1);
});

test("photo and own-record tabs and period buttons update the displayed view", async () => {
  renderCollection();
  await screen.findByText("즐거운 하루");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "사진", exact: true })); });
  expect(screen.getByRole("button", { name: "사진", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await screen.findByAltText("내 만남 기록 사진")).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "내 기록", exact: true })); });
  expect(await screen.findByText("나의 하루")).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "전체 보기" })); });
  expect(screen.getByRole("button", { name: "전체 보기" })).toHaveClass("selected");
  expect(screen.queryByRole("button", { name: "이전 달" })).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "월별 보기" })); });
  expect(screen.getByRole("button", { name: "이전 달" })).toBeInTheDocument();
});

function includeOlderRecords() {
  const olderMeeting = { ...meeting, id: "meeting-old", meeting_date: "2026-09-12", title: "9월 만남" };
  const emptyMeeting = { ...meeting, id: "meeting-empty", meeting_date: "2026-10-12", title: "미작성 만남" };
  const olderDiary = { ...diary, id: "diary-old", meeting_id: olderMeeting.id, body: "9월 기록" };
  const draft = { ...diary, id: "diary-draft", meeting_id: emptyMeeting.id, status: "draft", body: "임시 저장" };
  getRoomMeetings.mockResolvedValue([olderMeeting, emptyMeeting, meeting]);
  const byMeeting = { [meeting.id]: diary, [olderMeeting.id]: olderDiary, [emptyMeeting.id]: draft };
  getMeetingDiaryDetails.mockImplementation(async (id) => [byMeeting[id]]);
  getMyMeetingDiary.mockImplementation(async (id) => byMeeting[id]);
}

test("month navigation skips months without published records and stops at the first and last", async () => {
  includeOlderRecords();
  renderCollection();
  await screen.findByText("즐거운 하루");
  expect(screen.getByRole("button", { name: "다음 달" })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "이전 달" })); });
  expect(screen.getByRole("heading", { name: "2026년 9월" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "2026년 10월" })).not.toBeInTheDocument();
  expect(screen.getByText("9월 기록")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다음 달" })); });
  expect(screen.getByRole("heading", { name: "2026년 11월" })).toBeInTheDocument();
  await screen.findByAltText("기록 사진");
});

test.each(["meetings", "mine"])("%s all view omits month headings for draft-only meetings", async (tab) => {
  includeOlderRecords();
  renderCollection({ search: `?tab=${tab}&view=all&month=2026-11` });
  await screen.findByText("즐거운 하루");
  expect(screen.getByRole("heading", { name: "2026년 9월" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "2026년 11월" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "2026년 10월" })).not.toBeInTheDocument();
  await act(async () => {});
});

test("entering an empty month selects the latest month with records", async () => {
  renderCollection({ search: "?month=2026-10" });
  await screen.findByAltText("기록 사진");
  expect(screen.getByRole("heading", { name: "2026년 11월" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "2026년 10월" })).not.toBeInTheDocument();
});

test("own-record view skips a month containing only another member's records", async () => {
  const otherMeeting = { ...meeting, id: "meeting-other", meeting_date: "2026-10-12" };
  getRoomMeetings.mockResolvedValue([meeting, otherMeeting]);
  getMeetingDiaryDetails.mockImplementation(async (id) => [id === meeting.id ? diary : { ...diary, id: "other-diary", meeting_id: otherMeeting.id, author_auth_user_id: "member-2" }]);
  renderCollection({ search: "?tab=mine&month=2026-10" });
  await screen.findByAltText("기록 대표 사진");
  expect(screen.queryByRole("heading", { name: "2026년 10월" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();
});

test("no records shows an empty state without an empty month heading", async () => {
  getMeetingDiaryDetails.mockResolvedValue([]);
  getMyMeetingDiary.mockResolvedValue(null);
  renderCollection();
  await screen.findByText("아직 작성된 기록이 없어요.");
  expect(screen.queryByRole("heading", { name: /2026년.*월/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "이전 달" })).not.toBeInTheDocument();
});

test.each(["/rooms/7?tab=calendar", null])("back returns to the room calendar with entry state %s", async (from) => {
  renderCollection({ from });
  await screen.findByText("즐거운 하루");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "뒤로 가기" })); });
  expect(await screen.findByText("방 캘린더")).toBeInTheDocument();
  expect(screen.getByTestId("current-route")).toHaveTextContent("/rooms/7?tab=calendar");
});

test("record and photo buttons open their respective views", async () => {
  renderCollection();
  await screen.findByAltText("기록 사진");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "사진 크게 보기" })); });
  expect(await screen.findByRole("dialog")).toHaveTextContent("사진 보기");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "내 기록 보기 ›" })); });
  expect(await screen.findByText("기록 상세")).toBeInTheDocument();
});
