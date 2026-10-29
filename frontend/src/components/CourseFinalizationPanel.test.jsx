import { fireEvent, render as renderUI, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import CourseFinalizationPanel from "./CourseFinalizationPanel";
import { finalizeCourse, getCourseConfirmationProgress } from "../api/courseFinalizationApi";

jest.mock("../api/courseFinalizationApi", () => ({ finalizeCourse: jest.fn(), getCourseConfirmationProgress: jest.fn() }));
jest.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }), { virtual: true });
jest.mock("../lib/supabaseClient", () => ({ supabase: {
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: jest.fn(),
} }));

const vote = { id: 1, scheduleid: 3, vote_course_links: [{ course_id: 20, vote_option_id: 10 }],
  voteoptions: [{ id: 10, optiontext: "코스 A" }] };
let progress;
const render = (ui) => renderUI(ui);
beforeEach(() => {
  progress = { course: { id: 20, course_name: "코스 A" }, eligibleCount: 2, confirmedCount: 1,
    participants: [{ participantKey: "member:u", nickname: "유저", participantType: "member", status: "확정 완료" },
      { participantKey: "guest:g", nickname: "손님", participantType: "guest", status: "미확정" }],
    unconfirmed: [{}], isCreator: true, canFinalize: false, finalization: null,
    reason: "참석자 전원의 확정이 완료되면 최종 코스를 확정할 수 있습니다." };
  getCourseConfirmationProgress.mockReset().mockImplementation(async () => progress);
  finalizeCourse.mockReset();
});

test("미확정 참석자 표시 및 생성자 버튼 비활성화", async () => {
  render(<CourseFinalizationPanel vote={vote} roomId={2} onFinalized={jest.fn()} />);
  expect(await screen.findByText(/손님.*미확정/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "이 코스로 최종 확정하기" })).toBeDisabled();
});

test("일반 참석자는 최종 확정 버튼 없음", async () => {
  progress.isCreator = false;
  render(<CourseFinalizationPanel vote={vote} roomId={2} onFinalized={jest.fn()} />);
  await screen.findByText(/손님.*미확정/);
  expect(screen.queryByRole("button", { name: "이 코스로 최종 확정하기" })).not.toBeInTheDocument();
});

test("DB 검증 조회 오류는 확정 UI를 노출하지 않음", async () => {
  getCourseConfirmationProgress.mockRejectedValue(new Error("식별 정보 불명확"));
  render(<CourseFinalizationPanel vote={vote} roomId={2} onFinalized={jest.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("식별 정보 불명확");
  expect(screen.queryByRole("button", { name: "이 코스로 최종 확정하기" })).not.toBeInTheDocument();
});

test("최종 확정 완료 상태와 방문 장소 표시", async () => {
  progress.finalization = { course: { course_name: "최종 코스", stops: [{ id: 1, place_name: "카페" }] } };
  render(<CourseFinalizationPanel vote={vote} roomId={2} onFinalized={jest.fn()} />);
  expect(await screen.findByText("최종 확정 완료 · 최종 코스")).toBeInTheDocument();
  expect(screen.getByText("카페")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "이 코스로 최종 확정하기" })).not.toBeInTheDocument();
});

test("저장 실패는 완료 표시 대신 오류, 빠른 중복 클릭은 요청 하나", async () => {
  progress.canFinalize = true;
  let rejectSave;
  finalizeCourse.mockImplementation(() => new Promise((resolve, reject) => { rejectSave = reject; }));
  render(<CourseFinalizationPanel vote={vote} roomId={2} onFinalized={jest.fn()} />);
  const button = await screen.findByRole("button", { name: "이 코스로 최종 확정하기" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(finalizeCourse).toHaveBeenCalledTimes(1);
  rejectSave(new Error("저장 실패"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("저장 실패"));
  expect(screen.queryByText(/최종 확정 완료/)).not.toBeInTheDocument();
});
