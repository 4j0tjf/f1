// F1 랩타임 뷰어. data/ 아래 JSON만 읽는 정적 페이지다 (scripts/fetch.mjs가 생성).

import { readPreference, writePreference, readHiddenDrivers } from './preferences.js?v=20261116.1';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const CLEAN_LIMIT = 1.07; // 클린: 본인 최고 랩의 107% 이내
const FULL_LIMIT = 2.2; // 전체 랩 보기: 세션 최고 랩의 220%까지 축에 담는다 (적기 중단처럼 몇십 분짜리 랩 제외)
const DASHES = ['', '6 4', '2 4']; // 같은 팀 선수는 색이 같으므로 선 모양으로 구분

const KO_NAMES = {
  'Pre-Season Testing': '프리시즌 테스트',
  Australian: '호주', Chinese: '중국', Japanese: '일본', Bahrain: '바레인',
  'Saudi Arabian': '사우디', Miami: '마이애미', Canadian: '캐나다', Monaco: '모나코',
  Barcelona: '바르셀로나', Spanish: '스페인', Austrian: '오스트리아', British: '영국',
  Belgian: '벨기에', Hungarian: '헝가리', Dutch: '네덜란드', Italian: '이탈리아',
  Azerbaijan: '아제르바이잔', Singapore: '싱가포르', 'United States': '미국',
  'Mexico City': '멕시코시티', 'São Paulo': '상파울루', 'Las Vegas': '라스베이거스',
  Qatar: '카타르', 'Abu Dhabi': '아부다비', 'Emilia Romagna': '에밀리아로마냐',
  Madrid: '마드리드', Portuguese: '포르투갈', Turkish: '튀르키예', German: '독일', French: '프랑스',
};
const KO_SESSIONS = {
  'Practice 1': 'FP1', 'Practice 2': 'FP2', 'Practice 3': 'FP3',
  Qualifying: '퀄리파잉', 'Sprint Qualifying': '스프린트 퀄리파잉',
  'Sprint Shootout': '스프린트 슛아웃', Sprint: '스프린트', Race: '레이스',
  'Day 1': '1일차', 'Day 2': '2일차', 'Day 3': '3일차',
};
const COMPOUNDS = { S: '소프트', M: '미디엄', H: '하드', I: '인터미디어트', W: '웨트' };

const state = {
  seasons: [],
  year: null,
  index: null, // 시즌 index.json
  meeting: null,
  sessions: [], // 이 경기에서 데이터가 있는 세션들 (index 항목)
  loaded: new Map(), // 세션 키 → 세션 JSON
  session: null,
  drivers: [], // 이 경기에 나온 모든 선수 (세션 합집합, 선 모양 포함)
  mode: readPreference('f1.mode', 'clean') === 'all' ? 'all' : 'clean',
  sectorMode: readPreference('f1.sector', 'best') === 'avg' ? 'avg' : 'best',
  hidden: readHiddenDrivers(), // 체크 해제한 선수 코드
};

// ───────── 유틸 ─────────

function el(tag, attrs = {}, ...children) {
  const node = attrs.svg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'svg' || v == null) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}
const s = (tag, attrs = {}, ...children) => el(tag, { ...attrs, svg: true }, ...children);

function fmt(sec, digits = 3) {
  if (sec == null || !isFinite(sec)) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec - h * 3600) / 60);
  const rest = (sec - h * 3600 - m * 60).toFixed(digits).padStart(digits ? digits + 3 : 2, '0');
  if (h) return `${h}:${String(m).padStart(2, '0')}:${rest}`;
  return m ? `${m}:${rest}` : rest;
}
const fmtGap = (sec) => `+${sec.toFixed(3)}`;

const getJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { cache: 'no-cache', signal: controller.signal });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
};

