// --- DOM Elements ---
const scenarioCards = document.querySelectorAll('.scenario-card');
const resultArea = document.getElementById('result-area');
const scenarioTitle = document.getElementById('scenario-title');
const scenarioDescription = document.getElementById('scenario-description');
const paramsGrid = document.getElementById('params-grid');
const loading = document.getElementById('loading');
const stepsContainer = document.getElementById('steps-container');
const summarySection = document.getElementById('summary-section');
const summaryGrid = document.getElementById('summary-grid');
const executionTime = document.getElementById('execution-time');
const footerText = document.getElementById('footer-text');

// Chipnet UI
const chipnetBanner = document.getElementById('chipnet-banner');
const chipnetIndicator = document.getElementById('chipnet-indicator');
const chipnetStatusText = document.getElementById('chipnet-status-text');
const chipnetDetails = document.getElementById('chipnet-details');
const chipnetAddress = document.getElementById('chipnet-address');
const chipnetBalance = document.getElementById('chipnet-balance');
const chipnetUtxos = document.getElementById('chipnet-utxos');

// Mode & tabs
const modeBtns = document.querySelectorAll('.mode-btn');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Toast
const toast = document.getElementById('toast');

let isRunning = false;
let currentMode = 'mock';
let currentEventSource = null;

// ========== TAB NAVIGATION ==========

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tabContents.forEach(tc => tc.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');

    if (tab === 'setup') loadKeysStatus();
    if (tab === 'explorer') loadExplorerContracts();
    if (tab === 'history') renderHistory();
  });
});

// ========== MODE SWITCHING ==========

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (isRunning) return;
    const mode = btn.dataset.mode;
    if (mode === currentMode) return;
    setMode(mode);
  });
});

function setMode(mode) {
  currentMode = mode;
  modeBtns.forEach(b => b.classList.remove('active'));
  document.querySelector(`.mode-btn-${mode}`).classList.add('active');

  resultArea.classList.add('hidden');
  scenarioCards.forEach(c => c.classList.remove('active'));

  if (mode === 'chipnet') {
    chipnetBanner.classList.remove('hidden');
    footerText.textContent = 'CashBlocks v0.2.0 — Real on-chain transactions on BCH Chipnet (testnet)';
    checkChipnetStatus();
  } else {
    chipnetBanner.classList.add('hidden');
    footerText.textContent = 'CashBlocks v0.2.0 — All scenarios run real CashScript contracts with MockNetworkProvider (no BCH needed)';
  }
}

// ========== CHIPNET STATUS ==========

async function checkChipnetStatus() {
  chipnetIndicator.className = 'indicator indicator-checking';
  chipnetStatusText.textContent = 'Connecting to chipnet...';
  chipnetDetails.classList.add('hidden');

  try {
    const res = await fetch('/api/chipnet/status');
    const data = await res.json();

    if (data.available && data.keysLoaded) {
      chipnetIndicator.className = 'indicator indicator-connected';
      chipnetStatusText.textContent = 'Connected to BCH Chipnet';
      chipnetAddress.textContent = truncateAddress(data.owner.address);
      chipnetAddress.title = data.owner.address;
      chipnetBalance.textContent = `${data.owner.balance.toLocaleString()} sats`;
      chipnetUtxos.textContent = data.owner.utxoCount;
      chipnetDetails.classList.remove('hidden');
    } else {
      chipnetIndicator.className = 'indicator indicator-error';
      chipnetStatusText.textContent = data.error || 'Chipnet not available';
    }
  } catch (err) {
    chipnetIndicator.className = 'indicator indicator-error';
    chipnetStatusText.textContent = 'Failed to connect: ' + err.message;
  }
}

// ========== SCENARIO EXECUTION ==========

scenarioCards.forEach(card => {
  card.addEventListener('click', () => {
    if (isRunning) return;
    const scenario = card.dataset.scenario;

    // Ensure we're on the scenarios tab
    tabBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="scenarios"]').classList.add('active');
    tabContents.forEach(tc => tc.classList.remove('active'));
    document.getElementById('tab-scenarios').classList.add('active');

    if (currentMode === 'chipnet') {
      runChipnetScenario(scenario, card);
    } else {
      runMockScenario(scenario, card);
    }
  });
});

