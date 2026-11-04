import { fireEvent, render, screen } from "@testing-library/react";
import LightningMeetingEditSheet from "./LightningMeetingEditSheet";

jest.mock("../../components/map/LocationPicker", () => ({ onSelect }) => <button type="button" onClick={() => onSelect("새 카페", "서울시 중구", { name: "새 카페", address: "서울시 중구" })}>지도 검색 결과</button>);

test("번개 만남 수정에서 선택한 참여자만 저장한다", () => {
  const onSave = jest.fn();
  render(<LightningMeetingEditSheet
    meeting={{ meeting_date: "2020-11-01", title: "산책", start_time: "15:00:00", location: "공원", participant_user_ids: ["owner", "friend"] }}
    members={[{ userid: "owner", nickname: "등록자" }, { userid: "friend", nickname: "친구" }, { userid: "other", nickname: "다른 친구" }]}
    userId="owner"
    busy={false}
    error=""
    onClose={jest.fn()}
    onSave={onSave}
  />);

  expect(screen.getByRole("button", { name: /등록자/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "친구 ✓" }));
  fireEvent.click(screen.getByRole("button", { name: "다른 친구" }));
  fireEvent.change(screen.getByRole("textbox", { name: "이름" }), { target: { value: "수정한 산책" } });
  fireEvent.click(screen.getByRole("button", { name: "저장하기" }));

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    title: "수정한 산책", participantUserIds: ["owner", "other"],
  }));
});

test("지도에서 고른 장소와 주소를 수정 저장에 포함한다", () => {
  const onSave = jest.fn();
  render(<LightningMeetingEditSheet
    meeting={{ meeting_date: "2020-11-01", title: "산책", location: "공원", participant_user_ids: ["owner"] }}
    members={[{ userid: "owner", nickname: "등록자" }]}
    userId="owner"
    busy={false}
    error=""
    onClose={jest.fn()}
    onSave={onSave}
  />);
  fireEvent.click(screen.getByRole("button", { name: "지도에서 선택" }));
  fireEvent.click(screen.getByRole("button", { name: "지도 검색 결과" }));
  expect(screen.getByRole("textbox", { name: "장소 (선택)" })).toHaveValue("새 카페");
  fireEvent.click(screen.getByRole("button", { name: "저장하기" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ location: "새 카페", address: "서울시 중구" }));
});
