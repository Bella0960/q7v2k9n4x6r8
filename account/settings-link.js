(() => {
  'use strict';
  const row = document.querySelector('.user-row');
  const label = document.getElementById('settingsId');
  if (!row || !label) return;

  function openAccount() {
    window.location.assign('../account/manage.html');
  }

  row.style.cursor = 'pointer';
  row.setAttribute('role', 'link');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', '打开 MAO 账号管理');
  row.addEventListener('click', openAccount);
  row.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAccount();
    }
  });

  fetch('../api/accounts/me', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' }
  }).then(async response => {
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || !payload.account || payload.account.status !== 'active') {
      if (payload.error?.code === 'ACCOUNT_DISABLED') {
        window.location.replace('../account/index.html?disabled=1');
      }
      label.textContent = 'MAO 账号暂不可用';
      return;
    }
    label.textContent = 'MAO ID · ' + payload.account.id;
  }).catch(() => {
    label.textContent = 'MAO ID · 点击管理账号';
  });
})();
