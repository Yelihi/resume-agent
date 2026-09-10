# Phase 1 Context Summary

## 완료 결과

FastAPI가 PDF·이미지를 `PageDocument`, DOCX·TXT·직접 텍스트를 `FlowDocument`로 반환한다. 이 문서는 추출 단계의 완료 기록이다. 현재 AI·UI 구현은 Phase 2·3 문서를 참고한다.

## 확정 구현

- Python 3.12, uv, FastAPI, Pydantic, pytest
- PyMuPDF: PDF 내장 텍스트·줄 bbox
- python-docx: 머리글→본문 문단·표→바닥글 순서
- PaddleOCR 3.7 + PaddlePaddle CPU 3.2.1
- OCR 모델: `PP-OCRv5_mobile_det` + `korean_PP-OCRv5_mobile_rec`
- OCR 모델은 첫 OCR 요청에서 lazy-load
- `GET /api/resumes/validation-policy`
- `POST /api/resumes/extract/{pdf|image|docx|txt|text}`
- 예상 오류는 `{ errors: ModuleErrorDTO[] }`, 예상 밖 오류는 안전한 500과 내부 logging

## 불변 조건

- Page ID: `p{page}-b{n}`, `p{page}-l{n}`
- Flow ID: `f-b{n}`, `f-l{n}`
- bbox: 좌상단 원점 0..1, 양수 크기, 페이지 내부
- Flow offset: UTF-16 code unit, end-exclusive
- PDF 내장 텍스트가 겹치는 OCR보다 우선
- OCR 실패 시 전처리 후 한 번만 재시도

## 검증

- 기본 전체 테스트: 42 passed, 실제 OCR 1 skipped
- 실제 Paddle HTTP 인수 테스트: 1 passed
- OCR 합성 표본: Paddle CER 0.23%, 핵심 토큰 100%, bbox IoU 0.617, 평균 1.16초
- Tesseract 탈락: CER 3.02%, 핵심 토큰 87.5%, `1.2%→12%` 오인

## 알려진 한계

- 파일·텍스트 제한값은 대표 용량 표본 전까지 임시값이다.
- OCR 품질 임계값은 합성 표본 기준이며 익명화한 실제 이력서로 재보정해야 한다.
- PaddleOCR가 OpenCV를 전이 의존성으로 포함하지만 애플리케이션 전처리는 Pillow만 사용한다.
- HWP와 비텍스트 다이어그램 의미 분석은 범위 밖이다.

## Phase 2 입력

검토 모델은 이미 정규화된 `PageDocument | FlowDocument`만 읽는다. 원본 파일이나 픽셀 렌더링을 AI에 전달하지 않는다.
