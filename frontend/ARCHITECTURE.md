# 프런트엔드 아키텍처

2026-09-11 기준. 엔티티와 포트를 중심으로 책임과 의존 방향을 정의한다.

## Domain

| 폴더 | 엔티티 및 계약 |
| --- | --- |
| `domain/context` | Context: 작업 공간 이름·현재 버전·검토·의견 |
| `domain/resume` | ResumeVersion, ResumeInput, 문서·페이지·줄·추출 품질 값, ResumeGateway, 입력 검증 정책 |
| `domain/material` | Material, MaterialVersion, ContextMaterial 연결, MaterialGateway |
| `domain/review` | Review, SuggestionEntry, ReviewMaterial 연결, PendingRun, ReviewGateway, 버전에 고정된 자료 요약 계산 |
| `domain/workspace` | Workspace 집합과 WorkspaceRepository 포트, 기능별 API 포트의 조합 |
| `domain/shared` | 공통 오류 계약과 사용자 확인 함수 계약 |

`entities.ts`는 식별자·버전·관계를 정의한다. `contracts.ts`는 문서/검토 등 값의 구조를 정의한다. `ports.ts`는 외부 작업에 필요한 함수 계약을 정의한다. Domain은 React, IndexedDB, HTTP 구현과 생성된 전송 스키마를 import하지 않는다.

기존 서버와 저장 데이터의 모양을 유지하기 위해 domain 값 계약은 현재 구조에서 출발했다. 별도 domain 정의로 관리하며 서버 변경 시 어댑터가 이 계약을 만족하도록 변경한다. 생성된 OpenAPI 타입은 `infrastructure/http/schema.d.ts`에만 위치한다. 현재 domain과 전송 값의 구조가 같으므로 복사만 하는 변환기는 추가하지 않았다.

## Infrastructure

- `infrastructure/workspace/IndexedDbWorkspaceRepository.ts`: WorkspaceRepository를 명시적으로 implements한다. idb, DB 스키마·마이그레이션·트랜잭션·snapshot 알림을 담당한다.
- `infrastructure/resume/http.ts`: 이력서 추출과 입력 정책 요청.
- `infrastructure/material/http.ts`: 자료/URL 미리보기 요청.
- `infrastructure/review/http.ts`: 검토 실행·취소·재시도·기록 요청과 SSE 연결.
- `infrastructure/http/client.ts`: 공통 HTTP 및 서버 오류 변환.
- `infrastructure/browser/confirm.ts`: 브라우저 확인창 구현.
- `infrastructure/services.ts`: domain의 API 포트를 만족하는 실제 서비스 묶음.

DB 이름, 버전과 저장된 데이터 형식은 변경하지 않았다. 여러 엔티티를 함께 저장하는 작업의 원자성을 유지하기 위해 repository를 테이블별로 쪼개지 않았다.

## 연결과 UI

`App.tsx`가 실제 repository·gateway·확인 함수 구현을 연결하는 조립 지점이다. `useApplication`에는 완성된 의존성을 전달한다. application에는 기본 구현 import나 구현체에서 타입을 역으로 추출하는 `typeof defaultServices`/`Pick<구현클래스>`가 없다.

각 업무 훅은 domain 포트에서 자신이 사용하는 메서드만 요구한다. UI는 훅이 반환하는 값과 이벤트 콜백을 받는다. `ResumePreview`처럼 저장소를 구독하는 wrapper도 구체 클래스 대신 domain repository 계약을 받는다. 폼 초안은 영속 엔티티와 달리 application/UI의 일시 상태다.

PDF.js를 사용하는 컴포넌트는 `viewer/`에 제한한다. PDF 로딩, 페이지 렌더링, 이미지 URL, 인용 표시를 별도 컴포넌트 책임으로 유지하며 검토 API나 저장소 동작을 섞지 않는다. React·아이콘처럼 UI 전용 라이브러리는 해당 UI 계층에서 사용한다.

