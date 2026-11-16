// F1 랩타임 뷰어. data/ 아래 JSON만 읽는 정적 페이지다 (scripts/fetch.mjs가 생성).

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const CLEAN_LIMIT = 1.07; // 클린 랩: 본인 최고 랩의 107% 이내
const CLIP_LIMIT = 1.3; // 전체 랩 분포는 세션 최고 랩의 130%까지만 그린다

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
  session: null,
  data: null, // 세션 JSON
  mode: localStorage.getItem('f1.mode') === 'all' ? 'all' : 'clean',
  hidden: new Set(JSON.parse(localStorage.getItem('f1.hidden') || '[]')), // 체크 해제한 선수 코드
};

// ───────── 유틸 ─────────

function el(tag, attrs = {}, ...children) {
  const node = tag === 'svg' || attrs.svg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'svg' || v == null) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}
const s = (tag, attrs = {}, ...children) => el(tag, { ...attrs, svg: true }, ...children);

function fmt(sec, digits = 3) {
  if (sec == null || !isFinite(sec)) return '–';
  const m = Math.floor(sec / 60);
  const rest = (sec - m * 60).toFixed(digits).padStart(digits ? digits + 3 : 2, '0');
  return m ? `${m}:${rest}` : rest;
}

const getJson = async (url) => {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

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

// ───────── 통계 ─────────

function computeStats(driver, mode) {
  const all = driver.laps;
  const best = Math.min(...all.map((l) => l[1]));
  const used = mode === 'all' ? all : all.filter((l) => !l[2] && l[1] <= best * CLEAN_LIMIT);
  const times = used.map((l) => l[1]).sort((a, b) => a - b);
  return {
    driver,
    best,
    bestLap: all.find((l) => l[1] === best)[0],
    laps: used,
    total: all.length,
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    median: quantile(times, 0.5),
    q1: quantile(times, 0.25),
    q3: quantile(times, 0.75),
  };
}

// ───────── 탭 ─────────

function tabButton(label, selected, onClick, sub) {
  const b = el('button', { type: 'button', role: 'tab', 'aria-selected': selected }, label);
  if (sub) b.append(el('small', { text: sub }));
  b.addEventListener('click', onClick);
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
  const m = state.meeting;
  $('meeting-title').textContent = m.name;
  $('meeting-sub').textContent = `${m.circuit} · ${m.country} · ${dateLabel(m.start)}`;
  $('sessions').replaceChildren(
    ...m.sessions
      .filter((x) => x.laps)
      .map((x) => {
        const b = el('button', { type: 'button', 'aria-pressed': x === state.session, text: sessionLabel(x.name) });
        b.addEventListener('click', () => selectSession(x));
        return b;
      }),
  );
}

// ───────── 선수 체크박스 ─────────

function renderDrivers() {
  const teams = new Map();
  for (const d of state.data.drivers) {
    if (!teams.has(d.team)) teams.set(d.team, []);
    teams.get(d.team).push(d);
  }
  const list = $('driver-list');
  list.replaceChildren();
  for (const [team, drivers] of teams) {
    const box = el('div', { class: 'team' });
    box.append(
      el('div', { class: 'team-name' }, el('i', { class: 'swatch', style: `background:${drivers[0].color}` }), team || '기타'),
    );
    for (const d of drivers) {
      const input = el('input', { type: 'checkbox' });
      input.checked = !state.hidden.has(d.code);
      input.addEventListener('change', () => {
        if (input.checked) state.hidden.delete(d.code);
        else state.hidden.add(d.code);
        saveHidden();
        renderCharts();
      });
      box.append(el('label', { class: 'driver', title: d.name }, input, el('b', { text: d.code }), el('span', { text: d.name })));
    }
    list.append(box);
  }
}

function saveHidden() {
  localStorage.setItem('f1.hidden', JSON.stringify([...state.hidden]));
}

function setAll(on) {
  for (const d of state.data.drivers) {
    if (on) state.hidden.delete(d.code);
    else state.hidden.add(d.code);
  }
  saveHidden();
  renderDrivers();
  renderCharts();
}

// ───────── 차트 공통 ─────────

function niceTicks(min, max, target) {
  const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  const step = steps.find((x) => (max - min) / x <= target) ?? 300;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return { ticks, digits: step < 0.1 ? 2 : step < 1 ? 1 : 0 };
}

// 행(선수) 단위 가로 차트의 뼈대: 눈금, 선수 라벨, 행 배경을 그리고 좌표 변환을 돌려준다.
function frame(host, rows, domain, { rowH, right }) {
  const width = Math.max(host.clientWidth, 280);
  const left = 58;
  const top = 22;
  const height = top + rows.length * rowH + 6;
  const plotW = width - left - right;
  const x = (v) => left + ((v - domain[0]) / (domain[1] - domain[0])) * plotW;
  const y = (i) => top + i * rowH + rowH / 2;

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img' });
  const { ticks, digits } = niceTicks(domain[0], domain[1], Math.max(2, Math.floor(plotW / 70)));
  for (const t of ticks) {
    svg.append(
      s('line', { class: 'grid', x1: x(t), x2: x(t), y1: top - 4, y2: height - 4 }),
      s('text', { x: x(t), y: 11, 'text-anchor': 'middle', text: fmt(t, digits) }),
    );
  }
  const groups = rows.map((r, i) => {
    const g = s('g', { class: 'row' });
    g.append(
      s('rect', { class: 'row-bg', x: 0, y: y(i) - rowH / 2, width, height: rowH, rx: 4 }),
      s('rect', { class: 'sw', x: 6, y: y(i) - 6, width: 4, height: 12, rx: 1, fill: r.driver.color || 'gray' }),
      s('text', { class: 'code', x: 16, y: y(i) + 4, text: r.driver.code }),
    );
    svg.append(g);
    return g;
  });
  host.replaceChildren(svg);
  return { svg, groups, x, y, left, top, width, plotW, rowH };
}

const tooltip = $('tooltip');
function showTooltip(evt, title, lines) {
  tooltip.replaceChildren(
    el('strong', { text: title }),
    ...lines.map(([label, value, cls]) =>
      el('div', {}, el('span', {}, ...(cls ? [el('i', { class: `dot ${cls}` })] : []), label), el('span', { text: value })),
    ),
  );
  tooltip.hidden = false;
  const { width, height } = tooltip.getBoundingClientRect();
  const px = evt.clientX + 14 + width > innerWidth ? evt.clientX - width - 14 : evt.clientX + 14;
  const py = Math.min(Math.max(8, evt.clientY - height - 10), innerHeight - height - 8);
  tooltip.style.left = `${Math.max(8, px)}px`;
  tooltip.style.top = `${py}px`;
}
const hideTooltip = () => (tooltip.hidden = true);

// 포인터 위치의 행을 찾아 콜백에 넘긴다. 마크보다 넓은 행 전체가 히트 영역이다.
function trackRows(f, rows, onMove) {
  let active = null;
  const clear = () => {
    active?.classList.remove('on');
    active = null;
    hideTooltip();
    onMove(null);
  };
  f.svg.addEventListener('pointermove', (evt) => {
    const box = f.svg.getBoundingClientRect();
    const scale = f.width / box.width;
    const i = Math.floor(((evt.clientY - box.top) * scale - f.top) / f.rowH);
    if (i < 0 || i >= rows.length) return clear();
    if (active !== f.groups[i]) {
      active?.classList.remove('on');
      active = f.groups[i];
      active.classList.add('on');
    }
    onMove(evt, i, (evt.clientX - box.left) * scale);
  });
  f.svg.addEventListener('pointerleave', clear);
}

// ───────── 차트 1: 최고 랩 · 평균 랩 ─────────

function renderSummary(rows) {
  const host = $('chart-summary');
  const wide = host.clientWidth >= 520;
  const lo = Math.min(...rows.map((r) => r.best));
  const hi = Math.max(...rows.map((r) => r.avg));
  const pad = Math.max((hi - lo) * 0.04, 0.05);
  const f = frame(host, rows, [lo - pad, hi + pad], { rowH: 26, right: wide ? 150 : 76 });
  const fastest = rows[0].best;

  f.svg.append(
    s('text', { x: f.width - (wide ? 78 : 4), y: 11, 'text-anchor': 'end', text: '최고' }),
    ...(wide ? [s('text', { x: f.width - 4, y: 11, 'text-anchor': 'end', text: '평균' })] : []),
  );
  rows.forEach((r, i) => {
    const y = f.y(i);
    f.groups[i].append(
      s('line', { class: 'link', x1: f.x(r.best), x2: f.x(r.avg), y1: y, y2: y }),
      s('circle', { class: 'm-avg', cx: f.x(r.avg), cy: y, r: 5.5 }),
      s('circle', { class: 'm-best', cx: f.x(r.best), cy: y, r: 5.5 }),
      s('text', { class: 'val', x: f.width - (wide ? 78 : 4), y: y + 4, 'text-anchor': 'end', text: fmt(r.best) }),
      ...(wide ? [s('text', { class: 'val', x: f.width - 4, y: y + 4, 'text-anchor': 'end', text: fmt(r.avg) })] : []),
    );
  });

  trackRows(f, rows, (evt, i) => {
    if (!evt) return;
    const r = rows[i];
    showTooltip(evt, r.driver.name, [
      ['최고 랩', `${fmt(r.best)} (랩 ${r.bestLap})`, 'best'],
      ['평균 랩', fmt(r.avg), 'avg'],
      ['1위와 차이', i ? `+${(r.best - fastest).toFixed(3)}` : '–'],
      ['집계 랩 수', `${r.laps.length} / ${r.total}`],
    ]);
  });
}

// ───────── 차트 2: 랩타임 분포 ─────────

function renderDist(rows) {
  const host = $('chart-dist');
  const times = rows.flatMap((r) => r.laps.map((l) => l[1]));
  const lo = Math.min(...times);
  const max = Math.max(...times);
  const hi = Math.min(max, lo * CLIP_LIMIT);
  const pad = Math.max((hi - lo) * 0.03, 0.05);
  const domain = [lo - pad, hi + pad];
  const rowH = 30;
  const f = frame(host, rows, domain, { rowH, right: 12 });
  const cx = (t) => f.x(Math.min(t, hi));
  // 랩 번호로 정한 고정 지터: 겹친 점을 세로로 흩되 다시 그려도 위치가 같다.
  const jitter = (lap) => (((lap * 0.618034) % 1) - 0.5) * (rowH - 14);

  const dots = rows.map((r, i) => {
    const y = f.y(i);
    const circles = r.laps.map((l) => {
      const c = s('circle', { class: 'lap', cx: cx(l[1]), cy: y + jitter(l[0]), r: 3 });
      f.groups[i].append(c);
      return c;
    });
    f.groups[i].append(
      s('rect', {
        class: 'iqr', x: cx(r.q1), y: y - 9, rx: 2,
        width: Math.max(cx(r.q3) - cx(r.q1), 1), height: 18,
      }),
      s('line', { class: 'median', x1: cx(r.median), x2: cx(r.median), y1: y - 9, y2: y + 9 }),
    );
    return circles;
  });

  $('dist-note').textContent =
    max > hi ? `${fmt(hi, 1)}보다 느린 랩은 오른쪽 끝에 모아 표시했습니다.` : '';

  let lit = null;
  trackRows(f, rows, (evt, i, px) => {
    lit?.classList.remove('on');
    lit = null;
    if (!evt) return;
    const r = rows[i];
    let nearest = 0;
    r.laps.forEach((l, j) => {
      if (Math.abs(cx(l[1]) - px) < Math.abs(cx(r.laps[nearest][1]) - px)) nearest = j;
    });
    const lap = r.laps[nearest];
    lit = dots[i][nearest];
    lit.classList.add('on');
    showTooltip(evt, `${r.driver.name} · 랩 ${lap[0]}`, [
      ['랩타임', fmt(lap[1])],
      ...(lap[3] ? [['타이어', COMPOUNDS[lap[3]] ?? lap[3]]] : []),
      ...(lap[2] ? [['비고', '피트아웃 랩']] : []),
      ['중앙값', fmt(r.median)],
      ['중간 50%', `${fmt(r.q1)} – ${fmt(r.q3)}`],
    ]);
  });
}

// ───────── 표 ─────────

function renderTable(rows) {
  const head = ['#', '선수', '팀', '최고 랩', '평균 랩', '중앙값', '1위와 차이', '집계 랩'];
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
          el('td', {}, el('i', { class: 'swatch', style: `background:${r.driver.color}` }), r.driver.code),
          el('td', { text: r.driver.team }),
          el('td', { text: fmt(r.best) }),
          el('td', { text: fmt(r.avg) }),
          el('td', { text: fmt(r.median) }),
          el('td', { text: i ? `+${(r.best - fastest).toFixed(3)}` : '–' }),
          el('td', { text: `${r.laps.length} / ${r.total}` }),
        ),
      ),
    ),
  );
}

