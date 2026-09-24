# Resume Agent

이력서 원문을 바꾸지 않고, 근거가 있는 수정 위치와 방향을 제안하는 로컬 웹 작동 모델이다.

## 구성

- `frontend`: React, Vite, TypeScript, IndexedDB, PDF.js
- `backend`: FastAPI, PyMuPDF, PaddleOCR, OpenAI Responses API
- 로컬 모드는 IndexedDB, 초대형 서버 모드는 SQLite와 인증된 파일 저장소에서 작업 공간·이력서 버전·자료·검토·제안을 관리한다.
- 새 이력서는 독립 작업 공간으로, 수정본은 같은 작업 공간의 다음 버전으로 저장한다. 수정본의 연속성은 사용자가 판단한다.
- 제안별 좋아요/싫어요와 Resolve/Skip을 저장한다. 다음 검토는 같은 작업 공간의 피드백만 사용하며 AI가 반영을 확인한 제안은 현재 목록에서 제외한다.
- 자료는 추출 → 확인·수정 → 명시적 저장 후 사용할 수 있다. 보관함 자료를 여러 작업 공간에 연결하고 검토마다 사용 버전을 고정한다.
- `경험 기록`에서 Markdown 본문을 직접 작성하거나 옆에 링크·문서를 첨부해 AI로 상세 경험 템플릿을 만든다. 초안은 수정할 수 있고, 편집기 상단의 Markdown/Preview 탭으로 즉시 확인한다. 메타데이터는 별도로 생성·수정한 뒤 최종 저장한다. 본문과 메타데이터는 문제 → 분석 → 해결 → 기대 결과 흐름을 따르며 실제 성과와 기대 효과를 구분한다. 본문·제목·기간을 바꾸면 메타데이터를 다시 생성한다.
- 경험의 이미지는 외부 HTTP(S) URL만 사용한다. 직접 이미지 첨부·이미지 호스팅은 지원하지 않으며 문서 원본은 기존 IndexedDB에 보관한다.
- 이력서 검토에서 경험을 직접 고르면 JD 적합성에 따라 문구 또는 생략 이유를 제공한다. 다른 경험은 근거와 함께 추천하고 사용자가 추가를 선택한 뒤 문구를 작성한다. 경험을 고르지 않으면 저장된 경험 중 JD에 맞는 경험을 자동 추천·작성한다. JD가 없으면 경험 추천을 실행하지 않는다.
- 검토 당시 경험·이력서·JD 버전을 고정하므로 이후 원본 편집이 과거 추천을 바꾸지 않는다. 경험 생성은 전용 페이지에서만 하며, 기존 작업 공간 작성본은 보관함에서 열어 편집·복사할 수 있다. 이력서 파일에 자동 삽입하지 않는다.
- 완료 결과 저장 후 서버 실행 기록을 해제한다. 재실행 시 관계를 따라 `ReviewRecord`를 구성하므로 서버 재시작 후에도 재실행할 수 있다.
- 자동 만료와 Reset은 없다. 작업 공간 삭제 시 해당 이력서·검토·피드백을 정리하며 공용 자료는 유지한다. 앞으로 저장하는 이력서·자료 버전의 원본을 보관하며 과거에 삭제된 원본은 복구하지 못한다.
- 초대형 배포의 인증·서버 저장·개인 API 키·백업 기반은 구현했으며 외부 배포는 미완료다. [배포 계획](DEPLOYMENT_PLAN.md), [운영 절차](deploy/README.md), [CI/CD](deploy/CI_CD.md), [Docker 검증 조건](deploy/DOCKER.md)을 따른다. 개인화·채용 트렌드 분석은 후속 계획이다.

## 실행

Python 3.12, [uv](https://docs.astral.sh/uv/), Node.js와 pnpm이 필요하다.

터미널 1:

```bash
cd backend
uv sync
uv run --env-file .env uvicorn app.main:app --reload
```

터미널 2:

```bash
cd frontend
pnpm install
pnpm dev
```

`http://localhost:5173`을 연다. Vite가 `/api` 요청을 `http://localhost:8000`으로 전달한다.

문서 추출만 확인할 때는 키를 생략해도 된다. 실제 AI 검토에는 `backend/.env`의 `OPENAI_API_KEY`가 필요하다. 모델은 기본적으로 `gpt-5.4-mini`이며 `OPENAI_MODEL`로 바꿀 수 있다. 키는 브라우저에 전달하거나 저장하지 않는다.

## 검증

```bash
cd backend
uv run pytest

cd ../frontend
pnpm test
pnpm build
```

OpenAPI 타입을 갱신하려면:

```bash
cd backend
uv run python -m scripts.export_openapi ../frontend/openapi.json
cd ../frontend
pnpm types:api
```

실제 OpenAI 품질 평가는 비용이 발생하므로 명시적으로만 실행한다.

```bash
cd backend
RUN_AI_EVAL=1 OPENAI_API_KEY=... uv run pytest -m ai
```

설계 기준은 `DESIGN_NOTES.md`, 단계별 결과는 `PHASE_*_CONTEXT.md`에서 확인할 수 있다.
