# CI/CD 연결

대상은 `https://github.com/Yelihi/resume-agent`다. 확인 당시 빈 공개 저장소이며 계정 플랜은 GitHub Free다. 맥미니 연동은 보류하고 GitHub-hosted CI와 별도 브라우저 미리보기를 먼저 구성한다. 운영 runner는 연결하지 않는다. 운영 runner·비밀정보 등록은 아직 하지 않았다. GitHub의 실행 결과는 Actions 탭에서 확인한다. 기본 브랜치는 `main`을 가정하며 실제 저장소가 다르면 workflow의 trigger·조건·SHA 조회를 함께 바꾼다.

## 동작

`.github/workflows/ci.yml`의 `checks`는 PR, main push, 수동 실행에서 GitHub의 임시 Ubuntu runner를 사용한다.

1. 잠금 파일 기준 Python/Node 의존성 설치.
2. 유료 AI·실제 OCR 모델 다운로드를 제외한 백엔드 테스트.
3. OpenAPI와 TypeScript 타입 재생성 결과가 커밋과 같은지 확인.
4. 프런트 테스트·프로덕션 빌드, Worker 테스트, 배포 실패 복구 테스트, SSD 사전 검사, 셸 검사, Wrangler dry-run.

CD는 **private 저장소 + main + PR 아님 + 저장소 변수 `ENABLE_NATIVE_CD=true`**일 때만 시작한다. 비밀정보 없는 PR 검사가 운영 맥미니에 배정되지 않으며 `pull_request_target`/`workflow_run`은 사용하지 않는다. 사용하는 Actions는 전체 commit SHA에 고정했다. 운영 데이터나 AI 키를 CI에 넣지 않는다.

- 맥미니는 동일하게 검사한 SHA인지, 현재 main인지 확인한다. 별도 release 디렉터리에 코드를 풀고 의존성을 설치한다.
- SSD·키·설정 검증 후 기존 앱을 중지하고 **기존 코드로 백업**한다. 백업 또는 보관 정책 실패 시 교체하지 않고 기존 앱을 다시 시작한다.
- 성공한 뒤 `current` 링크를 새 release로 바꾸고 launchd를 시작한다. 로컬 `/health`가 정상인 경우만 다음 단계로 간다.
- Cloudflare job은 같은 SHA를 다시 빌드하고 Worker/SPA를 함께 배포한다. 백엔드 실패 시 프런트 배포를 건너뛴다. 운영 frontend와 별도로 preview job이 있으며 backend job을 기다리지 않는다.
- 배포 중단으로 깨지지 않도록 실행 중 배포는 새 push가 취소하지 않는다. 동시에 하나만 실행하며 Mac에도 배포 파일 잠금이 있다.

이것은 **네이티브 백엔드용 CD**다. Docker가 실제 운영 방식으로 확정되면 백엔드 job을 컨테이너 build/검증/백업/교체 흐름으로 바꿔야 한다. 기존 Docker 검증을 완료한 것처럼 이 플래그를 켜지 않는다. 수동 최초 설치와 실제 배포 복구 시험이 끝나기 전에는 플래그를 비워 둔다.

## 최초 연결 순서

1. 제공한 GitHub URL의 저장소·기본 브랜치·공개 여부를 확인하고, 현재 미커밋 기능 변경을 검토해 함께 커밋/푸시한다. OpenAPI 파일도 반드시 포함한다. 현재 작업 디렉터리를 CD 체크아웃으로 사용하지 않는다.
2. `checks` 실행을 확인한다. main 변경 권한은 운영자로 제한하고 가능한 플랜에서 branch ruleset에 `checks`를 필수로 설정한다. private 저장소의 보호 규칙·environment 기능과 Actions 무료 한도는 계정 플랜에 따라 다르므로 제공된다고 가정하지 않는다. 유료 AI secret은 넣지 않는다.
3. [배포 절차](README.md)의 무료 주소 Access/MFA·VPC·Tunnel·사용자 초대·로컬 암호화 백업 복구 시험을 먼저 끝낸다. Workers 이름 `resume-agent`와 기존 Access 정책이 보호하는 주소가 일치해야 한다.
4. 외장 SSD에 개발 checkout·DB·모델 cache와 **서로 겹치지 않는** `releases/` 디렉터리를 사전에 만들고 실행 사용자 소유 `0700`으로 둔다. 최초 검증된 commit을 그 아래 고유 디렉터리에 설치하고 `backend/.venv`를 만든다. `current` symlink는 그 디렉터리를 가리킨다.
5. `app.plist.template`의 `__REPO_PATH__`는 실제 `releases/current` 절대 경로로 치환한다. ProgramArguments는 `/bin/sh`, `releases/current/deploy/run-app.sh`, 개인 `server.env` 경로 순서여야 한다. 최초 앱과 백업이 실제로 성공해야 이후 자동 교체가 가능하다. 백업과 서버 환경의 `RESUME_DATA_DIR`는 같아야 한다. 백업 launchd도 `current`를 사용한다.
6. **운영자만 코드를 관리하는 private 저장소에 한해** Mac ARM64 self-hosted runner를 등록하고 사용자 label `resume-production`을 붙인다. 동일한 표준 실행 계정의 로그인 GUI 세션에서 실행해야 현재 LaunchAgent를 제어할 수 있다. runner의 작업 디렉터리는 releases/·개발 checkout·DB와 분리한다. `uv 0.9.21`, GitHub CLI `gh`, Python 3.12가 준비돼 있어야 한다. `run-release.sh`는 uv의 Python 3.12로 배포 코드를 실행한다.
7. 아래 환경값을 설정한다. `ENABLE_NATIVE_CD=true`는 수동·자동 CD를 함께 켜므로 검증된 서버에서 main 추가 push를 멈춘 상태로 첫 workflow_dispatch와 복구 시험을 진행한다. 이후 정상 main push부터 자동으로 배포한다. 세션의 FileVault/SSD 잠금 해제와 runner 시작도 재부팅 후 확인한다.