`application/`은 기능별 업무 흐름과 순수 화면 모델 계산을 담당한다. `views/`가 경로별 페이지와 공통 레이아웃을 관리하고, `features/`의 기능 컴포넌트를 조립한다. `WorkspaceScreen`은 검토 화면의 기능 컴포넌트를 모은다. `components/`와 `design-system/`은 모달·탭·오류 표시와 공통 디자인 토큰을 관리한다.

## 라우터와 페이지

React Router **8.3.1 Data 모드**를 사용한다. `App.tsx`의 `appRoutes`에 경로를 선언하고 `createAppRouter()`로 브라우저 라우터(`createBrowserRouter`)를 만든다. `main.tsx`가 React 렌더링 밖에서 한 번 생성해 App에 주입한다. 테스트는 동일 라우트 설정으로 memory router를 만들고 종료 시 dispose한다.

### 선택 근거

| 기준 | React Router Data 모드 | TanStack Router | 이 프로젝트의 판단 |
| --- | --- | --- | --- |
| 경로 타입 | 명시적 route objects 사용. 이 모드에서 전체 경로·검색 파라미터 추론은 제한적 | 경로·파라미터·검색 상태의 강한 타입 추론 | 현재 경로가 적고 검색 상태가 없어 추가 추론의 이점보다 전환 단순성을 우선 |
| 구성 | 기존 Vite에 RouterProvider·route objects로 도입 | 코드 기반 또는 파일 기반 라우트 트리 구성 가능 | App에서 명시적으로 설정하고 views를 분리하는 요청에 Data 모드가 간단히 맞음 |
| 이동 보호 | useBlocker로 SPA 이동 보호, useBeforeUnload로 문서 이탈 보호 | navigation blocking 제공 | 두 방식 모두 가능하며 기존 확인 함수 계약을 재사용 |
| 데이터 소유 | loader/action을 사용할 수 있으나 현재는 기존 업무 훅과 저장소 유지 | 라우트 데이터 로딩 기능과 별개로 기존 저장소 사용 가능 | 현재 IndexedDB·SSE·DI 흐름을 옮길 필요가 없음 |

React Router의 Data/Framework 모드는 구분한다. Framework 모드의 타입 생성·Vite 플러그인은 이번에 도입하지 않았다. TanStack Router도 코드 기반 구성이 가능하므로 플러그인이 필수라는 이유로 제외한 것은 아니다. 경로·URL 검색 상태가 복잡해지면 타입 추론의 효용을 다시 비교한다.

