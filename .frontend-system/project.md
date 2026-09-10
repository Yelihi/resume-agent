# resume agent project Frontend Context


> Generated from an uncommitted tree. Verify evidence before changing approved decisions.


React/Vite 단일 화면 프런트엔드가 FastAPI API와 SSE로 통신하는 로컬 우선 이력서 검토 도구다. IndexedDB가 브라우저 세션 데이터를 소유하며 PDF.js 기반 원문 뷰어와 검토 결과 패널을 함께 제공한다.

## Observed

- frontend/package.json은 React 19, TypeScript 5.8, Vite 7, Vitest 4를 사용한다.
- App.tsx가 입력, 검토 자료, SSE 진행 상태, 검토 결과를 조율한다.
- ResumeAgentStore가 IndexedDB의 단일 상태 레코드를 소유한다. 완료 ReviewRecord는 입력·완료 모듈·최종 응답을 포함하고 현재 결과는 이 기록에서 읽는다.
- 저장 성공 후 서버 실행을 해제한다. 재실행은 IndexedDB 기록을 API에 전달해 새 runId로 시작한다.
- API 계층은 생성된 schema.d.ts를 사용하며 Vite가 /api를 localhost:8000으로 프록시한다.
- ResumeViewer는 FlowDocument와 PageDocument/PDF overlay 렌더링을 분리한다.
- ErrorPopup은 공용 오류 UI이고 styles.css가 토큰과 반응형 규칙을 소유한다.
- Storybook, Tailwind CSS, shadcn/ui는 현재 감지되지 않았다.

## Architecture

- main.tsx → App.tsx → api/storage/viewer/components 방향의 의존성을 유지한다.
- ResumeAgentStore가 영속 상태를 소유하고 React 로컬 상태는 일시적인 UI 상태만 담당한다.
- 서버 호출은 api/client.ts와 기능별 API 파일을 통해 수행한다.
- 생성된 OpenAPI 타입을 클라이언트-서버 계약의 기준으로 삼는다.
- 현재는 단일 대시보드이며 실제 다중 경로가 생기기 전에는 라우터를 추가하지 않는다.

## Conventions

- React 함수 컴포넌트와 명시적 TypeScript 타입을 사용한다.
- 테스트를 위해 서비스 의존성을 주입할 수 있게 한다.
- Testing Library, user-event, fake-indexeddb를 사용한다.
- role, label, dialog, aria-live 등 접근성 의미를 유지한다.
- 전역 CSS 변수와 소수의 목적 중심 클래스를 사용하며 CSS 프레임워크는 없다.

## Decisions

- 프런트엔드는 React/Vite를 유지한다.
- 초기 버전은 서버 데이터베이스 없이 최소 IndexedDB 저장만 사용한다.
- 검토 진행은 SSE로 전달하고 취소를 지원한다.
- API 키와 AI 호출은 서버가 소유한다.
- 기존 프로젝트 토큰을 우선하고 OpenDesign은 보조 설계 근거로 사용한다.
- 검증된 필요가 없으면 새 의존성이나 추상화를 추가하지 않는다.

## Quality Gates

- 제품 변경은 테스트를 먼저 작성하는 TDD 흐름을 따른다.
- pnpm test를 통과한다.
- pnpm build를 통과한다.
- 백엔드 계약이 바뀌면 OpenAPI 스키마 타입을 다시 생성한다.
- 반응형 레이아웃, overflow, 접근성 동작을 시각적으로 확인한다.

## Assumptions

- 초기 제품은 로컬의 인증 없는 단일 사용자 환경이다.
- Open Design 0.22.0과 플러그인 0.5.3은 사용자 범위로 설치되어 있으며 새 Codex 작업부터 도구가 노출된다.
- App.tsx 분리는 복잡성이 실제로 확인될 때 수행한다.

## Open Questions

- 다음 작업은 IndexedDB 24시간 자동 삭제다. 아직 자동 만료는 없다.
