# CI/CD 연결과 운영

대상: [Yelihi/resume-agent](https://github.com/Yelihi/resume-agent). **공개 범위를 유지한다.** 운영 Mac에 GitHub Actions runner를 등록하지 않는다. 기존 Mac 로그인, 서비스, Tunnel, 백업과 키를 사용한다.

## main push 동작

| 변경 | GitHub workflow | 배포 |
| --- | --- | --- |
| `frontend/**`, `deploy/cloudflare/**` | Frontend CI and deployment | 테스트·빌드·Worker 검사 → Cloudflare SPA/API 프록시 배포 |
| `backend/**`, Cloudflare 외 `deploy/**`, API 계약 파일 | Backend CI and deployment | 테스트·API 계약·운영 검사 → 배포 요청 → Mac 백업·코드 교체·재시작·health → GitHub에 결과 기록 |
| 각 workflow 파일 | 해당 workflow | 같은 검사·배포 |
| 위 경로 밖 문서만 | 실행하지 않음 | 서비스 유지 |

PR은 GitHub의 임시 runner에서 검사만 한다. `main` push와 `workflow_dispatch`만 운영 배포한다. 프런트만 변경하면 서버·Tunnel을 재시작하지 않는다. 백엔드 배포는 서버를 잠시 중지하고 기존 코드로 암호화 백업한 뒤 새 코드로 시작한다. Tunnel과 새벽 4시 백업 예약은 유지된다.

두 workflow는 독립적이다. 프런트·백엔드를 함께 바꾸는 경우 실행 순서를 보장하지 않으므로 API는 이전 프런트와 호환되게 먼저 추가하고, 후속 배포에서 사용 전환·제거한다. 원자적/무중단 배포는 아니다. 실행 중 유료 AI 검토는 재시작으로 중단될 수 있으며 자동 재실행하지 않는다.

각 workflow는 진행 중 배포를 새 push가 취소하지 않는다. 다만 배포 시작 시점의 최신 main이 아닌 SHA는 거부한다. 오래된 실행이 거부되거나 실패한 뒤에는 최신 main에서 해당 workflow를 수동 실행한다. 프런트만 다시 push한다고 이전 백엔드 실패가 자동 복구되지는 않는다.

## 공개 저장소에서 Mac 배포

GitHub의 backend job은 `production-backend` Deployment를 만들고 결과를 기다린다. Mac의 `com.resume-agent.deploy` LaunchAgent는 60초마다 요청을 읽는다. GitHub와 Mac은 모두 외부로 연결하므로 공유기 포트·SSH 공개·새 Tunnel이 필요하지 않다.

Mac은 요청 SHA와 현재 main, 원본 저장소, workflow 경로, 실행 ID/재시도 번호, push/수동 이벤트, `checks` 성공, 실행 중 backend job을 검증한다. PR/fork의 코드는 실행하지 않는다. 통과한 코드만 전용 checkout으로 받아 기존 `run-release.sh`를 실행한다. main 수정 권한은 곧 운영 코드 배포 권한이므로 신뢰하는 운영자에게만 준다.

- 감시 코드: `~/.config/resume-agent/deployment/github-deploy.py`
- 전용 checkout: `~/.config/resume-agent/deployment/checkout`
- 실행 앱: `~/Applications/Resume Agent Deploy.app`
- 자동 실행: `~/Library/LaunchAgents/com.resume-agent.deploy.plist`
- 로그: `~/.config/resume-agent/deployment/deploy.log`
- 기존 운영 release: `/Volumes/Storage2TB/server/resume-agent/release/current`

별도 배포 앱은 기존 서비스 앱을 덮어쓰지 않는다. macOS가 요청하는 제거 가능한 볼륨 접근을 이 앱에 허용한다. GitHub 인증에는 Mac의 기존 `gh` 로그인을 사용하며 토큰을 GitHub나 저장소에 복사하지 않는다. 설치된 감시 코드는 일반 배포에서 자동 교체하지 않는다. 감시 코드/실행 앱 변경 시에는 검토한 파일을 명시적으로 갱신하고 다시 검증한다.

기존 `/bin/sh` LaunchAgent와 현재 설치된 `Resume Agent Service.app` 모두 지원한다. 전용 서비스 앱은 설치된 고정 release·설정 경로에서만 허용한다. 배포 전 백업도 기존 백업 LaunchAgent에 지정된 명령을 사용하므로 외장 접근 권한을 유지한다.

## GitHub 설정

[Actions 변수/Secrets](https://github.com/Yelihi/resume-agent/settings/secrets/actions):

| 종류 | 이름 | 용도 |
| --- | --- | --- |
| Variable | `ENABLE_NATIVE_CD` | Mac 배포 요청 활성화. 실제 검증 후 `true` |
| Variable | `ENABLE_FRONTEND_CD` | 운영 Cloudflare 배포 활성화. 토큰 검증 후 `true` |
| Variable | `ENABLE_PREVIEW_CD` | 별도 브라우저 미리보기. 운영에는 `false` 유지 가능 |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | 기존 Cloudflare 계정 ID |
| Variable | `CLOUDFLARE_VPC_SERVICE_ID` | 기존 `resume-agent-api` Service UUID |
| Secret | `CLOUDFLARE_API_TOKEN` | 해당 계정의 Workers 배포 및 기존 VPC binding 권한 |

계정/VPC 식별자는 기존 설치 값을 사용한다. 배포 전용 Cloudflare 토큰은 Workers Scripts Edit, Account Settings Read 및 기존 VPC binding 권한이 필요하다. [VPC 권한 설명](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/). 대화형 Wrangler OAuth를 GitHub Secret으로 복사하지 않는다. 새로운 토큰이 필요하면 배포 용도로만 만들고 기존 키를 재생성하지 않는다.

서버 환경 파일·개인 OpenAI 키·Fernet 키·Tunnel 토큰·restic 비밀번호는 GitHub에 넣지 않는다. GitHub backend job의 임시 `GITHUB_TOKEN`은 contents read/deployments write만 사용한다. `RESUME_*_ENV_FILE` 등의 서버 경로 변수와 private 저장소/self-hosted runner 조건은 새 구성에 필요하지 않다.

## 확인과 중지

- [Actions](https://github.com/Yelihi/resume-agent/actions): 두 workflow의 CI/CD 결과.
- [Deployments](https://github.com/Yelihi/resume-agent/deployments): `production-backend`의 성공/실패 SHA와 실행 링크.
- Cloudflare → Workers & Pages → `resume-agent` → Deployments/Metrics: 프런트 버전·요청·오류. Worker의 상세 observability 로그는 현재 비활성이다.
- Zero Trust → Networks → Tunnels: Tunnel 연결 상태.
- 서비스 설정 → 운영자 백업 상태: 마지막 성공 시각과 오류. 별도 자동 알림 서비스는 설치하지 않았다.

Mac에서:

```sh
launchctl print "gui/$(id -u)/com.resume-agent.deploy"
tail -n 80 "$HOME/.config/resume-agent/deployment/deploy.log"
launchctl print "gui/$(id -u)/com.resume-agent.app"
launchctl print "gui/$(id -u)/com.resume-agent.tunnel"
curl --fail http://127.0.0.1:8000/health
cat /Volumes/Storage2TB/server/resume-agent/data/backup-status.json
df -h / /Volumes/Storage2TB
```

배포 감시와 예약 백업은 작업 사이 `not running`이 정상이다. 마지막 종료 코드 0과 로그/성공 시각을 확인한다. 앱과 Tunnel은 running이어야 한다. 재부팅 후 macOS 사용자 로그인·외장 마운트가 필요하다.

자동 배포만 중지하려면 GitHub의 `ENABLE_NATIVE_CD`/`ENABLE_FRONTEND_CD`를 `false`로 바꾼다. 서버·Tunnel·예약 백업은 유지된다. 이미 요청된 배포는 취소되지 않는다. 진행 여부를 확인하기 전 Mac 배포 프로세스를 강제 종료하지 않는다.

## 실패와 복구

- 검사/빌드/SSD 검사 실패: 기존 서버 유지.
- 배포 전 백업 실패: 기존 앱 재시작, 새 release로 전환하지 않음.
- 새 앱 health 실패: 새 앱 정지. DB 스키마 변경 가능성이 있어 코드만 자동 롤백하지 않음. 배포 전 백업을 별도 폴더에서 복원·검증하고 이전 코드와 함께 복구.
- 실패/중단된 Deployment는 자동 재시도하지 않음. 로그와 release 상태 확인 후 GitHub에서 최신 main workflow를 다시 실행.
- 배포 중 정전: Mac 로그인 후 `current`, `.current-next`, DB/백업, Deployment 상태를 확인. 진행 중으로 남은 요청도 임의 재실행하지 않음.
- GitHub backend job이 시간 초과: Mac 오프라인/로그아웃/권한/인증과 로그부터 확인. 실제 Mac 작업이 계속 진행될 수 있으므로 새 배포 전 기존 작업 상태 확인.
- 프런트 배포 실패: 서버 유지. Cloudflare Secret/권한을 고친 뒤 프런트 workflow만 다시 실행.
- 과거 release와 백업을 배포 스크립트가 임의 삭제하지 않음. 디스크 여유 공간을 운영자가 확인.

Docker는 현재 배포에 필요하지 않다. 기존 macOS Python 가상환경 + launchd가 서버를 실행한다. Docker로 전환하려면 Linux ARM64 OCR·볼륨·백업·재부팅 복구를 별도로 검증한다.
