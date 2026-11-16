// 브라우저 저장소가 차단되거나 예전 설정이 손상되어도 화면은 기본값으로 열린다.
export function readPreference(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

export function writePreference(key, value) {
  try { localStorage.setItem(key, value); }
  catch { /* 저장할 수 없는 브라우저에서는 현재 화면에서만 설정을 유지한다. */ }
}

export function readHiddenDrivers() {
  try {
    const value = JSON.parse(readPreference('f1.hidden', '[]'));
    return new Set(Array.isArray(value) ? value.filter(code => typeof code === 'string') : []);
  } catch { return new Set(); }
}
