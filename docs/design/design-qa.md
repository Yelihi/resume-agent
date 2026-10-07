# Design QA

## 2026-10-07 경험 자료의 어필 포인트·면접 준비

- 범위: 경험 편집과 보관함. 상단 어필 포인트/분석 버튼, 접을 수 있는 추천용 메타데이터, 본문 아래 질문·답변·근거 편집, 저장 후 질문별 펼쳐 읽기. 기존 디자인 토큰을 사용했다. OpenDesign은 연결 오류로 새 참조를 확인하지 못했다.
- Chrome에서 1440×1000, 390×844로 확인했다. 데스크톱 답변/근거 두 열, 모바일 한 열을 확인했으며 모바일 문서 너비와 스크롤 너비는 모두 390px였다.
- 브라우저 검증에는 임시 로컬 진입점과 합성 Chromium 예시, 가짜 AI 응답, 별도 IndexedDB를 사용했다. 생성 → 답변 수정 → 질문 추가 → 저장 → 새로고침 → 보관함 열람을 확인했다. 운영 사용자 자료와 실제 AI를 사용하지 않았다.
- 자동 재현: `cd frontend && pnpm test`의 `experience.test.tsx`에서 생성·수정·재생성 시 보존·저장 실패·재열기·삭제를 검증한다. `http.test.ts`는 새 응답의 타입/길이 제한과 기존 서버 응답 호환성을 검사한다.
- 서버 재현: `cd backend && uv run pytest -m 'not ai and not ocr' -q`. `test_experience_authoring.py`는 답변 인용 검증, `test_workspace.py`는 저장·재열기·이관·제한 검증 및 검토 사실 입력에서 준비 메모 제외를 검사한다.
- 결과: 프런트 155개, 백엔드 179개 통과, 프런트 빌드 통과. 기존 대용량 번들 경고는 남아 있다. 브라우저 확인과 별도로 실제 AI 검증을 아래에 수행했다. 운영 배포는 하지 않았다. Frontend System의 기록 도구는 이 세션에서 제공되지 않아 이 문서에 검증 범위를 남겼다.

### 보완 후 재검증: 중복 추천·의미 변형