function showLoadError(error) {
  console.error(error);
  $('main').hidden = true;
  $('status').hidden = false;
  const retry = el('button', { type: 'button', text: '다시 불러오기' });
  retry.addEventListener('click', () => location.reload());
  $('status').replaceChildren(
    el('span', { text: '데이터를 불러오지 못했습니다. 연결 상태를 확인해 주세요. ' }), retry,
  );
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function meetingLabel(m, all) {
  const base = m.name.replace(/ Grand Prix$/, '');
  let label = KO_NAMES[base] ?? base;
  const same = all.filter((x) => x.name === m.name);
  if (same.length > 1) label += ` ${same.indexOf(m) + 1}`;
  return label;
}
const sessionLabel = (name) => KO_SESSIONS[name] ?? name;
const dateLabel = (iso) =>
  new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });

const visible = (d) => !state.hidden.has(d.code);
const styleOf = (code) => state.drivers.find((d) => d.code === code);

// 선수 식별용 짧은 선 견본 (팀 색 + 선 모양)
function lineSwatch(d) {
  return s(
    'svg',
    { class: 'line-swatch', viewBox: '0 0 22 8', width: 22, height: 8, 'aria-hidden': 'true' },
    s('line', { x1: 1, x2: 21, y1: 4, y2: 4, stroke: d.color, 'stroke-width': 2.5, 'stroke-dasharray': d.dash }),
  );
}

// ───────── 통계 ─────────

function computeStats(driver, mode) {
  const all = driver.laps;
  const best = Math.min(...all.map((l) => l[1]));
  const used = mode === 'all' ? all : all.filter((l) => !l[2] && l[1] <= best * CLEAN_LIMIT);
  const times = used.map((l) => l[1]).sort((a, b) => a - b);
  const sector = (laps, k, pick) => {
    const xs = laps.map((l) => l[4 + k]).filter((v) => v > 0);
    return xs.length ? pick(xs) : null;
  };
  return {
    driver,
    best,
    laps: used,
    total: all.length,
    avg: mean(times),
    median: quantile(times, 0.5),
    sectorBest: [0, 1, 2].map((k) => sector(all, k, (xs) => Math.min(...xs))),
    sectorAvg: [0, 1, 2].map((k) => sector(used, k, mean)),
  };
}

// ───────── 탭 ─────────

function tabButton(label, selected, onClick, sub) {
  const b = el('button', { type: 'button', role: 'tab', 'aria-selected': selected }, label);
  if (sub) b.append(el('small', { text: sub }));
  b.addEventListener('click', () => Promise.resolve().then(onClick).catch(showLoadError));
  return b;
}

function renderSeasons() {
  $('seasons').replaceChildren(
    ...state.seasons.map((y) => tabButton(`${y} 시즌`, y === state.year, () => selectSeason(y))),
  );
}

