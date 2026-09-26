# Phase 1 Test Cases

## P1-02 문서 계약·입력 검증

- 유효한 `PageDocument`와 `FlowDocument` 생성
- 중복·잘못된 `lineId`, 페이지 번호와 block ID 거부
- bbox 음수·0 크기·1 초과·경계 합 초과 거부
- UTF-16 surrogate pair가 포함된 줄의 end-exclusive offset 검증
- 빈 파일·빈 텍스트·제한 초과·엔드포인트와 실제 형식 불일치 오류
- PDF, PNG/JPEG, DOCX ZIP 구조와 UTF-8 TXT 실제 형식 판별

## P1-03 FlowDocument 추출

- BOM 제거, CRLF·CR의 LF 통일과 그 외 공백 보존
- 빈 줄을 기준으로 block 분리
- 직접 텍스트·TXT 결과 동일성
- DOCX 머리글→본문 문단·표 OOXML 순서→바닥글 순서
- 모든 줄의 UTF-16 offset으로 원문 재조회

## P1-04 내장 텍스트 PDF 추출

- 페이지·블록·줄·정규화 bbox 생성
- 다단 PDF도 좌표 순서를 보존하고 강제 재정렬하지 않음
- 암호화·손상 PDF 오류
- 모든 bbox와 ID 불변 조건 검증

## P1-05 OCR 검증 게이트

- 후보별 설치·실행 가능 여부
- 한글·영문 혼합, 날짜·수치·기술명 문자 정확도
- 줄 검출과 bbox 정확도
- 해상도·압축·기울기 변형별 처리 시간

## P1-06 OCR 통합

- 이미지와 스캔 PDF의 OCR 줄·bbox 생성
- 내장 텍스트와 OCR 중첩 시 내장 텍스트 우선
- 저신뢰 단어의 `uncertainWords` 변환
- 1회 보정 재시도 성공과 최종 품질 실패

## P1-07 추출 API

- 정책 조회와 다섯 입력 엔드포인트의 고정 응답 타입
- 정상 multipart 및 JSON 요청
- 413, 415, 422와 예상하지 못한 500 오류 본문
- 업로드 임시 파일이 요청 종료 후 남지 않음

## P1-08 통합 검증

- 지원 형식 전체의 실제 HTTP 성공 경로
- 빈 입력·위장 형식·손상 파일 회귀
- 전체 응답의 line ID, bbox, offset 불변 조건 일괄 검사
