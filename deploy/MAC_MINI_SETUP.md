# 맥미니 최초 설치: 화면 설정부터 실제 검토까지

2026-09-26 갱신. 현재 저장소의 **macOS 네이티브 실행 + Cloudflare Workers** 구성용 안내다. 실행 완료 범위는 아래 ‘현재 진행 상태’를 확인하며, 최초 설치 명령을 중복 실행하지 않는다. 한 단계가 실패하면 다음 단계로 넘어가지 않는다. `실제_...` 값은 자신의 값으로 바꾼다.

현재 자동 배포는 네이티브 실행만 지원한다. Docker를 선택하면 공통 디스크·Cloudflare 준비는 같지만, 서버 실행·백업·자동 시작·CD 단계는 [DOCKER.md](DOCKER.md)의 검증 후 별도로 연결해야 한다. 두 방식을 같은 DB에 동시에 실행하지 않는다.

서비스 데이터는 외장 SSD의 전용 폴더, 암호화 백업은 맥미니 내장 저장소에 둔다. 사용자가 도난 대비를 이번 범위에서 제외했으므로 전체 SSD 암호화·암호화 디스크 이미지·기존 222GB 복사는 설치 조건이 아니다. 현재 macOS 계정으로 진행한다. API 키 암호화, 파일 권한, Access/MFA, 사용자별 접근 제어는 유지한다.

## 1. 지금 확인된 상태

| 항목 | 확인 결과 |
| --- | --- |
| macOS / 아키텍처 | 26.5.1 / arm64 |
| 외장 SSD | `/Volumes/Storage2TB`, APFS, 약 1.8TB 여유 |
| SSD 소유권 / 암호화 | Owners Enabled / Encrypted No — 디스크 암호화는 이번 범위에서 제외 |
| 내장 저장소 | 약 25GiB 여유 — 서비스 데이터만 백업 |
| 컴퓨터 절전 / 전원 복구 | sleep=0 / autorestart=1 |
| 설치된 도구 | Homebrew, uv 0.9.21, gh, Node, pnpm, cloudflared, restic |
| Cloudflare 관리 로그인 | Wrangler OAuth 완료, 배포·VPC 관련 권한으로 제한 |
| GitHub | 공개 유지, 프런트/백엔드 CI 성공, 계정/VPC ID와 Cloudflare 배포 Secret 등록 |
| 자동 배포 | ENABLE_NATIVE_CD=true, ENABLE_FRONTEND_CD=true (각각 실제 배포 성공), ENABLE_PREVIEW_CD=false |

프런트엔드와 API 전달용 Worker는 Cloudflare에, Python 서버·DB·원본 파일은 맥미니에 둔다. 구매 도메인, nginx, 공유기의 80/443/8000 포트 개방은 이 구성에 필요하지 않다.

## 2. 맥미니와 SSD를 먼저 준비

- 시스템 설정에서 macOS 보안 업데이트, 방화벽, 내장 디스크 FileVault를 확인한다. OS 업데이트는 작업 저장 후 진행한다.
- 시스템 설정의 에너지 관련 메뉴에서 화면이 꺼져도 컴퓨터가 잠들지 않게 하고 정전 후 자동 시작을 유지한다. 화면 자체는 꺼져도 된다. 유선 LAN을 권장한다.
- 원격 로그인·화면 공유는 실제 사용할 경우에만 켜고 허용 사용자를 운영자로 제한한다. 공유기 포트 포워딩은 추가하지 않는다.
- 현재 로그인한 macOS 계정으로 진행한다. 데이터·키 생성, launchd, runner 설치를 **모두 같은 사용자**로 한다. 별도 표준 사용자 생성은 이번 설치의 선행 조건이 아니다. 아래 `$HOME`은 현재 사용자의 홈이다.

SSD 소유권은 이미 활성화됐다. 아래 조회에서 `Owners: Enabled`이면 다음 단계로 이동한다. 추후 Disabled인 경우에만 `sudo diskutil enableOwnership /Volumes/Storage2TB`를 실행하며, 디스크 전체에 재귀 chmod/chown을 실행하지 않는다.

```sh
diskutil info /Volumes/Storage2TB
```

`Owners: Enabled`인지 확인한다. Finder의 디스크 정보 → 공유 및 사용 권한 → 이 볼륨에서 소유권 무시가 해제되는 설정이다. 기존 파일 소유권도 다시 적용되므로 다른 프로젝트 접근에 문제가 없는지 확인한다.

디스크 전체 암호화와 기존 파일 이동은 진행하지 않는다. 이력서 원본과 DB는 디스크 암호화로 보호되지 않는 상태이며, 현재 선택한 운영 범위에서 파일 권한과 인증·인가로 접근을 제한한다. API 키와 restic 백업의 암호화는 유지한다.

