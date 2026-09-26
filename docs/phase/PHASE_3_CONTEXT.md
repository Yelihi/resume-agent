# Phase 3 Context Summary

## 완료 결과

React 로컬 웹에서 이력서 입력·추출, 독립 자료 등록, SSE 검토·취소, 결과 확인과 원문 위치 강조까지 한 흐름으로 사용할 수 있다.

## 확정 구현

- React 19, Vite, TypeScript, Vitest; 초기 라우터 없음
- FastAPI OpenAPI에서 프런트 DTO 자동 생성
- HTTP 상태별 오류 클래스와 안전한 서버 오류 DTO 파싱
- IndexedDB에는 현재 이력서, 자료 목록, 현재 ReviewRecord 한 건, 직전 검토 참고와 진행 중 실행 ID를 저장
- 이력서 교체 시 이력서 파생 상태와 현재 결과는 제거하고 회사·공고 자료와 직전 검토는 유지
- 자료 파일 원본은 추출 성공 직후 삭제; 현재 이력서 원본은 교체·명시적 삭제 전까지 유지
- PDF.js·이미지·Flow 뷰어와 서버 `lineId`→저장된 bbox/offset 위치 강조
- 검토 중 입력 잠금, 고정 SSE 문구, 취소, 동일 서버 프로세스 안에서 새로고침 후 재연결
- 모듈 오류와 제안 분리 표시, `canRetry` 모듈만 재실행
- 사용자 의견과 직전 결과를 다음 검토 참고로 전달하며 오래된 위치 ID는 전달하지 않음
- 완료 시 입력·완료 모듈·최종 응답을 ReviewRecord로 IndexedDB에 원자적으로 저장한 뒤 서버 기록을 해제
- 저장 기록을 조회해 결과를 표시하고 재실행 API에 전달. 서버 재시작 후에도 저장 결과 조회·모듈 재실행 가능
- 서버 입력 정책을 불러오지 못해도 로컬 저장 결과는 표시
- 저장 실패 시 서버 기록과 activeRunId 유지; 이전 저장 형식은 결과 조회 호환만 지원

## 검증

- 2026-09-10 저장 계약 변경 검증: 프런트 8개 파일·49 tests passed, TypeScript/Vite build 통과. 백엔드 91 passed, 2 skipped.
- OpenAPI 재출력과 TypeScript 타입 재생성 완료. 서버 재시작 복원, 로컬 결과 조회, 저장 실패 시 보존과 저장 후 서버 해제를 검증했다.
- 이번 변경에서는 실제 OpenAI/OCR 평가와 브라우저 시각 검증을 재실행하지 않았다.
- 아래 수치는 Phase 3 초기 완료 당시 기록이다.

- 프런트: 8 test files, 31 tests passed
- TypeScript project build와 Vite production build 통과
- OpenAPI 재출력·타입 재생성 후 테스트와 빌드 재통과
- 백엔드: 79 passed, 2 skipped
- 실제 OpenAI 품질 평가: 1 passed (`RUN_AI_EVAL=1`, 2026-09-01)
- 실제 브라우저: 초기 로드, 직접 입력 3개 줄 변환·렌더링, 검토 버튼 활성화, 콘솔 오류 없음
- skip: 실제 PaddleOCR 모델 1건, 실제 OpenAI 평가 1건

## 알려진 한계

- IndexedDB 저장 전 실행은 FastAPI 재시작 시 복구되지 않는다. 저장된 완료 기록은 복구와 재실행을 지원한다.
- 24시간 자동 삭제는 저장·조회 계약 변경 다음 작업이며 아직 미구현이다.
- 초기 브라우저 저장은 계정·장기 이력·기기 간 동기화를 지원하지 않는다.
- PDF.js worker는 별도 번들로 생성되며 초기 로드 용량 최적화는 실제 사용 측정 후 판단한다.

## 다음 판단 지점

IndexedDB 24시간 자동 삭제를 다음에 추가한 뒤 실제 이력서 표본과 OpenAI 품질 평가를 수행한다. 그 결과가 유용할 때만 공개 웹 또는 Electron, 서버 DB, 인증·사용자 API 키, GlitchTip, 컨테이너 배포와 추가 분석 모듈을 논의한다.
