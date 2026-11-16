# F1 랩타임

시즌 → 경기별로 세션 순위(FP1~3, Q1~3, 레이스)와 선수별 랩·섹터 기록 그래프를 보는 정적 사이트입니다.
데이터는 [OpenF1](https://openf1.org)에서 받아 `data/`에 JSON으로 저장합니다.

경기를 선택하면 **팀·차량 업그레이드**에서 FIA에 제출한 부품 변경과 목적을 볼 수 있습니다. 2026년 완료된 20개 GP, 11개 팀의 447개 변경 항목을 수집했고 원본 문서와 쪽수를 연결했습니다. 자료 추가 방법은 [UPGRADE.md](UPGRADE.md)에 기록합니다.

개발은 `C:\Development\f1-preview`에서 진행합니다. **GitHub Pages에서 먼저 완성한 뒤 운영 사이트에 배포**하는 순서와 폴더 구분은 [DEPLOYMENT.md](DEPLOYMENT.md)를 따릅니다.


## 구조

- `index.html`, `assets/` — 화면 (빌드 과정·외부 라이브러리 없음)
- `scripts/fetch.mjs` — 수집 스크립트 (Node 22, 의존성 없음)
- `data/<연도>/index.json` — 그 시즌의 경기·세션 목록
- `data/<연도>/<세션 키>.json` — 세션 하나의 선수별 랩·섹터 기록과 공식 순위
- `data/car-upgrades/<연도>.json` — 경기·팀별 차량 업데이트와 FIA 출처
- `scripts/fetch-car-upgrades.mjs`, `scripts/extract-car-upgrades.py` — FIA PDF 수집과 표 추출 (수동 실행)
- `.github/workflows/update.yml` — 매시간 수집 후 GitHub Pages 배포

## 자동 갱신

워크플로가 매시간 돌면서 끝난 지 30분이 지난 세션 중 아직 없는 것만 받아 커밋하고 배포합니다.
연도는 실행 시점의 연도를 쓰므로 다음 시즌도 일정이 OpenF1에 올라오면 탭이 자동으로 생깁니다.

처음 한 번만 설정하면 됩니다.

1. 이 코드를 `main` 브랜치에 둡니다 (예약 실행은 기본 브랜치에서만 동작).
2. 저장소 Settings → Pages → Source를 **GitHub Actions**로 바꿉니다.

## 직접 실행

```bash
node scripts/fetch.mjs --year 2026
```

```bash
python3 -m http.server 8000
```

지난 시즌을 추가하려면 Actions 탭에서 워크플로를 수동 실행하며 연도를 넣으면 됩니다.

Windows 운영 서버의 `serve.mjs`는 `C:\Development\f1`에 있습니다. 개발 확인은 이 폴더에서 `python -m http.server 8001`로 별도 서버를 열거나 GitHub Pages에 배포해 진행합니다.

## 화면과 집계 기준

- 세션별 순위: OpenF1의 공식 결과. Q1~Q3 순위는 각 구간 기록으로 매깁니다.
- 랩 진행 그래프: x축은 실제 랩 번호, y축은 실제 랩타임. 누락되거나 제외된 랩은 이어 그리지 않습니다.
- 섹터별 비교 그래프: 섹터마다 가장 빠른 선수와의 차이(초)
- 클린 랩(기본): 피트 진입·출발 랩과 본인 최고 랩의 107%를 넘는 랩을 뺀 것. 전체 랩으로 바꿀 수 있습니다.
- OpenF1 랩 데이터에는 트랙 리밋으로 삭제된 랩 표시가 없어 최고 랩이 공식 기록과 다를 수 있습니다.
