# STEP 08 통합 검증 및 오류 수정

검증일: 2026-10-28 (Asia/Seoul). 실환경 전체 흐름은 완료되지 않았다. 아래에서 모의 검증과 실제 실행을 구분한다.

## 1. 실제 실행 환경

- Node.js v24.15.0. frontend는 React 19 / react-scripts 5, backend는 Express 5다. Node/webpack 사용 중 deprecated 경고가 있다.
- 루트 package.json에는 서비스 실행 스크립트가 없다. frontend에서 `npm start`(8080), `npm run build`, `npm test -- --watchAll=false --runInBand`를 사용한다. backend에서 `npm start`는 server.js(5000)를 실행한다. backend의 npm test는 아직 실제 테스트가 없는 실패용 기본 스크립트다.
- frontend/.env와 backend/.env가 존재하고 아래 필수 키의 값이 비어 있지 않다. 실제 값·키·호스트·비밀번호는 기록하지 않았다.

| 위치 | 환경 변수 | 점검 |
| --- | --- | --- |
| frontend/.env | REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY | 설정됨. 백엔드와 프로젝트 URL 동일. 익명 키의 JWT claim은 anon이고 클라이언트 날짜 기준 만료되지 않음. 서버 수락 여부와는 별개 |
| frontend/.env | REACT_APP_KAKAO_JAVASCRIPT_KEY | 설정됨. index.html이 이제 이 변수를 사용함 |
| frontend/.env | REACT_APP_API_BASE_URL | 절대 URL로 설정됨. 접속 가능성과 모바일에서의 도달 여부는 별도 확인 필요 |
| frontend/.env | REACT_APP_GOOGLE_CLIENT_ID, REACT_APP_HOLIDAY_API_KEY | 설정됨. 코스 외 OAuth/공휴일 기능용 |
| backend/.env | SUPABASE_URL, SUPABASE_KEY, KAKAO_REST_API_KEY, GOOGLE_MAPS_API_KEY | 설정됨. 키의 유효성·권한은 검증되지 않음 |

환경이 빠진 경우 각 디렉터리 .env에 동일 이름을 설정하고 프로세스를 다시 시작한다. Kakao 개발자 콘솔의 JavaScript 키와 Web 플랫폼 도메인, Google 프로젝트의 Places/Routes 활성화·키 제한도 확인해야 한다. 브라우저용 Supabase 키는 anon/publishable 키를 사용하며 Service Role/DB 비밀번호를 프론트엔드에 넣으면 안 된다. DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT는 별도 미사용 db.js 경로의 설정이며 현재 코스 흐름의 필수 환경 변수로 확인되지 않았다.

**일반 backend npm start는 검증에서 실행하지 않았다.** 시작 시 voteJob이 즉시 투표 UPDATE 및 알림 INSERT를 수행하기 때문이다. 승인되지 않은 기존 데이터 변경을 피하려고 실제 Express 코드와 라우터를 로드하되 background job만 비활성화하는 검증 하네스를 사용했다.

실제 로컬 실행 결과:

- 프론트엔드 `BROWSER=none npm start` 기동·컴파일 성공. 브라우저는 열지 않았다.
- Accept: text/html 요청의 `/` 및 `/rooms/1/schedules/2/final-course`: 모두 HTTP 200, SPA root 포함. 환경 변수의 SDK placeholder가 제공 HTML에서 치환됨. 이는 HTML 제공 검사이며 DB 데이터 복원·화면 렌더링 검사는 아니다.
- 처음 일반 HTTP 탐색 요청은 HTML Accept 헤더가 없어 CRA proxy 경로로 전달되어 깊은 URL이 실패했다. 브라우저 탐색과 동일한 text/html 헤더로 재검증했고 성공했다. 이 응답을 앱 라우팅 버그로 수정하지 않았다.
- `node scripts/step08-backend-smoke.cjs`: 실제 Express의 GET / = 200, 필수 인자가 없는 POST /api/route/time, /api/google/place-rating, /api/kakao/route = 모두 400. 외부 API 호출 전에 거절되는 입력 검증만 확인했다.
- backend/server.js와 jobs/voteJob.js의 node --check 통과. 최초 하네스의 Google 경로를 /nearby로 잘못 지정해 404가 나온 것은 테스트 경로 오류였으며 실제 /place-rating으로 고쳐 재실행했다.

## 2. STEP 01~07 연결 검증

