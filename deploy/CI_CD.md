# CI/CD 연결

대상은 `https://github.com/Yelihi/resume-agent`다. 확인 당시 빈 공개 저장소이며 계정 플랜은 GitHub Free다. 운영 runner를 위한 비공개 전환 응답을 기다리고 있다. 파일을 추가했지만 Actions 실행·runner 등록·배포·비밀정보 등록은 하지 않았다. 기본 브랜치는 `main`을 가정하며 실제 저장소가 다르면 workflow의 trigger·조건·SHA 조회를 함께 바꾼다.

## 동작

`.github/workflows/ci.yml`의 `checks`는 PR, main push, 수동 실행에서 GitHub의 임시 Ubuntu runner를 사용한다.

1. 잠금 파일 기준 Python/Node 의존성 설치.
2. 유료 AI·실제 OCR 모델 다운로드를 제외한 백엔드 테스트.
3. OpenAPI와 TypeScript 타입 재생성 결과가 커밋과 같은지 확인.
4. 프런트 테스트·프로덕션 빌드, Worker 테스트, 배포 실패 복구 테스트, SSD 사전 검사, 셸 검사, Wrangler dry-run.

CD는 **private 저장소 + main + PR 아님 + 저장소 변수 `ENABLE_NATIVE_CD=true`**일 때만 시작한다. 비밀정보 없는 PR 검사가 운영 맥미니에 배정되지 않으며 `pull_request_target`/`workflow_run`은 사용하지 않는다. 사용하는 Actions는 전체 commit SHA에 고정했다. 운영 데이터나 AI 키를 CI에 넣지 않는다.

- 맥미니는 동일하게 검사한 SHA인지, 현재 main인지 확인한다. 별도 release 디렉터리에 코드를 풀고 의존성을 설치한다.
- SSD·키·설정 검증 후 기존 앱을 중지하고 **기존 코드로 백업**한다. 업로드 또는 보관 정책 실패 시 교체하지 않고 기존 앱을 다시 시작한다.
- 성공한 뒤 `current` 링크를 새 release로 바꾸고 launchd를 시작한다. 로컬 `/health`가 정상인 경우만 다음 단계로 간다.
- Cloudflare job은 같은 SHA를 다시 빌드하고 Worker/SPA를 함께 배포한다. 백엔드 실패 시 프런트 배포를 건너뛴다. 미리보기는 만들지 않는다.
- 배포 중단으로 깨지지 않도록 실행 중 배포는 새 push가 취소하지 않는다. 동시에 하나만 실행하며 Mac에도 배포 파일 잠금이 있다.

이것은 **네이티브 백엔드용 CD**다. Docker가 실제 운영 방식으로 확정되면 백엔드 job을 컨테이너 build/검증/백업/교체 흐름으로 바꿔야 한다. 기존 Docker 검증을 완료한 것처럼 이 플래그를 켜지 않는다. 수동 최초 설치와 실제 배포 복구 시험이 끝나기 전에는 플래그를 비워 둔다.

## 최초 연결 순서

1. 제공한 GitHub URL의 저장소·기본 브랜치·공개 여부를 확인하고, 현재 미커밋 기능 변경을 검토해 함께 커밋/푸시한다. OpenAPI 파일도 반드시 포함한다. 현재 작업 디렉터리를 CD 체크아웃으로 사용하지 않는다.
2. `checks` 실행을 확인한다. main 변경 권한은 운영자로 제한하고 가능한 플랜에서 branch ruleset에 `checks`를 필수로 설정한다. private 저장소의 보호 규칙·environment 기능과 Actions 무료 한도는 계정 플랜에 따라 다르므로 제공된다고 가정하지 않는다. 유료 AI secret은 넣지 않는다.
3. [배포 절차](README.md)의 무료 주소 Access/MFA·VPC·Tunnel·사용자 초대·R2 복구 시험을 먼저 끝낸다. Workers 이름 `resume-agent`와 기존 Access 정책이 보호하는 주소가 일치해야 한다.
4. 외장 SSD에 개발 checkout·DB·모델 cache와 **서로 겹치지 않는** `releases/` 디렉터리를 사전에 만들고 실행 사용자 소유 `0700`으로 둔다. 최초 검증된 commit을 그 아래 고유 디렉터리에 설치하고 `backend/.venv`를 만든다. `current` symlink는 그 디렉터리를 가리킨다.
5. `app.plist.template`의 `__REPO_PATH__`는 실제 `releases/current` 절대 경로로 치환한다. ProgramArguments는 `/bin/sh`, `releases/current/deploy/run-app.sh`, 개인 `server.env` 경로 순서여야 한다. 최초 앱과 백업이 실제로 성공해야 이후 자동 교체가 가능하다. 백업과 서버 환경의 `RESUME_DATA_DIR`는 같아야 한다. 백업 launchd도 `current`를 사용한다.
6. **운영자만 코드를 관리하는 private 저장소에 한해** Mac ARM64 self-hosted runner를 등록하고 사용자 label `resume-production`을 붙인다. 동일한 표준 실행 계정의 로그인 GUI 세션에서 실행해야 현재 LaunchAgent를 제어할 수 있다. runner의 작업 디렉터리는 releases/·개발 checkout·DB와 분리한다. `uv 0.9.21`, GitHub CLI `gh`, Python 3.12가 준비돼 있어야 한다. `run-release.sh`는 uv의 Python 3.12로 배포 코드를 실행한다.
7. 아래 환경값을 설정한다. `ENABLE_NATIVE_CD=true`는 수동·자동 CD를 함께 켜므로 검증된 서버에서 main 추가 push를 멈춘 상태로 첫 workflow_dispatch와 복구 시험을 진행한다. 이후 정상 main push부터 자동으로 배포한다. 세션의 FileVault/SSD 잠금 해제와 runner 시작도 재부팅 후 확인한다.

