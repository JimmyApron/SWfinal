# STEP 05 개인 코스 확정

## 구현

- 신규: `frontend/src/api/courseConfirmationApi.js`, `courseConfirmationApi.test.js`, `courseParticipant.test.js`, 이 문서.
- 수정: `frontend/src/api/voteApi.js`, `frontend/src/api/courseApi.js`, `frontend/src/pages/vote/VoteDetailPage.jsx`. 기존 STEP 04 작업은 유지했다.
- `getMyCourseConfirmation(voteId, roomId)`: 현재 참여자, DB 응답, 선택지, 코스 연결, 일정 및 모임을 검증하고 활성 확정을 조회한다.
- `confirmMyVotedCourse(voteId, roomId, expectedCourseId?)`: 전달 코스는 비교에만 사용하며 DB 응답에서 코스를 결정한다. 동일 활성 확정은 재사용하고 기존 부분 UNIQUE 인덱스로 중복 삽입을 처리한다.
- `submitVote`의 course 분기에서 `submitCourseVote`를 호출한다. 동일 선택지는 유지하고 다른 선택지 저장 성공 후 기존 확정을 `is_active=false`로 갱신한다. 해제 실패 시 응답 복구를 시도하고 오류를 표시한다.
- 회원은 Supabase auth 사용자와 room_members.userid, 게스트는 기존 localStorage guest_id와 room_guests.id를 검증한다. 확정 키는 member:UUID / guest:UUID이며 voteresponses.userid에는 기존 raw UUID TEXT를 유지한다. 인증 회원이 비참여자인 경우 게스트로 우회하지 않는다.
- 상세 화면은 선택지 ID로 코스를 연결하고 본인이 제출한 선택지에만 확정 버튼을 표시한다. 저장 성공 후 DB 재조회 결과로 완료 표시한다. 재접속·포커스 복귀·관련 실시간 이벤트에서 상태를 다시 조회한다.

## 제한 및 DB 검증

- 검증 실행: `CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/api/courseConfirmationApi.test.js src/api/courseParticipant.test.js src/utils/courseVoteUtils.test.js` — 3개 스위트, 27개 테스트 통과, 실패 0개. 기존 `App.test.js`를 포함한 전체 테스트 실행 결과는 아니다.
- 프론트엔드 `npm run build`는 성공했으며 프로젝트 기존 ESLint 경고가 있다.

- 실제 Supabase DB에는 쓰기 테스트, 스키마/RLS/GRANT 변경을 하지 않았다. 테스트는 모의 Supabase 쿼리와 로컬 빌드다. 실제 테이블/권한/인덱스 존재와 Realtime 활성화 여부는 검증하지 않았다.
- 게스트 ID의 localStorage 저장과 room_guests 조회는 신원 인증이 아니다. 기존 voter response의 raw UUID TEXT는 회원/게스트 유형을 저장하지 않아, 두 유형의 UUID가 실제로 같으면 응답 소유권을 구분할 수 없다. 확정 키만 유형별로 구분된다.
- 클라이언트 검증은 직접 DB 요청의 권한을 강제할 수 없다. 기존 RLS가 해당 정책을 보장하는지 별도 확인이 필요하다.
- 투표 저장, 확정 해제, 오류 복구는 여러 요청이다. 네트워크 단절, 응답 유실, 여러 탭의 동시 재투표·확정에서는 원자성을 보장하지 못하며 이전 활성 기록이 남거나 복구가 실패할 수 있다. 조회는 현재 투표와 불일치하는 기록을 완료로 표시하지 않지만 DB의 잘못된 기록 자체를 자동 복구하지 않는다.
- 운영 수준 보장을 위해 서버에서 인증·참여자 검증 후 일정/참여자 단위 잠금을 공유하는 트랜잭션 RPC(확정과 재투표 모두)가 필요하다. 게스트 신원 보장 방식 및 실제 RLS 확인 후 별도 설계·승인을 받아야 하며 이번 단계에서는 DB 함수를 생성하거나 실행하지 않았다.

## STEP 06 조회 데이터

`getMyCourseConfirmation` 반환값:

```js
{
  vote: { id, roomid, scheduleid, votetype },
  participant: { participantType, participantId, roomId },
  participantKey: "member:UUID", // 또는 guest:UUID
  responses: [{ id, optionid, userid }],
  optionId, course: { id, room_id, schedule_id },
  confirmation: { id, schedule_id, course_id, participant_type,
    member_user_id, guest_id, participant_key, is_active, created_at, updated_at }, // 또는 null
  isConfirmed: true // 실제 선택 코스와 활성 확정이 일치할 때만 true
}
```

전체 참석자 완료 판정, 생성자 최종 확정, 로드맵, 채팅 공유는 구현하지 않았다.
