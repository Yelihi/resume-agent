# 맥미니 배포 준비와 복구

이 디렉터리는 설치 전 템플릿이다. **도메인을 구매하지 않는 조건**으로 `workers.dev` + Access + Workers VPC/Tunnel을 사용한다. CI/CD는 [자동화 절차](CI_CD.md)를 따른다. 도메인·계정·서버 사양을 추정하지 않았고 Tunnel 생성, R2 구매, launchd 등록, 외부 백업은 실행하지 않았다. `__...__`를 실제 값으로 바꾸고 검증한 뒤 사용한다. 유료 AI 검증은 별도 명시적 요청이 필요하다.

## 준비할 값

- M4 / 16GB는 확인됨. macOS, 외장 SSD의 실제 마운트 경로·UUID·APFS·암호화·소유권·여유 공간, OCR 처리 시간은 추가 확인.
- Cloudflare 계정의 무료 `resume-agent.<계정-subdomain>.workers.dev` 주소, Access 팀 호스트·프런트 앱 AUD, MFA 인증 공급자·초대 이메일 목록.
- Workers VPC Service ID, 맥미니의 정식 Tunnel 토큰 파일. 공개 원본 도메인과 원본 Access 서비스 토큰은 필요하지 않다.
- 과금 없는 별도 로컬 백업 디스크, restic 암호 파일, API 키 암호화 파일의 별도 복구 보관소.
- Git 밖의 절대 경로: 데이터, 개인 환경 파일, 복호화 키, Tunnel 설정·자격증명, 백업 준비 디렉터리.

환경 파일과 키·자격증명은 소유자만 읽도록 `chmod 600`, 개인 디렉터리는 `chmod 700`으로 둔다. 이 문서의 명령은 운영자가 값을 준비한 뒤 수동 실행한다. 셸 환경 파일에 공백이 있는 경로는 작은따옴표로 감싼다. `run-app.sh`와 `run-backup.sh`는 해당 파일을 셸로 읽으므로 신뢰하는 운영자만 수정할 수 있어야 한다.

서버 환경 파일은 `backend/.env.example`를 복사해 다음 값을 설정한다.

```sh
RESUME_DEPLOYMENT_MODE=server
RESUME_STORAGE_ROOT='/Volumes/YOUR_SSD'
RESUME_STORAGE_UUID='YOUR_ACTUAL_VOLUME_UUID'
RESUME_DATA_DIR='/Volumes/YOUR_SSD/resume-agent/data'
RESUME_MODEL_CACHE='/Volumes/YOUR_SSD/resume-agent/model-cache'
RESUME_KEY_FILE='/absolute/private/fernet.key'
RESUME_PUBLIC_ORIGIN='https://YOUR_HOSTNAME'
CF_ACCESS_TEAM_DOMAIN='YOUR_TEAM.cloudflareaccess.com'
CF_ACCESS_AUD='YOUR_FRONTEND_APPLICATION_AUD'
RESUME_ACCESS_ASSERTION_HEADER='x-resume-user-jwt'
OPENAI_MODEL='gpt-5.4-mini'
```

위 경로와 호스트는 예시이며 실제 설정값이 아니다. 데이터·모델 캐시는 먼저 외장 APFS SSD에 각각 `0700`으로 준비하고 볼륨 루트 `.resume-agent-volume`에 실제 Volume UUID를 기록한다. `check-storage.py`가 마운트와 권한을 확인하며 디렉터리를 대신 만들지 않는다. [SSD·Docker 준비](DOCKER.md)를 참고한다. `RESUME_PUBLIC_ORIGIN` 끝에는 `/`를 붙이지 않는다. 서버 모드에서는 운영자 `OPENAI_API_KEY`를 사용하지 않는다. 각 사용자가 로그인 후 본인의 키를 등록한다.

운영자는 최초 로그인 후 `GET /api/account` 응답의 내부 `id`를 확인하고 개인 서버 환경 파일의 `RESUME_OPERATOR_ID`에 지정한 뒤 앱을 재시작한다. 이메일이나 Cloudflare 헤더 값을 사용하지 않는다. 지정된 한 계정만 설정 화면에서 백업 상태를 볼 수 있고 다른 사용자 데이터에 대한 권한은 생기지 않는다. 미지정이면 운영자 기능은 모두 비활성화된다.

Fernet 키는 최초 설치 시 한 번만 생성한다. 대상 경로가 없음을 확인하고, 백엔드 환경의 Python에서 다음 명령을 실행한다. 기존 서버 복구 시에는 새 키를 만들지 않고 별도 보관한 원래 키를 복원한다.

