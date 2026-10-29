# STEP 07 최종 코스 로드맵·일정 미리보기·채팅 공유

## 파일 목록

신규:

- `frontend/src/api/courseRoadmapApi.js`: 최종 로드맵 조회·공유
- `frontend/src/api/chatMessageApi.js`: 일반 채팅·코스 공유의 공통 메시지 INSERT
- `frontend/src/utils/courseRoadmapUtils.js`: 정렬·번호·좌표·링크·공유 형식 검증
- `frontend/src/pages/course/FinalizedCourseRoadmapPage.jsx`
- `frontend/src/pages/course/FinalizedCourseRoadmapPage.css`
- `frontend/src/components/FinalizedCoursePreview.jsx`
- `frontend/src/components/CourseShareMessage.jsx`
- `frontend/src/api/courseRoadmapApi.test.js`
- `frontend/src/pages/course/FinalizedCourseRoadmapPage.test.jsx`
- `frontend/src/components/map/KakaoCourseMap.test.jsx`
- 이 문서

수정:

- `frontend/src/App.js`: URL에 모임·일정 ID가 있는 로드맵 라우트 추가
- `frontend/src/components/map/KakaoMapView.jsx`: 선택 가능한 번호 마커, 순서 선 색상 추가. 기본 모드 유지
- `frontend/src/pages/home/ConfirmedScheduleDetailPage.jsx`: 기존 일정 정보 아래 최종 코스 미리보기 추가
- `frontend/src/pages/Chat/ChatTab.jsx`: 버전 있는 코스 공유 카드 분기, 일반 메시지 공통 INSERT 호출
- `frontend/src/components/CourseFinalizationPanel.jsx`: 최종 확정 후 전체 코스 링크
- `frontend/src/components/CourseFinalizationPanel.test.jsx`: 추가된 링크의 모의 라우터 처리

기존 STEP 01~06 작업은 유지했다. 실제 ChatTab 위치는 `pages/room`이 아니라 `pages/Chat`이다. 추천 API/엔진, routeTimeApi, backend/server.js, 기존 코스 저장·투표·개인 확정·최종 확정 API는 이번 단계에서 변경하지 않았다.

## 최종 데이터 연결 및 접근 검증

새 라우트는 `/rooms/:roomid/schedules/:scheduleid/final-course`다. React Router의 URL 파라미터로 DB를 조회하므로 이동 state나 추천 결과 localStorage가 없어도 복구한다. 호스팅 서버는 기존 SPA와 동일하게 직접 경로 요청을 index.html로 연결해야 한다.

`getFinalizedRoadmap(roomId, scheduleId, expectedCourseId?)`는 다음 순서로 조회한다.

1. 모임 참여 상태 확인
2. confirmed_schedules.id와 roomid 동시 검증
3. STEP 06 `getFinalizedCourse(scheduleId)` 호출
4. 최종 코스의 room_id·schedule_id, 공유 카드의 expectedCourseId 일치 확인
5. 실제 rooms.roomname과 저장된 코스·장소 반환

최종 기록이 없으면 null이며 완료 UI와 공유 버튼을 표시하지 않는다. 추천 엔진을 재실행하거나 courseId만으로 임의 코스를 보여주지 않는다. 장소를 stop_order로 정렬한 뒤 타임라인과 지도에서 함께 사용할 roadmapNumber/roadmapId를 부여한다.

요약에는 저장된 예상 소요·이동 시간, 1인당 비용을 사용한다. null/빈 값/잘못된 수치는 `정보 없음`이다. 실제 저장된 0은 0으로 표시한다. 이전 단계에서 누락값을 이미 0으로 저장한 경우에는 실제 0과 구분할 수 없다. 현재 courses 저장 컬럼에는 별도 이동 수단 필드가 없으므로 추정한 수단을 표시하지 않는다. 저장된 recommendation_condition이 있으면 그대로 추천 조건으로 표시한다.

## 지도·장소 상세

기존 KakaoMapView에 선택 기능과 numberedPlaces 옵션을 추가했다. SDK 로딩·지도 생성·범위 자동 조정·InfoWindow·Polyline 구현은 재사용한다.

