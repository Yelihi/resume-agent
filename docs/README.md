# 문서 안내

현재 서비스 설명은 [프로젝트 README](../README.md), 실제 운영 상태는 [운영 설명서](../deploy/OPERATIONS_GUIDE.md)를 먼저 확인한다. 설계·계획·단계별 문서에는 과거 구현 시점의 기록도 포함되어 있다.

| 폴더 | 문서 |
| --- | --- |
| [design](design/) | [제품 설계](design/DESIGN_NOTES.md), [기본 검토 원칙](design/DEFAULT_REVIEW_RULES.md), [화면 검증 기록](design/design-qa.md) |
| [plan](plan/) | [구현 계획](plan/IMPLEMENTATION_PLAN.md), [배포 계획](plan/DEPLOYMENT_PLAN.md), [용량·삭제·복구 안내](plan/STORAGE_MANAGEMENT.md) |
| [phase](phase/) | 1~3차 CONTEXT, ISSUES, TEST_CASES 기록 |
| [architecture](architecture/) | [인터랙티브 구성도](https://yelihi.github.io/resume-agent/), 원본과 검증 기록 |
| [deploy](../deploy/) | 설치·운영·CI/CD·백업 실행 절차와 스크립트 |

루트에는 `README.md`만 두며 제품 설계와 계획 문서를 위 폴더에서 관리한다. 실행 명령의 상대 경로는 별도 설명이 없으면 저장소 루트 기준이다. 기존 `frontend/`와 `backend/` 내부 문서는 해당 코드 가까이에 유지한다.

개선 작업은 항상 새 브랜치에서 시작하고, 한글 제목과 본문의 PR로 제출한다. `main`에 직접 푸시하지 않는다.
