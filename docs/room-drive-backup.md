# 방 캘린더: 내 기록 Google Drive 백업

방 캘린더의 토글은 **현재 로그인한 회원의 해당 방 기록만** 백업합니다. 기록 본문, 상태(임시 저장 포함), 공개 범위, 관련 만남 정보와 사진 원본을 포함합니다. 다른 회원의 기록은 포함하지 않습니다. 백업 JSON 목록과 사진 파일은 Google Drive의 **내 드라이브 최상위**에 저장되어 파일 목록에서 볼 수 있습니다. OFF는 앞으로의 동기화만 멈추며 이미 저장된 백업은 유지합니다. 현재 UI에는 복원 기능이 없습니다.

## 배포 설정

1. 이 저장소가 사용하는 Supabase 프로젝트에 `supabase/migrations/20261102120000_room_google_drive_backup.sql`과 `supabase/migrations/20261103120000_google_drive_visible_backup_scope.sql`을 순서대로 적용합니다. 다른 프로젝트에 적용하지 마세요.
2. Google Cloud Console에서 **Google Drive API**를 사용 설정하고 OAuth 동의 화면에 `https://www.googleapis.com/auth/drive.file` 범위를 추가합니다. 웹 애플리케이션 OAuth 클라이언트의 **승인된 JavaScript 원본**에 정확히 다음 두 주소를 등록합니다.
   - `http://localhost:8080`
   - `https://meetup-syk15151.apps.dauai.org`
3. 팝업 인증 코드 방식을 사용하므로 별도의 리디렉션 콜백 경로를 등록하지 않습니다. 인증 코드 교환에는 팝업을 연 페이지의 origin을 사용합니다. 외부 HTTP 주소는 Google OAuth 원본으로 사용할 수 없습니다.
4. 백엔드의 환경 변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_TOKEN_KEY`, `GOOGLE_OAUTH_ALLOWED_ORIGINS`를 설정합니다. `GOOGLE_CLIENT_ID`는 프런트엔드의 `REACT_APP_GOOGLE_CLIENT_ID`와 같아야 합니다. `GOOGLE_DRIVE_TOKEN_KEY`는 32바이트 난수의 64자리 hex 값이며, 연결된 토큰이 남아 있는 동안 바꾸면 기존 연결을 복호화할 수 없습니다. 예: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
5. `http://localhost:8080`에서는 프런트엔드가 `http://localhost:5000/api`로 요청합니다. 백엔드도 함께 실행해야 합니다. HTTPS 배포에서는 빌드 시 `REACT_APP_API_BASE_URL`을 같은 HTTPS origin의 `/api` 또는 실제 HTTPS 백엔드 `/api` 주소로 설정하고, `/api/drive-backup` 요청이 이 Express 백엔드에 도달하도록 프록시를 설정합니다. HTTPS 페이지에서 HTTP 백엔드로 직접 요청하면 브라우저가 차단합니다.
6. OAuth 동의 화면이 Testing 상태라면 사용할 Google 계정을 테스트 사용자로 등록합니다. External/Testing의 갱신 토큰은 일반적으로 7일 후 만료될 수 있으므로, 장기적인 한 번 연결 경험은 게시 상태와 Google의 검증 요건을 충족해야 합니다.

## 확인

두 주소에서 각각 로그인 후 방 캘린더 토글을 켭니다. 첫 사용 때만 Google 동의 창이 열려야 합니다. 기존 `appDataFolder` 연결은 새 권한으로 다시 연결해야 합니다. 이미 ON 상태라면 `Google 다시 연결` 버튼을 누릅니다. `마지막 백업` 시각이 표시되면 내 드라이브 최상위에 `syk-room-<방 번호>-member-<회원 ID>-backup.json` 파일과 해당 사진 파일이 있는지 확인합니다. 같은 방의 토글을 끈 뒤 다시 켜서 동의 창 없이 백업되는지도 확인합니다. 다른 방은 기본 OFF여야 합니다. 오류가 표시되면 백엔드 로그와 Google OAuth 원본, 동의 화면 상태, API 프록시, Supabase 마이그레이션 적용 여부를 확인합니다.

로컬 `localhost:8080`에서 토글 자체가 보이지 않으면 VS Code **Ports** 패널의 8080/5000 포트 전달을 확인합니다. 전달된 포트가 같은 번호의 로컬 개발 서버보다 먼저 응답할 수 있습니다. 이 경우 두 포트의 **Stop Forwarding Port**를 선택한 뒤 새로고침합니다.

백엔드는 토글을 켠 직후 백업을 시작하고 실행 중에는 15분 간격으로 다시 동기화합니다. 새 백업 파일은 내 드라이브 최상위에 저장되며 사용자가 방에서 탈퇴하면 백업을 중지합니다. 이전 `appDataFolder` 백업은 자동으로 옮기거나 삭제하지 않습니다. 사진 또는 목록 업로드가 실패하면 오류를 남기고 다음 주기에 재시도합니다. 실제 Drive 업로드는 Google 계정과 배포 환경에서 확인해야 합니다.
