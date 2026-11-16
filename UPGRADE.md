# 차량 업그레이드 자료 관리

화면의 팀·차량 업그레이드는 경기별 FIA Car Presentation Submissions를 기준으로 합니다.

## 현재 수집 범위

- 2026년 호주 GP부터 상파울루 GP까지 완료된 20개 GP
- 경기마다 11개 팀, 총 220개 제출 상태와 447개 부품 변경 항목
- 원본 PDF 링크와 항목별 쪽수 포함
- 테스트·미수집 경기는 자료 미확인으로 표시하며, 업데이트 제출 없음과 구분
- FIA의 제출 내용은 실제 장착 여부나 측정된 성능 향상량을 뜻하지 않음

## 다시 수집하기

Node 22 이상과 Python의 pdfplumber가 필요합니다.

```powershell
node scripts/fetch-car-upgrades.mjs --year 2026
python scripts/extract-car-upgrades.py 2026
node --test tests/*.test.mjs
```

`fetch-car-upgrades.mjs`는 FIA 공식 경기 페이지에서 해당 연도의 실제 PDF 링크를 찾습니다. 내려받은 PDF와 출처 목록, 추출 원문은 `tmp/fia/2026/`에 보관하며 Git에 포함하지 않습니다. 공개 데이터는 `data/car-upgrades/2026.json`입니다.

원본 표의 열 구조가 달라지거나 이미지로만 제공되면 자동 추출이 불완전할 수 있습니다. 미확인 팀을 확인하고 원본을 검토한 뒤 배포합니다. 호주 GP Williams 표는 이미지여서 원본 10쪽을 직접 확인한 보완값을 추출 스크립트에 넣었습니다.

## 항목 추가와 확인

경기 키는 `data/2026/index.json`과 일치해야 합니다. 각 경기에는 `source`, `status`, `teams`가 있고, 팀에는 `team`, `status`, `items`가 있습니다. 부품 항목은 `component`, `purpose`, `change`, `detail`, `page`를 사용합니다.

- `reported`: 제출한 변경 항목이 있음
- `none`: 원본에 업데이트 제출 없음이 명시됨
- `unavailable`: 해당 팀의 자료를 아직 확인하지 못함

새 PDF를 수집하면 추출 스크립트가 공개 JSON을 다시 생성하므로 수동 보완은 스크립트에도 기록합니다. 원본의 성능 개선 목적은 정리하되, 확인되지 않은 랩타임 개선 수치는 추가하지 않습니다.

## 상세 설명과 전문가 해설

각 항목의 `changeExplanation`은 변경 내용, `effectExplanation`은 목표와 작동 영역을 설명합니다. PDF의 병합 셀로 여러 부품에 묶인 설명은 함께 복원하고 `sharedExplanation`으로 표시합니다. `technicalSummary`는 팀의 제출 내용 요약이며 별도 전문가 발언이 아닙니다.

`data/car-upgrades/editorial-2026.json`에는 확인한 상세 설명 보완값(`itemOverrides`)과 전문가 해설(`experts`)을 저장합니다. 재수집할 때도 추출 스크립트가 이 보완값을 적용합니다.

전문가 해설에는 대상 팀, 실명, 소속·매체, 원문 주소와 한 문장 요약을 함께 기록합니다. 현재는 9개 GP에 출처를 확인한 해설을 연결했습니다. 요약은 직접 인용이 아니며, 출처를 확인하지 못한 경기·팀에는 임의의 전문가 의견을 만들지 않습니다.

## 그래프 기준

랩 진행 그래프는 실제 랩 번호와 실제 랩타임을 사용합니다. 서로 다른 랩의 섹터를 합쳐 만든 환산값은 사용하지 않습니다. 클린 랩은 피트 진입·출발 랩과 본인 최고 랩의 107%를 초과한 랩을 제외하며, 제외·누락 랩 사이의 선을 끊습니다. 전체 랩에서는 기록을 임의로 잘라내지 않습니다.

개발·검증은 `C:\Development\f1-preview`에서 하며, GitHub Pages 확인 후 운영 폴더에 별도로 반영합니다. 배포 흐름은 DEPLOYMENT.md를 참고합니다.
