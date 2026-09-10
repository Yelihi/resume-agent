# OCR Engine Decision

## 선택

초기 런타임은 PaddleOCR 3.7과 PaddlePaddle CPU 3.2.1을 사용한다.

- 검출: `PP-OCRv5_mobile_det`
- 인식: `korean_PP-OCRv5_mobile_rec`
- 방향 분류·문서 펼침: 기본 실행에서는 끔

## 환경

- macOS 26.5.1, ARM64
- Python 3.12.12
- Tesseract 5.5.3, `kor+eng`

## 합성 이력서 표본 결과

| 후보 | 평균 문자 오류율 | 핵심 토큰 재현율 | 평균 줄 bbox IoU | 평균 처리 시간 |
|---|---:|---:|---:|---:|
| PaddleOCR mobile | 0.23% | 100% | 0.617 | 1.16초 |
| Tesseract CLI | 3.02% | 87.5% | 0.805 | 0.69초* |

`*` Tesseract 첫 실행 2.55초, 이후 약 0.23초였다.

Tesseract는 여러 표본에서 `1.2%`를 `12%`로 높은 confidence와 함께 오인했다. PaddleOCR 모바일 조합은 다섯 표본 모두 날짜·수치·기술명 핵심 토큰을 보존했다. 제품 우선순위가 핵심 토큰 정확도→전체 오류율→좌표→속도이므로 PaddleOCR를 선택했다.

서버 검출 모델은 약 8~11초가 걸려 제외했다. 모바일 검출 모델은 공식적으로 효율 중심 모델이며 같은 표본에서 더 빠르고 정확했다.

## 재현

```bash
uv run python -m benchmarks.ocr.generate_samples
uv run python -m benchmarks.ocr.tesseract_benchmark
python -m benchmarks.ocr.paddle_benchmark
```

생성 표본과 원시 보고서는 Git에 저장하지 않는다. 개인정보를 제거하고 수동 검수한 실제 이력서 표본을 확보하면 같은 지표로 다시 검증한다.

참고: https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html