| 관계 | 코드·모의 검증 결과 | 실제 스키마 검증 |
| --- | --- | --- |
| confirmed_schedules → schedule_creation_records | 모든 신규 생성 경로가 공통 생성 함수를 호출. 통합 테스트에서 실행자 기록 확인 | 미실행 |
| confirmed_schedules → courses → course_stops | room_id/schedule_id 검증, 저장 후 로드맵 조회까지 연결 성공 | 미실행 |
| votes → voteoptions → vote_course_links → courses | 실제 createVote로 선택지와 두 코스의 링크 생성 확인 | 미실행 |
| voteresponses → course_member_confirmations | 실제 회원·게스트 식별 함수, 투표/확정/재투표 해제 조합 통과 | 미실행 |
| confirmed_schedules → schedule_finalizations | 실제 참석자 집합·생성자 검사 후 저장·중복 처리 통과 | 미실행 |
| schedule_finalizations → 로드맵 | 최종 코스만 조회하고 일정·모임 연결 검증, 다른 참여자 조회 통과 | 미실행 |
| 최종 코스 → room_messages → CourseShareMessage | 실제 공유 함수로 content 참조 생성, 기존 카드 테스트로 재조회·링크·실패 처리 검증 | 미실행 |

새 `courseFlow.integration.test.js`는 모의 DB 하나에서 **실제 API 모듈들을 함께 실행**한다. 회원/게스트 조회, 일정/생성자 기록, 추천 엔진, 코스 저장, 투표 생성, 개인 확정, 재투표 해제, 전원 동의, 최종 확정, 로드맵, 메시지 공유, 다른 회원의 동일 결과 조회를 연결한다. Supabase 어댑터·장소 검색·알림은 모의이며 실제 사용자 조작 E2E는 아니다. 테스트의 사용자 식별 문자열은 fixture여서 UUID 자료형의 실제 DB 수락 여부도 검증하지 않는다.

실제 스키마 파일/마이그레이션이 저장소에 없다. 기존 요청에서 주어진 테이블 정의 및 코드 사이 정합성은 검토했으나 실제 생성된 DB와 같다고 확정할 수 없다. 특히 `getVoteDetail`의 명시적 `voteoptions!vote_options_voteid_fkey` 관계 이름, scheduleid FK, TEXT userid, UUID/uuid[] 컬럼, bigint, 부분 UNIQUE 인덱스를 실제 DB에서 확인해야 한다. 모의 어댑터는 PostgREST 관계 조회·FK·타입·RLS를 구현하지 않는다.

## 3. 실제 DB 테스트

`scripts/step08-readonly.cjs`로 Supabase REST OpenAPI 메타데이터만 GET 요청했다. 네트워크 권한을 허용받아 재실행했으나 **HTTP 401**이었다. API 키 헤더 단독 요청도 401이었다. 따라서 현재 URL/키 조합 또는 프로젝트·게이트웨이 상태 점검이 필요하다. JWT 만료로 단정하지 않는다. 실제 컬럼 메타데이터는 받지 못했고 스키마 결과 파일도 생성되지 않았다.

실제 행 SELECT 및 INSERT/UPDATE/DELETE는 수행하지 않았다. 기존 사용자·방·일정 데이터를 수정하거나 삭제하지 않았으며, 실DB 쓰기 승인을 받았다고 간주하지 않았다. 현재 환경이 개발 전용 프로젝트라는 근거도 확보되지 않았다.

`scripts/step08-schema-audit.sql`에는 컬럼·자료형·FK/UNIQUE·부분 인덱스를 확인하는 SELECT만 준비했다. 자동 실행하지 않았다. 소유자가 Supabase SQL Editor에서 결과를 확인하면 실제 스키마 검증을 진행할 수 있다. 401 해결과 개발 프로젝트 확인 후에야 테스트 대상 승인 요청을 구체화할 수 있다.

## 4. 실제 외부 API

Kakao SDK·Places·Mobility 및 Google Places/Routes 실호출 성공 테스트는 미실행이다. 로컬 Express 입력 검증과 모의 SDK·검색·외부 실패 검증만 수행했다. 장소 검색이 실제 성공한 것으로 보고하지 않는다.

현재 추천 엔진은 Kakao 장소 검색 API 모듈을 사용한다. Google 평점/Routes 엔드포인트가 존재하지만 추천 통합 테스트에서 실제 Google 검색을 호출한 것은 아니다.

## 5. 브라우저·모바일