- 변경: 생성 뒤 원문과 대조하는 검수 1회를 추가했다. 행동의 대상, 부정, 조건, 개인/팀 역할, 목표/실제 결과를 대조하고, 검수 실패 시 미검수 초안을 반환하지 않는다. 기존 작성 내용은 유지된다.
- 자동 어필 제안은 가장 강한 핵심 기여 **하나 + 원문 인용 1~3개 + 확인할 점**으로 구성한다. 구현·테스트·통과를 별도 성과로 늘리거나 보완 조언만 별도 포인트로 만들지 않는다. 사용자가 여러 포인트를 직접 작성하는 것은 그대로 허용한다.
- 떨어진 근거 문장은 별도 인용으로 취급한다. 각 인용을 원문과 대조하고 하나라도 일치하지 않으면 해당 어필 제안을 제외한다. 답변의 인용 검증도 유지한다. 자료가 부족하면 어필 포인트 없이 보완 질문만 남긴다.
- 호출: 메타데이터 생성 요청당 AI 호출 2회. 기본 `gpt-5.4-mini`와 현재 고정 버전의 검수 단계에 `reasoning.effort=medium`을 사용한다. 다른 설정 모델에는 이 옵션을 보내지 않는다. 공식 문서상 기본 추론 수준은 `none`이며 `medium`을 지원한다. [OpenAI 공식 문서](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- 실제 검증: 합성 사례 8개를 동일한 최종 코드로 **두 차례 실행해 16/16 통과**했다. 각 실행은 169.49초/172.25초였고, 사례별 전체 처리 시간은 11.18~34.33초였다(초안 작성 경유 및 오류 주입 사례 포함, 두 실행을 동시에 수행한 개발 환경 관측값).
- 직접 출력 검토: Chromium 업로드 15회와 merge 1건 구분, 팀의 미측정 30% 목표와 개인의 재현/테스트 역할 구분, 단일 기여에 구현·검증 묶기, 모르는 선택 이유와 코드 세부사항의 답변 비우기, 자료 속 공격 문자열 제외를 확인했다. 의도적으로 넣은 “요청 취소를 무시하고 전송 차단”을 “취소한 요청의 결과를 무시하며 전송 자체는 막지 않음”으로 교정했고, 자동 재시도 금지/수동 재시도 허용의 구분도 유지했다.
- 회귀 검사: 백엔드 **180개 통과**, OpenAPI 스냅샷 일치, `git diff --check` 통과. JSON/SSE 모두 검수 실패·누락 시 미검수 결과나 내부 오류를 노출하지 않는 것, 유효하지 않은 인용 제외, 떨어진 인용의 별도 표시를 검사했다. 프런트 코드와 저장 계약은 이 보완에서 변경하지 않았으며 기존 155개·빌드·화면 검증 기록은 위와 같다.
- **판정:** 이전에 배포를 보류한 중복 추천·의미 반전은 최종 두 차례 검증에서 재발하지 않아 해당 보류 사유를 해소했다. 모델 출력의 일반적인 무오류 보장은 아니며, 인용이 확인되지 않는 답변은 빈칸으로 남을 수 있다. 실제 Chromium 링크 접근·운영 데이터·다른 모델은 이번 재검증 범위가 아니다. 배포는 실행하지 않았다. 배포 시 백엔드 완료 후 프런트를 반영한다.
- 증거: `/tmp/resume-agent-experience-review-20261007-verified-a/*.json`, `/tmp/resume-agent-experience-review-20261007-verified-b/*.json`. 합성 입력, 검수 수정 항목, 최종 응답, 소요 시간을 남겼다. 아래 재현 명령은 이제 8개 사례를 실행한다.

### 최초 실제 AI 품질 검증(보완 전)

- 모델: 개발 환경의 `gpt-5.4-mini`. 사용자 자료 대신 합성 입력만 사용했다. `backend/tests/evaluation/test_live_experience.py`에 유료 호출을 명시적으로 켜는 재현 테스트를 추가했다.
- 최종 자동 결과: 6개 통과, 24.81초. Chromium의 동일 변경 15회 업로드/1건 merge 구분, 자료 부족, 팀/개인 역할과 미측정 목표 구분, 선택 이유 누락, 자료 속 악성 지시, 파일 메모→경험 초안→면접 준비 흐름을 검사했다. 인용의 본문 일치·필수 섹션·답변 유무·공격 문자열 미출력을 자동 검사하고 출력의 의미는 별도로 읽었다.
- 발견 및 수정: 인용 하나가 틀리면 전체 분석이 실패하던 동작을 해당 답변/근거만 비우도록 변경했다. 어필할 활동을 찾지 못한 응답은 보완 질문 최대 2개만 남기고 답변을 비운다. 질문만 반복하는 답변, 미측정 사실을 태도로 칭찬하는 표현, 섹션 누락을 줄이도록 생성 지침을 보완했다.
- 반복 검증 중 빈 문자열 대신 설명을 쓰거나, 답할 수 있는 자료에서도 모든 답변을 비우는 변동이 있었다. 최종 6개 통과는 해당 실행의 자동 기준 통과이며 일반적인 의미 정확성을 보장하지 않는다.
- **당시 남은 품질 문제:** 최종 출력에서도 같은 기여의 반복, 어필 포인트에 보완 조언만 별도 항목으로 넣는 경우가 있었다. 초안→분석 사례의 확인 항목에서 원문의 “취소한 요청의 결과를 무시”가 “요청 취소를 무시”로 바뀌었다. 질문·해석의 의미 정확성은 인용 문자열 대조만으로 검증할 수 없다. **이 단계에서는 기능/저장 검증만 통과하고 AI 품질은 미통과로 판정해 배포를 보류했다.**
- 범위 제한: 실제 Chromium 링크 접근 성공률, 긴 실제 자료, 운영 계정/데이터는 이번 실행에 포함하지 않았다. 브라우저 UI 검증은 위의 모의 AI 테스트다.
- 배포 관련 검사: 백엔드 179개, 프런트 155개, 빌드, OpenAPI 스냅샷 일치, 배포 Python 테스트 5개, 저장장치 self-test, 셸 문법, Worker 테스트 2개, `git diff --check` 통과. 기존 번들 크기·라이브러리 deprecation 경고는 남아 있다.
- 향후 배포 순서: 백엔드 먼저 완료한 뒤 프런트를 배포한다. 기존 백엔드는 새 준비 메모 필드를 거부하며, 현재 두 CI/CD workflow는 순서를 보장하지 않는다. 커밋·push·운영 배포는 수행하지 않았다.

재현(개발용 키를 담은 로컬 `.env` 필요, 실제 API 비용 발생):

```sh
cd backend
RUN_AI_EVAL=1 AI_EVAL_OUTPUT_DIR=/tmp/resume-agent-experience-eval uv run --env-file .env pytest tests/evaluation/test_live_experience.py -m ai -q -s
```

마지막 실행의 합성 입력/출력은 로컬 `/tmp/resume-agent-experience-eval-20261007-finalcheck/*.json`에 남겼다. 재현 테스트는 자동 기준뿐 아니라 출력의 의미 검토가 필요함을 표시한다.


이 문서는 2026-09-07 시각 검증 기록이다. 이후 검토 출처·자료 근거 표시와 2026-09-10 저장 계약 변경을 이 시각 검증에 포함된 것으로 해석하지 않는다. 현재 기능·검증 기준은 DESIGN_NOTES.md와 PHASE_3_CONTEXT.md를 참고한다.

- Source visual truth: `/Users/yelihi/.codex/generated_images/01a05177-9ead-7bf1-9341-ab3dd3cc5452/exec-7e05c842-9a73-4789-a4a8-54f0576f07db.png`
- Implementation screenshot: `/Users/yelihi/Documents/resume agent project/implementation-ui-final-matched.png`
- Viewport: 1487 × 1058 CSS px
- Pixel dimensions: source 1487 × 1058; implementation 1487 × 1058
- Density normalization: both compared at matching native pixel dimensions; browser screenshot used device scale 1
- State: desktop, resume ready, file input selected, job-posting drawer open. The source contains illustrative review results and attachments; the implementation intentionally shows the current local empty-review state rather than fabricating persisted data.

## Findings

- No actionable P0/P1/P2 differences remain. The selected direction is preserved: compact dark navigation rail, restrained blue accent, document-first workspace, separate review column, and a right-side reference drawer above the workspace.
- Typography uses the existing Korean-first Pretendard/system stack with compact hierarchy and neutral weights. It is slightly less condensed than the generated reference but remains within P3 polish.
- Spacing and layout rhythm now match the reference proportions closely: 136 px navigation rail, flexible document area, 340 px review column, and 328 px drawer at the target viewport.
- Colors and tokens match the source's charcoal, cool-gray, white, and cobalt roles. Gradients and glass effects are absent.
- Icons use the Phosphor vector icon library; no raster placeholders, emoji, handwritten SVG, or CSS-drawn icons are used. The reference has no required photographic or illustrative assets.
- Copy is adapted to the real product states and existing domain language. Source-only fictional resume and company data were not copied into the application.

## Full-view comparison evidence

The source and final implementation were opened together at the same pixel dimensions. Main-region proportions, drawer hierarchy, toolbar density, border rhythm, restrained elevation, and accent placement align. The implementation keeps the drawer fixed above the app while reserving desktop space so the review column remains visible, matching the selected visual without losing the requested overlay behavior.

## Focused region comparison evidence

A separate crop was not needed because both native-size 1487 × 1058 artifacts keep the toolbar, navigation, drawer controls, typography, and borders legible in the full-view comparison. The drawer was additionally inspected in its job-posting and company-information states.

## Comparison history

1. First pass — blocked
   - Evidence: `implementation-ui-pass1.png` at 1440 × 1024.
   - P2 findings: the drawer scrim was too dark, the drawer hid the full review column, programmatic focus created a prominent close-button outline, and the file action row stretched vertically.
   - Fixes: reduced scrim opacity, moved initial focus to the dialog container, corrected the file-label layout, reserved desktop space for the fixed drawer, and aligned rail/review/drawer widths to the source.
2. Final pass — passed
   - Evidence: `implementation-ui-final-matched.png` at 1487 × 1058.
   - Post-fix result: navigation, viewer, review, and drawer remain simultaneously visible with proportions matching the source. Drawer tabs and close behavior work, and the mobile layout has no horizontal overflow.

## Interaction and runtime checks

- Opened and closed the reference drawer; focus returned to the trigger.
- Switched between job-posting and company-information tabs.
- Switched resume input modes without losing the rendered resume.
- Checked the 390 × 844 responsive state: body, shell, and viewer widths remained 390 px with no horizontal overflow.
- Browser console errors: none.
- Frontend tests: 33 passed.
- Production build: passed.

## Follow-up polish

- P3: compare the populated analysis state after the user runs a real review; the generated reference uses fictional results that were deliberately not persisted.

final result: passed
