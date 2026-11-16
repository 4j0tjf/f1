#!/usr/bin/env node
// OpenF1(https://openf1.org)에서 시즌별 세션 랩타임을 받아 data/<연도>/ 아래 JSON으로 저장한다.
// 이미 받은 세션은 건너뛰므로 주기적으로 실행해도 새로 끝난 세션만 추가된다.
//
//   node scripts/fetch.mjs                 # 올해(UTC) 시즌 갱신
//   node scripts/fetch.mjs --year 2026     # 특정 시즌
//   node scripts/fetch.mjs --year 2026 --force   # 전부 다시 받기

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = 'https://api.openf1.org/v1';
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const HOUR = 3600e3;
const READY_AFTER = 0.5 * HOUR; // 세션 종료 후 이만큼 지나야 받기 시작
const SETTLE_AFTER = 6 * HOUR; // 이보다 일찍 받은 데이터는 한 번 더 받아 보정
const GIVE_UP_AFTER = 7 * 24 * HOUR; // 이 뒤에 확인해도 랩이 없는 세션(취소 등)은 그만 시도
const REQUEST_GAP = 2200; // OpenF1 무료 한도: 분당 30회

const args = process.argv.slice(2);
const force = args.includes('--force');
const yearArg = args.indexOf('--year');
const year = yearArg >= 0 ? Number(args[yearArg + 1]) : new Date().getUTCFullYear();
if (!Number.isInteger(year)) throw new Error('--year 값이 올바르지 않습니다');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function get(endpoint, params) {
  const url = `${API}/${endpoint}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    await sleep(Math.max(0, lastRequest + REQUEST_GAP - Date.now()));
    lastRequest = Date.now();
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(60e3) });
    } catch (err) {
      if (attempt >= 4) throw err;
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 404) return []; // OpenF1은 결과가 없으면 404를 주기도 한다
    const body = (await res.text()).slice(0, 200);
    // 401/403: 라이브 세션 중에는 비인증 접근이 막힌다. 다음 실행 때 다시 시도하면 된다.
    if ([401, 403].includes(res.status) || attempt >= 4) {
      throw new Error(`${res.status} ${url} ${body}`);
    }
    await sleep(attempt * 15e3);
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const writeJson = (file, value) => writeFile(file, JSON.stringify(value) + '\n');

// 레이스 컨트롤 메시지에서 세이프티카(SC), 가상 세이프티카(VSC), 적기 중단(RED) 구간을
// [{ kind, from, to }] (선두 기준 랩 번호, 양 끝 포함)로 뽑는다.
function neutralPeriods(messages) {
  const periods = [];
  let open = null;
  const close = (lap) => {
    if (open) periods.push({ ...open, to: Math.max(lap, open.from) });
    open = null;
  };
  const start = (kind, lap) => {
    if (open?.kind === kind) return;
    close(lap);
    open = { kind, from: lap };
  };
  for (const m of [...messages].sort((a, b) => a.date.localeCompare(b.date))) {
    const lap = m.lap_number ?? 1;
    const text = m.message ?? '';
    if (m.category === 'SafetyCar') {
      const kind = /VSC|VIRTUAL/.test(text) ? 'VSC' : 'SC';
      if (/DEPLOYED/.test(text)) start(kind, lap);
      else if (/ENDING|IN THIS LAP/.test(text) && open?.kind === kind) close(lap);
    } else if (m.category === 'SessionStatus') {
      if (/ABORTED/.test(text)) start('RED', lap);
      else if (open && /STARTED|FINISHED/.test(text)) close(lap);
    }
  }
  return periods;
}

async function fetchSession(session) {
  const key = { session_key: session.session_key };
  const laps = await get('laps', key);
  const timed = laps.filter((l) => l.lap_duration > 0);
  if (!timed.length) return null;
  const drivers = await get('drivers', key);
  const stints = await get('stints', key).catch(() => []);
  const results = await get('session_result', key); // 실패하면 세션 전체를 다음 실행에서 다시 시도
  // 피트 스톱과 세이프티카 구간은 랩 번호가 모든 선수에게 같은 뜻인 레이스·스프린트에서만 쓴다.
  const isRace = session.session_type === 'Race';
  const pits = isRace ? await get('pit', key) : [];
  const periods = isRace ? neutralPeriods(await get('race_control', key)) : [];

  const compound = (num, lap) => {
    const s = stints.find(
      (s) => s.driver_number === num && lap >= s.lap_start && lap <= (s.lap_end ?? Infinity),
    );
    return s?.compound ? s.compound[0] : '';
  };

  const byNumber = new Map();
  for (const l of timed) {
    if (!byNumber.has(l.driver_number)) byNumber.set(l.driver_number, []);
    // [랩 번호, 랩타임(초), 피트아웃 랩 여부, 타이어 컴파운드 첫 글자, 섹터1, 섹터2, 섹터3]
    byNumber.get(l.driver_number).push([
      l.lap_number,
      Math.round(l.lap_duration * 1000) / 1000,
      l.is_pit_out_lap ? 1 : 0,
      compound(l.driver_number, l.lap_number),
      l.duration_sector_1 ?? null,
      l.duration_sector_2 ?? null,
      l.duration_sector_3 ?? null,
    ]);
  }

  const out = [];
  for (const [num, driverLaps] of byNumber) {
    const d = drivers.find((d) => d.driver_number === num) ?? {};
    out.push({
      num,
      code: d.name_acronym ?? String(num),
      name: d.full_name ?? d.broadcast_name ?? `#${num}`,
      team: d.team_name ?? '',
      color: d.team_colour ? `#${d.team_colour}` : '',
      laps: driverLaps.sort((a, b) => a[0] - b[0]),
      // 피트로 들어간 랩 번호
      pits: [...new Set(pits.filter((p) => p.driver_number === num).map((p) => p.lap_number))].sort((a, b) => a - b),
    });
  }
  out.sort((a, b) => a.team.localeCompare(b.team) || a.num - b.num);
  // 공식 순위. 퀄리파잉은 time·gap이 [Q1, Q2, Q3] 배열이다.
  const classification = results
    .map((r) => ({
      num: r.driver_number,
      pos: r.position ?? null,
      laps: r.number_of_laps ?? null,
      time: r.duration ?? null,
      gap: r.gap_to_leader ?? null,
      status: r.dsq ? 'DSQ' : r.dns ? 'DNS' : r.dnf ? 'DNF' : '',
    }))
    .sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99) || (b.laps ?? 0) - (a.laps ?? 0));
  return { key: session.session_key, drivers: out, results: classification, periods };
}