근거: [React Router 모드](https://reactrouter.com/start/modes), [브라우저 라우터](https://reactrouter.com/api/data-routers/createBrowserRouter), [useBlocker](https://reactrouter.com/api/hooks/useBlocker), [TanStack 타입 안전성](https://tanstack.com/router/latest/docs/guide/type-safety), [TanStack 이동 보호](https://tanstack.com/router/latest/docs/guide/navigation-blocking).

### 페이지 구성

| 경로 | views 페이지 |
| --- | --- |
| `/` | `/contexts`로 replace 이동 |
| `/contexts` | WorkspaceListView |
| `/contexts/new` | ResumeUploadView — 신규 공간 |
| `/contexts/:contextId` | WorkspaceView |
| `/contexts/:contextId/upload` | ResumeUploadView — 수정본 |
| `/materials` | MaterialLibraryView |
| 그 외 경로 | NotFoundView |

`ApplicationLayout`은 업무 훅을 한 번 연결하고 Outlet에 controller와 repository 포트를 전달한다. 팝업은 ApplicationDialogs에서 관리해 페이지 이동 중 저장소·SSE 연결이 중복 생성되지 않도록 한다. 존재하지 않는 작업 공간은 저장소 로딩 완료 후 판정하며, 해당 공간의 수정본 경로로 새 공간이 생성되지 않도록 막는다. RouteErrorView는 라우트 렌더 오류를, 로딩 실패 UI는 저장소 재시도를 담당한다.

`views/useWorkspaceNavigation`이 React Router를 감싸는 UI 훅이다. 미저장 입력은 주입된 확인 함수로 확인하고 저장 중 이동은 막는다. 저장 성공 후의 이동만 명시적으로 허용한다. 확정된 경로 변경 후 초안·팝업·기록 선택을 초기화한다. 같은 경로의 링크 클릭은 초안을 지우지 않는다. 브라우저 앞뒤 이동도 동일한 blocker를 사용한다.

URL은 해시 없이 `/contexts/...` 형식을 사용한다. Vite는 `appType: "spa"`로 직접 접근과 새로고침 시 index.html을 반환한다. 운영 배포 서버도 정적 파일과 `/api` 요청을 제외한 화면 경로에 `/index.html` fallback을 설정해야 한다. 수동 hashchange 라우터와 문자열 split 매칭은 제거했다. main 포커스·문서 제목은 페이지 변경 시 갱신하고, 메뉴는 NavLink의 활성 표시와 접근 가능한 이름을 사용한다. 공용 usePageAnnouncement 훅이 일반 화면과 라우트 오류 화면의 제목·포커스를 갱신하며 열린 모달의 포커스는 유지한다. 이 Effect는 라우터와 브라우저 DOM을 동기화하는 역할이다.

## 배포 후보 검토 — Oracle Cloud (2026-09-14)

즉시 가입·배포하지 않고 소수 사용자 베타의 후보로 Oracle A1을 검토한다. [현재 Always Free 문서](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)는 무료 계정의 A1 합계를 2 OCPU·12GB 상당(월 1,500 OCPU시간·9,000 GB시간)으로 안내한다. [가격표](https://www.oracle.com/cloud/price-list/)의 유료 계정 무료 사용량인 월 3,000 OCPU시간·18,000 GB시간과 구분한다. 부팅 디스크 포함 무료 블록 저장소는 합계 200GB다. 신청 시 콘솔 한도를 다시 확인한다.

서울을 우선 확인하되 무료 A1의 실제 용량은 보장되지 않는다. 홈 리전은 변경할 수 없고 현재 무료 A1 문서에는 춘천 예외가 있다. 유휴 자원은 7일간 CPU(95백분위)·네트워크·A1 메모리 사용률이 각각 20% 미만인 조건에서 회수 대상이 될 수 있으므로 서버 외부 백업과 복구 가능한 배포 설정이 필요하다. [예산 알림](https://docs.oracle.com/en-us/iaas/Content/Billing/Tasks/create-budget.htm)은 과금 자동 차단이 아니다.

초기 후보는 A1 한 대에 정적 프론트·FastAPI·OCR을 실행하는 구성이다. Python 3.12/PaddlePaddle 3.2.1의 Linux ARM64 wheel은 [공식 패키지 목록](https://www.paddlepaddle.org.cn/packages/stable/cpu/paddlepaddle/)과 uv.lock에서 확인했지만 실제 실행 호환성과 처리량은 미검증이다. Linux ARM64에서 전체 설치·한국어 OCR 초기화·Figma PDF 회귀·최대 메모리·처리 시간 검증을 선행한다. HTTPS·SPA fallback·SSE 프록시, 사용자별 인증·실행 제한, 서버 밖 데이터 및 암호화 키 복구를 배포 기준으로 둔다.

## 이력서 저장소와 서버 DB — 확정 방향·미구현

사용자 요구는 context당 최신 이력서 원본 1개를 유지하면서 commit처럼 업로드 이력을 남기는 것이다. 현재 IndexedDB 구현도 새 버전 저장 시 직전 버전의 original을 제거하고 추출 문서·버전·검토 기록은 유지한다. 서버 DB는 자체 운영 PostgreSQL, 원본 파일 저장소는 OCI Object Storage로 결정했다. 서버 저장 기능은 아직 구현하지 않았다.

권장안은 업로드 후 추출·확인·저장이 성공한 단위를 불변 patchset(기존 ResumeVersion)으로 남기는 방식이다. 원본 PDF/DOCX는 비공개 파일 저장소에 최신본만 보관하고, DB에는 버전별 메타데이터·추출 문서(줄 ID, 좌표, 추출기 버전 포함)·검토 연결을 보관한다. context는 최신 버전을 가리킨다. 추출 실패로 기존 최신본이 사라져서는 안 되며, 새 파일 저장과 DB 전환 성공 후 구 파일을 삭제한다. 두 저장소는 단일 트랜잭션이 아니므로 삭제 재시도와 미참조 임시 파일 정리가 필요하다. 따라서 교체 도중에는 파일이 일시적으로 2개일 수 있다.

텍스트 +/- 비교는 저장 방식과 별개인 조회 기능이다. 우선 업로드 이력과 텍스트 스냅샷을 남기고, 필요할 때 두 버전에서 diff를 계산하는 방식을 제안한다. OCR/레이아웃 변경으로 생기는 차이를 사용자 수정으로 단정하지 않는다. delta만 저장하는 방식은 원문 복원과 추출 좌표 검증이 복잡해지므로 초기에는 사용하지 않는다.

원본을 최신본만 보관하면 과거 원본의 다운로드·시각적 복원은 제공할 수 없다. 과거 검토는 해당 patchset의 추출 문서와 연결하며 최신 PDF에 옛 좌표를 적용하지 않는다. context는 기업 단위가 아니라 사용자가 «새 이력서 추가»로 만드는 독립 이력서 단위다. 새 이력서 추가는 새 context를 생성하고, 기존 context의 수정본 업로드는 해당 context의 새 patchset을 생성한다. 각 context는 최신 제출본 원본 1개를 유지하며 기업 연결을 필수로 요구하지 않는다. 하나의 context에서 과거 제출 PDF까지 보존하려면 별도 보존 정책이 필요하다.

파일 저장소의 «비공개»는 제품명이 아니라 익명 접근을 허용하지 않는 버킷 접근 정책을 뜻한다. OCI Object Storage의 비공개 버킷을 사용한다. 원본은 객체 저장소에, 객체 키·파일 메타데이터·소유권·최신 버전 연결은 DB에 둔다. 파일 읽기는 서버가 인증·context 소유권을 검사한 뒤 중계하거나 단기 접근 URL을 발급한다. 접근 URL 자체도 유효 기간 동안 접근 권한이므로 로그와 영속 저장 대상에서 제외한다. S3 호환 API를 선택해도 사용 기능의 호환성과 인증 차이는 검증한다. 참고: [S3 공개 접근 차단](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html), [OCI Object Storage FAQ](https://www.oracle.com/cloud/storage/object-storage/faq/).

PostgreSQL을 자체 운영한다. 사용자/context/patchset/검토 관계는 관계형 데이터와 트랜잭션으로 관리하며 추출 문서는 JSONB 보관을 검토한다. Supabase 같은 관리형 서비스의 별도 이용료를 줄일 수 있지만 서버 CPU·메모리·디스크·백업·네트워크 비용과 운영 시간은 남는다. 무료 자원 한도 내에서 현금 지출을 낮추는 선택이지 운영 비용이 없는 선택은 아니다. DB 업데이트·보안 설정·모니터링·백업·복구는 직접 책임진다. PostgreSQL 선택과 로그인 인증 구현은 별개이며 인증 공급자는 아직 미정이다.

### 인프라와 CI/CD 준비 기준 — 후속 개발

인프라 설정 경험이 적은 상태에서도 재현·점검·복구할 수 있도록 설정을 코드와 실행 절차로 남긴다. 즉시 배포하거나 CI/CD가 구현되었다고 간주하지 않는다.

- 환경: 개발·테스트·운영 환경변수와 비밀값을 분리하고 누락된 필수 설정은 시작 시 검증한다. PostgreSQL은 인터넷에 직접 노출하지 않고 앱 전용 최소 권한 계정을 사용한다. OCI 버킷은 비공개로 두고 서버 권한을 필요한 버킷·작업으로 제한한다.
- CI: 잠금 파일 기반 설치, 프론트 테스트·타입 검사·빌드, 백엔드 테스트, 임시 PostgreSQL을 사용하는 통합·마이그레이션 검증을 수행한다. Linux ARM64 컨테이너 및 OCR 실행 검증을 마련한다. 실제 사용자 파일·키를 CI에 넣지 않고 실제 AI 호출은 기본 검사에서 제외한다.
- CD: 검증한 동일 이미지와 커밋을 배포하고 비밀값을 이미지·저장소·로그에 포함하지 않는다. 초기 운영 배포는 수동 실행을 기본으로 하며 동시 배포와 중복 마이그레이션을 방지한다. 배포 후 health·SPA 직접 접근·인증·SSE 동작을 확인한다.
- 복구: 배포 전 마이그레이션 영향과 백업을 확인하고 이전 이미지로 복귀 가능한 절차를 둔다. 데이터 파괴를 수반하는 자동 DB 롤백은 하지 않으며 호환 가능한 스키마 변경을 우선한다. 서버 외부에 암호화된 백업을 두고 실제 복원 검증 및 보관·삭제 주기를 설정한다. API 키 암호화 키도 별도로 복구 가능해야 한다.
- 운영: 디스크·메모리·오류·백업 실패 알림과 자원 사용량 점검을 마련한다. 백업에 남는 이전 원본의 보존 기간도 최신 원본 1개 정책과 구분해 명시한다. CI/CD는 인프라 보안과 복구 검증을 대신하지 않는다.

## 상태와 렌더링

### 공개 서비스 준비 — 합의된 개발 방향 (2026-09-14, 미구현)

초기 사용자는 본인과 초대한 소수이며, 최종적으로 누구나 가입하는 서비스와 사용자별 AI API 키 사용을 지원한다. 즉시 배포하는 작업은 아니다. 아래 내용은 현재 구현과 구분되는 후속 개발 기준이다.

- 인증된 사용자에게 작업 공간·자료·검토·API 키가 귀속된다. 서버는 요청 본문의 사용자 ID를 신뢰하지 않고 인증 정보로 소유자를 결정하며 조회·실행·재실행·취소·삭제·SSE 모두 소유권을 검증한다.
- API 키는 HTTPS로 등록받아 서버에서 인증된 암호화 방식으로 저장한다. 암호화 키는 데이터 저장소와 분리해 관리하고 버전 관리 및 교체가 가능해야 한다. 검토 실행 시 해당 사용자의 키만 사용하며 키가 없거나 유효하지 않으면 공용 키로 대체하지 않는다.
- 직접 입력하는 동안 브라우저 메모리에 존재하는 것은 허용하되 localStorage·IndexedDB·쿠키·영속 스토어·URL에 API 키를 저장하지 않는다. 등록 성공·취소·화면 이탈 시 입력 상태를 해제한다. 이는 브라우저 메모리의 물리적 삭제를 보장한다는 의미가 아니다.
- 서버는 API 키 원문이나 암호문을 클라이언트에 반환하지 않는다. UI에는 등록 여부만 제공하고 교체·삭제 기능을 둔다. 요청 본문 로깅, 오류 보고, 분석 도구 및 세션 리플레이에 키 입력이 포함되지 않도록 제외한다.
- 인증·세션 및 키 보관 구현체는 infrastructure에서 담당하고, application은 포트 주입으로 사용한다. 프론트 검토 요청에는 API 키를 다시 실어 보내지 않는다. 사용자별 요청·동시 실행 제한은 서버가 담당한다.

개발 순서는 인증과 소유권 검증 → 사용자별 키 등록·암호화 보관·교체·삭제 → 해당 키를 사용하는 검토 실행 → 운영 환경 설정과 배포 검증이다. DB와 파일 저장소는 위 결정에 따르며 인증 공급자와 비밀 관리 서비스는 구현 착수 시 선택한다. 기존 IndexedDB 자료의 계정 귀속·이전 정책과 서버 재시작 시 작업 복구 방식도 별도로 결정한다.

완료 기준에는 다른 사용자의 키·작업 접근 차단, 인증 없는 요청 차단, 응답·로그·클라이언트 저장소의 키 비노출, 키 누락·교체·삭제·잘못된 키의 처리, 공용 키로의 대체 금지 테스트를 포함한다. 현재 서버 공용 환경변수 키와 메모리 기반 실행 관리가 이 기준을 충족한다고 간주하지 않는다.

영속 데이터는 저장소 snapshot 하나가 소유한다. 쓰기 트랜잭션 커밋 후에만 구독자에게 알리고 실패하면 기존 snapshot을 유지한다. 읽기 결과는 기존 엔티티와 비교해 바뀌지 않은 참조를 재사용한다. 문서 버전의 원본 Blob 참조도 유지한다.

`useWorkspaceSelector`는 안정적인 엔티티·배열·원시 값을 선택해야 한다. selector 안에서 새 배열이나 객체를 반환하지 않는다. 계산 결과가 필요한 경우 구독 밖에서 계산한다. `ResumePreview`는 해당 문서만 구독하고 부모의 진행 메시지·자료 입력 변화로 문서 뷰어가 다시 렌더링되지 않도록 memo 경계를 둔다.

UI 초안은 이벤트로 갱신한다. 공유 `useDraftState`는 비동기 결과가 현재 초안에 속하는지 확인한다. Effect는 저장소 초기 로드·브라우저 이벤트, SSE 연결과 정리, 모달 포커스, PDF/이미지 리소스와 인용 위치 스크롤 같은 외부 동기화에 사용한다. 값 계산을 위한 Effect나 모든 컴포넌트의 일괄 memo는 사용하지 않는다.

현재 snapshot 비교는 로컬 자료 전체를 읽고 직렬화해 비교한다. 자료 규모가 커져 측정된 병목이 생기면 저장된 revision과 변경 테이블 단위 알림으로 교체한다. 다른 탭의 변경은 focus/load 시 반영한다. 서버 목록 캐싱 요구가 생기기 전에는 TanStack Query를 추가하지 않는다.

## 검증

```sh
cd frontend
pnpm test
pnpm build
```

Vitest + Testing Library/user-event + fake-indexeddb를 사용한다. 실제 API 호출 대신 서비스 주입으로 정상·실패·지연 응답을 제어한다. 저장소는 테스트마다 별도 DB 이름을 사용한다.

주요 보호 대상은 입력 검증과 추출 확인 전 저장 방지, 미저장 입력 이동 취소, 늦은 추출 응답, 자료 다중 연결의 원자성, 버전 충돌과 과거 검토 불변성, 오류 모듈 재실행, SSE 중단·취소·저장 실패, 문서 구독 안정성, 모달 포커스 복원과 탭 방향키다. 비동기 작업 뒤에는 UI 상태 또는 저장 완료를 기다린 뒤 다음 동작을 수행한다.

TypeScript strict와 미사용 선언·인자 및 switch fallthrough 검사도 빌드에 포함한다. 현재 프로젝트에 없는 Storybook/E2E 프레임워크는 추가하지 않았다.

실제 브라우저에서는 데스크톱/좁은 화면의 overflow·글꼴 배치, 네이티브 모달의 Tab 순환·배경 inertness, 중첩 모달 Escape·포커스 복원, 드래그 업로드, PDF 원본과 인용 표시를 추가 확인해야 한다. jsdom만으로 이 항목들이 검증됐다고 판단하지 않는다.

### 경계 검사와 최근 검증 결과

- `src/views/routing.test.tsx`: 브라우저 URL, 기본 경로 이동, 404, 누락된 작업 공간, 앞뒤 이동 보호, 저장 중 이동 차단을 검사한다.
- `src/architecture.test.ts`: domain의 역방향·패키지 의존, application/UI의 infrastructure 직접 import 및 직접 전송 호출을 검사한다.
- `src/application/ports.test.tsx`: IndexedDB나 HTTP 없이 작은 포트 객체만 주입해 추출→저장 흐름과 저장 실패 시 입력 보존을 검사한다.
- 기존 저장소 테스트는 infrastructure 옆으로, 순수 입력 정책 테스트는 domain/resume으로 이동했다. 기존 통합·접근성·SSE·경합·뷰어 테스트를 유지한다.
- `pnpm test`: 28개 파일, 127개 테스트 통과.
- `pnpm build`: TypeScript와 프로덕션 빌드 통과. 라우터 도입 후 main 번들은 gzip 약 123.05 kB이며 이전 약 91.79 kB보다 약 31.26 kB 증가했다. PDF 별도 청크는 유지한다.
- API 타입 재생성: `pnpm types:api` (입력은 frontend/openapi.json).

## 경험 기록과 이력서별 작성본 — 2026-09-15

`/experiences`는 이력서와 독립된 경험 원본 보관함이고, `/contexts/:contextId/experiences`는 해당 이력서에 맞춘 문서 작성 화면이다. 기존 검토 자료는 회사·채용 공고로 유지한다. 기존 rail·토큰·버튼·native dialog를 재사용하고, context 안에서는 이력서 검토와 경험 작성을 경로 링크로 전환한다.

- IndexedDB v3에 `experiences`, `experienceDocuments`를 추가한다. v2의 기존 stores를 재생성하지 않으며 v1 이관도 유지한다.
- 경험은 메모·링크·파일 원본을 추가하는 방식으로 관리한다. AI는 원본을 덮어쓰지 않는다. 파일 Blob과 추출 텍스트는 구분한다. 텍스트·코드 파일은 UTF-8로 읽고 기존 PDF·DOCX·이미지 추출을 재사용한다.
- 경험 하나당 context별 작성본 하나를 저장한다. 작성 입력의 경험 revision·원본 목록·이력서 버전·자료 버전을 기록한다. 생성은 메모리의 초안이며 저장에 성공해야 작성본을 교체한다. 경험과 작성본의 revision을 검사해 다른 탭의 수정을 덮어쓰지 않는다.
- 작업 공간 삭제는 해당 작성본도 삭제하고 공통 경험 원본은 유지한다. 경험 추가는 기존 작성본을 자동 변경하지 않는다. 오래된 원본·이력서 버전으로 작성한 문서는 갱신 안내를 표시한다.
- `useExperiencesWorkflow`가 기록·작성 흐름을 담당하고 기존 dirty/busy 이동 보호와 오류 팝업에 연결한다. feature 컴포넌트는 domain 포트와 controller를 사용한다.
- `/api/experiences/write`는 경험·이력서·저장된 검토 자료를 받아 문서를 작성한다. URL 확인과 문서 작성 호출을 분리하며, URL 확인 실패는 확인되지 않은 근거로 표시한다. 작성 호출에는 도구 권한을 주지 않는다. 로그인 필요한 링크는 관련 내용을 직접 메모·파일로 추가한다.
- Markdown은 읽기 화면이 기본이며 편집과 복사를 지원한다. 요약 복사는 현재 Markdown의 `## 이력서용 요약` 구간을 사용하므로 사용자가 편집한 결과를 복사한다. 원문 HTML은 실행하지 않는다. Mermaid는 필요할 때만 로드하고 strict 모드의 결과를 Blob 이미지로 표시한다. 도표 오류 시 원문을 남긴다.

렌더러 사용 근거: [react-markdown](https://github.com/remarkjs/react-markdown), [Mermaid 사용 문서](https://mermaid.js.org/config/usage.html). 실제 AI 품질 평가는 별도이며 일반 테스트에서는 API 응답을 대체한다.