function renderMeetings() {
  const meetings = state.index.meetings.filter((m) => m.sessions.some((x) => x.laps));
  $('meetings').replaceChildren(
    ...meetings.map((m) =>
      tabButton(meetingLabel(m, state.index.meetings), m === state.meeting, () => selectMeeting(m), dateLabel(m.start)),
    ),
  );
  $('meetings').querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function renderSessions() {
  $('sessions').replaceChildren(
    ...state.sessions.map((x) => {
      const b = el('button', { type: 'button', 'aria-pressed': x === state.session, text: sessionLabel(x.name) });
      b.addEventListener('click', () => selectSession(x));
      return b;
    }),
  );
}

// ───────── 선수 체크박스 ─────────

// 경기 전체 세션에서 선수 목록을 모으고 팀 안 순서대로 선 모양을 정한다.
function collectDrivers() {
  const byCode = new Map();
  for (const x of state.sessions) {
    for (const d of state.loaded.get(x.key).drivers) {
      if (!byCode.has(d.code)) {
        byCode.set(d.code, { num: d.num, code: d.code, name: d.name, team: d.team, color: d.color || '#888', count: 0 });
      }
      byCode.get(d.code).count++;
    }
  }
  // 팀 안에서는 세션에 많이 나온 선수(정규 드라이버)가 먼저 와서 실선·파선을 받는다.
  const drivers = [...byCode.values()].sort(
    (a, b) => a.team.localeCompare(b.team) || b.count - a.count || a.num - b.num,
  );
  const seen = new Map();
  for (const d of drivers) {
    const i = seen.get(d.team) ?? 0;
    d.dash = DASHES[Math.min(i, DASHES.length - 1)];
    seen.set(d.team, i + 1);
  }
  state.drivers = drivers;
}

function renderDrivers() {
  const list = $('driver-list');
  list.replaceChildren();
  let box;
  let team;
  for (const d of state.drivers) {
    if (d.team !== team) {
      team = d.team;
      box = el('div', { class: 'team' }, el('div', { class: 'team-name', text: team || '기타' }));
      list.append(box);
    }
    const input = el('input', { type: 'checkbox' });
    input.checked = visible(d);
    input.addEventListener('change', () => {
      if (input.checked) state.hidden.delete(d.code);
      else state.hidden.add(d.code);
      saveHidden();
      renderAll();
    });
    box.append(
      el('label', { class: 'driver', title: d.name }, input, lineSwatch(d), el('b', { text: d.code }), el('span', { text: d.name })),
    );
  }
}

function saveHidden() {
  writePreference('f1.hidden', JSON.stringify([...state.hidden]));
}

function setAll(on) {
  for (const d of state.drivers) {
    if (on) state.hidden.delete(d.code);
    else state.hidden.add(d.code);
  }
  saveHidden();
  renderDrivers();
  renderAll();
}

// ───────── 경기 순위표 ─────────

// 세션 하나를 순위표의 열(들)로 바꾼다. 각 열은 선수 번호 → { pos, text } 맵.
function rankColumns(entry) {
  const data = state.loaded.get(entry.key);
  const results = data.results ?? [];
  const label = sessionLabel(entry.name);

  if (entry.type === 'Qualifying') {
    const prefix = entry.name.startsWith('Sprint') ? 'SQ' : 'Q';
    return [0, 1, 2].map((k) => {
      const timed = results
        .filter((r) => Array.isArray(r.time) && r.time[k] != null)
        .sort((a, b) => a.time[k] - b.time[k]);
      return {
        label: `${prefix}${k + 1}`,
        cells: new Map(timed.map((r, i) => [r.num, { pos: i + 1, text: fmt(r.time[k]) }])),
      };
    });
  }

  if (entry.type === 'Race') {
    return [
      {
        label,
        final: true,
        cells: new Map(
          results.map((r) => {
            let text = r.status;
            if (!text && r.pos === 1) text = fmt(r.time);
            else if (!text && typeof r.gap === 'number') text = fmtGap(r.gap);
            else if (!text) text = r.gap ?? '';
            return [r.num, { pos: r.pos, text }];
          }),
        ),
      },
    ];
  }

  // 연습: 공식 결과가 없으면 최고 랩으로 직접 순위를 매긴다.
  let rows = results.filter((r) => r.pos != null && typeof r.time === 'number');
  if (!rows.length) {
    rows = data.drivers
      .map((d) => ({ num: d.num, time: Math.min(...d.laps.map((l) => l[1])) }))
      .sort((a, b) => a.time - b.time)
      .map((r, i) => ({ ...r, pos: i + 1 }));
  }
  return [{ label, cells: new Map(rows.map((r) => [r.num, { pos: r.pos, text: fmt(r.time) }])) }];
}

function renderRanking() {
  const columns = state.sessions.flatMap(rankColumns);
  // 행 순서: 가장 마지막 세션 순위. 그 세션에 없는 선수는 앞선 세션 순위로 뒤에 붙인다.
  const order = (d) => {
    for (let i = columns.length - 1, tier = 0; i >= 0; i--, tier++) {
      const cell = columns[i].cells.get(d.num);
      if (cell) return tier * 1000 + (cell.pos ?? 500);
    }
    return Infinity;
  };
  const rows = state.drivers.filter(visible).sort((a, b) => order(a) - order(b));

  $('ranking').replaceChildren(
    el('thead', {}, el('tr', {}, el('th', { text: '선수' }), ...columns.map((c) => el('th', { text: c.label })))),
    el(
      'tbody',
      {},
      ...rows.map((d) =>
        el(
          'tr',
          {},
          el('td', { title: `${d.name} · ${d.team}` }, lineSwatch(d), el('b', { text: d.code })),
          ...columns.map((c) => {
            const cell = c.cells.get(d.num);
            if (!cell) return el('td', { class: 'none', text: '–' });
            return el(
              'td',
              { class: cell.pos && cell.pos <= 3 ? 'podium' : null },
              el('b', { text: cell.pos ?? '–' }),
              el('small', { text: cell.text }),
            );
          }),
        ),
      ),
    ),
  );
  $('ranking-empty').hidden = rows.length > 0;
}

// ───────── 선 차트 공통 ─────────

function niceTicks(min, max, target) {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  const step = steps.find((x) => (max - min) / x <= target) ?? 300;
  const ticks = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return { ticks, digits: step < 0.1 ? 2 : step < 1 ? 1 : 0 };
}

// 단조 3차 보간: 점을 지나되 점 사이에서 출렁이지 않는 곡선
function smoothPath(pts) {
  const n = pts.length;
  if (n < 3) return 'M' + pts.map((p) => `${p[0]},${p[1]}`).join('L');
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t[i] =
      m[i - 1] * m[i] <= 0
        ? 0
        : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  t[n - 1] = m[n - 2];
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

const tooltip = $('tooltip');
function showTooltip(evt, title, lines) {
  tooltip.replaceChildren(
    el('strong', { text: title }),
    ...lines.map(([label, value]) => el('div', {}, el('span', { text: label }), el('span', { text: value }))),
  );
  tooltip.hidden = false;
  const { width, height } = tooltip.getBoundingClientRect();
  const px = evt.clientX + 14 + width > innerWidth ? evt.clientX - width - 14 : evt.clientX + 14;
  const py = Math.min(Math.max(8, evt.clientY - height - 10), innerHeight - height - 8);
  tooltip.style.left = `${Math.max(8, px)}px`;
  tooltip.style.top = `${py}px`;
}

let clipId = 0;

// 선수별 선 차트.
//   series: [{ driver, segments: [[{ x, y, ... }]] }]  — segment 단위로 선이 끊긴다
//   series[].marks: [x] — 그 선수의 표식(피트 스톱)을 그래프 아래쪽 가장자리에 ▲로 찍는다
//   bands: [{ x1, x2, label }] — 배경 띠(세이프티카 구간)
//   xTicks: [{ v, label }], yFormat(v, digits), tip(driver, point) → [제목, [[라벨, 값]]]
function lineChart(host, { series, bands = [], xDomain, yDomain, xTicks, yFormat, height, smooth, tip }) {
  const width = Math.max(host.clientWidth, 280);
  const m = { left: 54, right: 40, top: 10, bottom: 26 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const X = (v) => m.left + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW;
  const Y = (v) => m.top + plotH - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH;

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img' });
  const clip = `clip${++clipId}`;
  svg.append(
    s('clipPath', { id: clip }, s('rect', { x: m.left, y: m.top - 4, width: plotW + 4, height: plotH + 8 })),
  );

  const { ticks, digits } = niceTicks(yDomain[0], yDomain[1], Math.max(2, Math.floor(plotH / 44)));
  for (const t of ticks) {
    svg.append(
      s('line', { class: 'grid', x1: m.left, x2: m.left + plotW, y1: Y(t), y2: Y(t) }),
      s('text', { x: m.left - 8, y: Y(t) + 4, 'text-anchor': 'end', text: yFormat(t, digits) }),
    );
  }
  for (const t of xTicks) {
    svg.append(
      s('line', { class: 'grid', x1: X(t.v), x2: X(t.v), y1: m.top, y2: m.top + plotH }),
      s('text', { x: X(t.v), y: height - 8, 'text-anchor': 'middle', text: t.label }),
    );
  }

  const bandLabels = []; // 선 위에 보이도록 나중에 얹는다
  for (const b of bands) {
    const x1 = Math.max(X(b.x1), m.left);
    const x2 = Math.min(X(b.x2), m.left + plotW);
    if (x2 <= x1) continue;
    svg.append(s('rect', { class: 'band', x: x1, y: m.top, width: x2 - x1, height: plotH }));
    bandLabels.push(
      s('text', { class: 'band-label', x: (x1 + x2) / 2, y: m.top + 12, 'text-anchor': 'middle', text: b.label }),
    );
  }

  const plot = s('g', { 'clip-path': `url(#${clip})` });
  svg.append(plot);
  const points = []; // 호버 탐색용
  const labels = [];
  for (const sr of series) {
    const g = s('g', { class: 'series' });
    const st = styleOf(sr.driver.code);
    for (const seg of sr.segments) {
      const pts = seg.map((p) => [X(p.x), Y(p.y)]);
      if (pts.length === 1) {
        g.append(s('circle', { cx: pts[0][0], cy: pts[0][1], r: 2.5, fill: st.color }));
      } else {
        g.append(
          s('path', {
            d: smooth ? smoothPath(pts) : 'M' + pts.map((p) => p.join(',')).join('L'),
            stroke: st.color,
            'stroke-dasharray': st.dash,
          }),
        );
      }
      seg.forEach((p, i) => {
        // 축 범위를 벗어난 점은 화면에 없으므로 호버 대상에서 뺀다
        if (pts[i][1] >= m.top - 4 && pts[i][1] <= m.top + plotH + 4) points.push({ px: pts[i][0], py: pts[i][1], p, sr, g });
      });
    }
    for (const mx of sr.marks ?? []) {
      const x = X(mx);
      g.append(s('path', { class: 'mark', d: `M${x - 4.5},${m.top + plotH + 3}h9l-4.5,-8z`, style: `fill:${st.color}` }));
    }
    plot.append(g);
    const last = sr.segments.at(-1)?.at(-1);
    if (last) labels.push({ y: Math.min(Math.max(Y(last.y), m.top), m.top + plotH), x: X(last.x), sr, g });
  }

  // 선 끝 라벨: 겹치지 않게 위에서 아래로 밀고, 바닥을 넘으면 다시 끌어올린다.
  labels.sort((a, b) => a.y - b.y);
  const gap = 11;
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + gap);
  const over = labels.length ? labels.at(-1).y - (m.top + plotH + 4) : 0;
  if (over > 0) {
    labels.at(-1).y -= over;
    for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - gap);
  }
  for (const l of labels) {
    const text = s('text', { class: 'end-label', x: m.left + plotW + 8, y: l.y + 4, text: l.sr.driver.code });
    l.g.label = text;
    svg.append(text);
  }

  const marker = s('circle', { class: 'marker', r: 4.5, visibility: 'hidden' });
  svg.append(...bandLabels, marker);

  let active = null;
  const clear = () => {
    svg.classList.remove('focus');
    active?.g.classList.remove('on');
    active?.g.label?.classList.remove('on');
    active = null;
    marker.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };
  svg.addEventListener('pointermove', (evt) => {
    const box = svg.getBoundingClientRect();
    const scale = width / box.width;
    const px = (evt.clientX - box.left) * scale;
    const py = (evt.clientY - box.top) * scale;
    let hit = null;
    let bestD = 40 * 40;
    for (const q of points) {
      const d = (q.px - px) ** 2 + (q.py - py) ** 2;
      if (d < bestD) [bestD, hit] = [d, q];
    }
    if (!hit) return clear();
    if (active?.g !== hit.g) {
      clear();
      svg.classList.add('focus');
      hit.g.classList.add('on');
      hit.g.label?.classList.add('on');
      plot.append(hit.g); // 강조한 선을 맨 위로
    }
    active = hit;
    marker.setAttribute('cx', hit.px);
    marker.setAttribute('cy', Math.max(hit.py, m.top - 4));
    marker.setAttribute('fill', styleOf(hit.sr.driver.code).color);
    marker.setAttribute('visibility', 'visible');
    const [title, lines] = tip(hit.sr.driver, hit.p);
    showTooltip(evt, title, lines);
  });
  svg.addEventListener('pointerleave', clear);
  host.replaceChildren(svg);
}

// ───────── 차트 1: 랩 진행 (섹터 단위) ─────────

const PERIOD_LABELS = { SC: 'SC', VSC: 'VSC', RED: '적기' };

// x는 랩·섹터 순서, y는 그 섹터까지 직전 세 섹터를 합친 "한 바퀴 기록".
// 섹터 길이가 달라도 선이 톱니처럼 튀지 않고, 섹터가 끝날 때마다 값이 갱신된다.
// 피트·세이프티카 구간도 선을 끊지 않는다. 클린 모드는 y축만 주행 구간에 맞춰 확대한다.
function renderPace(rows, data) {
  const sessionBest = Math.min(...rows.map((r) => r.best));
  let maxX = 0;
  const focus = []; // 클린 모드에서 y축 범위를 정할 값들
  const isRace = state.session.type === 'Race';
  const series = rows.map((r) => {
    const sectors = new Map(); // 섹터 순번 → { 기록, 랩 }
    for (const lap of r.driver.laps) {
      for (let k = 0; k < 3; k++) {
        if (lap[4 + k] > 0) sectors.set((lap[0] - 1) * 3 + k, { t: lap[4 + k], lap });
      }
    }
    // 피트아웃 랩의 바로 앞 랩이 피트로 들어간 랩이다. 레이스·스프린트에서만 표시한다.
    const pits = new Set(isRace ? r.driver.laps.filter((l) => l[2] && l[0] > 1).map((l) => l[0] - 1) : []);
    const segments = [];
    let current = null;
    for (const i of [...sectors.keys()].sort((a, b) => a - b)) {
      const [a, b, c] = [sectors.get(i - 2), sectors.get(i - 1), sectors.get(i)];
      if (!a || !b) {
        current = null;
        continue;
      }
      const y = a.t + b.t + c.t;
      if (!current || current.at(-1).i !== i - 1) segments.push((current = []));
      current.push({
        i, x: i + 1, y, t: c.t,
        lapNo: c.lap[0], sector: (i % 3) + 1, compound: c.lap[3],
        pit: pits.has(c.lap[0]),
      });
      if (y <= r.best * CLEAN_LIMIT) focus.push(y);
      maxX = Math.max(maxX, i + 1);
    }
    return { driver: r.driver, segments, marks: [...pits].map((lap) => lap * 3) };
  });

  const ys = series.flatMap((sr) => sr.segments.flatMap((seg) => seg.map((p) => p.y)));
  const host = $('chart-pace');
  if (!ys.length) {
    host.replaceChildren(el('p', { class: 'empty', text: '이 세션에는 섹터 기록이 없습니다.' }));
    $('pace-note').textContent = '';
    return;
  }
  const lo = Math.min(...ys);
  const top = Math.max(...ys);
  const hi = state.mode === 'clean' && focus.length ? Math.max(...focus) : Math.min(top, sessionBest * FULL_LIMIT);
  const pad = Math.max((hi - lo) * 0.05, 0.05);

  const laps = Math.ceil(maxX / 3);
  const step = [1, 2, 5, 10, 20].find((x) => laps / x <= Math.max(3, host.clientWidth / 60)) ?? 50;
  const xTicks = [];
  for (let n = step; n <= laps; n += step) xTicks.push({ v: n * 3, label: `${n}랩` });

  const periods = data.periods ?? [];
  lineChart(host, {
    series,
    bands: periods.map((p) => ({ x1: (p.from - 1) * 3 + 1, x2: p.to * 3, label: PERIOD_LABELS[p.kind] ?? p.kind })),
    xDomain: [1, Math.max(maxX, 4)],
    yDomain: [lo - pad, hi + pad],
    xTicks,
    yFormat: (v, digits) => fmt(v, digits),
    height: 460,
    smooth: true,
    tip: (d, p) => [
      `${d.name} · ${p.lapNo}랩 섹터 ${p.sector}`,
      [
        ['한 바퀴 환산', fmt(p.y)],
        [`섹터 ${p.sector} 기록`, fmt(p.t)],
        ...(p.compound ? [['타이어', COMPOUNDS[p.compound] ?? p.compound]] : []),
        ...(p.pit ? [['비고', '이 랩에 피트 인']] : []),
      ],
    ],
  });

  const hasPits = series.some((sr) => sr.marks.length);
  $('pace-note').textContent =
    'x축은 랩·섹터 순서(섹터 하나가 한 칸), y축은 그 섹터까지 직전 세 섹터를 합친 한 바퀴 기록입니다. ' +
    (hasPits ? '아래쪽 ▲는 피트 스톱' : '') +
    (hasPits && periods.length ? ', ' : '') +
    (periods.length ? '색 띠는 세이프티카(SC)·가상 세이프티카(VSC)·적기 구간' : '') +
    (hasPits || periods.length ? '입니다. ' : '') +
    (state.mode === 'clean'
      ? '클린 랩 보기에서는 y축을 주행 구간에 맞춰 확대해서, 피트·세이프티카처럼 느린 구간은 선이 위쪽으로 벗어납니다. 전체 랩으로 바꾸면 끝까지 보입니다.'
      : top > hi
        ? `${fmt(hi, 1)}보다 느린 구간(적기 중단 등)은 위쪽으로 벗어납니다.`
        : '');
}

// ───────── 차트 2: 섹터별 비교 ─────────

function renderSectors(rows, allStats) {
  const key = state.sectorMode === 'avg' ? 'sectorAvg' : 'sectorBest';
  // 기준은 체크 여부와 무관하게 세션 전체에서 가장 빠른 기록
  const ref = [0, 1, 2].map((k) => Math.min(...allStats.map((r) => r[key][k]).filter((v) => v != null)));
  const series = rows.map((r) => {
    const pts = [0, 1, 2]
      .filter((k) => r[key][k] != null && isFinite(ref[k]))
      .map((k) => ({ x: k + 1, y: r[key][k] - ref[k], t: r[key][k], sector: k + 1 }));
    // 섹터가 빠지면 그 사이는 잇지 않는다
    const segments = [];
    for (const p of pts) {
      if (segments.length && segments.at(-1).at(-1).x === p.x - 1) segments.at(-1).push(p);
      else segments.push([p]);
    }
    return { driver: r.driver, segments };
  });

  const ys = series.flatMap((sr) => sr.segments.flatMap((seg) => seg.map((p) => p.y)));
  const host = $('chart-sectors');
  if (!ys.length) {
    host.replaceChildren(el('p', { class: 'empty', text: '이 세션에는 섹터 기록이 없습니다.' }));
    return;
  }
  const hi = Math.max(...ys, 0.1);
  const what = state.sectorMode === 'avg' ? '평균' : '최고';
  lineChart(host, {
    series,
    xDomain: [0.85, 3.15],
    yDomain: [-hi * 0.03, hi * 1.05],
    xTicks: [1, 2, 3].map((k) => ({ v: k, label: `섹터 ${k}` })),
    yFormat: (v, digits) => (Math.abs(v) < 1e-9 ? '0' : `+${v.toFixed(Math.max(digits, 1))}`),
    height: 380,
    smooth: false,
    tip: (d, p) => [
      `${d.name} · 섹터 ${p.sector}`,
      [
        [`${what} 기록`, fmt(p.t)],
        ['가장 빠른 선수와 차이', p.y < 0.0005 ? '가장 빠름' : `${fmtGap(p.y)}초`],
      ],
    ],
  });
}

// ───────── 표 ─────────

function renderTable(rows) {
  const head = ['#', '선수', '팀', '최고 랩', '1위와 차이', '평균 랩', '중앙값', '섹터 1', '섹터 2', '섹터 3', '집계 랩'];
  const fastest = rows[0].best;
  $('table').replaceChildren(
    el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { text: h })))),
    el(
      'tbody',
      {},
      ...rows.map((r, i) =>
        el(
          'tr',
          {},
          el('td', { text: i + 1 }),
          el('td', {}, lineSwatch(styleOf(r.driver.code)), r.driver.code),
          el('td', { text: r.driver.team }),
          el('td', { text: fmt(r.best) }),
          el('td', { text: i ? fmtGap(r.best - fastest) : '–' }),
          el('td', { text: fmt(r.avg) }),
          el('td', { text: fmt(r.median) }),
          ...r.sectorBest.map((v) => el('td', { text: fmt(v) })),
          el('td', { text: `${r.laps.length} / ${r.total}` }),
        ),
      ),
    ),
  );
}

