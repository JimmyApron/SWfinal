# STEP 06 참석자 전원 동의 및 일정 생성자 최종 확정

## 생성·수정 파일

신규 파일:

- `frontend/src/api/scheduleCreationApi.js`
- `frontend/src/api/courseFinalizationApi.js`
- `frontend/src/api/courseFinalizationApi.test.js`
- `frontend/src/components/CourseFinalizationPanel.jsx`
- `frontend/src/components/CourseFinalizationPanel.test.jsx`
- `frontend/src/testUtils/mockDatabase.js`
- 이 보고서

수정 파일:

- `frontend/src/api/scheduleApi.js`: 신규 일정 생성 경로 3곳을 공통 함수로 연결
- `frontend/src/api/voteApi.js`: 일정 투표로 신규 일정 생성 시 생성자 기록 연결, 최종 확정 후 코스 투표 편집·삭제·선택지 변경 및 새 코스 투표 생성 차단
- `frontend/src/api/courseConfirmationApi.js`: 최종 확정 후 코스 재투표·개인 확정 저장·해제 차단
- `frontend/src/pages/room/ScheduleTab.jsx`: 직접 생성 시 생성자 기록 연결 및 구체적인 실패 안내
- `frontend/src/pages/vote/VoteDetailPage.jsx`: 코스 전용 현황 패널 추가, 최종 확정 후 투표·개인 확정 변경 UI 차단
- `frontend/src/api/courseConfirmationApi.test.js`: STEP 06 읽기 검증을 위한 모의 최종 확정 테이블 추가

STEP 05 이전의 작업 및 추천 엔진은 유지했다. App.js, 확정 일정 상세 화면, backend/server.js와 백엔드 자동 투표 마감 코드는 확인했으며 변경하지 않았다. 서버에는 일정 생성·최종 확정용 인증/트랜잭션 경로가 없다.

## 일정 생성자 기록

검색으로 확인한 confirmed_schedules INSERT 경로는 모두 `createScheduleWithCreator(payload)`에 연결했다.

| 원래 생성 경로 | 용도 |
| --- | --- |
| scheduleApi.createConfirmedScheduleForRoom | 날짜가 있는 일정 직접 생성 |
| scheduleApi.createDraftConfirmedSchedule | 준비 중 일정 생성 |
| scheduleApi.createLocationOnlyConfirmedSchedule | 날짜 없는 장소 일정 생성 |
| voteApi.confirmVote의 schedule 신규 분기 | 일정 투표 결과로 새 일정 생성 |
| ScheduleTab.handleAddConfirmedSchedule | 일정 탭에서 직접 생성 |

각 경로에서 회원/게스트 구분은 실제 실행 당시의 `getCurrentRoomParticipantInfo` 결과를 사용한다. 생성 전에 참여 상태를 확인하며, 생성된 ID로 schedule_creation_records에 저장한다. 기존 일정의 날짜·장소를 수정하는 경로에서는 생성자를 추가하거나 바꾸지 않는다. rooms.createdby 또는 votes.userid로 생성자를 추정하지 않는다.

생성자 기록 INSERT 실패 시 동일 기록을 조회해 응답 유실 여부를 확인하고 한 번 재시도한다. 이후에도 실패하면 일정 ID를 포함한 오류를 반환하고 성공 알림·후속 처리를 중단한다. 기존·신규 일정을 보상 목적으로 삭제하지 않는다.

**중요한 미보장 사항:** 일정 INSERT와 생성자 기록 INSERT는 서로 다른 요청이므로, 기록 저장이 계속 실패하거나 앱이 종료되면 신규 일정이 생성자 기록 없이 남을 수 있다. 이를 완전히 방지한 구현은 아니다. 그 일정은 최종 확정 불가이며 오류에 표시된 ID로 별도 확인해야 한다. 일정 INSERT 자체의 응답이 유실되면 생성된 ID조차 클라이언트에서 알 수 없을 수 있다. 이 보장은 서버 트랜잭션 및 요청 멱등키가 필요하다.

과거 일정에 기록이 없으면 현황에 `일정 생성자 기록이 없어 최종 확정할 수 없습니다.`를 표시한다. 과거 데이터는 수정하지 않는다. 복구가 필요하면 감사 로그 등 검증 가능한 근거로 생성자를 확인한 뒤 별도 승인된 이관 절차를 진행해야 한다.

## 참석 대상 및 전원 동의 판정

