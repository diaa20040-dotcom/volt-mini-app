const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const initData = tg?.initData || '';

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-telegram-init': initData,
  };
  const res = await fetch(path, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

let me = null;
let adminTarget = null;
let tasksCache = null;

function showTab(name) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(`tab-${name}`)?.classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${name}"]`)?.classList.add('active');
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

function renderMe() {
  if (!me) return;
  document.getElementById('balance-pill').textContent = `${me.balance.toFixed(1)} vølt`;
  document.getElementById('mined-live').textContent = me.minedUnclaimed.toFixed(2);
  document.getElementById('level').textContent = me.level;
  document.getElementById('mining-dot').classList.toggle('on', me.miningActive && !me.banned);
  document.getElementById('mining-label').textContent = me.banned
    ? 'Banned'
    : me.miningActive
      ? 'Active'
      : 'Paused';
  document.getElementById('wallet-input').value = me.tonWallet || '';
  if (me.isAdmin) {
    document.querySelectorAll('.admin-only').forEach((el) => el.classList.remove('hidden'));
  }
  const ref = `https://t.me/Voltvvbot?start=ref_${me.telegramId}`;
  document.getElementById('ref-link').textContent = ref;
}

async function loadMe() {
  me = await api('/api/me');
  renderMe();
}

async function ensureCaptcha() {
  const cap = await api('/api/captcha');
  if (cap.passed) {
    document.getElementById('captcha-overlay').classList.add('hidden');
    return;
  }
  document.getElementById('captcha-overlay').classList.remove('hidden');
  document.getElementById('captcha-q').textContent = cap.question + ' = ?';
}

document.getElementById('captcha-submit').addEventListener('click', async () => {
  const answer = Number(document.getElementById('captcha-input').value);
  try {
    me = await api('/api/captcha', { method: 'POST', body: JSON.stringify({ answer }) });
    document.getElementById('captcha-overlay').classList.add('hidden');
    renderMe();
    tg?.HapticFeedback?.notificationOccurred('success');
  } catch (e) {
    tg?.showAlert?.(e.message);
  }
});

document.getElementById('claim-btn').addEventListener('click', async () => {
  try {
    const r = await api('/api/claim', { method: 'POST', body: '{}' });
    me = r;
    renderMe();
    if (r.claimed > 0) tg?.HapticFeedback?.notificationOccurred('success');
  } catch (e) {
    tg?.showAlert?.(e.message);
  }
});

document.getElementById('checkin-btn').addEventListener('click', async () => {
  try {
    const r = await api('/api/checkin', { method: 'POST', body: '{}' });
    me = r;
    renderMe();
    tg?.showPopup?.({ message: `+${r.reward} vølt` });
  } catch (e) {
    tg?.showAlert?.(e.message);
  }
});

async function renderTasks() {
  tasksCache = await api('/api/tasks');
  const el = document.getElementById('tasks-list');
  el.innerHTML = '';
  const add = (title, reward, action, done, secondary) => {
    const div = document.createElement('div');
    div.className = 'task-item' + (done ? ' done' : '');
    div.innerHTML = `<div><strong>${title}</strong><br><span class="muted">+${reward} vølt</span></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = done ? 'Done' : secondary || 'Collect';
    btn.disabled = !!done;
    if (!done && action) btn.addEventListener('click', action);
    div.appendChild(btn);
    el.appendChild(div);
  };
  for (const t of tasksCache.linkTasks || []) {
    add(
      t.title,
      t.reward,
      async () => {
        if (!t.clicked) {
          await api(`/api/tasks/link/${t.id}/open`, { method: 'POST', body: '{}' });
          window.open(t.url, '_blank');
          t.clicked = true;
          renderTasks();
        } else {
          const r = await api(`/api/tasks/link/${t.id}/collect`, { method: 'POST', body: '{}' });
          me = r;
          renderMe();
          renderTasks();
        }
      },
      t.done,
      t.clicked ? 'Collect' : 'Open'
    );
  }
}

document.querySelector('[data-tab="tasks"]')?.addEventListener('click', () => renderTasks());

async function loadBoard() {
  const rows = await api('/api/leaderboard');
  const ul = document.getElementById('board-list');
  ul.innerHTML = rows
    .map((r) => `<li><span>#${r.rank} ${r.name}</span><span>${r.balance} vølt</span></li>`)
    .join('');
}

document.querySelector('[data-tab="board"]')?.addEventListener('click', () => loadBoard());

document.getElementById('share-btn').addEventListener('click', () => {
  const url = document.getElementById('ref-link').textContent;
  const text = 'Join me on vølt mining';
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  } else if (navigator.share) {
    navigator.share({ title: 'vølt', text, url });
  }
});

document.getElementById('save-wallet').addEventListener('click', async () => {
  const address = document.getElementById('wallet-input').value.trim();
  try {
    me = await api('/api/wallet', { method: 'POST', body: JSON.stringify({ address }) });
    renderMe();
  } catch (e) {
    tg?.showAlert?.(e.message);
  }
});

document.getElementById('withdraw-btn').addEventListener('click', async () => {
  const gramAmount = Number(document.getElementById('withdraw-input').value);
  try {
    me = await api('/api/withdraw', { method: 'POST', body: JSON.stringify({ gramAmount }) });
    renderMe();
    tg?.showPopup?.({ message: 'Withdrawal pending review' });
  } catch (e) {
    tg?.showAlert?.(e.message);
  }
});

document.getElementById('lt-save').addEventListener('click', async () => {
  const title = document.getElementById('lt-title').value.trim();
  const url = document.getElementById('lt-url').value.trim();
  const reward = Number(document.getElementById('lt-reward').value);
  const pinned = document.getElementById('lt-pin').checked;
  try {
    await api('/api/admin/link-task', {
      method: 'POST',
      body: JSON.stringify({ title, url, reward, pinned }),
    });
    tg?.showPopup?.({ message: 'Link task added' });
  } catch (e) {
    tg?.showAlert?.(e.message);
  }
});

document.getElementById('adm-search').addEventListener('click', async () => {
  const q = document.getElementById('adm-q').value.trim();
  try {
    adminTarget = await api(`/api/admin/users/search?q=${encodeURIComponent(q)}`);
    document.getElementById('adm-info').textContent = `${adminTarget.firstName} (@${adminTarget.username || adminTarget.telegramId}) — ${adminTarget.balance} vølt${adminTarget.banned ? ' · BANNED' : ''}`;
  } catch (e) {
    tg?.showAlert?.(e.message);
  }
});

document.getElementById('adm-add').addEventListener('click', async () => {
  if (!adminTarget) return tg?.showAlert?.('Search a user first');
  const amount = Number(document.getElementById('adm-points').value);
  try {
    adminTarget = await api('/api/admin/points', {
      method: 'POST',
      body: JSON.stringify({ telegramId: adminTarget.telegramId, amount }),
    });
    document.getElementById('adm-info').textContent = `Updated: ${adminTarget.balance} vølt`;
  } catch (e) {
    tg?.showAlert?.(e.message);
  }
});

document.getElementById('adm-ban').addEventListener('click', async () => {
  if (!adminTarget) return;
  adminTarget = await api('/api/admin/ban', {
    method: 'POST',
    body: JSON.stringify({ telegramId: adminTarget.telegramId, ban: true }),
  });
  document.getElementById('adm-info').textContent += ' · BANNED';
});

document.getElementById('adm-unban').addEventListener('click', async () => {
  if (!adminTarget) return;
  adminTarget = await api('/api/admin/ban', {
    method: 'POST',
    body: JSON.stringify({ telegramId: adminTarget.telegramId, ban: false }),
  });
  document.getElementById('adm-info').textContent = 'Unbanned';
});

setInterval(async () => {
  try {
    me = await api('/api/me');
    renderMe();
  } catch {
    /* ignore */
  }
}, 5000);

(async () => {
  try {
    await loadMe();
    await ensureCaptcha();
  } catch (e) {
    console.error(e);
  }
})();