function renderCharts() {
  for (const b of $('lap-filter').children) b.setAttribute('aria-pressed', b.dataset.mode === state.mode);
  $('filter-note').textContent =
    state.mode === 'clean'
      ? '피트아웃 랩과 본인 최고 랩의 107%를 넘는 랩 제외'
      : '기록된 모든 랩 (세이프티카·인랩 포함)';

  const rows = state.data.drivers
    .filter((d) => !state.hidden.has(d.code) && d.laps.length)
    .map((d) => computeStats(d, state.mode))
    .sort((a, b) => a.best - b.best);

  if (!rows.length) {
    for (const id of ['chart-summary', 'chart-dist']) {
      $(id).replaceChildren(el('p', { class: 'empty', text: '선수를 한 명 이상 선택하세요.' }));
    }
    $('table').replaceChildren();
    $('dist-note').textContent = '';
    return;
  }
  renderSummary(rows);
  renderDist(rows);
  renderTable(rows);
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
  const meeting = meetings.find((m) => m.key === want.meeting) ?? meetings.at(-1);
  await selectMeeting(meeting, want.session);

  const latest = state.index.meetings
    .flatMap((m) => m.sessions)
    .map((x) => x.fetched)
    .filter(Boolean)
    .sort()
    .at(-1);
  $('updated').textContent = latest ? `· 최근 갱신 ${new Date(latest).toLocaleString('ko-KR')}` : '';
}

