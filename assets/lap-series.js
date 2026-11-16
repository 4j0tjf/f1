export function pitLaps(laps) {
  return new Set(laps.filter(lap => lap[2] && lap[0] > 1).map(lap => lap[0] - 1));
}

export function cleanLaps(laps, limit = 1.07) {
  const valid = laps.filter(lap => Number.isFinite(lap[1]) && lap[1] > 0);
  const best = Math.min(...valid.map(lap => lap[1]));
  const pits = pitLaps(valid);
  return valid.filter(lap => !lap[2] && !pits.has(lap[0]) && lap[1] <= best * limit);
}

// 그래프용: 클린 랩 중에서도 본인 평소 페이스(중앙값)보다 cut 배 넘게 느린 랩을 뺀다.
// 세이프티카·황기·트래픽 등으로 느려진 랩이 세로축을 늘려 선들이 겹쳐 보이는 것을 막는다.
export function paceLaps(laps, cut = 1.035) {
  const clean = cleanLaps(laps);
  if (!clean.length) return clean;
  const times = clean.map(lap => lap[1]).sort((a, b) => a - b);
  const mid = (times[Math.floor((times.length - 1) / 2)] + times[Math.ceil((times.length - 1) / 2)]) / 2;
  return clean.filter(lap => lap[1] <= mid * cut);
}

export function lapSegments(laps, mode) {
  const included = mode === 'clean' ? paceLaps(laps) : laps.filter(lap => lap[1] > 0);
  const segments = [];
  for (const lap of [...included].sort((a, b) => a[0] - b[0])) {
    const point = {x: lap[0], y: lap[1], lapNo: lap[0], compound: lap[3]};
    const current = segments.at(-1);
    if (current?.at(-1).x === point.x - 1) current.push(point);
    else segments.push([point]);
  }
  return segments;
}
