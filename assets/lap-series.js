export function pitLaps(laps) {
  return new Set(laps.filter(lap => lap[2] && lap[0] > 1).map(lap => lap[0] - 1));
}

export function cleanLaps(laps, limit = 1.07) {
  const valid = laps.filter(lap => Number.isFinite(lap[1]) && lap[1] > 0);
  const best = Math.min(...valid.map(lap => lap[1]));
  const pits = pitLaps(valid);
  return valid.filter(lap => !lap[2] && !pits.has(lap[0]) && lap[1] <= best * limit);
}

export function lapSegments(laps, mode) {
  const included = mode === 'clean' ? cleanLaps(laps) : laps.filter(lap => lap[1] > 0);
  const segments = [];
  for (const lap of [...included].sort((a, b) => a[0] - b[0])) {
    const point = {x: lap[0], y: lap[1], lapNo: lap[0], compound: lap[3]};
    const current = segments.at(-1);
    if (current?.at(-1).x === point.x - 1) current.push(point);
    else segments.push([point]);
  }
  return segments;
}