```sh
backend/.venv/bin/python -c 'import os; from cryptography.fernet import Fernet; fd=os.open(os.environ["RESUME_KEY_FILE"], os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600); os.write(fd, Fernet.generate_key()); os.close(fd)'
```

## 무료 주소와 비공개 API 연결

`브라우저 → HTTPS workers.dev / Access → SPA·Worker /api → VPC Service → 암호화 Tunnel → 맥미니 loopback:8000`을 사용한다. 도메인 구매, 공개 원본 주소, nginx, 공유기 포트 개방이 필요하지 않다. 기존 공개 호스트용 `cloudflared.yml.template`은 이 구성에서 사용하지 않는다.

**2026-09-24 확인:** Workers VPC는 현재 무료 베타이며 향후 API·요금 변경 가능성이 있다. 도메인 구매 없이 구성할 수 있다는 뜻이지 모든 서비스의 영구 무료 운영을 보장하는 것은 아니다. [VPC 시작 안내](https://developers.cloudflare.com/workers-vpc/get-started/), [VPC 제한](https://developers.cloudflare.com/workers-vpc/platform/limits/).

1. Cloudflare 계정에서 Workers용 무료 subdomain을 정한다. 앱 이름은 `wrangler.jsonc`의 `resume-agent`이며 최종 주소를 서버의 `RESUME_PUBLIC_ORIGIN`에 정확히 설정한다.
2. **처음 공개하기 전에** Zero Trust에서 정확한 `workers.dev` 호스트 전체를 보호하는 Access 앱을 생성한다. 초대 이메일만 허용하고 MFA를 요구한다. 이메일 OTP 단독 인증은 사용하지 않는다. 초기 세션은 1시간을 제안한다. 앱 생성 후 AUD를 백엔드 `CF_ACCESS_AUD`로 사용한다. Worker 생성 후 Access 탭에서도 All traffic 적용과 정적 파일 보호를 확인한다. 다른 Access 앱으로 바꿀 때는 AUD도 맞춘다. [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
3. Workers VPC에서 remotely-managed Tunnel을 만들고 맥미니에서 `cloudflared`를 실행한다. 2025.7.0 이상, QUIC와 outbound UDP 7844가 필요하다. Tunnel 토큰은 Git 밖 `0600` 파일에 보관하고 `tunnel.plist.template`의 `__PRIVATE_TUNNEL_TOKEN_PATH__`로 전달한다. 명령 인수나 Actions 로그에 토큰 원문을 남기지 않는다. 공개 hostname route를 만들지 않는다. [VPC Tunnel](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/).
4. HTTP VPC Service의 목적지를 이 Tunnel의 **127.0.0.1, HTTP port 8000**으로 제한한다. 전체 LAN 접근을 허용하는 VPC Network binding은 사용하지 않는다. 전달 경로는 Tunnel까지 암호화되고 평문 HTTP는 같은 맥미니의 cloudflared→FastAPI loopback에만 사용한다. Service ID를 기록한다. [VPC Service 설정](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/).
5. Worker에 `RESUME_API` VPC Service binding을 연결한다. CI/CD는 `CLOUDFLARE_VPC_SERVICE_ID` 변수로 배포 설정을 생성한다. 수동 최초 배포는 `wrangler.jsonc`에 `vpc_services: [{"binding":"RESUME_API","service_id":"실제 UUID"}]`와 `workers_dev: true`를 설정한 검증된 사본을 사용한다. 저장소의 기본값은 주소 비활성 상태이며 임의 ID로 배포하지 않는다. 미리보기 URL은 계속 비활성화한다.
6. Worker는 Access 사용자 JWT를 `X-Resume-User-JWT`에 덮어써 전달한다. 백엔드는 서명·발급자·AUD·만료와 DB 초대·정지를 검증한다. 원본용 Access 앱·서비스 토큰과 `ORIGIN_URL`은 이번 구성에 필요하지 않다.
7. 미인증 사용자와 미초대 계정 차단, 쿠키 `HttpOnly/Secure/SameSite`, 로그아웃·만료, 두 계정 격리, 업로드·PDF Range·SSE를 실제 주소에서 확인한다. 무료 Quick Tunnel은 운영 대안으로 사용하지 않는다. SSE를 지원하지 않기 때문이다. [Tunnel 안내](https://developers.cloudflare.com/tunnel/get-started/).

프런트는 상대 `/api`만 사용하고 CORS 허용 범위를 넓히지 않는다. VPC가 해당 계정에서 동작하지 않으면 이 단계에서 원인을 확인하며 공개 임시 터널로 자동 우회하지 않는다.

## 운영자만 계정 관리

최초 운영자도 먼저 초대한다. 서버가 자동으로 첫 사용자를 관리자로 만들지 않는다. 아래는 `backend` 디렉터리에서 실행하며 데이터 경로는 사전에 확인한 운영 경로로 지정한다.

```sh
uv run python -m scripts.manage_users --data-dir /ABSOLUTE_DATA invite owner@example.com
uv run python -m scripts.manage_users --data-dir /ABSOLUTE_DATA list
uv run python -m scripts.manage_users --data-dir /ABSOLUTE_DATA disable INTERNAL_USER_ID
uv run python -m scripts.manage_users --data-dir /ABSOLUTE_DATA revoke user@example.com
uv run python -m scripts.manage_users --data-dir /ABSOLUTE_DATA enable INTERNAL_USER_ID
```

초대는 Cloudflare 허용 정책과 서버 DB 양쪽에 필요하다. 정지는 서버에서 먼저 적용하고 Cloudflare 허용 정책 제거·기존 세션 철회를 함께 수행한다. `enable`은 초대 철회를 되돌리지 않는다. 진행 중 AI 작업도 5초 간격으로 초대·정지·JWT 만료를 확인하지만 이미 제공자에 제출한 요청의 즉시 비용 중단을 보장하지 않는다. 이메일이 같아도 새로운 인증 `sub`에 기존 소유권을 자동 이전하지 않는다.

**Docker 운영 중에는 위 CLI도 같은 컨테이너 안에서 실행한다.** 호스트 Python으로 실행 중 컨테이너 WAL DB에 접근하지 않는다. `run-containers.sh`와 동일한 환경을 읽어 렌더링한 Compose에서 `exec backend python -m scripts.manage_users --data-dir /data ...`를 사용한다. 대시보드의 Access 관리 권한·맥미니 실행 계정·SSH 접근은 운영자만 보유한다.

## 맥미니 앱 실행

Docker는 [별도 절차](DOCKER.md)를 따른다. 현재 Linux OCR·SSD DB 잠금·복구가 미검증이므로 아래 네이티브 실행을 비교 기준으로 남긴다. 두 방식을 같은 DB에서 동시에 실행하지 않는다.

1. 백엔드에서 `uv sync --frozen`을 수행한다. 기존 서비스가 있다면 성공 백업을 확인하고 이전 DB 사본으로 스키마 변경을 검증한다. 현재 시작 시 기초 테이블과 계정 정지 열을 생성하며 임의 버전 간 자동 마이그레이션을 보장하지 않는다.
2. `/bin/sh deploy/run-app.sh /ABSOLUTE_PRIVATE/server.env check`로 실제 SSD·키 권한을 확인한다. 앱은 worker 1개와 loopback만 사용한다. OCR/AI 각각 동시 실행 1개로 시작한다.
3. `app.plist.template`과 `tunnel.plist.template`의 저장소·개인 설정 절대 경로를 치환한다. 백업도 실제 준비 공간과 자격증명을 준비한 다음 구성한다.
4. 완성한 plist를 `~/Library/LaunchAgents/com.resume-agent.{app,tunnel,backup}.plist`로 설치하기 전에 `plutil -lint`로 검사한다. 백업 시각 자리표시는 정수로 치환한다.

현재 템플릿은 로그인 사용자용 LaunchAgent다. 로그인 전 실행을 보장하지 않는다. 설치 예:

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.resume-agent.app.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.resume-agent.tunnel.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.resume-agent.backup.plist"
launchctl kickstart -k "gui/$(id -u)/com.resume-agent.app"
```

재부팅 후 FileVault 잠금 해제·로그인 필요 여부, 절전과 전원 복구 설정을 실제 장비에서 확인한다. 현재 장비가 무인 재시작 가능한 상태라고 가정하지 않는다. LaunchDaemon으로 변경하려면 별도 실행 계정·데이터 권한·부팅 시 디스크 접근을 검증한다. [Cloudflare macOS 서비스 안내](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/macos/), [Apple FileVault 안내](https://support.apple.com/guide/deployment/manage-filevault-with-device-management-dep0a2cb7686/web).

실제 도메인에서 두 계정 간 자료·파일·검토·SSE 격리, 업로드·PDF·OCR·SSE, 브라우저 종료 후 결과 보존, 재시작 후 중단 작업 상태를 확인하고 초대한다.

## 과금 없는 암호화 백업

**초과 과금을 피한다는 사용자 조건에 따라 R2 자동 백업을 제외한다.** Cloudflare의 예산 알림은 통지만 하며 사용량·과금을 중단시키지 않는다. R2 무료 구간이나 자체 사용량 검사만으로 청구액 0원을 보장하지 않는다. [공식 예산 알림 제한](https://developers.cloudflare.com/billing/manage/budget-alerts/).

현재 백업은 기본 `RESUME_BACKUP_MODE=disabled`이며 어떤 restic 작업도 시작하지 않는다. `local`을 명시한 경우만 Git 밖의 기존 **로컬 디스크 restic 저장소**에 암호화해서 저장한다. s3/http/sftp/rclone 등의 원격 저장소는 restic을 실행하기 전에 차단한다. 과금되는 네트워크/클라우드 마운트를 로컬 경로로 연결해서도 안 된다.

1. 별도 백업 디스크를 준비한다. 같은 2TB SSD 안의 다른 폴더는 실수로 삭제한 데이터 복구에는 도움이 될 수 있지만 해당 SSD 고장에는 대비하지 못한다. 별도 물리 디스크까지 스크립트가 강제/검증하는 것은 아니다.
2. `backup.env.example`를 Git 밖에 복사하고 owner-only `0600`으로 둔다. 정상 마운트한 저장소·준비 디렉터리를 먼저 만들고 `0700`으로 제한한다. 개인 암호 파일을 준비하고 백업 디스크의 restic 저장소를 최초 한 번 수동 초기화한다. 스크립트는 없는 저장소를 자동 초기화하지 않는다.
3. 환경에 `RESUME_BACKUP_MODE=local`, 실제 `RESTIC_REPOSITORY` 절대 경로, `RESTIC_PASSWORD_FILE`, `RESUME_DATA_DIR`, `RESUME_BACKUP_STAGING_DIR`, `RESTIC_BIN`을 설정한다. AWS/R2 자격증명은 사용하지 않는다.
4. `/bin/sh deploy/run-backup.sh /ABSOLUTE_PRIVATE/backup.env`로 백업한 뒤 아래 복구 검증을 실행한다. Docker는 [백업 제약](DOCKER.md#sqlite와-백업)에 따라 호스트 백업 동안 중지해야 한다.
5. 실제 성공 후 일일 launchd를 등록한다. 배포 직전에도 동일 백업이 필수이므로 백업을 구성하지 않은 상태에서는 운영 자동 배포가 진행되지 않는다.

백업은 SQLite 쓰기 잠금 동안 `Connection.backup()`으로 일관된 DB를 만들고 그 DB가 참조하는 원본을 복사한다. SHA-256과 DB 무결성을 확인한 사본을 restic으로 암호화하며, 중복 제거로 기존 조각을 재사용한다. 준비 공간에는 매번 DB·원본 전체를 복사할 여유가 필요하다. 최근 일별 7개·주별 4개·월별 3개 스냅샷을 보관하며 정책 간 같은 스냅샷이 겹칠 수 있다. [restic 저장소 준비](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html), [보관 정책](https://restic.readthedocs.io/en/stable/060_forget.html).

운영자 설정 화면에서 마지막 시도·성공 시각과 안전한 오류 코드만 확인한다. 매일 성공했더라도 마지막 성공 이후 최대 약 하루의 변경은 손실될 수 있다. restic 암호와 개인 API 키용 Fernet 복호화 키의 복구 사본은 맥미니·운영 SSD 밖에 별도로 보관한다. 백업 대상과 암호를 동시에 잃으면 복구할 수 없다.

백업 디스크는 아직 선택·연결하지 않았으며 실제 백업은 없다. 지금의 브라우저 미리보기 데이터는 IndexedDB에만 있으므로 설정 화면에서 직접 내보내 별도로 보관한다. 브라우저 저장을 서버 백업으로 간주하지 않는다.

## 빈 디렉터리 복구 검증

먼저 로컬 백업 환경을 읽고, 비어 있는 Git 밖 대상에 복원한다. 실행 중인 서버 데이터에 덮어쓰지 않는다.

```sh
restic check
restic snapshots --tag resume-agent
restic restore SNAPSHOT_ID --target /ABSOLUTE_EMPTY_RESTORE_DIRECTORY
```

restic은 스냅샷에 기록된 경로를 대상 아래 복원한다. 복원 결과에서 `manifest.json`, `resume.sqlite3`, `files/`가 함께 있는 `snapshot` 디렉터리를 찾고 검증한다. [restic 복구 문서](https://restic.readthedocs.io/en/stable/050_restore.html).

```sh
backend/.venv/bin/python backend/scripts/backup.py --verify /ABSOLUTE_RESTORED_SNAPSHOT_DIRECTORY
```

검증은 DB 해시·SQLite 무결성·외래 키·모든 원본의 크기와 SHA-256을 검사한다. 이후 별도 시험 데이터 경로와 원래 Fernet 키로 앱을 실행해 관계·검토 결과·원본 다운로드·키 복호화를 확인한다. 유료 AI 호출은 복구 검증에 필요하지 않다. SQLite 외래 키로 표현되지 않은 JSON 작업 공간 관계는 앱에서 추가 확인해야 한다.

실제 전환 시 앱을 중지한 뒤 검증한 DB와 `files/`를 새 데이터 디렉터리로 옮기고, 스냅샷 시점에 맞는 코드와 원래 키로 시작한다. 기존 디렉터리는 검증이 끝날 때까지 보존한다. DB와 코드 버전이 맞지 않는 단순 코드 되돌리기는 하지 않는다. 복구 목표는 마지막 성공 백업이며 유료 AI 작업은 자동 재실행하지 않는다.

로컬 테스트는 스냅샷·잠금·해시·오류 상태를 검증한다. 실제 백업 디스크 저장·빈 서버 복원, launchd·터널·FileVault·장비 성능 검증은 운영 입력값 준비 후 남은 작업이다.

## Cloudflare 계정 연결과 MCP

계정 이메일/이름만으로는 관리 작업을 할 수 없다. 공식 Cloudflare API MCP `https://mcp.cloudflare.com/mcp`를 연결하면 Cloudflare의 OAuth 화면에서 대상 계정과 필요한 권한을 승인할 수 있다. Codex 전역 설정에 이 MCP를 등록했다. OAuth 승인 완료 여부와 다음 세션의 도구 연결은 별도로 확인한다. MCP가 필수는 아니며 최초 설정은 Wrangler OAuth 로그인/API로도 가능하다. [Cloudflare 공식 MCP](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/), [Wrangler 로그인](https://developers.cloudflare.com/workers/wrangler/commands/general/).

대화형 설정용 OAuth와 GitHub 자동 배포용 API 토큰은 별개다. Actions에는 최소 권한 API 토큰을 GitHub Secret으로 등록한다. 비밀번호·Global API Key·토큰 원문을 채팅이나 저장소에 붙이지 않는다. 계정 ID는 식별 정보이며 로그인 권한을 대신하지 않는다.

## 맥미니 최초 서버 설정 체크리스트

1. **실행 계정/디스크:** 전용 표준 사용자, macOS 업데이트·방화벽, 외장 APFS SSD 암호화·소유권·UUID 확인. 코드 release, DB/원본, 모델 cache, 백업 준비 공간을 분리하고 `0700`, 비밀 파일은 `0600`으로 준비한다. 기존 디스크를 자동 포맷하지 않는다.
2. **상시 운영:** 사용 중 절전 방지, 정전 후 재시작, 유선 네트워크 권장. FileVault/암호화 SSD가 재부팅 후 잠겨 있으면 원격 서비스가 시작되지 않을 수 있으므로 실제 복구 절차를 시험한다. 현재 LaunchAgent는 로그인 이후 실행한다.
3. **런타임:** Python 3.12/uv, Node 22/pnpm, Git/GitHub CLI, cloudflared, restic. 우선 네이티브 앱과 OCR을 검증한다. Docker를 선택하면 별도 ARM 이미지·VM 메모리·SSD 파일 잠금·백업 검증이 선행돼야 한다.
4. **인증/연결:** 개인 키 암호화 파일 생성·외부 복구 사본, 운영자 초대, Access MFA, 무료 workers.dev, VPC Service와 Tunnel. FastAPI는 loopback:8000만 사용하며 공유기 포트를 열지 않는다.
5. **백업/배포:** 로컬 디스크 암호화 백업 성공과 빈 디렉터리 복원, 최초 release/current 설치, launchd 앱·Tunnel·일일 백업, private 저장소 runner 등록. 실제 서버에서 성공한 뒤 CD를 활성화한다.
6. **운영 시험:** 두 계정 격리·초대 철회·로그아웃·업로드/PDF/OCR/SSE, SSD 미연결 시작 거부, 브라우저 종료·서버 재시작·정전 후 복구를 확인한다. 백업 성공 시각과 여유 디스크/메모리를 주기적으로 확인한다.

프리뷰만 준비할 때는 대상 계정 하나에 `Workers Scripts: Edit`와 `Account Settings: Read`부터 부여한다. R2·DNS·Billing·API 토큰 관리·Tunnel·Access 권한은 이 단계에 필요하지 않다. OAuth가 만료됐으면 `codex mcp login cloudflare`로 다시 승인한다.
