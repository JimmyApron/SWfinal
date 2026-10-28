import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DiaryEditor from "./DiaryEditor";
import { getDiaryPhotos, getMyMeetingDiary, saveDiary, uploadDiaryPhotos } from "../../api/meetupDiaryApi";

jest.mock("../../api/meetupDiaryApi", () => ({
  getDiaryPhotos: jest.fn(),
  getMyMeetingDiary: jest.fn(),
  saveDiary: jest.fn(),
  uploadDiaryPhotos: jest.fn(),
}));

const meeting = { id: "meeting-1", meeting_date: "2026-10-27", title: "저녁 모임", source_type: "confirmed" };
const existingDraft = {
  id: "diary-1", meeting_id: meeting.id, status: "draft", body: "이전 기록", mood_emoji: "😊",
  visibility: "room", version: 3, updated_at: "2026-10-27T03:00:00.000Z",
};

function renderEditor(onClose = jest.fn()) {
  render(<DiaryEditor roomId="room-1" meeting={meeting} identityId="identity-1" fullScreen onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  getMyMeetingDiary.mockResolvedValue(existingDraft);
  getDiaryPhotos.mockResolvedValue([]);
  saveDiary.mockResolvedValue({ id: existingDraft.id, status: "draft", version: 4, updated_at: new Date().toISOString() });
  uploadDiaryPhotos.mockResolvedValue({ id: existingDraft.id, version: 4, photos: [] });
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: jest.fn(() => "request-id") } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn(() => "blob:test-photo") });
});

test("X saves dirty text and leaves without showing the failure dialog", async () => {
  const onClose = renderEditor();
  const bodyField = await screen.findByLabelText("어떤 하루였나요?");
  fireEvent.change(bodyField, { target: { value: "수정한 기록" } });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));

  await waitFor(() => expect(onClose).toHaveBeenCalledWith({ saved: true }));
  expect(saveDiary).toHaveBeenCalledWith(expect.objectContaining({ body: "수정한 기록", publish: false }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("X waits for an in-progress save and exits normally when it succeeds", async () => {
  let finishSave;
  saveDiary.mockReturnValue(new Promise((resolve) => { finishSave = resolve; }));
  const onClose = renderEditor();
  fireEvent.change(await screen.findByLabelText("어떤 하루였나요?"), { target: { value: "저장 중인 기록" } });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(saveDiary).toHaveBeenCalledTimes(1));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

  await act(async () => finishSave({ id: existingDraft.id, status: "draft", version: 4, updated_at: new Date().toISOString() }));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith({ saved: true }));
});

test("X shows the dialog on save failure and retry success leaves with the saved toast state", async () => {
  const onClose = renderEditor();
  saveDiary.mockRejectedValueOnce(new Error("네트워크 오류"));
  saveDiary.mockRejectedValueOnce(new Error("재시도도 실패했습니다"));
  saveDiary.mockResolvedValueOnce({ id: existingDraft.id, status: "draft", version: 4, updated_at: new Date().toISOString() });
  fireEvent.change(await screen.findByLabelText("어떤 하루였나요?"), { target: { value: "저장 실패 후 다시 시도" } });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));

  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  expect(screen.getByText("자동 저장에 실패했어요")).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "다시 저장" }));
  expect(await within(screen.getByRole("alertdialog")).findByText("재시도도 실패했습니다")).toBeInTheDocument();
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "다시 저장" }));

  await waitFor(() => expect(onClose).toHaveBeenCalledWith({ saved: true }));
  expect(saveDiary).toHaveBeenCalledTimes(3);
});

test("photo upload failure counts as unsaved and shows the dialog", async () => {
  const onClose = renderEditor();
  uploadDiaryPhotos.mockRejectedValue(new Error("사진 업로드 실패"));
  const photoInput = (await screen.findByText("사진 추가")).parentElement.querySelector("input[type='file']");
  fireEvent.change(photoInput, { target: { files: [new File(["photo"], "photo.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(uploadDiaryPhotos).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));

  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test("continue writing closes only the popup and keeps the edited text", async () => {
  const onClose = renderEditor();
  saveDiary.mockRejectedValue(new Error("네트워크 오류"));
  const bodyField = await screen.findByLabelText("어떤 하루였나요?");
  fireEvent.change(bodyField, { target: { value: "계속 작성할 내용" } });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "계속 작성" }));

  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(bodyField).toHaveValue("계속 작성할 내용");
  expect(onClose).not.toHaveBeenCalled();
});

test("discard exits without a success result and clears local recovery while preserving the server draft", async () => {
  const onClose = renderEditor();
  saveDiary.mockRejectedValue(new Error("네트워크 오류"));
  const bodyField = await screen.findByLabelText("어떤 하루였나요?");
  fireEvent.change(bodyField, { target: { value: "폐기할 미저장 내용" } });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(screen.getByText(/마지막 저장 이후 변경사항은 사라집니다/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "저장하지 않고 나가기" }));

  await waitFor(() => expect(onClose).toHaveBeenCalledWith({ saved: false }));
  expect(localStorage.getItem("meetup-diary-draft:room-1:meeting-1:identity-1")).toBeNull();
  expect(saveDiary).toHaveBeenCalledTimes(1);
  expect(getMyMeetingDiary).toHaveBeenCalledTimes(1);
});
