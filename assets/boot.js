// 앱 모듈 자체가 실행되지 못해도 로딩 문구만 남겨 두지 않는다.
(() => {
  const script = document.currentScript;
  const status = document.getElementById('status');
  let timer;
  function failed(message) {
    if (!document.getElementById('main').hidden) return;
    status.hidden = false;
    const text = document.createElement('span');
    text.textContent = message + ' ';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '다시 불러오기';
    retry.addEventListener('click', () => location.reload());
    status.replaceChildren(text, retry);
  }
  timer = setTimeout(() => failed('화면을 불러오는 데 시간이 걸리고 있습니다. 연결 상태를 확인해 주세요.'), 30000);
  import(new URL('upgrades.js?v=20261116.1', script.src).href)
    .then(module => module.renderUpgrades())
    .catch(error => {
      console.warn(error);
      const host = document.getElementById('upgrade-list');
      if (host) host.textContent = '변경 내역을 불러오지 못했습니다.';
    });
  import(new URL('app.js?v=20261116.1', script.src).href)
    .catch(error => {
      console.error(error);
      failed('화면 실행에 실패했습니다.');
    })
    .finally(() => clearTimeout(timer));
})();
