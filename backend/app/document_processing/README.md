# 추출 단계의 책임

별도 노드 프레임워크 없이 함수 경계로 처리한다.

| 단계 | 진입점 | 책임 |
| --- | --- | --- |
| 입력 검증 | `resume.api._extract_file`, `validation.validate_file` | 크기·형식 검증, 추출 실패를 API 오류로 반환 |
| 기본 추출 | `pdf.extract_embedded_blocks`, `flow.extract_docx/extract_txt` | 문자와 위치 추출 |
| 복구 | `ocr.extract_pdf_with_ocr`, `ocr.extract_image` | 표시 문자 재추출 → OCR, 복구·누락 근거 기록 |
| 품질 판정 | `quality.assess_document` | 잔여 깨짐·낮은 OCR 신뢰도 검사, 구간별 기록과 상태 생성 |
| 사용자 확인 | `ExtractionPreview` | 원본/추출문·의심 구간 확인 후 명시적으로 저장 |
| 검토 전달 | `quality.require_reviewable` | 새 검토 및 저장 기록 재실행 요청에서 미확인 문서 차단 |

문서의 `extraction`에 상태(`complete`, `recovered`, `needs_review`), 확인 여부,
각 사유의 단계·코드·메시지·페이지·lineIds·bbox·복구 여부를 저장한다.
실패는 기존 422 오류 계약으로 반환하며 문서를 저장하지 않는다.
구조가 바뀐 복구 구간은 이전 lineId를 사용하지 않고 페이지와 bbox로 기록한다.
보고서는 IndexedDB의 원문 버전 및 재실행 입력과 함께 유지된다.

`complete`는 자동 검사상 이상 징후 없음이다. 원본 이미지와 의미가 같다는 보증이 아니다.
현재 자동 이미지 대조 모델이나 교정 기능은 없다. DOCX/TXT 확인 화면은 추출문을 표시하므로
원본 파일을 별도로 열어 비교하도록 안내한다. 틀린 내용은 저장을 취소하고 원본을 수정하거나 직접 입력한다.
사용자 확인은 결과 사용 동의이며 원문 데이터는 바꾸지 않는다.

기존 문서에 보고서가 없어도 검토 요청 시 문자/신뢰도 검사를 수행한다.
과거에 조용히 생략된 이미지 영역 등 당시 기록하지 않은 사항은 복원할 수 없으므로 재업로드가 필요하다.