Playwright/Puppeteer가 설치되어 있지 않다. 실제 브라우저·360/390/768px 화면·스크린샷·Kakao Web 플랫폼 도메인 검증은 모두 미실행이다.

실제 React Router의 App 진입 및 게스트 페이지 이동, 깊은 로드맵 URL 파라미터 전달은 JSDOM으로 검증했다. 이전의 코스 화면 테스트에는 기존 가상 라우터도 남아 있다. HTTP HTML fallback 검사와 실제 브라우저에서 새로고침 후 DB가 복구되는 검증은 구분해야 한다.

## 6. 발견된 오류 및 수정

1. **App 테스트 모듈 해석 실패:** CRA/Jest가 react-router-dom 7의 package 진입점을 찾지 못했다. frontend/package.json의 테스트 전용 moduleNameMapper에 실제 CJS 진입점을 지정했다. setupTests에 TextEncoder/TextDecoder·matchMedia를 준비했다. 생산 코드/인증은 변경하지 않았다.
2. **구식 App 테스트:** 존재하지 않는 Learn React 문구를 검사하고 있었다. 현재 진입 화면에서 게스트 로그인 이동 및 실제 App의 깊은 로드맵 라우트를 검사하도록 교체하고 Supabase auth/로드맵 조회 경계를 모의 처리했다.
3. **Kakao SDK 설정 불일치:** .env에 JavaScript 키 변수가 있지만 index.html은 하드코딩된 appkey를 사용했다. 기존 환경 변수 placeholder로 바꾸었고 제공 HTML의 치환을 확인했다. 실제 키 값은 출력·추가하지 않았다.
4. **추천 → 투표 저장 중 장소 메타데이터 유실:** VoteCreatePage의 변환에서 실제 장소 ID·출처·사진·카테고리를 버리고 있었다. 기존 buildCourseVoteDbRows를 사용해 저장하도록 연결하고 place_id/place_source를 보존했다. 사진·카테고리·평점도 유지한다.
5. **누락 수치가 0으로 변환되는 오류:** 공통 변환기의 Number(null) 때문에 좌표·평점의 null이 0이 될 수 있었다. null/undefined/빈 값은 지정 fallback을 유지하도록 수정했다. 테스트에서 없는 평점을 null로 확인한다. 기존 DB에 이미 저장된 값은 수정하지 않았다.

신규 파일: 이 보고서, courseFlow.integration.test.js, scripts/step08-readonly.cjs, scripts/step08-backend-smoke.cjs, scripts/step08-schema-audit.sql.

수정 파일: frontend/package.json, src/setupTests.js, src/App.test.js, public/index.html, src/pages/vote/VoteCreatePage.jsx, src/utils/courseVoteUtils.js, src/utils/courseVoteUtils.test.js. 앞선 단계의 기존 변경은 보존했다.

## 7. 미해결 문제

- Supabase 실제 GET 401. 코드에서 검토한 컬럼·관계가 실제 스키마와 일치하는지 미확인이다.
- 추천 엔진이 index별로 같은 후보 집합에서 같은 순서로 선택하므로, 생성된 여러 코스가 이름만 다르고 방문 장소 구성이 동일해질 수 있다. 현재 모의 검색의 고정 후보에서도 이 현상이 있다. 핵심 알고리즘 변경 금지 범위이므로 이번 단계에서는 수정하지 않았다. 실제 검색 결과로 후보 다양성을 별도 검증해야 한다.
- 외부 API 오류·요금/할당량·지도 SDK 권한·모바일 레이아웃은 실환경 미검증이다.
- 기존 ESLint unused 변수·Hook dependency 경고와 Node deprecation 경고는 남아 있다. 범위 밖 리팩터링은 하지 않았다.
- 실제 전원 동의·권한의 DB 강제, 게스트 신원 인증, 여러 요청 사이 원자성, 원본 변경에 대한 불변성, 공유 정확히 한 번 보장은 이전 단계와 동일하게 미해결이다.

## 8. 기존 서비스 영향 및 최종 검증

생산 DB/스키마/RLS/GRANT/계정 데이터는 변경하지 않았다. 추천 핵심 알고리즘·기존 인증 구조·최종 권한 정책도 유지했다. 런타임 변경은 SDK 키 설정 사용과 장소 데이터 보존·누락값 처리에 한정했다. 테스트 설정은 테스트에만 적용된다.

실행 명령:

