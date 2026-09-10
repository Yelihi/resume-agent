# Phase 2 Context Summary

## 완료 결과

정규화된 이력서와 선택 자료를 받아 비-AI 검사, 조건부 자료 분석, 최종 검토를 실행하고 `{ status, errors, materialReviews, results }`를 반환한다. 현재는 Phase 3 웹 UI와 연결되어 있다.

## 확정 구현

- wire DTO의 수정 제안 필드는 `수정포인트위치`, `수정성격`, `검토출처`, `검토자료근거`, `이유 및 제안`, `실제 수정 예시`
- 최종 AI 원시 출력은 strict `AiReviewOutput { materialReviews, results }`; 상태와 오류는 코드가 조립
- `spellCheck`는 반복 공백·문장부호 앞 공백만 비-AI로 진단
- 회사·공고 분석은 입력이 있을 때만 실행하며 서로 병렬
- URL 입력이 있을 때만 OpenAI `web_search`, `tool_choice=required`, 전체 sources 검증
- OpenAI 기본 모델 `gpt-5.4-mini`, `OPENAI_MODEL`로 교체 가능, `store=false`
- 최종 위치는 실제 `lineIds`와 공백 정규화 후 실제 `quote` 포함 여부를 검증
- 기본 검토는 자기소개, 경험의 판단·결과, 수치 근거, 소유권, 기술-경험 연결, 구조·중복, 가독성, 안전을 페이지별로 확인
- 수정 포인트마다 별도 객체를 만들고 위치는 정확한 원문 인용과 `1~3`개 `lineIds`로 제한
- 일부 위치 실패는 `partial`, 모든 생성 제안 위치 실패는 `failed`, 원래 빈 결과는 `success`
- 실행 상태는 서버 메모리, SSE는 고정 진행 문구만 전달
- 취소는 실행 중 asyncio task를 취소하여 중단 가능한 HTTP 요청까지 전파
- 완료 `ModuleResult`를 입력·최종 응답과 함께 JSON `ReviewRecord`로 반환하고 IndexedDB에 저장한다. 실행 중 중간 체크포인트는 없다.
- 특정 모듈 재실행 후 finalReview는 항상 재실행, 다른 성공 모듈은 재사용
- Page/Flow 검토 시작 API 분리, 새 검토와 재실행의 동시 실행을 서버에서도 차단
- 직전 검토 참고는 이전 lineId를 버리고 quote·이유·예시·사용자 의견만 전달

## API

- `POST /api/reviews/page`, `POST /api/reviews/flow`
- `GET /api/reviews/{runId}/events`, `GET /api/reviews/{runId}/result`
- `POST /api/reviews/{runId}/cancel`, 기존 `POST /api/reviews/{runId}/retry`
- `GET /api/reviews/{runId}/record`, `POST /api/reviews/retry`, `DELETE /api/reviews/{runId}`

## 검증

- 2026-09-10 현재: 91 passed, 2 skipped. 저장 기록 왕복·서버 재시작 후 재실행·해제·입력 거부 포함.
- 아래 수치는 단계 완료 당시 기록이다.

- 전체 기본 테스트: 79 passed, 2 skipped
- skip: 실제 Paddle OCR 1건, 실제 OpenAI 평가 1건
- 실제 OpenAI 평가: 1 passed (`RUN_AI_EVAL=1`, 2026-09-01)
- 실제 5페이지 이력서 회귀 평가: 원시 9건 중 위치 검증 8건 통과, 1·3·5페이지와 3개 수정 성격에 분산 (`2026-09-02`)
- 실제 OpenAI 평가는 `RUN_AI_EVAL=1 OPENAI_API_KEY=... uv run pytest -m ai`로 실행

## 알려진 한계

- 비-AI 맞춤법은 확실한 공백 규칙만 다루며 한국어 문법 교정기로 과장하지 않는다.
- IndexedDB 저장 전 실행은 FastAPI 재시작 후 복구되지 않는다. 저장된 완료 기록은 서버 재시작과 무관하게 조회·재실행할 수 있다.

## Phase 3 입력

React는 OpenAPI DTO를 기준으로 추출·검토 API를 호출한다. 서버 원본 파일 저장소는 없으며 현재 이력서 원본과 파생 문서, 자료 항목, ReviewRecord와 직전 검토 한 건은 IndexedDB에서 수명 주기를 관리한다. 저장 성공 후 서버 실행 기록을 해제한다.