이 안내의 LaunchAgent는 사용자 로그인 이후 실행되며 로그인 전 무인 복구를 보장하지 않는다. 기존 FileVault 설정을 끄지 않는다. [Apple 절전 설정](https://support.apple.com/guide/mac-help/set-sleep-and-wake-settings-mchle41a6ccd/mac).

## 3. 운영 폴더와 런타임 준비

디스크가 정상 마운트되고 소유권 설정이 끝난 후, 서버 실행 계정의 터미널에서 실행한다. 아래는 `/Volumes/Storage2TB`가 그대로인 경우다. 소유권 활성화 후 볼륨 루트가 root:wheel 소유이면 일반 사용자의 mkdir이 Permission denied로 실패할 수 있다. 서비스 상위 폴더가 아직 없는 최초 설치에서는 다음 한 번만 관리자 권한으로 폴더를 만들고 현재 사용자에게 소유권을 준다. 기존 폴더가 있다면 내용을 확인한 뒤 진행한다. 디스크 전체에 chown/chmod를 실행하지 않는다.

```sh
sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /Volumes/Storage2TB/server/resume-agent
```

이후 하위 폴더 생성은 sudo 없이 진행한다.

```sh
umask 077
mkdir -p /Volumes/Storage2TB/server/resume-agent/data
mkdir -p /Volumes/Storage2TB/server/resume-agent/model-cache
mkdir -p /Volumes/Storage2TB/server/resume-agent/release
mkdir -p /Volumes/Storage2TB/server/resume-agent/backup-staging
mkdir -p "$HOME/.config/resume-agent"
chmod 700 /Volumes/Storage2TB/server/resume-agent
chmod 700 /Volumes/Storage2TB/server/resume-agent/{data,model-cache,release,backup-staging}
chmod 700 "$HOME/.config/resume-agent"
```

실제 확인된 서비스 위치는 `/Volumes/Storage2TB/server/resume-agent`, 배포 폴더 이름은 `release`다. 이미 만든 data/model-cache/release/backup-staging 폴더는 그대로 사용한다.

디스크 확인용 표시 파일은 서비스 폴더가 아닌 SSD 루트에 최초 한 번 만든다. SSD 루트가 root 소유이므로 이 명령에만 sudo를 쓴다. 기존 파일은 덮어쓰지 않으며 다른 설치·앱 실행은 현재 사용자로 진행한다. Python 코드의 첫 줄과 마지막 PY 앞에 공백을 넣지 않는다.

```sh
sudo /usr/bin/python3 - <<'PY'
import os, plistlib, subprocess
from pathlib import Path
os.umask(0o022)
root = Path('/Volumes/Storage2TB')
info = plistlib.loads(subprocess.check_output(['diskutil', 'info', '-plist', str(root)]))
assert info.get('MountPoint') == str(root) and info.get('FilesystemType') == 'apfs'
assert info.get('Internal') is False
marker = root / '.resume-agent-volume'
assert not marker.is_symlink(), '표시 파일이 심볼릭 링크입니다'
if marker.exists():
    assert marker.read_text().strip() == info['VolumeUUID'], '기존 표시와 UUID가 다릅니다'
else:
    with marker.open('x') as stream:
        stream.write(info['VolumeUUID'] + '\n')
print('server.env에 넣을 UUID:', info['VolumeUUID'])
PY
```

아직 없는 도구를 설치하고 Python 3.12를 준비한다. 현재 uv/gh/Node/pnpm은 이미 있으므로 다시 설치할 필요 없다. 전용 사용자를 새로 만들었다면 해당 계정에서도 명령이 보이는지 확인한다.

```sh
brew install cloudflared restic
uv python install 3.12
cloudflared --version
restic version
uv --version
```

서버 환경 파일과 키는 `~/.config/resume-agent/`, DB·원본·모델·실행 코드는 SSD에 둔다. 사용자 개인 Node 설치 경로는 runner 서비스의 PATH에 없을 수 있다. 네이티브 backend job은 Node를 사용하지 않지만 `uv`와 `gh`가 보여야 한다.

## 4. Cloudflare 계정과 GitHub 값 준비

[Cloudflare 대시보드](https://dash.cloudflare.com/)와 GitHub 계정의 MFA를 설정한다. Workers와 Zero Trust는 Free 플랜으로 시작한다. 유료 플랜·R2·Workers AI는 이 설치에 추가하지 않는다.

계정 ID는 Cloudflare 검색(⌘K)에서 `Copy account ID`로 복사한다. [API Tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token → Custom token에서 `resume-agent-github`을 만든다. 대상은 해당 계정 하나, 기본 권한은 Account / Workers Scripts / Edit와 Account / Account Settings / Read다. Global API Key를 사용하지 않는다.

[GitHub Actions 설정](https://github.com/Yelihi/resume-agent/settings/secrets/actions)에 다음을 등록한다.

| 종류 | 이름 | 값 |
| --- | --- | --- |
| Secret | CLOUDFLARE_API_TOKEN | 위 토큰 원문 |
| Variable | CLOUDFLARE_ACCOUNT_ID | 계정 ID |
| Variable | ENABLE_NATIVE_CD | 아직 false 유지 |
| Variable | ENABLE_PREVIEW_CD | 실제 운영 설치에서는 false 유지 가능 |

프리뷰와 달리 운영 배포에는 VPC binding 권한도 필요하다. VPC를 만드는 사용자는 Connectivity Directory Admin, 기존 VPC를 연결하는 배포 사용자는 Connectivity Directory Bind 역할이 필요하다. 현재 사용 중인 계정 토큰은 계정 관리 → 계정 API 토큰 → `resume-agent-github`에서 편집한다. 권한 검색에서 `Connectivity Directory` → `Bind`를 선택해 업데이트하면 기존 GitHub Secret을 그대로 사용할 수 있다. 이 권한 보완 후 실제 GitHub 배포가 성공했다. VPC 권한 오류를 전체 관리자 토큰으로 우회하지 않는다. [VPC 권한 안내](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/).

OpenAI 키, 맥미니 환경 파일 내용, Fernet 키, Tunnel 토큰, 백업 비밀번호는 GitHub에 올리지 않는다. OpenAI 키는 운영 사이트 로그인 후 앱 설정에서 입력한다.

MCP는 편의를 위한 별도 연결이다. Codex에서 이미 서버를 등록했으므로 같은 Mac 터미널에서 `codex mcp login cloudflare`로 OAuth를 완료할 수 있다. MCP 승인으로 GitHub 토큰이 자동 등록되지는 않는다. 아래 수동 설정은 MCP 없이도 가능하다.

## 5. 무료 주소와 로그인 보호를 먼저 구성

Workers & Pages에서 사용할 workers.dev subdomain을 확인한다. 운영 앱 이름은 `resume-agent`이므로 최종 주소는 `https://resume-agent.yelihi19.workers.dev`다. `resume-agent-preview`는 별도의 프리뷰다.

Zero Trust 팀 주소는 `raspy-butterfly-055e.cloudflareaccess.com`이다. Zero Trust → Access controls → Applications에서 Self-hosted 앱을 생성한다. 메뉴명이 Access → Applications인 화면도 있다.

| 항목 | 설정 |
| --- | --- |
| 앱 이름 | resume-agent |
| 보호할 호스트 | resume-agent.yelihi19.workers.dev |
| 경로 | 비워 두어 전체 호스트 보호 |
| 정책 | Allow, Include Emails에 본인 이메일 하나 |
| 세션 | 화면에서 제공되는 6시간 선택 |
| Bypass / Everyone 허용 | 추가하지 않음 |

MFA는 단순히 본인의 Google/GitHub 계정에서 켰다는 것으로 끝내지 않는다. Access에서 실제로 강제되는지 확인한다. 간단한 시작 방법은 이메일 One-time PIN 로그인에 **Access Independent MFA**를 추가하는 것이다. 이메일 OTP만으로 운영하지 않는다.

1. Zero Trust → Access controls → Access settings에서 독립 MFA 방법(TOTP 인증 앱 또는 보안 키)을 허용한다.
2. 해당 앱 Authentication → MFA에서 Custom MFA settings로 인증 애플리케이션을 요구하고 지속 시간을 6시간으로 설정한다. 허용 정책이 Disable MFA로 덮어쓰지 않게 한다.
3. Access settings → Manage your App Launcher → Manage에서 본인 이메일만 허용하는 `resume-owner` 정책과 One-time PIN 로그인 방법을 연결하고 저장한다. App Launcher는 기본적으로 비활성화되어 있어 이 설정이 먼저 필요하다.
4. `https://raspy-butterfly-055e.cloudflareaccess.com/AddMfaDevice`에서 본인 인증 수단을 등록한다. QR 코드·설정 키·인증 코드는 공유하지 않는다.
5. 앱의 Additional settings에서 Application Audience(AUD)를 복사한다. 이 값은 서버의 `CF_ACCESS_AUD`에 들어간다.

Worker가 생성된 뒤에도 같은 호스트 보호와 AUD가 일치하는지 확인한다. Worker별 Access 앱을 추가로 생성하면 적용 우선순위와 AUD가 달라질 수 있으므로 이 가이드에서는 정확한 호스트의 앱 하나를 유지한다. 공개 전에 해당 보호를 구성한다. [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [Independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/).

### 현재 진행 상태 (2026-09-26)

- 사용자 화면에서 Access의 본인 이메일 허용 정책, One-time PIN, 앱별 인증 애플리케이션 MFA(6시간), App Launcher 및 본인 MFA 등록을 확인했다. 사용자가 실제 서비스 로그인 후 화면 표시를 확인했고, 서버 DB에도 본인 활성 계정이 생성되어 인증된 요청의 도착을 확인했다.
- 아래 CI 성공 커밋을 운영 `release`에 설치하고 `current` 연결을 생성했다. 붙여넣기로 생긴 폴더 이름의 줄바꿈·공백을 수정하고 가상환경을 재생성했다. 이전 환경은 해당 backend의 `.venv-before-path-fix`에 보존했다.
- `/Users/yelihi/.config/resume-agent/server.env`와 `fernet.key`를 최초 생성했다. 두 파일은 권한 600이며 SSD·경로·키 유효성 검사를 통과했다. 기존 키를 재생성하거나 덮어쓰지 않는다.
- 서버 DB에 본인 이메일을 초대했다. 임시 로컬 실행에서 `/health` 200, 미인증 `/api/account` 401, `/docs` 404, `127.0.0.1:8000` 바인딩을 확인한 뒤 시험 프로세스를 종료했다.
- 수동 백엔드·Tunnel을 종료하고 app/tunnel LaunchAgent로 전환했다. 둘 다 running이며 backend health 200, Tunnel ready 200, 미인증 API 401, docs 404를 확인했다. Tunnel 토큰은 `~/.config/resume-agent/tunnel.token`에 권한 600으로 보관한다. macOS 로그인 후 자동 시작하며 실제 재부팅 시험은 아직이다.
- Cloudflare 계정 ID: `d66f507ce982f13b411da99173f23491`. Tunnel ID: `5117f665-bf37-4bb2-811c-2124bdc4cd75`. HTTP VPC Service `resume-agent-api` ID: `01a0dcda-2086-79b3-a43c-73937daf7754`, 대상은 이 Tunnel의 `127.0.0.1:8000`이다.
- 검증된 커밋과 frontend/deploy 소스가 같은지 확인한 뒤 운영 빌드와 dry-run을 통과하고 `https://resume-agent.yelihi19.workers.dev`에 배포했다. Worker 버전은 `1701db0e-0aa4-4211-8574-0b4095010fcf`다. 실제 배포 설정은 Git에서 제외된 `deploy/cloudflare/.wrangler/production.json`에 있다.
- 미인증 브라우저 요청으로 `/`, `/api/account`, 정적 CSS 모두 올바른 Access 팀 로그인으로 이동하는 것을 확인했다. 사용자 로그인 후 서버 계정 생성도 확인했다. 실제 자료 업로드·검토·계정 격리 시험은 아직이다.
- 내장 저장소의 restic 저장소를 초기화하고 현재 DB를 백업했다. `restic check --read-data`, 별도 외장 임시 폴더로 복원, manifest/SQLite 무결성, 복원한 본인 계정·초대 확인을 통과했다. 당시 실제 첨부 파일은 없어 첨부 파일 복원은 아직 실자료로 시험하지 않았다. 임시 복원 폴더는 검사 후 정리했다.
- `backup.env`, `restic-password`는 `~/.config/resume-agent`에 권한 600으로 생성했다. 기존 비밀번호를 재생성하지 않는다. 내장 여유 공간은 약 24GiB이며 자동 용량 상한은 없다.
- 새벽 4시 백업 LaunchAgent를 등록했고 실제 launchd 실행이 종료 코드 0으로 성공했다. 최근 확인 시각은 2026-09-26 17:47:50 KST이며 `backup-status.json`의 error는 null이다. 내장 로컬 암호화 백업으로 클라우드 저장 요금은 없다.
- `/bin/sh`의 외장 볼륨 TCC 차단은 전용 앱 `~/Applications/Resume Agent Service.app`의 제거 가능한 볼륨 접근 허용으로 해결했다. 소스는 `~/.config/resume-agent/launcher.swift`, 실행 파일은 `Contents/MacOS/ResumeAgentService`이며 `app` 또는 `backup`만 받아 기존 스크립트를 실행한다. app/backup plist는 각각 이 실행 파일과 작업 인수를 사용한다. 앱 서명·인수 거부·launchd 실행 검사를 통과했다. 아래의 직접 `/bin/sh` LaunchAgent 생성 예시로 현재 설치를 덮어쓰지 않는다.
- 본인 내부 사용자 ID를 `RESUME_OPERATOR_ID`에 등록하고 서버에 반영했다. 운영 CD는 비활성 상태다. 이후 release.py를 수정해 전용 앱 구성을 지원했다. 첫 CD에서 확인한 자식 서버 잔류 문제도 service-launcher.swift의 exec 방식으로 수정했으며, 실제 프로세스 재시작/PID/health 확인을 통과했다. OpenAI API 키 등록이나 유료 AI 호출은 하지 않았다.

## 6. 검증된 최초 서버 코드를 설치

개발 중 파일을 그대로 서비스로 실행하지 않고, CI가 성공한 커밋을 별도 releases에 설치한다. 현재 검증된 커밋은 `6be063bf437629ecc4d33598a312bb3138665880`이다. 이후 코드를 변경했다면 새 CI 성공 SHA를 사용한다.

아래 명령은 최초 설치용이다. 같은 release 디렉터리나 `current`가 이미 있으면 덮어쓰지 말고 기존 설치부터 확인한다. 기존 미커밋 개발 파일은 변경하지 않는다.

```sh
cd /Volumes/Storage2TB/Projects/github/resume-agent
RESUME_INSTALL_SHA=6be063bf437629ecc4d33598a312bb3138665880
RESUME_INITIAL_RELEASE="/Volumes/Storage2TB/server/resume-agent/release/$RESUME_INSTALL_SHA"
mkdir -m 700 "$RESUME_INITIAL_RELEASE" && \
git archive "$RESUME_INSTALL_SHA" backend deploy | tar -x -C "$RESUME_INITIAL_RELEASE"
UV_CACHE_DIR=/Volumes/Storage2TB/server/resume-agent/model-cache/uv \
  uv sync --frozen --python 3.12 --project "$RESUME_INITIAL_RELEASE/backend"
ln -s "$RESUME_INITIAL_RELEASE" /Volumes/Storage2TB/server/resume-agent/release/current
```

앞 단계 명령이 실패한 경우 후속 명령을 실행하지 않는다. 다른 macOS 사용자를 선택해 개발 저장소에 접근할 수 없다면 그 사용자의 별도 checkout으로 같은 커밋을 받아 archive한다.

## 7. 개인 키와 server.env 작성

최초 API 키 암호화 키를 만든다. 기존 키는 덮어쓰지 않는다. 이 키는 OpenAI 키와 다르다.

```sh
/Volumes/Storage2TB/server/resume-agent/release/current/backend/.venv/bin/python - <<'PY'
import os
from pathlib import Path
from cryptography.fernet import Fernet
os.umask(0o077)
path = Path.home() / '.config/resume-agent/fernet.key'
with path.open('xb') as stream:
    stream.write(Fernet.generate_key())
print('암호화 키 생성 완료. 내용은 출력하지 않았습니다.')
PY
nano "$HOME/.config/resume-agent/server.env"
```

아래 내용을 넣고 실제 UUID, 사용자 홈, Cloudflare 주소/AUD를 채운다. nano 저장은 Ctrl+O → Enter, 종료는 Ctrl+X다. 경로는 절대 경로를 쓴다. `RESUME_OPERATOR_ID`는 첫 로그인 뒤 설정한다.

```sh
RESUME_DEPLOYMENT_MODE=server
RESUME_STORAGE_ROOT='/Volumes/Storage2TB'
RESUME_STORAGE_UUID='실제_Volume_UUID'
RESUME_DATA_DIR='/Volumes/Storage2TB/server/resume-agent/data'
RESUME_MODEL_CACHE='/Volumes/Storage2TB/server/resume-agent/model-cache'
RESUME_KEY_FILE='/Users/실행사용자/.config/resume-agent/fernet.key'
RESUME_PUBLIC_ORIGIN='https://resume-agent.yelihi19.workers.dev'
CF_ACCESS_TEAM_DOMAIN='raspy-butterfly-055e.cloudflareaccess.com'
CF_ACCESS_AUD='1163ac085938748b937b86a699c62e78136c10b9bdccf14463ad79fa21d0dec4'
RESUME_ACCESS_ASSERTION_HEADER='x-resume-user-jwt'
OPENAI_MODEL='gpt-5.4-mini'
RESUME_OPERATOR_ID=''
```

```sh
chmod 600 "$HOME/.config/resume-agent/server.env"
/bin/sh /Volumes/Storage2TB/server/resume-agent/release/current/deploy/run-app.sh \
  "$HOME/.config/resume-agent/server.env" check
```

성공 기준은 `SSD, cache, and key permissions checks passed`다. 이 검사는 실제 로그인·AI 연결 검사가 아니다. Fernet 키 복구 사본은 운영 SSD와 별개의 안전한 장소에 보관한다. 잃어버리면 DB에 저장된 사용자 API 키를 복호화할 수 없다.

## 8. 본인을 초대하고 서버를 수동 실행

```sh
cd /Volumes/Storage2TB/server/resume-agent/release/current/backend
.venv/bin/python -m scripts.manage_users \
  --data-dir /Volumes/Storage2TB/server/resume-agent/data invite 실제이메일@example.com
/bin/sh ../deploy/run-app.sh "$HOME/.config/resume-agent/server.env"
```

서버 터미널을 열어둔 채 다른 터미널에서 확인한다.

```sh
curl --fail http://127.0.0.1:8000/health
curl -i http://127.0.0.1:8000/api/account
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

health는 `{"status":"ok"}`, 인증 없이 부른 `/api/account`는 거부되어야 한다. 리슨 주소는 `127.0.0.1:8000`이어야 한다. LAN 전체에 열리는 `*:8000`이나 `0.0.0.0`으로 바꾸지 않는다. 이미 다른 앱이 8000을 사용하면 임의로 종료하지 말고 해당 프로세스부터 확인한다.

## 9. Tunnel과 VPC 연결

Cloudflare Zero Trust의 Networks → Connectors/Cloudflare Tunnels에서 remotely-managed cloudflared Tunnel을 만들고 이름을 `resume-agent-mac-mini`로 정한다. 화면에서 Tunnel UUID와 connector 토큰을 확인한다. 토큰이 포함된 전체 명령을 채팅이나 셸 기록에 붙이지 않는다. Public hostname이나 공개 route는 추가하지 않는다.

```sh
umask 077
nano "$HOME/.config/resume-agent/tunnel.token"
chmod 600 "$HOME/.config/resume-agent/tunnel.token"
cloudflared tunnel --no-autoupdate --protocol quic run \
  --token-file "$HOME/.config/resume-agent/tunnel.token"
```

nano에는 토큰 원문 한 줄만 넣는다. 정상 연결되면 대시보드의 Tunnel이 Healthy가 된다. 이 터미널도 유지한다. Workers VPC에는 cloudflared 2025.7.0 이상과 outbound UDP 7844가 필요하다. 외부에서 들어오는 공유기 포트를 열라는 뜻이 아니다. [공식 Tunnel 조건](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/).

다른 터미널에서 다음으로 관리용 Wrangler에 로그인하고 HTTP VPC Service를 만든다. 이 로그인은 MCP 로그인과 별개다. 이미 같은 VPC Service를 만들었다면 새로 만들지 말고 기존 ID를 사용한다.

```sh
cd /Volumes/Storage2TB/Projects/github/resume-agent
npm ci --ignore-scripts --prefix deploy/cloudflare
npm exec --prefix deploy/cloudflare -- wrangler login
npm exec --prefix deploy/cloudflare -- wrangler vpc service create resume-agent-api \
  --type http --tunnel-id 실제_TUNNEL_UUID --ipv4 127.0.0.1 --http-port 8000
```

명령 결과의 **Service ID**를 기록한다. Tunnel ID와 다른 값이다. 생성 결과가 지정한 Tunnel, `127.0.0.1`, HTTP 8000을 가리키는지 확인한다. 전체 사설 네트워크를 여는 VPC Network는 필요 없다. [VPC 명령](https://developers.cloudflare.com/workers-vpc/reference/wrangler-commands/).

## 10. 운영 프런트엔드를 처음 배포

이 단계는 GitHub backend CD를 켜기 전의 수동 첫 배포다. Cloudflare Access 앱, 로컬 서버, Tunnel, VPC가 준비되어 있어야 한다. 현재 checkout의 frontend/deploy 코드가 위 CI 성공 커밋과 같은지 확인한다. 다르면 그 변경을 먼저 CI로 검증한다.

```sh
cd /Volumes/Storage2TB/Projects/github/resume-agent
git diff 6be063bf437629ecc4d33598a312bb3138665880 -- frontend deploy/cloudflare
pnpm --dir frontend install --frozen-lockfile
unset VITE_PREVIEW_MODE
pnpm --dir frontend build
```

운영 빌드에서는 `VITE_PREVIEW_MODE`를 설정하지 않는다. 로컬 환경에 이미 설정했다면 먼저 `unset VITE_PREVIEW_MODE`를 실행한다. 아래는 저장소 설정을 직접 바꾸지 않고 Git에서 제외된 `.wrangler` 아래에 실제 배포 사본을 만드는 명령이다.

```sh
export RESUME_VPC_SERVICE_ID='실제_Service_UUID'
python3 - <<'PY'
import json, os, uuid
from pathlib import Path
root = Path.cwd()
service_id = str(uuid.UUID(os.environ['RESUME_VPC_SERVICE_ID']))
config = json.loads((root / 'deploy/cloudflare/wrangler.jsonc').read_text())
config['main'] = str(root / 'deploy/cloudflare/worker.mjs')
config['assets']['directory'] = str(root / 'frontend/dist')
config['workers_dev'] = True
config['vpc_services'] = [{'binding': 'RESUME_API', 'service_id': service_id}]
destination = root / 'deploy/cloudflare/.wrangler/production.json'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(config, indent=2) + '\n')
print(destination)
PY
npm exec --prefix deploy/cloudflare -- wrangler deploy \
  --config deploy/cloudflare/.wrangler/production.json
```

배포된 주소가 `RESUME_PUBLIC_ORIGIN`과 같아야 한다. 시크릿 창으로 먼저 접속해 로그인/MFA 요구를 확인한다. 서버 DB의 초대와 Access의 허용 이메일이 모두 일치해야 앱에 들어갈 수 있다. 프런트엔드만 로그인 성공하고 `/api/account`가 403이면 team domain/AUD/초대 이메일을 확인한다.

## 11. 서버와 Tunnel을 로그인 후 자동 시작

현재 Mac에는 전용 앱을 사용하는 app/backup 서비스와 tunnel 서비스가 이미 등록되어 있다. 아래 최초 설치 예시는 실행하지 않는다. 실제 설정은 `~/Library/LaunchAgents/com.resume-agent.*.plist`에 있다.

앞서 수동으로 실행한 서버와 cloudflared를 각각 Ctrl+C로 끝낸 뒤 진행한다. 기존 다른 서비스가 이미 설치돼 있으면 중복 등록하지 않는다. 다음은 현재 사용자용 app/tunnel plist를 최초 생성한다.

```sh
python3 - <<'PY'
import os, plistlib, shutil
from pathlib import Path
os.umask(0o077)
release = Path('/Volumes/Storage2TB/server/resume-agent/release/current')
private = Path.home() / '.config/resume-agent'
agents = Path.home() / 'Library/LaunchAgents'
agents.mkdir(parents=True, exist_ok=True)
binary = shutil.which('cloudflared')
assert binary, 'cloudflared 설치를 확인하세요'
for name, arguments in {
    'app': ['/bin/sh', str(release / 'deploy/run-app.sh'), str(private / 'server.env')],
    'tunnel': [binary, 'tunnel', '--no-autoupdate', '--protocol', 'quic', 'run', '--token-file', str(private / 'tunnel.token')],
}.items():
    content = plistlib.loads((release / f'deploy/{name}.plist.template').read_bytes())
    content['ProgramArguments'] = arguments
    # launchd는 대화형 셸 PATH를 물려받지 않는다.
    content['EnvironmentVariables'] = {'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}
    with (agents / f'com.resume-agent.{name}.plist').open('xb') as stream:
        plistlib.dump(content, stream)
PY
plutil -lint "$HOME/Library/LaunchAgents/com.resume-agent.app.plist"
plutil -lint "$HOME/Library/LaunchAgents/com.resume-agent.tunnel.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.resume-agent.app.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.resume-agent.tunnel.plist"
curl --fail http://127.0.0.1:8000/health
```

macOS에서 외장 볼륨 접근 권한 창이 뜨면 필요한 실행 파일에 한정해 허용한다. 전체 디스크 접근 권한을 무조건 모든 도구에 주지 않는다. 실패 시 `launchctl print "gui/$(id -u)/com.resume-agent.app"`와 로컬 health를 확인한다.

화면 잠금은 가능하지만 로그아웃하면 사용자 LaunchAgent가 종료된다. FileVault를 끄거나 자동 로그인을 켜서 무인 부팅을 흉내 내지 않는다. 처음 운영은 재부팅 후 직접 로그인하고 SSD가 마운트된 상태에서 정상 복구되는지 확인하는 방식이다.

## 12. 로컬 백업과 복원 시험

백업은 맥미니 **내장 저장소**의 `~/Library/Application Support/resume-agent-backup/restic`에 둔다. 외장 SSD와 물리 장치가 다르므로 외장 SSD 고장에 대비할 수 있다. 기존 222GB 전체가 아니라 이 서비스의 DB와 원본 파일만 백업한다. 맥미니와 외장 SSD의 동시 손실이나 실행 계정 침해에 대비한 외부 백업은 이번 범위 밖이다.

현재 내장 여유 공간은 약 25GiB다. 아래 `df`로 실제 백업 경로의 장치와 여유 공간을 확인한다. 홈이 외장 SSD나 네트워크로 옮겨져 있다면 이 경로를 그대로 사용하지 않는다. 내장 용량을 모두 백업에 할당하지 않는다. 현재 백업 코드에는 총 저장량 상한이나 최소 여유 공간 자동 보호가 없으므로 운영 중 백업 크기와 여유 공간을 확인해야 한다. restic 보관 개수 제한은 용량 상한이 아니다.

```sh
umask 077
mkdir -p "$HOME/Library/Application Support/resume-agent-backup/restic"
chmod 700 "$HOME/Library/Application Support/resume-agent-backup"
chmod 700 "$HOME/Library/Application Support/resume-agent-backup/restic"
df -h "$HOME/Library/Application Support/resume-agent-backup/restic"
umask 077
python3 - <<'PY'
import os, secrets
from pathlib import Path
os.umask(0o077)
with (Path.home() / '.config/resume-agent/restic-password').open('x') as stream:
    stream.write(secrets.token_urlsafe(32) + '\n')
PY
chmod 600 "$HOME/.config/resume-agent/restic-password"
nano "$HOME/.config/resume-agent/backup.env"
```

비밀번호 생성은 **파일이 아직 없을 때 최초 한 번만** 한다. 기존 비밀번호를 바꾸거나 잃으면 백업을 열 수 없다. 파일 내용 예:

```sh
RESUME_BACKUP_MODE=local
RESUME_DATA_DIR='/Volumes/Storage2TB/server/resume-agent/data'
RESUME_BACKUP_STAGING_DIR='/Volumes/Storage2TB/server/resume-agent/backup-staging'
RESTIC_BIN='/opt/homebrew/bin/restic'
RESTIC_REPOSITORY='/Users/실행사용자/Library/Application Support/resume-agent-backup/restic'
RESTIC_PASSWORD_FILE='/Users/실행사용자/.config/resume-agent/restic-password'
```

`command -v restic` 결과가 다르면 RESTIC_BIN을 수정한다. 초기화·백업·복원을 순서대로 확인한다.

```sh
chmod 600 "$HOME/.config/resume-agent/backup.env"
set -a
. "$HOME/.config/resume-agent/backup.env"
set +a
restic init
/bin/sh /Volumes/Storage2TB/server/resume-agent/release/current/deploy/run-backup.sh \
  "$HOME/.config/resume-agent/backup.env"
restic check
restic snapshots --tag resume-agent
RESUME_RESTORE_TEST=$(mktemp -d /Volumes/Storage2TB/server/resume-agent/restore-test.XXXXXX)
restic restore latest --tag resume-agent --target "$RESUME_RESTORE_TEST"
find "$RESUME_RESTORE_TEST" -name manifest.json -print
```

출력된 manifest.json이 있는 디렉터리를 아래에 넣는다. 실제 운영 데이터 경로에 덮어쓰지 않는다.

```sh
/Volumes/Storage2TB/server/resume-agent/release/current/backend/.venv/bin/python \
  /Volumes/Storage2TB/server/resume-agent/release/current/backend/scripts/backup.py \
  --verify '/실제/복원된/snapshot/디렉터리'
```

검증 성공 후 `deploy/backup.plist.template`을 `~/Library/LaunchAgents/com.resume-agent.backup.plist`에 복사한다. `__REPO_PATH__`는 `/Volumes/Storage2TB/server/resume-agent/release/current`, 환경 파일은 개인 backup.env의 실제 절대 경로, 시각은 예를 들어 Hour=4, Minute=0으로 치환한다. app plist처럼 PATH에 `/opt/homebrew/bin`을 포함한다. `plutil -lint` 통과 후 아래로 등록한다.

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.resume-agent.backup.plist"
```

복구 비밀번호와 Fernet 키는 운영 맥미니·SSD 밖에도 안전하게 보관한다. R2나 원격 유료 저장소는 사용하지 않는다. 내장 로컬 백업은 클라우드 과금이 없지만 용량 부족과 백업 실패는 확인해야 한다. [restic 저장소](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html), [복원](https://restic.readthedocs.io/en/stable/050_restore.html).

## 13. 실제 검토와 계정 격리 시험

1. 외부 네트워크(휴대폰 LTE/5G 등)에서 운영 주소에 접속한다.
2. 로그인/MFA → 본인 초대 확인 → 설정에서 개인 OpenAI 키 등록.
3. 가상 텍스트 이력서부터 검토한다. 여기부터 실제 OpenAI 비용이 발생한다.
4. 새로고침·브라우저 닫기 후 결과가 보존되는지 확인한다.
5. 텍스트 PDF → DOCX → 한국어 이미지/스캔 PDF 순서로 파일 처리와 OCR을 확인한다.
6. 별도 시험 계정을 Access 정책과 서버 DB에 초대하고 계정 간 자료·원본·검토를 볼 수 없는지 확인한다.
7. 시험 계정을 disable/revoke한 뒤 새 요청·진행 작업이 차단되는지 확인한다. Access 허용 정책과 기존 세션도 철회한다.
8. 백업이 실제 성공한 뒤 서버 재시작·맥미니 재부팅 복구를 확인한다. 쓰기 중인 SSD를 뽑는 시험은 하지 않는다.

첫 로그인 후 서버 사용자 목록에서 본인의 내부 ID를 찾아 `server.env`의 `RESUME_OPERATOR_ID`에 넣고 app을 재시작하면 백업 상태를 조회할 수 있다. 이메일을 넣지 않는다.

```sh
cd /Volumes/Storage2TB/server/resume-agent/release/current/backend
.venv/bin/python -m scripts.manage_users --data-dir /Volumes/Storage2TB/server/resume-agent/data list
# server.env 수정 후:
launchctl kickstart -k "gui/$(id -u)/com.resume-agent.app"
```

## 14. GitHub 자동 배포 연결 (공개 범위 유지)

2026-09-26 후속 작업에서 기존 private/self-hosted runner 절차를 변경했다. 저장소 공개 범위를 바꾸거나 운영 Mac에 Actions runner를 등록하지 않는다. 프런트·백엔드 workflow를 분리하고, Mac이 검증된 GitHub 배포 요청을 받아 기존 백업·서버 교체를 수행한다. 상세 구성·설정값·실패 복구는 [CI_CD.md](CI_CD.md)를 따른다.

`Resume Agent Deploy.app`과 `com.resume-agent.deploy`는 배포 감시 전용이다. 기존 app/tunnel/backup LaunchAgent와 키는 그대로 둔다. macOS에서 새 배포 앱의 제거 가능한 볼륨 접근을 허용하고 GitHub CLI 인증이 유효한지 확인한다. GitHub의 Cloudflare 배포 Secret 준비 전에는 `ENABLE_FRONTEND_CD=false`를 유지한다.

처음에는 두 플래그를 false로 둔 채 새 workflow의 CI를 통과시킨다. Mac 감시·백업 복원 검사 후 백엔드를 켜고 실제 새 SHA의 백업·서버 교체·health·GitHub 성공 보고를 확인한다. 프런트는 토큰/VPC 권한을 준비한 뒤 켜서 확인한다. 이후 해당 경로의 main push가 각각 자동 배포된다.

## 15. 운영 완료 기준과 문제 위치

| 증상 | 먼저 볼 곳 |
| --- | --- |
| SSD 검사 실패 | 마운트·UUID·표시 파일·소유권·700/600 권한 |
| 로컬 health 실패 | app 실행 오류·8000 포트 충돌·server.env |
| Tunnel Offline | cloudflared·토큰 파일·outbound QUIC 7844 |
| 로그인 없이 화면 표시 | Access 호스트·정책·적용 우선순위 |
| 로그인 뒤 API 403 | AUD·team domain·서버 초대·계정 정지 |
| API 502/503 | Tunnel·VPC Service의 IP/port·서버 상태 |
| backend job skipped | ENABLE_NATIVE_CD·main 여부·변경 경로 |
| backend job 대기/시간 초과 | deploy LaunchAgent·Mac 로그인·외장 접근 권한·gh 인증 |
| 배포 전 백업 실패 | 내장 백업 경로·restic 암호·남은 공간 |

완료는 URL이 열리는 것만으로 판단하지 않는다. 인증·초대 철회·계정 격리·원본 보존·실제 백업 복원·재부팅 복구까지 확인한 후 지인을 초대한다. 계정·터널·서버 설치와 예약 백업은 완료했으며, 실제 이력서 검토·첨부 복원·계정 격리·재부팅·운영 CD 검증은 남아 있다.

### 후속 자동 배포 검증

2026-09-26 main push `2162a10`의 백엔드 CI/CD가 성공했다. 암호화 백업 → 새 release 교체 → launchd 서버 시작 → health 및 GitHub 성공 보고를 확인했다. 마지막 백업 성공은 18:48:13 KST다. 프런트 CD도 활성화했으며 main push `914c39d`의 CI 통과 후 VPC 권한 오류 10196을 기존 토큰의 Bind 권한 추가로 해결했다. 동일 실행을 재시도해 19:34 KST Cloudflare 게시와 운영 버전 100% 적용을 확인했다. 백엔드 release와 PID는 유지됐다. 실사용 로그인/개인 API 키/AI 검토/앱 첨부 및 실제 재부팅 검증은 남아 있다. 가상 첨부의 별도 restic 저장·복원 해시 검사는 통과했다. 현재 상태는 OPERATIONS_GUIDE.md를 우선한다.
