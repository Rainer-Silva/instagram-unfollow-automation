let lastStatus = null;

const $ = (id) => document.getElementById(id);
const categoryLabels = {
  instagram_business_or_creator_category: 'Business / creator labels',
  selling_or_product_page: 'Selling / product pages',
  public_or_general_page: 'Public / general pages',
  person_or_uncategorized: 'Personal / uncategorized',
  mutual_friends_last: 'Mutual friends last'
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function setText(id, value) {
  $(id).textContent = value;
}

function formatTime(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function render(status) {
  lastStatus = status;
  setText('account', status.account || '-');
  setText('removed-today', status.today.unfollowed);
  setText('daily-cap', status.dailyMaxUnfollows);
  setText('remaining', status.today.remaining);
  setText('run-state', status.activeRun.running ? 'Running' : 'Idle');
  $('run-state').style.background = status.activeRun.running ? '#16664f' : 'rgba(255,255,255,.55)';
  $('run-state').style.color = status.activeRun.running ? '#fff' : '#1d1a16';

  $('run-max').value = status.dailyMaxUnfollows;
  $('target-account').value = status.env.INSTAGRAM_USERNAME || status.account || '';
  $('following-url').value = status.env.FOLLOWING_URL || status.followingUrl || '';
  $('mode-all').checked = status.cleanup.mode === 'all';
  $('mode-categories').checked = status.cleanup.mode !== 'all';
  renderCategories(status.cleanup.availableCategories, status.cleanup.categories);
  $('schedule-hour').value = status.scheduler.hour;
  $('schedule-minute').value = status.scheduler.minute;
  $('schedule-max').value = status.dailyMaxUnfollows;
  $('schedule-live').checked = status.env.DRY_RUN !== '1';
  $('scheduler-path').textContent = `Launchd: ${formatTime(status.scheduler.hour, status.scheduler.minute)} / ${status.scheduler.installed ? 'installed' : 'not installed'}`;

  setText('delay-range', `Delay: ${status.safety.minDelaySeconds}-${status.safety.maxDelaySeconds}s`);
  setText('cooldown', `Cooldown: every ${status.safety.batchSize} actions, ${status.safety.cooldownMinutesMin}-${status.safety.cooldownMinutesMax} min`);
  setText('skip-personal', `Personal accounts: ${status.safety.skipPersonalAccounts ? 'skipped' : 'eligible'}`);

  $('allowlist').value = status.allowlist || '';
  $('report').textContent = status.reportPreview || 'No report yet.';
  $('log').textContent = status.logPreview || 'No log yet.';
  $('run-output').textContent = (status.activeRun.output || []).join('\n');
  $('live-run').disabled = status.activeRun.running;
  $('dry-run').disabled = status.activeRun.running;
  $('stop-run').disabled = !status.activeRun.running;
}

function renderCategories(availableCategories, selectedCategories) {
  const grid = $('category-grid');
  const selected = new Set(selectedCategories || []);
  grid.innerHTML = '';
  for (const category of availableCategories || []) {
    const label = document.createElement('label');
    label.className = 'check category-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = category;
    input.checked = selected.has(category);
    label.append(input, document.createTextNode(categoryLabels[category] || category));
    grid.append(label);
  }
}

async function refresh() {
  const status = await request('/api/status');
  const active = document.activeElement;
  const editingAllowlist = active && active.id === 'allowlist';
  const editingConfig = active && ['target-account', 'following-url'].includes(active.id);
  const currentAllowlist = $('allowlist').value;
  const currentAccount = $('target-account').value;
  const currentFollowingUrl = $('following-url').value;
  render(status);
  if (editingAllowlist) {
    $('allowlist').value = currentAllowlist;
    $('allowlist').focus();
  }
  if (editingConfig) {
    $('target-account').value = currentAccount;
    $('following-url').value = currentFollowingUrl;
    active.focus();
  }
}

async function run(mode) {
  const maxUnfollows = Number($('run-max').value);
  await request('/api/run', {
    method: 'POST',
    body: { mode, maxUnfollows }
  });
  await refresh();
}

async function saveScheduler() {
  await request('/api/scheduler', {
    method: 'POST',
    body: {
      hour: Number($('schedule-hour').value),
      minute: Number($('schedule-minute').value),
      maxUnfollows: Number($('schedule-max').value),
      live: $('schedule-live').checked
    }
  });
  await refresh();
}

async function saveConfig() {
  const cleanupMode = $('mode-all').checked ? 'all' : 'categories';
  const cleanupCategories = [...document.querySelectorAll('#category-grid input:checked')]
    .map((input) => input.value);
  await request('/api/config', {
    method: 'POST',
    body: {
      account: $('target-account').value,
      followingUrl: $('following-url').value,
      cleanupMode,
      cleanupCategories
    }
  });
  await refresh();
}

async function installScheduler() {
  await request('/api/scheduler/install', { method: 'POST' });
  await refresh();
}

async function setScheduler(enabled) {
  await request('/api/scheduler/enabled', {
    method: 'POST',
    body: { enabled }
  });
  await refresh();
}

async function saveAllowlist() {
  await request('/api/allowlist', {
    method: 'POST',
    body: { allowlist: $('allowlist').value }
  });
  await refresh();
}

function bind(id, handler) {
  $(id).addEventListener('click', async () => {
    try {
      await handler();
    } catch (error) {
      alert(error.message);
    }
  });
}

bind('dry-run', () => run('dry-run'));
bind('live-run', () => run('live'));
bind('stop-run', () => request('/api/stop', { method: 'POST' }).then(refresh));
bind('save-scheduler', saveScheduler);
bind('save-config', saveConfig);
bind('install-scheduler', installScheduler);
bind('enable-scheduler', () => setScheduler(true));
bind('disable-scheduler', () => setScheduler(false));
bind('save-allowlist', saveAllowlist);

refresh().catch((error) => {
  setText('run-state', error.message);
});
setInterval(() => {
  refresh().catch(() => {
    if (lastStatus) render(lastStatus);
  });
}, 4000);