```powershell
# frontend
$env:CI='true'
npm test -- --watchAll=false --runInBand
npm run build
# repository root, DB-writing job disabled, only local HTTP input validation
node scripts/step08-backend-smoke.cjs
```

- 초기 전체 실행: 8개 스위트 성공, App 스위트는 모듈 해석으로 실패. 기존 104개 테스트는 통과했다.
- 최종 전체 실행: **10개 스위트 / 108개 테스트 통과, 실패 0개**, App.test.js 포함.
- 최종 프론트엔드 프로덕션 빌드 성공, 기존 ESLint 경고 유지. 수정 과정에서 확인된 중복 객체 키 경고는 제거했다.
- 백엔드 smoke 최종 4개 HTTP 응답 기대값 일치. 독립 자동 테스트 스위트가 아니라 DB-writing job을 제외한 실행 검사다.
- 테스트 중 실제 방 생성·알림·코스·채팅 쓰기 없음. 기존 서비스 영향이 전혀 없음을 실환경 회귀로 입증한 것은 아니다.

## 9. 사용자 실환경 테스트 절차

### 승인 전 준비

1. 개발 전용 Supabase 프로젝트인지 확인하고 401을 해결한다. 서비스 키/비밀번호를 채팅에 붙여 넣지 않는다.
2. 읽기 전용 schema-audit.sql 결과로 FK 이름·컬럼 타입·인덱스를 확인한다. 이후 실제 수정 대상 프로젝트·모임 ID·범위의 명시적 승인을 받아야 한다.
3. 테스트 계정 A/B 및 별도 게스트 브라우저를 사용한다. 기존 사용자의 실사용 방 대신 `STEP08-20261028-<고유번호>` 신규 방 1개, 신규 일정 1개를 테스트 대상으로 정한다.
4. 승인 범위: 신규 방/참여 기록, 일정/생성자 기록 1개, 코스 2개와 그 장소 행, 투표 1개/선택지 2개/연결 2개, 참여자 3명의 응답·개인 확정(재투표로 비활성 이력 포함), 최종 기록 1개, 공유 메시지 1개. 기존 기능의 알림·채팅 읽음 기록 등 부수 쓰기도 포함해 고지해야 한다. 계정 생성이 필요하면 별도 범위에 포함한다.
5. 기존 행 변경·삭제나 테스트 자료 자동 정리는 승인 범위에 포함하지 않는다. 정리가 필요하면 생성한 ID 목록으로 별도 승인한다. 운영 프로젝트에서 일반 backend npm start를 실행하면 테스트 대상 밖의 투표/알림도 변경될 수 있으므로 실행하지 않는다. 격리 개발 프로젝트에서만 정상 기동한다.

### 전체 흐름 상태표 및 실행 방법

실제 환경 열의 미실행은 DB 승인을 받지 않았고 401도 해결되지 않았기 때문이다. 성공은 모의 열에만 표시한다.

| 단계 | 모의/로컬 검사 | 실제 환경에서 해야 할 확인 | 실제 환경 |
| --- | --- | --- | --- |
| 1 방 생성·참여 | 참여 데이터 fixture 사용, 생성 UI 미실행 | A가 신규 방 생성, B·게스트 참여, 신규 ID 기록 | 미실행 |
| 2 신규 확정 일정 | API 성공 | A가 새 일정 생성 | 미실행 |
| 3 생성자 기록 | API 성공 | schedule_id와 A의 유형/UUID, 중복 없음 확인 | 미실행 |
| 4 추천 조건 | 엔진 입력 성공, 입력 화면 미실행 | 날짜/시간·기준 장소·예산·활동 입력 | 미실행 |
| 5 장소 검색 | Kakao 검색 경계 모의 성공, Google 실호출 없음 | Network·키·도메인·검색 응답 및 외부 실패 확인 | 미실행 |
| 6 추천 결과 | 실제 엔진+모의 검색 성공 | 장소가 실재하고 후보 구성이 다양한지 확인 | 미실행 |
| 7 코스 2개 선택 | 결과 배열 2개 선택, UI 미실행 | 결과 화면에서 2개 선택 | 미실행 |
| 8 투표 생성 | 실제 API 성공 | 회원 A로 기존 투표 생성 화면 제출 | 미실행 |
| 9 링크 확인 | API 성공 | 두 vote_option_id가 올바른 course_id를 가리키는지 확인 | 미실행 |
| 10 각 참여자 투표 | A/B/게스트 API 성공 | 서로 분리된 세 세션에서 같은 코스 선택 | 미실행 |
| 11 개인 확정 | API 성공, 재투표 해제도 성공 | 투표 후 별도 확정 버튼, 새로고침 상태 확인 | 미실행 |
| 12 현황 계산 | 집합 검증 성공 | 3명 완료, 탈퇴/불참·누락자 집계 확인 | 미실행 |
| 13 생성자 최종 확정 | A 성공, 비생성자 거부 | A만 버튼 표시, 최종 기록 1개, 코스 투표 종료 | 미실행 |
| 14 로드맵 | 조회 성공, 실제 App URL 매칭·HTTP HTML 200 | 일정 미리보기·전체 코스 이동 및 직접 URL 새로고침 | 미실행 |
| 15 지도 번호·선 | 모의 SDK 테스트 성공 | 실제 마커·번호·전체 범위·선·클릭 동기화 | 미실행 |
| 16 채팅 공유 | API·버튼 중복 방지 테스트 성공 | 직접 한 번 클릭해 메시지 1개, 실패 시 안내 확인 | 미실행 |
| 17 다른 참여자 조회 | B의 동일 결과 조회·카드 링크 모의 성공 | B의 카드 클릭으로 같은 코스·순서 확인 | 미실행 |