- 현재 room_members.userid와 room_guests.id를 조회해 `member:UUID`, `guest:UUID` 집합을 만든다. 중복 키는 하나로 정리한다. 투표하지 않은 현재 참여자도 포함한다.
- 일정의 absentees UUID를 제외한다. 참석 대상이 0명이면 최종 확정할 수 없다.
- 회원/게스트 UUID가 같으면 기존 voteresponses.userid TEXT와 absentees uuid[]에서 유형을 판단할 수 없으므로, 임의로 제외하거나 확정 성공으로 처리하지 않고 오류로 차단한다.
- 요청에 scheduleId, roomId, voteId, courseId를 모두 명시한다. 같은 일정의 다른 투표를 합산하거나 임의로 최신 투표를 고르지 않는다.
- 일정·투표·코스가 같은 모임·일정에 속하는지 검증한다. 해당 투표의 실제 course 선택지와 vote_course_links 연결을 확인한다.
- 참석자별로 지정 투표의 응답이 정확히 하나인지, 선택지 연결이 정확히 하나인지, 그 코스가 대상 코스인지 확인한다.
- 참석자별 활성 개인 확정이 정확히 하나이고, participant_key뿐 아니라 participant_type 및 회원/게스트 ID 컬럼도 일치해야 한다. 그 확정 코스와 현재 투표 코스가 모두 대상 코스여야 완료 인원으로 계산한다.
- 탈퇴자나 불참자의 확정은 현재 참석자의 누락된 확정을 대신하지 않는다. 다른 코스 선택, 잘못된 유형, 중복 응답, 누락 응답, 비활성 확정은 전원 동의로 인정하지 않는다.
- 필수 조회 실패나 불명확한 식별 관계는 오류로 반환하며 UI는 최종 확정 버튼을 활성화하지 않는다. 기존 RLS가 일부 행을 오류 없이 숨기는 경우까지는 클라이언트가 감지할 수 없으므로 실제 조회 권한 검증이 필요하다.

## 권한·저장 및 이후 변경

`getCourseConfirmationProgress`는 현재 참여자의 유형과 UUID를 schedule_creation_records의 유형·ID와 비교한다. 모임 생성자라는 이유로 권한을 주지 않는다.

`finalizeCourse`는 UI 상태를 믿지 않고 저장 직전에 전체 진행 상태를 다시 조회·검증한다. 검증 성공 시 schedule_finalizations에 schedule_id, course_id, finalized_by_type, finalized_by_member_id, finalized_by_guest_id, finalized_at을 INSERT한다. 기존 UNIQUE(schedule_id)에 의존해 동시 중복 요청을 처리하고 저장 결과를 다시 읽는다. 같은 코스는 기존 결과를 반환하고, 다른 코스는 덮어쓰지 않는다.

최종 확정 후 해당 일정의 모든 course 투표에 기존 `isclosed=true` 상태를 적용한다. 종료 갱신 실패는 최종 기록을 삭제하지 않고 `voteClosurePending` 및 `warning`으로 알린다. 같은 코스의 최종 확정 API 재호출 시 종료 처리를 재시도할 수 있다.

최종 기록이 있으면 코스 투표 재제출, 개인 확정 저장·해제, 투표 삭제·편집·선택지 변경, 같은 일정의 새 코스 투표 생성을 앱 API에서 차단한다. 일반·일정·장소 투표에는 최종 확정 제한을 적용하지 않는다.

## UI

기존 코스 투표 상세 화면에만 코스별 참석 대상 수, 완료·미확정 수, 진행률과 참석자별 상태를 표시한다. 현황 대상 코스를 선택할 수 있으며 최종 확정 요청에는 현재 화면의 명시적인 투표 ID를 사용한다.

생성자에게만 최종 확정 버튼을 표시하고 전원 동의 전에는 비활성화한다. 일반 참석자는 현황과 개인 확정을 이용한다. 최종 확정 후에는 확정된 코스명과 순서별 방문 장소를 표시하고 변경 UI를 차단한다. 상태는 DB 조회 결과를 사용하며 관련 실시간 이벤트, 포커스 복귀, 15초 주기 갱신, 수동 새로고침으로 갱신한다. Realtime 미활성 환경에서도 주기 조회는 동작하지만 다른 사용자의 변경이 즉시 반영된다는 보장은 없다.

## 검증 결과

PowerShell에서 frontend 디렉터리 기준 실행:

```powershell
$env:CI='true'
npm test -- --watchAll=false --runInBand --runTestsByPath src/api/courseFinalizationApi.test.js src/api/courseConfirmationApi.test.js src/api/courseParticipant.test.js src/utils/courseVoteUtils.test.js src/components/CourseFinalizationPanel.test.jsx
npm run build
```