async function runMockScenario(name, card) {
  isRunning = true;
  scenarioCards.forEach(c => c.classList.remove('active'));
  card.classList.add('active');

  resultArea.classList.remove('hidden');
  stepsContainer.innerHTML = '';
  paramsGrid.innerHTML = '';
  summaryGrid.innerHTML = '';
  summarySection.classList.add('hidden');
  loading.classList.remove('hidden');
  scenarioTitle.textContent = 'Loading...';
  scenarioDescription.textContent = '';

  resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await fetch(`/api/scenario/${name}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    loading.classList.add('hidden');
    scenarioTitle.textContent = data.title;
    scenarioDescription.textContent = data.description;

    renderParams(data.params);

    for (let i = 0; i < data.steps.length; i++) {
      await delay(400);
      renderStep(data.steps[i], i);
    }

    await delay(300);
    renderSummary(data.summary, data.executionTimeMs, 'mock');

    saveHistory({ scenario: name, mode: 'mock', title: data.title, summary: data.summary, timeMs: data.executionTimeMs });
  } catch (err) {
    loading.classList.add('hidden');
    scenarioTitle.textContent = 'Error';
    scenarioDescription.textContent = err.message;
  }

  isRunning = false;
}

function runChipnetScenario(name, card) {
  isRunning = true;
  let stepIndex = 0;

  scenarioCards.forEach(c => c.classList.remove('active'));
  card.classList.add('active');

  resultArea.classList.remove('hidden');
  stepsContainer.innerHTML = '';
  paramsGrid.innerHTML = '';
  summaryGrid.innerHTML = '';
  summarySection.classList.add('hidden');
  loading.classList.remove('hidden');
  loading.querySelector('.cursor').nextSibling.textContent = ' Broadcasting to BCH Chipnet...';
  scenarioTitle.textContent = 'Executing on Chipnet...';
  scenarioDescription.textContent = 'Real on-chain transactions. This may take 15-30 seconds.';

  resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }

  const es = new EventSource(`/api/chipnet/scenario/${name}`);
  currentEventSource = es;

  es.addEventListener('step', (event) => {
    const step = JSON.parse(event.data);
    loading.classList.add('hidden');

    if (stepIndex === 0) {
      scenarioTitle.textContent = `${capitalize(name)} — Chipnet`;
      scenarioDescription.textContent = 'Live on-chain execution with real BCH transactions.';
    }

    renderStep(step, stepIndex, true);
    stepIndex++;
  });

  es.addEventListener('complete', (event) => {
    const result = JSON.parse(event.data);
    es.close();
    currentEventSource = null;

    if (result.params) renderParams(result.params);
    if (result.summary) renderSummary(result.summary, result.executionTimeMs, 'chipnet');

    saveHistory({
      scenario: name, mode: 'chipnet', title: result.title || `${capitalize(name)} — Chipnet`,
      summary: result.summary, timeMs: result.executionTimeMs,
      txids: result.steps ? result.steps.filter(s => s.txid).map(s => s.txid) : [],
    });

    checkChipnetStatus();
    isRunning = false;
  });

  es.addEventListener('error', (event) => {
    if (es.readyState === EventSource.CLOSED) return;

    let errorMsg = 'Connection lost';
    try {
      const data = JSON.parse(event.data);
      errorMsg = data.error || errorMsg;
    } catch {}

    es.close();
    currentEventSource = null;
    loading.classList.add('hidden');
    scenarioTitle.textContent = 'Error';
    scenarioDescription.textContent = errorMsg;
    isRunning = false;
  });
}

// ========== RENDERING ==========

function renderParams(params) {
  paramsGrid.innerHTML = '';
  for (const [key, value] of Object.entries(params)) {
    const keyEl = document.createElement('span');
    keyEl.className = 'param-key';
    keyEl.textContent = key;

    const valueEl = document.createElement('span');
    valueEl.className = 'param-value';
    valueEl.textContent = value;

    paramsGrid.appendChild(keyEl);
    paramsGrid.appendChild(valueEl);
  }
}

function renderStep(step, index, isChipnet) {
  const el = document.createElement('div');
  el.className = `step step-${step.status}`;

  let bodyHtml = `<p>${escapeHtml(step.description)}</p>`;

  bodyHtml += '<div class="step-details">';
  for (const [key, value] of Object.entries(step.details)) {
    bodyHtml += `<span class="detail-key">${escapeHtml(key)}:</span>`;
    bodyHtml += `<span class="detail-value">${escapeHtml(value)}</span>`;
  }
  bodyHtml += '</div>';

  if (step.txid) {
    if (step.explorerUrl) {
      bodyHtml += `<div class="step-txid">txid: <a href="${escapeHtml(step.explorerUrl)}" target="_blank" rel="noopener">${escapeHtml(step.txid)}</a></div>`;
    } else {
      bodyHtml += `<div class="step-txid">txid: ${escapeHtml(step.txid)}</div>`;
    }
  }

  if (step.primitives && step.primitives.length > 0) {
    bodyHtml += '<div class="step-primitives">';
    for (const p of step.primitives) {
      const cls = primitiveClass(p);
      bodyHtml += `<span class="primitive-chip ${cls}">${escapeHtml(p)}</span>`;
    }
    bodyHtml += '</div>';
  }

  el.innerHTML = `
    <div class="step-header">
      <span class="step-number">${index + 1}</span>
      <span class="step-title">${escapeHtml(step.title)}</span>
      <span class="badge badge-${step.status}">${step.status}</span>
    </div>
    <div class="step-body">${bodyHtml}</div>
  `;

  el.style.opacity = '0';
  el.style.transform = 'translateY(12px)';
  stepsContainer.appendChild(el);

  requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });

  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderSummary(summary, timeMs, mode) {
  summaryGrid.innerHTML = '';
  for (const [key, value] of Object.entries(summary)) {
    const keyEl = document.createElement('span');
    keyEl.className = 'summary-key';
    keyEl.textContent = key;

    const valueEl = document.createElement('span');
    valueEl.className = 'summary-value';
    valueEl.textContent = value;

    summaryGrid.appendChild(keyEl);
    summaryGrid.appendChild(valueEl);
  }

  if (mode === 'chipnet') {
    executionTime.textContent = `Executed in ${(timeMs / 1000).toFixed(1)}s (BCH Chipnet, real on-chain)`;
  } else {
    executionTime.textContent = `Executed in ${timeMs}ms (MockNetworkProvider, in-memory)`;
  }

  summarySection.classList.remove('hidden');
  summarySection.style.opacity = '0';
  summarySection.style.transform = 'translateY(12px)';
  requestAnimationFrame(() => {
    summarySection.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    summarySection.style.opacity = '1';
    summarySection.style.transform = 'translateY(0)';
  });

  summarySection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ========== SETUP TAB: KEY MANAGEMENT ==========

const keysStatus = document.getElementById('keys-status');
const keysDisplay = document.getElementById('keys-display');
const btnGenerateKeys = document.getElementById('btn-generate-keys');
const fundingAddress = document.getElementById('funding-address');
const btnCopyFunding = document.getElementById('btn-copy-funding');
const setupBalance = document.getElementById('setup-balance');
const setupUtxos = document.getElementById('setup-utxos');
const btnRefreshBalance = document.getElementById('btn-refresh-balance');

async function loadKeysStatus() {
  keysStatus.textContent = 'Checking keys...';
  keysDisplay.classList.add('hidden');
  btnGenerateKeys.classList.add('hidden');

  try {
    const res = await fetch('/api/keys');
    const data = await res.json();

    if (data.exists) {
      keysStatus.textContent = 'Keys loaded successfully.';
      keysStatus.style.color = 'var(--green)';
      document.getElementById('key-owner-addr').textContent = data.owner.address;
      document.getElementById('key-recipient-addr').textContent = data.recipient.address;
      document.getElementById('key-oracle-addr').textContent = data.oracle.address;
      keysDisplay.classList.remove('hidden');
      btnGenerateKeys.classList.add('hidden');

      fundingAddress.textContent = data.owner.address;
      btnCopyFunding.disabled = false;

      refreshBalance();
    } else {
      keysStatus.textContent = 'No keys found. Click below to generate.';
      keysStatus.style.color = 'var(--amber)';
      btnGenerateKeys.classList.remove('hidden');
    }
  } catch (err) {
    keysStatus.textContent = 'Error: ' + err.message;
    keysStatus.style.color = 'var(--red)';
  }
}

btnGenerateKeys.addEventListener('click', async () => {
  btnGenerateKeys.disabled = true;
  btnGenerateKeys.textContent = 'Generating...';

  try {
    const res = await fetch('/api/keys/generate', { method: 'POST' });
    const data = await res.json();

    if (data.error) {
      showToast(data.error, 'error');
      return;
    }

    showToast('Keys generated successfully!', 'success');
    loadKeysStatus();
  } catch (err) {
    showToast('Failed to generate keys: ' + err.message, 'error');
  } finally {
    btnGenerateKeys.disabled = false;
    btnGenerateKeys.textContent = 'Generate Keys';
  }
});

async function refreshBalance() {
  try {
    const res = await fetch('/api/chipnet/status');
    const data = await res.json();

    if (data.available && data.keysLoaded) {
      setupBalance.textContent = `${data.owner.balance.toLocaleString()} sats`;
      setupBalance.style.color = data.owner.balance > 0 ? 'var(--green)' : 'var(--red)';
      setupUtxos.textContent = data.owner.utxoCount;
    } else {
      setupBalance.textContent = data.error || 'Unavailable';
      setupBalance.style.color = 'var(--red)';
    }
  } catch (err) {
    setupBalance.textContent = 'Error';
    setupBalance.style.color = 'var(--red)';
  }
}

btnRefreshBalance.addEventListener('click', () => {
  setupBalance.textContent = 'Loading...';
  setupBalance.style.color = 'var(--text-secondary)';
  refreshBalance();
});

btnCopyFunding.addEventListener('click', () => {
  const addr = fundingAddress.textContent;
  if (addr && addr !== 'Generate keys first') {
    copyToClipboard(addr);
  }
});

document.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.copy;
    const el = document.getElementById(targetId);
    if (el) copyToClipboard(el.textContent);
  });
});

// ========== EXPLORER TAB ==========

const explorerBtns = document.querySelectorAll('.explorer-btn');
const explorerLoading = document.getElementById('explorer-loading');
const explorerEmpty = document.getElementById('explorer-empty');
const contractsList = document.getElementById('contracts-list');
const utxoViewer = document.getElementById('utxo-viewer');
const utxoAddress = document.getElementById('utxo-address');
const utxoList = document.getElementById('utxo-list');

let currentExplorerScenario = 'dao';

explorerBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    explorerBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentExplorerScenario = btn.dataset.explore;
    loadExplorerContracts();
  });
});

async function loadExplorerContracts() {
  explorerLoading.classList.remove('hidden');
  explorerEmpty.classList.add('hidden');
  contractsList.classList.add('hidden');
  utxoViewer.classList.add('hidden');

  try {
    const res = await fetch(`/api/contracts/${currentExplorerScenario}`);
    const data = await res.json();

    if (data.error) {
      explorerLoading.classList.add('hidden');
      explorerEmpty.classList.remove('hidden');
      explorerEmpty.querySelector('p').textContent = data.error;
      return;
    }

    explorerLoading.classList.add('hidden');
    contractsList.classList.remove('hidden');
    contractsList.innerHTML = '';

    for (const [name, info] of Object.entries(data.contracts)) {
      const card = document.createElement('div');
      card.className = 'contract-card';

      const lowerName = name.toLowerCase();
      const primitiveType = (lowerName.includes('vault') || lowerName.includes('pool') || lowerName.includes('escrow') || lowerName.includes('treasury'))
        ? 'vault' : (lowerName.includes('time') || lowerName.includes('timer') || lowerName.includes('governance'))
        ? 'timestate' : 'oracle';

      card.innerHTML = `
        <div class="contract-card-header">
          <span class="primitive-chip primitive-${primitiveType}">${escapeHtml(name)}</span>
          <span class="contract-balance">${info.balance.toLocaleString()} sats</span>
        </div>
        <p class="contract-role">${escapeHtml(info.role)}</p>
        <div class="contract-addr-row">
          <span class="contract-addr">${escapeHtml(info.address)}</span>
          <button class="copy-btn copy-inline">Copy</button>
        </div>
        <div class="contract-meta">
          <span>UTXOs: ${info.utxoCount}</span>
          <button class="btn btn-small">View UTXOs</button>
        </div>
      `;

      // Attach event listeners
      card.querySelector('.copy-inline').addEventListener('click', () => copyToClipboard(info.address));
      card.querySelector('.btn-small').addEventListener('click', () => viewUtxos(info.address));

      contractsList.appendChild(card);
    }
  } catch (err) {
    explorerLoading.classList.add('hidden');
    explorerEmpty.classList.remove('hidden');
    explorerEmpty.querySelector('p').textContent = 'Error: ' + err.message;
  }
}

async function viewUtxos(address) {
  utxoViewer.classList.remove('hidden');
  utxoAddress.textContent = address;
  utxoList.innerHTML = '<div class="loading"><span class="cursor">_</span> Loading UTXOs...</div>';

  try {
    const res = await fetch(`/api/utxos/${address}`);
    const data = await res.json();

    if (data.utxos.length === 0) {
      utxoList.innerHTML = '<p class="utxo-empty">No UTXOs found at this address.</p>';
      return;
    }

    utxoList.innerHTML = '';
    for (const utxo of data.utxos) {
      const el = document.createElement('div');
      el.className = 'utxo-item';
      el.innerHTML = `
        <div class="utxo-row">
          <span class="utxo-label">txid:</span>
          <span class="utxo-value">${escapeHtml(utxo.txid)}</span>
        </div>
        <div class="utxo-row">
          <span class="utxo-label">vout:</span>
          <span class="utxo-value">${utxo.vout}</span>
          <span class="utxo-label" style="margin-left: 16px">sats:</span>
          <span class="utxo-value utxo-sats">${utxo.satoshis.toLocaleString()}</span>
        </div>
      `;
      utxoList.appendChild(el);
    }

    utxoViewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    utxoList.innerHTML = `<p class="utxo-empty">Error: ${escapeHtml(err.message)}</p>`;
  }
}

// ========== HISTORY ==========

const HISTORY_KEY = 'cashblocks_history';
const btnClearHistory = document.getElementById('btn-clear-history');
const historyList = document.getElementById('history-list');

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(entry) {
  const history = getHistory();
  history.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (history.length > 50) history.length = 50;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function renderHistory() {
  const history = getHistory();

  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No executions yet. Run a scenario to see it here.</div>';
    return;
  }

  historyList.innerHTML = '';
  for (const entry of history) {
    const el = document.createElement('div');
    el.className = 'history-item';

    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    const modeClass = entry.mode === 'chipnet' ? 'mode-chipnet-badge' : 'mode-mock-badge';

    let summaryHtml = '';
    if (entry.summary) {
      summaryHtml = '<div class="history-summary">';
      for (const [k, v] of Object.entries(entry.summary)) {
        summaryHtml += `<span class="history-kv"><span class="history-k">${escapeHtml(k)}:</span> ${escapeHtml(String(v))}</span>`;
      }
      summaryHtml += '</div>';
    }

    let txidsHtml = '';
    if (entry.txids && entry.txids.length > 0) {
      txidsHtml = '<div class="history-txids">';
      for (const txid of entry.txids) {
        txidsHtml += `<span class="history-txid">${escapeHtml(txid.slice(0, 16))}...</span>`;
      }
      txidsHtml += '</div>';
    }

    el.innerHTML = `
      <div class="history-item-header">
        <span class="history-title">${escapeHtml(entry.title || capitalize(entry.scenario))}</span>
        <span class="${modeClass}">${entry.mode}</span>
      </div>
      <div class="history-item-meta">
        <span>${timeStr}</span>
        <span>${entry.timeMs ? (entry.mode === 'chipnet' ? (entry.timeMs / 1000).toFixed(1) + 's' : entry.timeMs + 'ms') : ''}</span>
      </div>
      ${summaryHtml}
      ${txidsHtml}
    `;

    historyList.appendChild(el);
  }
}

btnClearHistory.addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  showToast('History cleared', 'info');
});

// ========== HELPERS ==========

function primitiveClass(name) {
  const lower = name.toLowerCase();
  if (lower === 'vault') return 'primitive-vault';
  if (lower.includes('time')) return 'primitive-timestate';
  if (lower.includes('oracle')) return 'primitive-oracle';
  return '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncateAddress(addr) {
  if (addr.length <= 20) return addr;
  return addr.slice(0, 14) + '...' + addr.slice(-6);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied to clipboard', 'success');
  });
}

let toastTimeout = null;
function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toast.classList.remove('hidden');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// ========== INIT ==========
loadKeysStatus();