**runner 보안 한계:** workflow의 `if`와 runner label은 격리 경계가 아니다. 이 Mac에서 실행할 수 있는 workflow를 수정하는 사람은 서버 파일에 접근할 수 있다. private여도 신뢰하지 않는 기여자의 PR/fork workflow를 허용하지 않는다. Fork PR Actions를 비활성화하고, GitHub 계정 MFA·main/배포 파일의 변경 권한을 운영자에게 제한한다. 공개 저장소이거나 외부 기여를 허용할 경우 이 production runner를 등록하지 않고 별도 격리/배포 경로를 먼저 설계한다. [GitHub self-hosted 보안](https://docs.github.com/en/actions/reference/security/secure-use), [runner 등록](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners).

## 맥미니 없이 먼저 테스트

`preview` job은 GitHub-hosted runner에서만 실행한다. `checks` 통과 후 `ENABLE_PREVIEW_CD=true`인 main push/수동 실행에 대해 `resume-agent-preview.<계정>.workers.dev`로 **별도 정적 SPA**를 배포한다. 앱 서버, VPC, Tunnel, self-hosted runner, R2, OpenAI 키가 필요하지 않다. 운영 배포용 `ENABLE_NATIVE_CD`는 `false`로 유지한다.

- 화면 이동, 텍스트/TXT 이력서·자료 저장, 편집, 새로고침 복원, 내보내기를 브라우저 IndexedDB에서 시험한다.
- 데이터는 해당 브라우저의 preview 전용 저장소에 남는다. 다른 브라우저/기기와 동기화되지 않고 브라우저 데이터 삭제 시 사라진다. 먼저 가상 자료로 시험한다.
- AI·OCR·PDF/DOCX 추출·사용자 인증/인가·서버 저장/백업은 이 미리보기로 검증하지 않는다. API 키 입력도 제공하지 않는다.
- 미리보기 CSP는 `connect-src 'none'`으로 API 통신을 막으며 분석·R2·Worker 서버 코드를 배포하지 않는다. 운영 `resume-agent`의 VPC 프록시 설정과 구분한다.
- 미리보기 접근 제한이 필요하면 `resume-agent-preview.<계정>.workers.dev` 전체에 Access 정책을 먼저 적용한다. 브라우저 내부 데이터와 정적 앱 코드의 공개 여부는 별개다.
- Cloudflare 정적 assets 요청은 무료다. 기존 계정의 다른 유료 상품 요금까지 없어지는 것은 아니며, 이 작업은 유료 플랜·R2 구독을 만들지 않는다. [정적 assets 과금](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

직접 로컬에서 실행할 때(맥미니 서버 불필요):

```sh
cd frontend
pnpm install --frozen-lockfile
VITE_PREVIEW_MODE=true pnpm dev
```

Node가 있는 현재 컴퓨터의 브라우저로 접속한다. 배포형 빌드는 `VITE_PREVIEW_MODE=true pnpm exec vite build --outDir dist-preview`이며, CI에서는 정상 TypeScript 검사도 선행한다.

## GitHub 설정값

[Repository → Settings → Secrets and variables → Actions](https://github.com/Yelihi/resume-agent/settings/secrets/actions)에서 등록한다. **`.env` 파일 전체를 올리지 않는다.** 비밀값은 Secrets, 식별자·기능 플래그는 Variables에 넣는다.

지금 미리보기에 필요한 값:

| 위치 | 이름 | 값 |
| --- | --- | --- |
| Repository secret | `CLOUDFLARE_API_TOKEN` | 해당 Cloudflare 계정에 한정한 Workers Scripts:Edit, Account Settings:Read 권한 토큰 |
| Repository variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 대시보드의 Account ID |
| Repository variable | `ENABLE_PREVIEW_CD` | 위 값 준비 후 `true` |
| Repository variable | `ENABLE_NATIVE_CD` | 맥미니 준비 전 **false 유지** |

`VITE_PREVIEW_MODE=true`는 workflow가 미리보기 빌드에만 넣는다. 사용자가 별도 등록할 필요 없으며 `VITE_*`에 비밀값을 넣으면 브라우저 번들에 노출된다. Cloudflare OAuth/MCP 승인은 대화형 설정용이고 위 Actions API 토큰을 자동으로 대신하지 않는다. 토큰은 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)에서 만들고 GitHub Secret 입력창에 직접 저장한다. Global API Key·R2·DNS·Billing·Access 정책 수정 권한은 미리보기 배포에 필요하지 않다.

맥미니 연동 후 추가할 값:

| 위치 | 이름 | 값 |
| --- | --- | --- |
| Repository variable | `RESUME_SERVER_ENV_FILE` | Mac의 Git 밖 server.env 절대 경로 |
| Repository variable | `RESUME_BACKUP_ENV_FILE` | Mac의 Git 밖 backup.env 절대 경로 |
| Repository variable | `RESUME_RELEASE_ROOT` | 기존 외장 SSD releases 디렉터리 절대 경로 |
| Repository variable | `CLOUDFLARE_VPC_SERVICE_ID` | loopback:8000 서비스 UUID |
| Repository variable | `ENABLE_NATIVE_CD` | 초기 설치·백업 복구 시험·private 저장소 확인 후 `true` |

운영 VPC binding에는 별도 Connectivity Directory Bind 권한이 필요하며 실제 API 권한 이름은 계정에서 확인한다. 현재 GitHub Free private 저장소에서 유료 environment/보호 기능을 전제하지 않도록 Repository Variables/Secrets를 사용한다. 매 배포 수동 승인은 기본으로 요구하지 않는다. 현재 workflow는 PR 검사에 Secrets를 전달하지 않는다. 운영자가 workflow를 바꾸면 이 경계도 바뀌므로 저장소 접근 제어가 필요하다. [GitHub 배포 제어](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments).

Mac의 server.env, backup.env, Fernet 키, restic 암호, Tunnel 토큰과 개인 OpenAI 키는 GitHub에 등록하지 않는다. 서버 경로만 변수에 넣고 내용은 소유자 전용 파일로 유지한다. GitHub의 임시 `GITHUB_TOKEN`은 자동 제공되며 사용자가 만들거나 등록할 필요 없다.

## 실패와 복구

- 테스트/빌드/SSD 확인 실패: 실행 중 서버는 유지된다. 실패한 release 디렉터리는 자동 삭제하지 않는다.
- 배포 전 백업 실패: 기존 앱을 다시 시작하고 job을 실패 처리한다. 새 버전으로 전환하지 않는다.
- 새 앱 시작/health 실패: 새 앱을 중지한다. 시작 도중 DB 스키마가 바뀌었을 수 있어 코드만 이전 버전으로 자동 되돌리지 않는다. 마지막 배포 전 백업을 별도 디렉터리에 복구·검증한 뒤 이전 코드와 함께 다시 시작한다.
- 프런트 배포 실패: 건강한 새 백엔드는 유지한다. 같은 main SHA로 workflow를 재실행하면 백엔드는 건강 상태를 확인하고 프런트 배포를 재시도한다. 두 단계는 원자적 배포가 아니므로 API 변경은 기존 프런트와 호환되게 먼저 추가하고 후속 배포에서 제거한다.
- 중단/정전/실패한 디렉터리가 남은 경우: 상태를 확인한 운영자가 복구한 뒤 재시도한다. 실행 중 AI 검토는 재시작 중단 기록으로 남고 자동 유료 재실행하지 않는다.
- 이전 release와 백업을 자동 삭제하지 않는다. 디스크 여유 공간을 확인하고 정상 운영·복구 검증 후 운영자가 정리한다.

`/health`는 프로세스 준비 확인일 뿐 Access/MFA·실제 OCR·백업 복구 검증을 대신하지 않는다. Docker 또는 무중단 배포는 이번 자동화 범위에 포함하지 않는다.
