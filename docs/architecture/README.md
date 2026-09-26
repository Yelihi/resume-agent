# 아키텍처 그림과 검증 기록

[프로젝트 README의 설명](../../README.md#아키텍처-이해하기)과 함께 읽는다. 운영 서비스의 코드를 바꾸지 않는 문서 산출물이다.

## 서비스 구성도

- [탐색용 HTML](runtime.html): 파일을 다운로드하거나 로컬에서 브라우저로 연다. 별도 서버가 필요 없다.
- [Archify 원본](runtime.architecture.json): `architecture` 유형, showcase 품질 기준.
- [밝은 테마](runtime.visual-check.2048x1320.light.png), [어두운 테마](runtime.visual-check.2048x1320.dark.png): 정확히 배포된 HTML에서 수집한 화면 캡처. README에는 밝은 테마를 표시한다.
- [아티팩트 검증 영수증](runtime.delivery.json), [브라우저 검사 영수증](runtime.visual-check.json), [네 장의 검토 화면](runtime.visual-check.html).

작성 기준은 저장소 커밋 `d50233b556bc223db2486122ce1780e98537358d`와 2026-09-26 운영 기록이다. HTML의 SRC 링크는 검증한 해당 커밋의 코드로 연결된다. 모든 관계선에는 전달하는 요청이나 수행하는 작업을 표시했다. 응답의 역방향과 정적 파일 반환은 하단 설명 카드와 프로젝트 README에서 설명한다.

Archify 2.17로 생성했다. 설명은 한국어이고 고정 Viewer UI와 `<html lang>`은 영어 기본값이다. 생성된 HTML을 직접 수정하지 않고 JSON 원본을 수정한 뒤 다시 검증·생성한다.

## 검증 결과

| 항목 | 결과 |
| --- | --- |
| diagram_type | architecture |
| validation | showcase 9/9, 오류 0, 경고 0 |
| browser_evidence | passed |
| visual_review | passed — 아래 범위의 캡처 직접 검토 |
| correction_rounds | 0 — 최초 성공 delivery 이후 시각 수정 없음 |
| 원본 크기 | 5,311 bytes |
| HTML 크기 | 810,665 bytes |

```text
specification_sha256: 3a0684a3682185225150962832447b4dee4d03a2506939d7b3b2a8b4fff881c2
artifact_sha256: 8ae54a58e73c5c1da1e36d14a07af1ac18806aba481d3b2df29fb21d887d1a10
```

`deliver`의 결정적 아티팩트 검사, `visual-check`의 실제 Chrome 검사, 화면을 직접 본 시각 검토는 각각 별도로 확인했다. 브라우저 자동 검사는 1440×900, 1600×1000, 1920×1080, 2048×1320에서 가로·세로 넘침과 가독성·뷰어 컨트롤 배치를 통과했다. 처음에는 샌드박스에서 Chrome 실행이 실패했으나 권한 승인 후 동일 HTML로 재실행해 통과했다.

직접 검토한 범위는 1440×900 및 2048×1320의 밝은·어두운 테마 총 네 장이다. 노드와 관계선의 겹침, 라벨 잘림, 그룹 경계, 하단 카드와 큰 화면의 세로 균형을 확인했다. 이 검토는 기본 READ/Still 화면에 대한 것이며, 모든 탐색·내보내기 기능의 상호작용 시험이나 운영 서비스의 로그인·AI 시험을 대신하지 않는다.

## 자동 배포 그림의 범위

추가 [Archify workflow 초안](deployment.workflow.json)은 **미승인 초안**이며 HTML로 제공하지 않는다. 두 차례의 가독성 수정 뒤에도 1440px 기준 예상 보조 글자 크기가 5.82px로 최소 6px에 미달했다(`composition/desktop-readability`). 오류 수가 두 번 연속 줄지 않으면 중단하는 스킬 규칙에 따라 추가 수정을 멈췄다. 실패한 초안을 검증 완료된 그림으로 표시하지 않는다.

대신 프로젝트 README에 GitHub에서 바로 표시되는 Mermaid 배포 흐름과 파일별 동작 표를 넣었다. 프런트·백엔드 분리, Mac의 요청 조회, 백업·재시작·실패 처리에 대한 설명은 모두 포함되어 있다.

## 다시 생성할 때

프로젝트 루트에서 설치된 Archify 경로를 사용한다.

```sh
node /Users/yelihi/.agents/skills/archify/bin/archify.mjs validate architecture docs/architecture/runtime.architecture.json --repo-root . --quality showcase --json
node /Users/yelihi/.agents/skills/archify/bin/archify.mjs deliver architecture docs/architecture/runtime.architecture.json docs/architecture/runtime.html --repo-root . --quality showcase --json > docs/architecture/runtime.delivery.json
node /Users/yelihi/.agents/skills/archify/bin/archify.mjs visual-check docs/architecture/runtime.html --json
```

각 명령이 성공했을 때만 다음 명령을 실행한다. 새 영수증과 캡처를 확인하고 위 해시·검토 기록도 갱신한다. 원본 코드가 바뀌면 먼저 사실관계를 다시 확인한 뒤 `meta.repository.revision`을 갱신한다.