async function selectMeeting(meeting, wantSession) {
  state.meeting = meeting;
  renderMeetings();
  const sessions = meeting.sessions.filter((x) => x.laps);
  await selectSession(sessions.find((x) => x.key === wantSession) ?? sessions.at(-1));
}

async function selectSession(session) {
  state.session = session;
  renderSessions();
  history.replaceState(null, '', `#${state.year}/${state.meeting.key}/${session.key}`);
  const data = await getJson(`data/${state.year}/${session.key}.json`);
  if (state.session !== session) return; // 그사이 다른 세션을 골랐다
  state.data = data;
  $('status').hidden = true;
  $('main').hidden = false;
  renderDrivers();
  renderCharts();
}

// ───────── 시작 ─────────

$('all-on').addEventListener('click', () => setAll(true));
$('all-off').addEventListener('click', () => setAll(false));
$('lap-filter').addEventListener('click', (evt) => {
  const mode = evt.target.dataset?.mode;
  if (!mode) return;
  state.mode = mode;
  localStorage.setItem('f1.mode', mode);
  renderCharts();
});
new ResizeObserver(() => state.data && !$('main').hidden && renderCharts()).observe($('chart-summary'));

try {
  state.seasons = await getJson('data/seasons.json');
  if (!state.seasons.length) throw new Error('no seasons');
  const [year, meeting, session] = location.hash.slice(1).split('/').map(Number);
  await selectSeason(state.seasons.includes(year) ? year : state.seasons[0], { meeting, session });
} catch (err) {
  console.error(err);
  $('status').hidden = false;
  $('status').textContent = '데이터를 불러오지 못했습니다. 아직 수집 전이거나 일시적인 오류일 수 있습니다.';
}