async function updateSeasons() {
  const seasons = [];
  for (const entry of await readdir(DATA, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}$/.test(entry.name)) continue;
    const index = await readJson(path.join(DATA, entry.name, 'index.json'), null);
    if (index?.meetings.some((m) => m.sessions.some((s) => s.laps))) seasons.push(Number(entry.name));
  }
  await writeJson(path.join(DATA, 'seasons.json'), seasons.sort((a, b) => b - a));
}

async function main() {
  const dir = path.join(DATA, String(year));
  await mkdir(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');
  const previous = await readJson(indexFile, { meetings: [] });
  const known = new Map(previous.meetings.flatMap((m) => m.sessions).map((s) => [s.key, s]));

  const meetings = (await get('meetings', { year })).filter((m) => !m.is_cancelled);
  const sessions = (await get('sessions', { year })).filter((s) => !s.is_cancelled);
  if (!meetings.length) {
    console.log(`${year} 시즌 일정이 아직 없습니다.`);
    return;
  }

  const now = Date.now();
  let changed = 0;
  const index = { year, meetings: [] };

  for (const m of meetings.sort((a, b) => a.date_start.localeCompare(b.date_start))) {
    const entry = {
      key: m.meeting_key,
      name: m.meeting_name,
      country: m.country_name,
      location: m.location,
      circuit: m.circuit_short_name,
      start: m.date_start,
      sessions: [],
    };
    const own = sessions
      .filter((s) => s.meeting_key === m.meeting_key)
      .sort((a, b) => a.date_start.localeCompare(b.date_start));

    for (const s of own) {
      const end = Date.parse(s.date_end);
      const old = known.get(s.session_key);
      const item = {
        key: s.session_key,
        name: s.session_name,
        type: s.session_type,
        start: s.date_start,
        end: s.date_end,
        laps: old?.laps ?? 0,
        fetched: old?.fetched ?? null,
      };
      entry.sessions.push(item);

      const finished = now > end + READY_AFTER;
      const settled = item.laps > 0 && Date.parse(item.fetched) > end + SETTLE_AFTER;
      const abandoned = item.laps === 0 && Date.parse(item.fetched) > end + GIVE_UP_AFTER;
      if (!finished || (!force && (settled || abandoned))) continue;

      const label = `${m.meeting_name} · ${s.session_name}`;
      try {
        const data = await fetchSession(s);
        if (!data) {
          item.fetched = new Date(now).toISOString();
          console.log(`- ${label}: 아직 랩 데이터 없음`);
          continue;
        }
        await writeJson(path.join(dir, `${s.session_key}.json`), data);
        item.laps = data.drivers.reduce((n, d) => n + d.laps.length, 0);
        item.fetched = new Date(now).toISOString();
        changed++;
        console.log(`+ ${label}: ${data.drivers.length}명 ${item.laps}랩`);
      } catch (err) {
        console.warn(`! ${label}: ${err.message}`);
      }
    }
    if (entry.sessions.length) index.meetings.push(entry);
  }

  if (changed || JSON.stringify(index) !== JSON.stringify(previous)) await writeJson(indexFile, index);
  await updateSeasons();
  console.log(`${year}: ${changed}개 세션 갱신`);
}

await main();