- 지정한 테스트 5개 스위트, **70개 통과 / 실패 0개**. 기존 App.test.js를 포함한 전체 테스트 실행 결과는 아니다.
- 회원·게스트 생성 기록, 실제 API 생성 경로 연결, 생성자 권한과 기록 없음, 전원 동의, 누락·다른 코스·현재 응답 불일치, 불참자·집합 비교, UUID 충돌, 다른 모임·일정 연결, 명시적 투표 선택, 중복·동시 최종 기록, 확정 후 변경 차단, 저장/종료 실패, 일반·일정·장소 투표 회귀를 검증했다.
- UI 테스트에서 미확정 인원 표시, 생성자 버튼 비활성화, 일반 참석자의 버튼 미노출, 조회 오류 시 차단, 최종 코스·장소 표시, 저장 실패 및 빠른 중복 클릭을 검증했다.
- 마지막 조회와 INSERT 사이에 상태 변경을 주입하면 모순된 최종 기록이 저장될 수 있는 **남은 동시성 한계**도 테스트로 확인했다. 이는 원자성 보장 테스트 통과를 의미하지 않는다.
- 프론트엔드 프로덕션 빌드 성공. 기존 unused 변수·Hook dependency 등 ESLint 경고는 남아 있다.
- 실제 Supabase DB 읽기·쓰기 검증은 수행하지 않았다. 모의 쿼리 어댑터는 Postgres 제약·RLS·GRANT·트리거·Realtime 동작을 재현하거나 검증하지 않는다.

## 운영 전 필요한 보장

DB 스키마, RLS, GRANT, Service Role 설정은 변경하지 않았다. SQL/RPC를 생성하거나 DB에 실행하지 않았다.

1. 일정+생성자 기록의 원자적 생성이 필요하다. 현재 재시도는 생성자 없는 일정 발생 가능성을 제거하지 못한다.
2. 최종 검증+최종 기록 INSERT+관련 코스 투표 종료는 하나의 트랜잭션이어야 한다. 재투표·개인 확정도 같은 일정/참여자 잠금 규칙에 참여해야 최종 조회 이후의 경합을 방지할 수 있다. UNIQUE 인덱스는 최종 기록 중복만 막고 전원 동의 조건의 동시성은 보장하지 않는다.
3. 현재 앱 API의 변경 차단은 직접 Supabase 요청이나 다른 클라이언트를 막는 서버 보안 장치가 아니다. 서버에서 인증·일정 생성자·모임 참여·전체 행 조회 권한을 검증하고 기존 RLS의 실제 보장을 점검해야 한다.
4. 게스트는 localStorage ID와 room_guests 존재를 확인할 뿐 신원 인증이 보장되지 않는다. 서버가 검증하는 게스트 세션/자격 증명 방식이 필요하다.
5. 최종 확정 이후의 멤버 입퇴장·불참 변경·일정/코스 원본 수정은 이 단계에서 동결하지 않았다. 최종 코스 ID는 보존하지만 원본 코스·장소의 스냅샷을 저장하지 않으므로, 직접 DB 변경이나 추후 원본 수정에 대한 불변성도 보장하지 않는다. 해당 정책은 서버 트랜잭션 설계와 함께 정해야 한다.

따라서 현재 구조에서 동작하는 기능과 모의 테스트는 완료했지만, DB 차원의 권한·원자성·게스트 인증이 완료되었다고 주장하지 않는다.

## STEP 07 재사용 데이터

`getFinalizedCourse(scheduleId)`는 최종 기록이 없으면 null, 있으면 현재 모임 참여를 확인하고 다음 데이터를 반환한다.

```js
{
  id, schedule_id, course_id,
  finalized_by_type, finalized_by_member_id, finalized_by_guest_id, finalized_at,
  course: {
    /* courses 실제 컬럼 */
    id, room_id, schedule_id, course_name,
    stops: [/* course_stops 실제 컬럼, stop_order 오름차순 */]
  }
}
```

`finalizeCourse` 결과에는 추가로 `voteClosurePending`과 `warning`이 있다.

`getCourseConfirmationProgress({ scheduleId, roomId, voteId, courseId })`는 `eligibleCount`, `confirmedCount`, `participants`, `unconfirmed`, `differentCourse`, `allConfirmed`, `isCreator`, `canFinalize`, `reason`, `creator`, `finalization`, `course`를 반환한다. `participants`의 각 항목에는 유형별 participantKey, participantId, nickname, votedCourseId, confirmed, differentCourse, status가 포함된다.

STEP 07의 지도·로드맵·채팅 공유, 방문 완료 기능은 구현하지 않았다.
