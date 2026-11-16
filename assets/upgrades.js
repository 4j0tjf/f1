export async function renderUpgrades() {
  const host = document.getElementById('upgrade-list');
  if (!host) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('data/upgrades.json', {cache: 'no-cache', signal: controller.signal});
    if (!response.ok) throw new Error(`upgrades: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.releases)) throw new Error('Invalid releases');
    const entries = data.releases.map((release, index) => {
      const entry = document.createElement('details');
      entry.open = index === 0;
      const summary = document.createElement('summary');
      const title = document.createElement('strong');
      title.textContent = release.title;
      const version = document.createElement('span');
      version.className = 'muted';
      version.textContent = `${release.date} · v${release.version}`;
      summary.append(title, version);
      const items = document.createElement('ul');
      for (const item of release.items ?? []) {
        const line = document.createElement('li');
        line.textContent = item;
        items.append(line);
      }
      entry.append(summary, items);
      if (release.source) {
        const url = new URL(release.source);
        if (url.protocol === 'https:' && url.hostname === 'github.com') {
          const source = document.createElement('a');
          source.className = 'muted';
          source.href = url.href;
          source.textContent = '변경 근거 보기';
          entry.append(source);
        }
      }
      return entry;
    });
    host.replaceChildren(...entries);
  } catch (error) {
    console.warn('변경 내역을 불러오지 못했습니다.', error);
    host.textContent = '변경 내역을 불러오지 못했습니다. 랩타임 화면은 계속 사용할 수 있습니다.';
  } finally { clearTimeout(timer); }
}