- 저장된 유효 좌표만 지도 마커를 만든다. 위도/경도 누락·빈 문자열·범위 밖 수치를 제외한다.
- 마커 번호는 좌표 필터링 전에 정한 타임라인 순번이다. 예를 들어 2번 장소에 좌표가 없으면 지도 번호는 1, 3으로 표시한다.
- 마커 클릭은 장소 정보를 열고 타임라인 선택 상태를 바꾼다. 타임라인 선택은 같은 ID의 마커를 강조하고 지도에서 위치를 확인한다.
- 보라색 Polyline은 유효 장소 좌표를 순서대로 직선 연결한다. 실제 도로 경로가 아니라 방문 순서를 나타내는 선임을 화면에 명시한다. 누락 좌표를 건너뛴 연결도 도로 경로로 해석하지 않는다.
- 실경로 좌표는 현재 course_stops에 저장되지 않는다. routeTimeApi를 새로 호출해 시간을 재계산하지 않으며 직선거리로 시간·거리를 추정하지 않는다.
- 유효 장소가 없으면 지도 대신 목록 안내를 표시한다. SDK 로딩 실패 시 기존 지도 오류 안내와 타임라인을 유지한다.
- 장소 카드에는 저장된 카테고리·주소·방문 시간·체류 시간·비용·이전 이동 시간을 표시한다. 사진·평점은 저장된 값이 있을 때만 표시하고 사진 로딩 실패 시 숨긴다.
- 외부 링크는 검증된 Kakao 장소 ID 또는 유효 좌표·장소명으로만 생성한다. SDK InfoWindow에도 같은 검증된 링크를 전달해 새 장소 검색으로 다른 장소를 연결하지 않는다.

## 일정 미리보기·최종 화면 이동

일정 상세는 기존 날짜·장소·참여자 정보를 유지하고 FinalizedCoursePreview를 추가했다. 동일 getFinalizedRoadmap 결과로 최종 완료 상태·이름·주요 장소 방문 순서·시간·비용을 표시한다. 최종 기록이 없으면 이 영역은 표시하지 않는다. 조회 실패는 완료 대신 안전한 안내를 표시한다.

`전체 코스 보기`는 URL에 실제 모임·일정 ID를 넣는다. 투표 상세의 STEP 06 최종 확정 패널에도 같은 링크를 추가했다.

## 공유 저장 형식·카드

기존 채팅에는 별도 채팅 API 모듈 없이 ChatTab 내부 Supabase INSERT와 JSON `__type` 카드 분기가 있었다. 그 형식을 유지하며 일반 메시지 전송과 코스 공유에 공통 createRoomMessage 함수를 연결했다. 기존 알림·이미지·수정·삭제·투표/지도 카드 분기는 유지한다.

사용자가 로드맵의 공유 버튼을 클릭할 때만 `shareFinalizedCourse`가 DB 최종 데이터를 다시 조회하고, 현재 회원 또는 게스트 참여 정보를 확인해 기존 room_messages 컬럼으로 INSERT한다. 자동 발송·자동 재시도는 하지 않는다. 기존 userid 저장 규칙처럼 게스트도 실제 guest UUID를 저장한다.

content TEXT 형식:

```json
{"__type":"finalized_course","version":1,"roomId":"2","scheduleId":"3","courseId":"20"}
```

이름·날짜·장소의 클라이언트 스냅샷이나 외부 링크를 메시지에서 신뢰하지 않는다. ChatTab은 해당 형식을 인식하면 CourseShareMessage를 사용한다. 카드가 현재 채팅방 ID를 비교하고 DB의 최종 결과를 재조회하여 코스명·일정 날짜·주요 장소·최종 상태를 렌더링한다. `코스 자세히 보기`는 검증된 모임·일정의 로드맵으로 연결한다.

다른 모임 ID, 불일치 코스 ID, 지원하지 않는 버전·잘못된 형식, 삭제·접근 불가 일정은 대체 안내로 표시한다. 인식된 코스 공유 메타데이터는 원문 JSON으로 노출하지 않는다. 일반 텍스트와 기존 카드 메시지는 기존 흐름을 유지한다.

