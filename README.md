# Resume Agent

이력서 원문을 바꾸지 않고, 근거가 있는 수정 위치와 방향을 제안하는 로컬 웹 작동 모델이다.

## 구성

- `frontend`: React, Vite, TypeScript, IndexedDB, PDF.js
- `backend`: FastAPI, PyMuPDF, PaddleOCR, OpenAI Responses API
- 서버 데이터베이스 없음. 현재 이력서·자료·완료 검토 기록은 브라우저 IndexedDB에 저장한다.
- 완료 기록은 입력·모듈 결과·최종 응답을 담는 JSON `ReviewRecord`다. 서버 재시작 후에도 저장 결과를 읽고 기록을 전달해 모듈을 재실행할 수 있다.
- IndexedDB 저장 성공 후 서버 실행 기록을 해제한다. 저장 전 실행은 서버 종료 시 복원되지 않는다.
- 24시간 자동 삭제는 다음 작업이며 현재는 교체·명시적 삭제로 정리한다.

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