function pressed(group, attr, value) {
  for (const b of $(group).children) b.setAttribute('aria-pressed', b.dataset[attr] === value);
}

function renderSession() {
  pressed('lap-filter', 'mode', state.mode);
  pressed('sector-mode', 'sector', state.sectorMode);
  $('filter-note').textContent =
    state.mode === 'clean'
      ? '피트아웃 랩과 본인 최고 랩의 107%를 넘는 랩 제외'
      : '기록된 모든 랩 (피트·세이프티카 포함)';

  const data = state.loaded.get(state.session.key);
  const allStats = data.drivers.filter((d) => d.laps.length).map((d) => computeStats(d, state.mode));
  const rows = allStats.filter((r) => visible(r.driver)).sort((a, b) => a.best - b.best);

  if (!rows.length) {
    for (const id of ['chart-pace', 'chart-sectors']) {
      $(id).replaceChildren(el('p', { class: 'empty', text: '선수를 한 명 이상 선택하세요.' }));
    }
    $('table').replaceChildren();
    $('pace-note').textContent = '';
    return;
  }
  renderPace(rows, data);
  renderSectors(rows, allStats);
  renderTable(rows);
}

function renderAll() {
  renderRanking();
  renderSession();
}

// ───────── 선택 흐름 ─────────

async function selectSeason(year, want = {}) {
  state.year = year;
  state.index = await getJson(`data/${year}/index.json`);
  renderSeasons();
  const meetings = state.index.meetings.filter((m) => m.sessions.some((x) => x.laps));
  if (!meetings.length) {
    $('meetings').replaceChildren();
    $('main').hidden = true;
    $('status').hidden = false;
    $('status').textContent = `${year} 시즌 데이터가 아직 없습니다.`;
    return;
  }
  const latest = state.index.meetings
    .flatMap((m) => m.sessions)
    .map((x) => x.fetched)
    .filter(Boolean)
    .sort()
    .at(-1);
  $('updated').textContent = latest ? `· 최근 갱신 ${new Date(latest).toLocaleString('ko-KR')}` : '';

  await selectMeeting(meetings.find((m) => m.key === want.meeting) ?? meetings.at(-1), want.session);
}