공유 버튼은 ref 잠금과 disabled 상태로 빠른 중복 클릭을 막고 전송 중·성공·실패를 표시한다. 전송 결과가 불명확하면 채팅을 먼저 확인하라는 안내와 재시도로 중복 전송될 수 있다는 안내를 표시한다. 여러 탭·다른 기기·새로고침·응답 유실에 대한 정확히 한 번 전송 보장은 없다. 이 보장에는 DB 멱등키와 서버 처리가 필요하다.

## 테스트·빌드

frontend 디렉터리에서 실행:

```powershell
$env:CI='true'
npm test -- --watchAll=false --runInBand --runTestsByPath src/api/courseRoadmapApi.test.js src/pages/course/FinalizedCourseRoadmapPage.test.jsx src/components/map/KakaoCourseMap.test.jsx src/api/courseFinalizationApi.test.js src/api/courseConfirmationApi.test.js src/api/courseParticipant.test.js src/utils/courseVoteUtils.test.js src/components/CourseFinalizationPanel.test.jsx
npm run build
```

- **8개 스위트, 104개 통과 / 최종 실패 0개**. STEP 05~06 회귀 테스트를 포함한 지정 테스트이며 기존 App.test.js를 포함한 전체 실행은 아니다.
- 처음 UI 테스트에서는 기존 Jest가 설치된 react-router-dom 패키지의 진입점을 해석하지 못했다. 테스트에만 가상 라우터를 사용해 해결했다. URL 파라미터 사용과 생성 링크는 모의 검증이며 실제 브라우저 라우팅 E2E 검증은 아니다.
- 모의 DB: 최종 결과만 조회, 미확정 처리, 순서·좌표·누락값, 다른 모임·일정·코스 차단, 회원/게스트 공유, 전송 실패, 공유 버전 해석을 검증했다.
- UI: 타임라인·지도 번호 일치, 좌표 없는 장소 유지, 미확정 화면, 일정 미리보기 링크, 카드 렌더링·이동 링크·접근 실패 안내, 일반 텍스트 유지, 전송 중 중복 클릭·성공·실패를 검증했다.
- 실제 KakaoMapView 컴포넌트에 모의 SDK를 연결해 번호 CustomOverlay, Polyline 경로, 범위 조정, 마커 선택 콜백과 강조, SDK 미제공 오류를 검증했다.
- 프론트엔드 프로덕션 빌드 성공. 기존 unused 변수·Hook dependency 등 ESLint 경고가 남아 있다.
- 실제 Supabase나 카카오 API 호출 검증은 하지 않았다. 지도·공유를 실제 방에 전송하지 않았다.
- 모바일용 폭 제한·유동 지도 높이·이미지 크기·360px 이하 단일 열 CSS를 적용했다. 실제 모바일 브라우저 화면·SDK 배치·스크린샷은 검증하지 않았다. 브라우저 자동화 도구도 설치되어 있지 않아 모의 DOM 검사와 빌드 범위로 보고한다.

## 호환성 및 남은 제약

DB 테이블·컬럼, RLS/GRANT, 회원·게스트 인증 구조, 최종 확정 권한, 추천 엔진은 변경하지 않았다. Service Role Key를 추가하거나 노출하지 않았다. 로드맵은 읽기 전용이며 방문 장소 수정·재추천·코스 교체·최종 기록 덮어쓰기를 제공하지 않는다.

기존 클라이언트 참여 검증은 서버 보안 보장이 아니며 게스트 ID 신원 인증도 여전히 제한적이다. 최종 확정의 원자성 문제는 STEP 06과 동일하게 남아 있다. 조회·공유·메시지 저장도 트랜잭션이 아니므로 여러 요청 사이에 데이터가 변경될 수 있다.

최종 결과는 스냅샷이 아니라 현재 courses/course_stops를 참조한다. 원본이 변경되면 로드맵·미리보기·공유 카드도 재조회 시 바뀔 수 있다. 같은 화면을 연 상태에서는 초기에 읽은 데이터를 표시하며, 공유 시에는 DB를 다시 확인한다. 실제 저장된 데이터의 품질·권한·SDK 키 및 호스팅 SPA fallback은 실환경 확인이 필요하다.
