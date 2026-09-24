# 접근성 및 상태 소유권 점검 — 2026-09-11

## 수정한 접근성 항목

- AppShell: 이름 있는 navigation landmark와 본문 바로가기 추가. 바로가기는 hash 라우트를 변경하지 않고 main에 포커스를 이동한다.
- 자료 보관함: 정적 내용이나 빈 결과로 시작하는 tabpanel에 키보드 진입점을 추가했다. 탭과 패널의 ARIA 연결 및 포커스 표시를 유지한다.
- 검토 결과: 제안 제목을 h3, 요약 제목을 h3/h4로 구성했다. 이름이 필요한 일반 div는 group 역할을 부여했다. 진행 메시지가 이미 status이므로 skeleton은 별도의 live region으로 중복 알리지 않는다.
- 문서·추출 화면: 이름 있는 region을 제공한다. PDF canvas에는 이미지 역할과 페이지 이름을 부여한다. 페이지별 추출 텍스트 펼치기는 사용자 요청으로 제거했다.
- 파일/텍스트 입력: 텍스트 입력의 보이는 레이블과 접근 가능한 이름을 일치시켰다. 파일 선택의 기본 input 키보드 동작은 유지한다.
- 자료 선택 개수를 status로 알리고 인용 스크롤은 prefers-reduced-motion을 존중한다.

기준: [WAI-ARIA 탭 패턴](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [WAI 복잡한 이미지의 텍스트 대안](https://www.w3.org/WAI/tutorials/images/complex/).

## 상태 소유권 판단

| 소유자 | 상태 | 판단 |
| --- | --- | --- |
| ResumeUpload | dragging 1개 | 업로드 영역에 국한된 UI 상태 |
| MaterialLibrary / MaterialPicker / FeedbackPanel | 필터 / 선택 / 의견 각 1개 | 해당 화면·컴포넌트 소유 유지 |
| ExtractionPreview | 확인 여부와 선택 구간 2개 | 같은 원문 확인 작업이므로 유지 |
| ImageViewer / PdfViewer | URL / 로딩 결과 각 1개 | 리소스 수명에 결합된 상태 |
| PdfPage | canvas, 너비, 렌더 실패 3개 | 한 페이지 렌더링의 응집된 책임, 별도 전역 저장 불필요 |
| useApplication | 기록 선택, 인용 선택 2개 + 기능별 흐름 훅 조합 | 화면 간 조율을 맡되 실제 기능 책임은 각 훅 유지 |
| 기능별 업무 훅 | 초안, 비동기 실행, 자료 모달, SSE 상태 | 기능 단위로 분리되어 있으며 무관한 상태를 한 UI 컴포넌트가 직접 관리하지 않음 |

useState의 개수만 줄이기 위한 컴포넌트 분리는 하지 않았다. 영속 데이터는 이미 ResumeAgentStore와 useSyncExternalStore의 선택 구독으로 관리한다. Zustand를 추가하면 현재로서는 동일 데이터의 복제 또는 기존 저장소를 감싸는 계층만 늘어난다. 여러 독립 화면이 공유하는 일시 상태가 생기거나, 실제 프로파일링에서 기존 선택 구독으로 해결되지 않는 병목이 확인되면 도입을 다시 검토한다.

## 검증 결과와 한계

`src/accessibility.test.tsx`에 5개 회귀 테스트를 추가했다: 본문 바로가기, 빈 탭 패널 진입, 제목/ARIA 그룹, PDF 페이지의 접근 가능한 이름, reduced-motion 스크롤.

- `pnpm test`: 25개 파일, 110개 테스트 통과.
- `pnpm build`: TypeScript 및 프로덕션 빌드 통과.
- `git diff --check -- frontend`: 통과.
- 브라우저 연결을 다시 확인했으나 사용 가능한 브라우저가 없었다. 실제 스크린리더, 네이티브 모달 Tab 순환, 대비·확대·반응형 배치는 미검증이다. 이 결과는 전체 WCAG 적합성 인증이나 자동 axe 검사 결과가 아니다.