async function selectMeeting(meeting, wantSession) {
  state.meeting = meeting;
  renderMeetings();
  const sessions = meeting.sessions.filter((x) => x.laps);
  const files = await Promise.all(sessions.map((x) => getJson(`data/${state.year}/${x.key}.json`)));
  if (state.meeting !== meeting) return; // 그사이 다른 경기를 골랐다
  state.sessions = sessions;
  state.loaded = new Map(sessions.map((x, i) => [x.key, files[i]]));
  collectDrivers();

  $('meeting-title').textContent = meeting.name;
  $('meeting-sub').textContent = `${meeting.circuit} · ${meeting.country} · ${dateLabel(meeting.start)}`;
  $('status').hidden = true;
  $('main').hidden = false;
  renderDrivers();
  renderRanking();
  selectSession(sessions.find((x) => x.key === wantSession) ?? sessions.at(-1));
}

function selectSession(session) {
  state.session = session;
  history.replaceState(null, '', `#${state.year}/${state.meeting.key}/${session.key}`);
  renderSessions();
  renderSession();
}

// ───────── 시작 ─────────

$('all-on').addEventListener('click', () => setAll(true));
$('all-off').addEventListener('click', () => setAll(false));
$('lap-filter').addEventListener('click', (evt) => {
  const mode = evt.target.dataset?.mode;
  if (!mode) return;
  state.mode = mode;
  writePreference('f1.mode', mode);
  renderSession();
});
$('sector-mode').addEventListener('click', (evt) => {
  const mode = evt.target.dataset?.sector;
  if (!mode) return;
  state.sectorMode = mode;
  writePreference('f1.sector', mode);
  renderSession();
});
let lastWidth = 0;
new ResizeObserver(([entry]) => {
  const w = Math.round(entry.contentRect.width);
  if (w === lastWidth || !state.session || $('main').hidden) return;
  lastWidth = w;
  renderSession();
}).observe($('chart-pace'));

try {
  state.seasons = await getJson('data/seasons.json');
  if (!state.seasons.length) throw new Error('no seasons');
  const [year, meeting, session] = location.hash.slice(1).split('/').map(Number);
  await selectSeason(state.seasons.includes(year) ? year : state.seasons[0], { meeting, session });
} catch (err) {
  showLoadError(err);
}
