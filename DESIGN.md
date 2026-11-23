# Resume Review 디자인 기준

사용자가 제공한 **ElevenLabs — Style Reference**를 전체 테마로 적용한다. [awesome-design-md](https://github.com/VoltAgent/awesome-design-md)는 여러 브랜드의 장식과 패턴을 점검하는 자료로만 사용한다.

문서 검토 화면은 크림색 종이 위에 검은 잉크로 정리한 작업 공간이다. 원문, 인용, 판단의 위치를 타이포그래피와 얇은 선으로 구분한다.

| 용도 | 적용 기준 |
|---|---|
| 캔버스 | `#fdfcfc` 에그셸을 앱과 문서의 기본 면으로 사용한다. `#f5f3f1` 토프는 탐색 영역과 인용, `#ebe8e4` 스톤은 구분선과 선택 면에 쓴다. |
| 색의 대비 | `#000000` 잉크로 주요 제목·링크·실행 버튼을 표시한다. 본문은 `#44403b`, 메타데이터는 `#777169`를 쓴다. 청색 `#0447ff`와 오렌지 `#ff4704`는 제품 그래픽 전용이다. 이 화면에는 문서가 중심이므로 해당 색의 장식은 생략한다. |
| 글꼴 | Waldenburg 300 대신 Inter 300을 우선한다. 설치된 한글 글꼴이 필요할 경우 Pretendard나 시스템 글꼴로 대체한다. 화면 제목은 32–48px, 자간 −0.02em이다. 본문은 14–16px, 조작 요소는 500 굵기를 쓴다. |
| 모양 | 버튼, 태그, 선택 탭은 캡슐 형태다. 패널은 20px, 큰 문서 면은 24px, 입력은 4px 반경이다. 4px 단위 간격과 낮은 깊이의 그림자를 사용한다. |
| 레이아웃 | 두 검토 화면은 제목·탭·버전 도구 모음을 공유한다. 넓은 화면은 문서와 평가를 좌우에 놓고, 좁은 화면은 읽는 순서대로 쌓는다. |
| 상태 | 충족·미확인·실패를 명시하는 텍스트를 넣는다. 선택은 스톤 배경과 잉크 테두리, 키보드 포커스는 검은 외곽선으로 표시한다. |

작업 공간 목록, 업로드, 경험 기록, 자료 보관함, 설정은 [PageHeading](frontend/src/components/PageHeading.tsx)에서 같은 제목 크기와 여백을 쓴다. 목록과 설정 패널은 최대 1280px 범위에 배치하고, 업로드는 한 열의 좁은 양식으로 구성한다.

공통 토큰은 [tokens.css](frontend/src/design-system/tokens.css), 검토 화면 배치는 [review-desk.css](frontend/src/features/workspaces/review-desk.css), 공통 헤더는 [ReviewDeskHeader](frontend/src/features/workspaces/ReviewDeskHeader.tsx)에 둔다. 제품 소개 페이지의 대형 섹션 간격은 문서 검토의 조작 밀도에 맞게 줄인다.
