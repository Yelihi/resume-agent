# M4 / 16 GB 맥미니의 선택적 Docker 백엔드

프런트엔드는 Cloudflare 또는 Vercel에 두고, 이 Compose는 맥미니의 백엔드만 실행한다. `cloudflared`는 기존 macOS 서비스로 유지하며 `127.0.0.1:8000`에 연결한다. 프런트엔드와 API의 도메인·Access·프록시 설정은 [배포 절차](README.md)를 함께 적용한다. Docker 사용 자체가 인증이나 백업을 대신하지 않는다.

## 확인한 범위

2026-09-24 기준 잠금 파일의 PaddlePaddle **3.2.1 / Python 3.12 / Linux ARM64** wheel이 [공식 CPU 패키지 인덱스](https://www.paddlepaddle.org.cn/packages/stable/cpu/paddlepaddle/)에 존재한다. 의존성 버전을 바꾸지 않았으며 x86 에뮬레이션을 자동 사용하지 않는다. Dockerfile은 네이티브 `linux/arm64` 빌드와 wheel 설치만 허용한다. 이미지 안에서 실행하는 `paddle.utils.run_check()`는 실제 장비 확인 단계다.

현재 작업 환경은 Docker CLI 29.1.3 / Compose 2.40.3이며 Docker daemon이 실행 중이지 않았다. 따라서 Compose 구문과 누락된 SSD 차단만 검사했으며, **이미지 빌드·Linux OCR·DB 파일 잠금·메모리·재부팅 복구를 통과했다고 볼 수 없다.** Docker를 시작하거나 기존 VM 설정을 변경하지 않았다.

## 외장 SSD 준비

DB·원본·모델 캐시는 로컬 **외장 APFS 볼륨**의 서로 다른 디렉터리를 사용한다. SMB/NFS/NAS와 ExFAT은 이 템플릿 대상이 아니다. 볼륨의 실제 마운트 경로, UUID, APFS 여부, 외장 여부를 확인한다.

```sh
diskutil info /Volumes/YOUR_SSD
```

볼륨이 정상 마운트된 것을 운영자가 확인한 뒤 `resume-agent/data`, `resume-agent/model-cache`를 만들고 현재 실행 사용자가 소유하도록 준비한다. 두 디렉터리는 `chmod 700`이어야 하며 저장소 디렉터리 아래에는 만들지 않는다. 볼륨 루트의 `.resume-agent-volume` 파일에는 위 명령의 Volume UUID 한 줄을 기록한다. 네이티브 앱과 Docker는 공통 `check-storage.py`로 마운트·소유권·권한을 확인하며 디렉터리나 표시 파일을 대신 생성하지 않는다. SSD가 빠졌거나 다른 디스크가 같은 이름으로 마운트되면 시작을 거부한다.

키는 기존 서버에서 사용한 **동일한 Fernet 키**를 유지한다. 키 파일은 데이터·모델 캐시 디렉터리 밖의 소유자 전용 `0600` 파일이어야 한다. 컨테이너에는 해당 파일 하나만 읽기 전용으로 연결한다. 현재 macOS UID/GID로 이미지를 빌드하고 실행해 앱의 키 소유권 검사를 유지한다. 최초 설치의 키 생성·별도 복구 사본 절차는 [배포 절차](README.md)를 따른다.

Git 밖의 `0600` 개인 환경 파일 예:

```sh
RESUME_STORAGE_ROOT='/Volumes/YOUR_SSD'
RESUME_STORAGE_UUID='YOUR_ACTUAL_VOLUME_UUID'
RESUME_DATA_DIR='/Volumes/YOUR_SSD/resume-agent/data'
RESUME_MODEL_CACHE='/Volumes/YOUR_SSD/resume-agent/model-cache'
RESUME_KEY_FILE='/ABSOLUTE_PRIVATE/fernet.key'
RESUME_PUBLIC_ORIGIN='https://YOUR_FRONTEND_HOST'
CF_ACCESS_TEAM_DOMAIN='YOUR_TEAM.cloudflareaccess.com'
CF_ACCESS_AUD='YOUR_APPLICATION_AUD'
RESUME_ACCESS_ASSERTION_HEADER='x-resume-user-jwt'
OPENAI_MODEL='gpt-5.4-mini'
RESUME_OPERATOR_ID='YOUR_INTERNAL_USER_ID'
RESUME_CONTAINER_MEMORY='6g'
```

`RESUME_CONTAINER_UID/GID`는 스크립트가 현재 사용자 값으로 채운다. `RESUME_ACCESS_ASSERTION_HEADER` 기본값은 Worker가 전달한 사용자 JWT용 `x-resume-user-jwt`다. Worker 없이 Access를 직접 연결하는 별도 구성을 검증할 때만 `cf-access-jwt-assertion`으로 바꾼다. 운영자 OpenAI 키는 컨테이너 환경에 전달하지 않는다. 이미지·빌드 캐시까지 SSD에 두려면 Docker Desktop의 **Settings → Resources → Advanced → Disk image location**을 해당 SSD로 옮겨야 한다. DB bind mount만 지정해서는 Docker의 이미지 저장 위치가 바뀌지 않는다. 기존 디스크 이미지 이동은 Docker UI 절차로 수행하며 이 스크립트는 설정을 수정하지 않는다. [Docker Desktop 설정](https://docs.docker.com/desktop/settings-and-maintenance/settings/).

## 검사와 실행

Docker Desktop의 ARM64 Linux VM이 준비된 상태에서 다음을 사용한다. `up`은 빌드 후 키 권한·설정·Paddle CPU 자체 검사를 거쳐 앱을 실행하며, 유료 AI 요청을 보내지 않는다.

```sh
/bin/sh deploy/run-containers.sh --self-test
/bin/sh deploy/run-containers.sh /ABSOLUTE_PRIVATE/server.env check
/bin/sh deploy/run-containers.sh /ABSOLUTE_PRIVATE/server.env build
/bin/sh deploy/run-containers.sh /ABSOLUTE_PRIVATE/server.env up
/bin/sh deploy/run-containers.sh /ABSOLUTE_PRIVATE/server.env ps
```

시작 시 별도 OCR 모델 다운로드가 발생할 수 있으며 캐시는 외장 SSD에 저장된다. 서비스에 실제 한국어 이미지·스캔 PDF를 넣어 추출을 확인한다. `docker stats --no-stream`으로 메모리·CPU를 측정하고 재시작 뒤 모델 캐시 재사용도 확인한다. 텍스트 PDF, DOCX, 업로드 원본 다운로드, 두 사용자 격리, SSE, 재시작 후 중단 기록을 검사한다.

기본 한도는 worker **1**, 컨테이너 **6 GiB / 4 CPU**, 공유 메모리 **256 MiB**, 임시 파일 **512 MiB**다. 16 GB 전체를 컨테이너에 주지 않기 위한 초기 보호 한도이며 성능 측정 결과가 아니다. Docker VM 자체 메모리도 컨테이너와 VM 오버헤드를 수용해야 한다. 모델 첫 로딩과 큰 스캔 PDF의 최대 메모리를 확인한 뒤 `RESUME_CONTAINER_MEMORY`를 조정한다. 메모리 부족 종료 시 검토는 자동 유료 재실행하지 않고 앱의 재시작 복구로 표시한다.

컨테이너는 비루트, 읽기 전용 루트 파일시스템, 모든 Linux capability 제거, `no-new-privileges`를 사용한다. 쓰기 가능한 호스트 경로는 지정한 데이터·모델 캐시뿐이다. Docker 소켓이나 전체 홈 디렉터리를 연결하지 않는다. 원본은 정적 공개 디렉터리가 아니며 다운로드 API가 소유권을 검사한다. 호스트 포트는 loopback에만 공개한다. `create_host_path: false`로 없는 SSD 경로 자동 생성을 차단한다. [Compose 서비스 설정](https://docs.docker.com/reference/compose-file/services/), [bind mount 동작](https://docs.docker.com/engine/storage/bind-mounts/).

`restart: "no"`를 사용하므로 호스트 재부팅 후 Docker가 앱을 자동으로 시작하지 않는다. SSD 확인을 우회하는 자동 시작을 막기 위한 선택이다. 로그인·암호화 디스크 잠금 해제·Docker 기동이 끝난 뒤 같은 스크립트의 `up`을 실행한다. SSD는 사용 중 분리하지 않으며 안전 제거 전 `down`으로 백엔드를 중지한다.

## SQLite와 백업

SQLite WAL은 공유 메모리와 파일 잠금이 필요하므로 모든 접근 프로세스가 같은 호스트에서 실행되어야 한다. Docker Desktop의 Linux VM과 macOS의 Python을 **실행 중인 같은 DB에 동시에 연결하지 않는다.** APFS bind mount도 Docker의 파일 공유 계층을 통하므로 실제 장비에서 WAL 동시쓰기·재시작·무결성·복구를 검증해야 한다. [SQLite WAL 제약](https://sqlite.org/wal.html).

이 최소 Docker 템플릿은 restic·R2 자격증명을 컨테이너에 연결하지 않는다. 기존 macOS 백업 스크립트를 쓰려면 백업 전체가 끝날 때까지 백엔드 컨테이너를 중지한다. 자동 백업 시간에 이 중지를 보장하지 못하면 기존 호스트 백업 작업을 Docker DB에 연결해서는 안 된다.

```sh
/bin/sh deploy/run-containers.sh /ABSOLUTE_PRIVATE/server.env down
/bin/sh deploy/run-backup.sh /ABSOLUTE_PRIVATE/backup.env
# 백업 결과를 확인한 뒤에만 재시작한다.
/bin/sh deploy/run-containers.sh /ABSOLUTE_PRIVATE/server.env up
```

백업 준비·검증은 단순 DB 파일 복사가 아니라 기존 SQLite backup API와 파일 manifest 절차를 사용한다. 무중단 자동 백업이 필요하면 동일 Linux VM 안에서 실행하는 별도 백업 작업과 최소 자격증명 마운트를 추가하고 빈 디렉터리 복원까지 검증한 뒤 전환한다. 이 검증 전에는 현재 macOS 네이티브 백엔드 운영 절차가 더 단순하다.