예외 확인 절차:

- 생성자 기록이 없는 **별도 테스트 fixture/일정**에서 안내·최종 확정 차단 확인. 기존 일정의 기록을 삭제해 테스트하지 않는다.
- 없는 일정·코스 ID 및 다른 모임 URL에서 오류 안내와 데이터 미노출 확인.
- 투표 전 개인 확정 거부, A 확정 후 다른 코스 재투표 시 이전 확정 비활성·새 코스 미확정 확인.
- B나 게스트가 최종 확정할 수 없는지, 한 명 미확정이면 A도 최종 확정할 수 없는지 확인.
- 최종 확정 후 재투표·개인 확정·코스 투표 편집/삭제 차단 확인.
- 좌표 없는 테스트 장소는 생성 시부터 누락시켜 목록 유지·마커 제외를 확인한다. 기존 장소 좌표를 지우지 않는다.
- 개발자 도구의 요청 차단/Offline으로 장소 API·채팅 전송 실패 UI를 확인한다. 실제 전송 결과가 불명확하면 채팅을 확인한 뒤 재시도한다.
- 개발자 도구 반응형 모드에서 **360px, 390px, 768px** 각각 추천 조건/결과/투표 생성/투표 상세/확정 패널/로드맵/일정 미리보기/채팅 카드를 점검한다. 가로 스크롤·버튼 잘림·긴 이름/주소·키보드/포커스·지도 높이·선택 강조를 확인하고 스크린샷과 console/network 오류를 기록한다.
- 각 화면의 새로고침·뒤로가기·직접 URL, 다른 참여자 세션을 따로 확인한다. 추천 결과는 최종 로드맵과 달리 일부 단계가 state/localStorage에 의존하므로 결과 복구도 실제 브라우저에서 확인해야 한다.

## 10. 운영 전 필수 개선 과제

DB 트랜잭션/권한 구조는 무단 변경하지 않았다. 다음은 별도 설계·승인 대상이다.

1. 일정+생성자 기록을 원자적으로 생성하고 요청 멱등키로 응답 유실에 대응한다.
2. 투표·개인 확정·최종 검증/저장·투표 종료가 공통 잠금 규칙을 따르는 서버 트랜잭션이 필요하다.
3. 서버의 실제 사용자/게스트 세션 검증과 일정 생성자 권한 강제, RLS/GRANT의 전체 행 조회·쓰기 보장을 점검한다. 클라이언트 검증만으로 보안을 보장하지 않는다.
4. 회원/게스트의 raw UUID 충돌 및 absentees 유형 불명확 정책을 해결한다. 현재는 모호하면 최종 확정 차단이다.
5. 원본 코스·장소 변경 시 최종 결과의 스냅샷/동결 정책, 공유 메시지 정확히 한 번 전송 정책을 정한다.
6. 운영 환경과 테스트 환경을 분리하고, 백엔드 시작 즉시 수행되는 기존 투표 마감·알림 작업의 실행 범위를 검토한다.

결론: 코드·모의 통합·전체 테스트·빌드·로컬 HTTP 실행은 확인했다. 실제 사용자 전체 흐름, 실제 스키마 일치, 실DB·외부 API·모바일 UI 성공은 아직 검증되지 않았다.