**runner 보안 한계:** workflow의 `if`와 runner label은 격리 경계가 아니다. 이 Mac에서 실행할 수 있는 workflow를 수정하는 사람은 서버 파일에 접근할 수 있다. private여도 신뢰하지 않는 기여자의 PR/fork workflow를 허용하지 않는다. Fork PR Actions를 비활성화하고, GitHub 계정 MFA·main/배포 파일의 변경 권한을 운영자에게 제한한다. 공개 저장소이거나 외부 기여를 허용할 경우 이 production runner를 등록하지 않고 별도 격리/배포 경로를 먼저 설계한다. [GitHub self-hosted 보안](https://docs.github.com/en/actions/reference/security/secure-use), [runner 등록](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners).

## GitHub 설정값

| 위치 | 이름 | 값 |
| --- | --- | --- |
| Repository variable | `ENABLE_NATIVE_CD` | 초기 미설정. 실제 초기 설치·복구 검증 후 `true` |
| Repository variable | `RESUME_SERVER_ENV_FILE` | Mac의 Git 밖 server.env 절대 경로 |
| Repository variable | `RESUME_BACKUP_ENV_FILE` | Mac의 Git 밖 backup.env 절대 경로 |
| Repository variable | `RESUME_RELEASE_ROOT` | 기존 외장 SSD releases 디렉터리 절대 경로 |
| Repository variable | `CLOUDFLARE_ACCOUNT_ID` | 해당 Cloudflare 계정 ID |
| Repository variable | `CLOUDFLARE_VPC_SERVICE_ID` | loopback:8000 서비스 UUID |
| Repository secret | `CLOUDFLARE_API_TOKEN` | 해당 계정 Workers 배포·VPC binding에 필요한 최소 권한 토큰 |

Cloudflare 토큰에는 DNS 변경·R2·Access 정책 수정 권한을 주지 않는다. VPC binding에는 Connectivity Directory Bind 권한이 필요하며 실제 API 권한 이름은 계정에서 확인한다. 배포용 토큰으로 정책을 자동 약화시키지 않는다. 현재 GitHub Free private 저장소에서 유료 environment/보호 기능을 전제하지 않도록 job의 environment 지정은 생략하고 저장소 Variables/Secrets를 사용한다. 이후 지원되는 플랜으로 전환하면 environment와 main 제한을 추가할 수 있다. 매 배포 수동 승인은 기본으로 요구하지 않는다. 현재 workflow의 PR 검사에는 Secrets를 전달하지 않는다. 운영자가 workflow를 바꾸면 이 경계도 바뀌므로 저장소 접근 제어가 필요하다. [GitHub 배포 제어](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments).

Mac의 server.env, backup.env, Fernet 키, restic 암호, Tunnel 토큰은 GitHub에 등록하지 않는다. 경로만 변수에 넣고 내용은 소유자 전용 파일로 유지한다. GitHub의 임시 `GITHUB_TOKEN`은 SHA 조회용 read 권한이며 checkout에 영구 저장하지 않는다.

## 실패와 복구

- 테스트/빌드/SSD 확인 실패: 실행 중 서버는 유지된다. 실패한 release 디렉터리는 자동 삭제하지 않는다.
- 배포 전 백업 실패: 기존 앱을 다시 시작하고 job을 실패 처리한다. 새 버전으로 전환하지 않는다.
- 새 앱 시작/health 실패: 새 앱을 중지한다. 시작 도중 DB 스키마가 바뀌었을 수 있어 코드만 이전 버전으로 자동 되돌리지 않는다. 마지막 배포 전 백업을 별도 디렉터리에 복구·검증한 뒤 이전 코드와 함께 다시 시작한다.
- 프런트 배포 실패: 건강한 새 백엔드는 유지한다. 같은 main SHA로 workflow를 재실행하면 백엔드는 건강 상태를 확인하고 프런트 배포를 재시도한다. 두 단계는 원자적 배포가 아니므로 API 변경은 기존 프런트와 호환되게 먼저 추가하고 후속 배포에서 제거한다.
- 중단/정전/실패한 디렉터리가 남은 경우: 상태를 확인한 운영자가 복구한 뒤 재시도한다. 실행 중 AI 검토는 재시작 중단 기록으로 남고 자동 유료 재실행하지 않는다.
- 이전 release와 백업을 자동 삭제하지 않는다. 디스크 여유 공간을 확인하고 정상 운영·복구 검증 후 운영자가 정리한다.

`/health`는 프로세스 준비 확인일 뿐 Access/MFA·실제 OCR·R2 복구 검증을 대신하지 않는다. Docker 또는 무중단 배포는 이번 자동화 범위에 포함하지 않는다.
