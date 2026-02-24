// ═══════════════════════════════════════════
// CashBlocks DeFi Protocol — Dashboard JS
// ═══════════════════════════════════════════

(function() {
  'use strict';

  // ─── State ───
  let totalBlocked = 0;
  let totalProcessed = 0;
  const stepCounts = {};
  let currentMode = 'mock'; // 'mock' or 'chipnet'
  var prevDashValues = {}; // for animated counters

  // ─── Toast System ───
  function showToast(type, title, msg) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var icons = { success: '\u2713', error: '\u2717', info: 'i' };
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.innerHTML =
      '<div class="toast-icon">' + (icons[type] || 'i') + '</div>' +
      '<div class="toast-body">' +
        '<div class="toast-title">' + escapeHtml(title) + '</div>' +
        (msg ? '<div class="toast-msg">' + escapeHtml(msg) + '</div>' : '') +
      '</div>';
    container.appendChild(toast);
    setTimeout(function() {
      toast.classList.add('toast-out');
      setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 4000);
  }

  // ─── Animated Counter ───
  function animateValue(el, start, end, duration, formatter) {
    var fmt = formatter || function(v) { return Number(v).toLocaleString(); };
    if (!el || start === end) { if (el) el.textContent = fmt(end); return; }
    var startTime = null;
    var diff = end - start;
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      var current = Math.round(start + diff * eased);
      el.textContent = fmt(current);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.classList.add('value-pulse');
        setTimeout(function() { el.classList.remove('value-pulse'); }, 400);
      }
    }
    requestAnimationFrame(step);
  }

  // ─── Ring Chart Updater ───
  function updateRingChart(utilization) {
    var fill = document.getElementById('ring-fill');
    var pct = document.getElementById('ring-pct');
    var healthBadge = document.getElementById('health-badge');
    var healthText = document.getElementById('health-text');
    var circumference = 2 * Math.PI * 40; // ~251.33
    var offset = circumference - (Math.min(utilization, 100) / 100) * circumference;
    if (fill) {
      fill.style.strokeDashoffset = offset;
      if (utilization < 60) fill.style.stroke = 'var(--green)';
      else if (utilization < 85) fill.style.stroke = 'var(--amber)';
      else fill.style.stroke = 'var(--red)';
    }
    if (pct) pct.textContent = utilization.toFixed(1) + '%';
    if (healthBadge && healthText) {
      healthBadge.className = 'health-badge';
      if (utilization < 60) {
        healthBadge.classList.add('health-healthy');
        healthText.textContent = 'Healthy';
      } else if (utilization < 85) {
        healthBadge.classList.add('health-moderate');
        healthText.textContent = 'Moderate';
      } else {
        healthBadge.classList.add('health-critical');
        healthText.textContent = 'Critical';
      }
    }
  }

  // ─── Loading Overlay ───
  function showLoadingOverlay() {
    var overlay = document.getElementById('lending-loading-overlay');
    var subtext = document.getElementById('loading-subtext');
    if (overlay) overlay.style.display = '';
    if (subtext) subtext.textContent = currentMode === 'chipnet'
      ? 'Funding contracts on chipnet...'
      : 'Deploying mock contracts...';
  }
  function hideLoadingOverlay() {
    var overlay = document.getElementById('lending-loading-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ─── Server Health Check ───
  var serverOnline = false;
  function checkServerHealth() {
    var badge = document.getElementById('badge-server');
    var text = document.getElementById('server-status-text');
    fetch('/api/lending/pools', { method: 'GET' })
      .then(function(r) {
        if (!r.ok) throw new Error('bad status');
        serverOnline = true;
        if (badge) { badge.className = 'badge badge-server server-online'; }
        if (text) text.textContent = 'Server OK';
      })
      .catch(function() {
        serverOnline = false;
        if (badge) { badge.className = 'badge badge-server server-offline'; }
        if (text) text.textContent = 'Server Offline';
      });
  }
  checkServerHealth();
  setInterval(checkServerHealth, 15000);

  // ─── Hero Buttons ───
  var heroRunBtn = document.getElementById('hero-run-btn');
  if (heroRunBtn) {
    heroRunBtn.addEventListener('click', function() {
      document.getElementById('scenarios').scrollIntoView({ behavior: 'smooth' });
    });
  }
  var heroSdkBtn = document.getElementById('hero-sdk-btn');
  if (heroSdkBtn) {
    heroSdkBtn.addEventListener('click', function() {
      var sdkItem = document.querySelector('[data-scenario="sdk"]');
      if (sdkItem) sdkItem.click();
    });
  }

  // ─── Mode Toggle ───
  document.querySelectorAll('.mode-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var mode = btn.dataset.mode;
      if (mode === currentMode) return;
      currentMode = mode;
      document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      updateModeUI();
    });
  });

  function updateModeUI() {
    var walletSection = document.getElementById('wallet-section');
    var identitySection = document.getElementById('identity-section');
    var badgeNet = document.getElementById('badge-net');
    var badgeNetText = document.getElementById('badge-net-text');

    if (currentMode === 'chipnet') {
      if (walletSection) walletSection.style.display = '';
      if (identitySection) identitySection.style.display = 'none';
      if (badgeNet) badgeNet.classList.add('badge-chipnet-active');
      if (badgeNetText) badgeNetText.textContent = 'Chipnet';
      loadWalletStatus();
    } else {
      if (walletSection) walletSection.style.display = 'none';
      if (identitySection) identitySection.style.display = '';
      if (badgeNet) badgeNet.classList.remove('badge-chipnet-active');
      if (badgeNetText) badgeNetText.textContent = 'Testnet';
      renderIdentityPanel();
    }
  }

  // ─── Sidebar Navigation ───
  document.querySelectorAll('.sidebar-item').forEach(function(item) {
    item.addEventListener('click', function() {
      document.querySelectorAll('.sidebar-item').forEach(function(i) { i.classList.remove('active'); });
      document.querySelectorAll('.scenario-panel').forEach(function(p) { p.classList.remove('active'); });
      item.classList.add('active');
      var scenario = item.dataset.scenario;
      var panel = document.getElementById('panel-' + scenario);
      if (panel) panel.classList.add('active');

      // Update header nav active state
      document.querySelectorAll('.nav-link').forEach(function(l) { l.classList.remove('active'); });
      if (scenario === 'sdk') {
        var sdkLink = document.querySelector('.nav-link[href="#sdk"]');
        if (sdkLink) sdkLink.classList.add('active');
      } else {
        var scenLink = document.querySelector('.nav-link[href="#scenarios"]');
        if (scenLink) scenLink.classList.add('active');
      }
    });
  });

  // Header nav clicks
  document.querySelectorAll('.nav-link').forEach(function(link) {
    link.addEventListener('click', function(e) {
      var href = link.getAttribute('href');
      if (href === '#sdk') {
        e.preventDefault();
        var sdkItem = document.querySelector('[data-scenario="sdk"]');
        if (sdkItem) sdkItem.click();
        document.getElementById('scenarios').scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // ─── Run Scenario Buttons (via data-run attribute) ───
  document.querySelectorAll('[data-run]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      runScenario(btn.dataset.run);
    });
  });

  // ─── Code Tabs ───
  var codeSnippets = {
    init: {
      title: 'Initialize 4 Primitives',
      code: 'import { VaultPrimitive, TimeStatePrimitive,\n' +
        '         OracleProofPrimitive, TokenGatePrimitive\n' +
        "} from 'cashblocks';\n" +
        "import { MockNetworkProvider } from 'cashscript';\n" +
        '\n' +
        'const provider = new MockNetworkProvider();\n' +
        '\n' +
        'const pool = new VaultPrimitive({\n' +
        '  ownerPk: lenderPub,\n' +
        '  spendLimit: 500_000n,\n' +
        '  whitelistHash: borrowerPkh,\n' +
        '}, provider);\n' +
        '\n' +
        'const schedule = new TimeStatePrimitive({\n' +
        '  ownerPk: lenderPub,\n' +
        '  phase1Time: BigInt(appStart),\n' +
        '  phase2Time: BigInt(appEnd),\n' +
        '}, provider);\n' +
        '\n' +
        'const credit = new OracleProofPrimitive({\n' +
        '  oraclePk: assessorPub,\n' +
        '  domainSeparator: new Uint8Array([0x43, 0x52, 0x45, 0x44]),\n' +
        '  expiryDuration: 7200n,\n' +
        '}, provider);\n' +
        '\n' +
        'const governance = new TokenGatePrimitive({\n' +
        '  requiredCategory: TokenGatePrimitive.categoryToVMBytes(categoryHex),\n' +
        '  minTokenAmount: 100n,\n' +
        '}, provider);'
    },
    oracle: {
      title: 'Oracle Signing (Off-chain)',
      code: "import { encodeOracleMessage, intToBytes4LE } from 'cashblocks';\n" +
        "import { secp256k1, sha256 } from '@bitauth/libauth';\n" +
        '\n' +
        '// Off-chain: assessor signs a credit score\n' +
        'const payload = intToBytes4LE(85n);  // score = 85\n' +
        'const message = encodeOracleMessage(\n' +
        '  DOMAIN,        // 4-byte domain separator\n' +
        '  timestamp,     // when assessed\n' +
        '  nonce,         // replay protection\n' +
        '  payload        // score as bytes\n' +
        ');\n' +
        '\n' +
        'const sig = secp256k1.signMessageHashSchnorr(\n' +
        '  assessorPrivKey,\n' +
        '  sha256.hash(message)\n' +
        ');\n' +
        '\n' +
        '// On-chain: contract verifies via checkDataSig(sig, message, oraclePk)\n' +
        '// Domain, timestamp, nonce, and expiry all validated atomically'
    },
    compose: {
      title: 'Compose 4-Primitive Atomic TX',
      code: "import { TransactionComposer } from 'cashblocks';\n" +
        "import { SignatureTemplate } from 'cashscript';\n" +
        '\n' +
        'const lenderSig = new SignatureTemplate(lenderPrivKey);\n' +
        '\n' +
        '// All 4 inputs must validate or entire TX is rejected\n' +
        'const composer = new TransactionComposer(provider);\n' +
        'composer\n' +
        '  .addInput(poolUtxo, pool.contract.unlock\n' +
        '    .composableSpend(lenderSig, loanAmount, 0n))\n' +
        '  .addInput(timerUtxo, schedule.contract.unlock\n' +
        '    .composableCheck(lenderSig, 1n))\n' +
        '  .addInput(oracleUtxo, credit.contract.unlock\n' +
        '    .composableVerify(oracleSig, oracleMsg))\n' +
        '  .addInput(govUtxo, governance.contract.unlock\n' +
        '    .composableVerify(2n))\n' +
        '  .addOutput(pool.address, poolBalance - loanAmount)\n' +
        '  .addOutput(borrower.address, loanAmount)\n' +
        '  .addOutput(governance.tokenAddress, 1000n,\n' +
        '    { amount: 100n, category: TOKEN_CATEGORY })\n' +
        '  .setLocktime(Number(timestamp) + 10);\n' +
        '\n' +
        'const tx = await composer.send();\n' +
        "console.log('TX:', tx.txid);"
    },
    tokens: {
      title: 'CashTokens Integration',
      code: "import { TokenGatePrimitive } from 'cashblocks';\n" +
        '\n' +
        '// TokenGate validates CashToken ownership on-chain\n' +
        '// Contract checks: tokenCategory == required && tokenAmount >= min\n' +
        '\n' +
        '// Convert hex category to VM byte order (reversed)\n' +
        'const categoryBytes = TokenGatePrimitive.categoryToVMBytes(\n' +
        "  'aabbccdd...'  // 32-byte hex token category\n" +
        ');\n' +
        '\n' +
        'const gate = new TokenGatePrimitive({\n' +
        '  requiredCategory: categoryBytes,\n' +
        '  minTokenAmount: 100n,   // min fungible tokens\n' +
        '}, provider);\n' +
        '\n' +
        '// Token UTXO with CashTokens attached\n' +
        'const tokenUtxo = {\n' +
        '  ...randomUtxo({ satoshis: 1_000n }),\n' +
        '  token: { amount: 100n, category: categoryHex },\n' +
        '};\n' +
        '\n' +
        '// Must use tokenAddress (not address) for token operations\n' +
        'provider.addUtxo(gate.tokenAddress, tokenUtxo);\n' +
        '\n' +
        '// composableVerify preserves tokens in continuation output\n' +
        '// Output at index 2 must have same category + >= amount\n' +
        'composer.addInput(tokenUtxo, gate.contract.unlock\n' +
        '  .composableVerify(2n));  // continuation at output index 2'
    },
  };

  document.querySelectorAll('.code-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.code-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      renderCodeSnippet(tab.dataset.code);
    });
  });

  function renderCodeSnippet(key) {
    var snippet = codeSnippets[key];
    if (!snippet) return;
    var container = document.getElementById('code-content');
    if (!container) return;
    container.innerHTML =
      '<div class="code-header">' +
        '<span class="code-title">' + snippet.title + '</span>' +
        '<button type="button" class="copy-btn">Copy</button>' +
      '</div>' +
      '<pre class="code-block"><code>' + escapeHtml(snippet.code) + '</code></pre>';

    var copyBtn = container.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        var code = container.querySelector('code').textContent;
        navigator.clipboard.writeText(code).then(function() {
          copyBtn.textContent = 'Copied!';
          setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
        });
      });
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── BCH Formatter ───
  // Convert satoshis to BCH string with 8 decimal places
  function satsToBch(sats) {
    var n = Number(sats) || 0;
    var bch = (n / 100000000).toFixed(8);
    return bch + ' BCH';
  }

  // Initial render
  renderCodeSnippet('init');

  // ─── Step Rendering ───
  var stepIcons = { info: 'i', blocked: '!', success: '\u2713' };

  function renderStep(scenario, step) {
    var container = document.getElementById('steps-' + scenario);
    if (!container) return;
    var div = document.createElement('div');
    div.className = 'step ' + step.type;

    var icon = document.createElement('div');
    icon.className = 'step-icon ' + step.type;
    icon.textContent = stepIcons[step.type] || '-';

    var body = document.createElement('div');
    body.className = 'step-body';

    var title = document.createElement('div');
    title.className = 'step-title';
    title.textContent = step.title;
    body.appendChild(title);

    if (step.details) {
      var details = document.createElement('div');
      details.className = 'step-details';
      Object.keys(step.details).forEach(function(k) {
        var keyEl = document.createElement('span');
        keyEl.className = 'step-key';
        keyEl.textContent = k;
        var valEl = document.createElement('span');
        valEl.className = 'step-val';
        valEl.textContent = step.details[k];
        details.appendChild(keyEl);
        details.appendChild(valEl);
      });
      body.appendChild(details);
    }

    if (step.txid) {
      var txRow = document.createElement('div');
      txRow.className = 'step-details';
      txRow.style.marginTop = '0.3rem';
      var k2 = document.createElement('span');
      k2.className = 'step-key';
      k2.textContent = 'TX';
      var v2 = document.createElement('span');
      v2.className = 'step-val';
      v2.textContent = step.txid.slice(0, 20) + '...';
      txRow.appendChild(k2);
      txRow.appendChild(v2);
      body.appendChild(txRow);
    }

    // Explorer link for chipnet transactions
    if (step.explorerUrl) {
      var explorerRow = document.createElement('div');
      explorerRow.style.marginTop = '0.35rem';
      var explorerLink = document.createElement('a');
      explorerLink.href = step.explorerUrl;
      explorerLink.target = '_blank';
      explorerLink.rel = 'noopener';
      explorerLink.className = 'explorer-link';
      explorerLink.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> View on Explorer';
      explorerRow.appendChild(explorerLink);
      body.appendChild(explorerRow);
    }

    if (step.primitives && step.primitives.length) {
      var tags = document.createElement('div');
      tags.className = 'step-primitives';
      step.primitives.forEach(function(p) {
        var tag = document.createElement('span');
        var cls = p.toLowerCase().replace(/[- ]/g, '');
        tag.className = 'prim-tag ' + cls;
        tag.textContent = p;
        tags.appendChild(tag);
      });
      body.appendChild(tags);
    }

    div.appendChild(icon);
    div.appendChild(body);
    container.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Update step count
    if (!stepCounts[scenario]) stepCounts[scenario] = { blocked: 0, success: 0, total: 0 };
    stepCounts[scenario].total++;
    var countEl = document.getElementById('count-' + scenario);
    if (countEl) countEl.textContent = stepCounts[scenario].total + ' steps';

    // Update global metrics
    if (step.type === 'blocked') {
      totalBlocked++;
      stepCounts[scenario].blocked++;
      var blockedEl = document.getElementById('metricBlocked');
      if (blockedEl) blockedEl.textContent = totalBlocked;
    } else if (step.type === 'success') {
      totalProcessed++;
      stepCounts[scenario].success++;
      var processedEl = document.getElementById('metricProcessed');
      if (processedEl) processedEl.textContent = totalProcessed;
    }
  }

  // ─── Summary Rendering ───
  function renderSummary(scenario, result) {
    var container = document.getElementById('summary-' + scenario);
    if (!container) return;
    container.style.display = '';
    container.innerHTML = '';

    var grid = document.createElement('div');
    grid.className = 'summary-grid';

    Object.keys(result.summary).forEach(function(k) {
      var item = document.createElement('div');
      item.className = 'summary-item';
      var label = document.createElement('div');
      label.className = 'summary-label';
      label.textContent = k;
      var value = document.createElement('div');
      value.className = 'summary-value';
      value.textContent = result.summary[k];
      item.appendChild(label);
      item.appendChild(value);
      grid.appendChild(item);
    });

    container.appendChild(grid);

    if (result.executionTimeMs !== undefined) {
      var time = document.createElement('div');
      time.className = 'exec-time';
      time.textContent = 'Executed in ' + (result.executionTimeMs / 1000).toFixed(2) + 's';
      container.appendChild(time);
    }

    // Show mode badge in summary
    if (result.mode === 'chipnet') {
      var modeBadge = document.createElement('div');
      modeBadge.className = 'exec-time';
      modeBadge.style.color = 'var(--green)';
      modeBadge.textContent = 'Executed on BCH Chipnet (real transactions)';
      container.appendChild(modeBadge);
    }
  }

  // ─── Run Scenario ───
  function runScenario(name) {
    var panel = document.getElementById('panel-' + name);
    if (!panel) { console.error('Panel not found: panel-' + name); return; }
    var btn = panel.querySelector('[data-run]');
    if (!btn) { console.error('Run button not found in panel-' + name); return; }
    var timeline = document.getElementById('timeline-' + name);
    var stepsEl = document.getElementById('steps-' + name);
    var summary = document.getElementById('summary-' + name);

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Running...';
    if (stepsEl) stepsEl.innerHTML = '';
    stepCounts[name] = { blocked: 0, success: 0, total: 0 };
    if (timeline) timeline.style.display = '';
    if (summary) summary.style.display = 'none';

    var countEl = document.getElementById('count-' + name);
    if (countEl) countEl.textContent = '';

    // Route to mock or chipnet endpoint based on current mode
    var url = currentMode === 'chipnet'
      ? '/api/chipnet/scenario/' + name
      : '/api/scenario/' + name;

    // Send chipnet keys from localStorage when in chipnet mode
    var fetchBody = {};
    if (currentMode === 'chipnet') {
      var chipKeys = ChipnetKeyManager.getKeys();
      if (chipKeys) fetchBody.keys = chipKeys;
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fetchBody),
    })
    .then(function(resp) {
      if (!resp.ok) {
        throw new Error('Server returned ' + resp.status);
      }
      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function readChunk() {
        return reader.read().then(function(result) {
          if (result.done) return;
          buffer += decoder.decode(result.value, { stream: true });

          var lines = buffer.split('\n');
          buffer = lines.pop();

          var eventType = 'message';
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('event: ') === 0) {
              eventType = line.slice(7).trim();
            } else if (line.indexOf('data: ') === 0) {
              try {
                var data = JSON.parse(line.slice(6));
                if (eventType === 'done') {
                  renderSummary(name, data);
                } else if (eventType === 'error') {
                  renderStep(name, { type: 'blocked', title: 'Error: ' + data.error, details: {} });
                } else {
                  renderStep(name, data);
                }
              } catch (parseErr) {
                console.warn('SSE parse error:', parseErr.message);
              }
              eventType = 'message';
            }
          }

          return readChunk();
        });
      }

      return readChunk();
    })
    .catch(function(err) {
      console.error('Scenario error:', err);
      renderStep(name, { type: 'blocked', title: 'Error: ' + err.message, details: { Hint: 'Make sure server is running on port 3060' } });
    })
    .finally(function() {
      btn.disabled = false;
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Scenario';
    });
  }

  // ═══════════════════════════════════════════
  // ChipnetKeyManager — localStorage-backed chipnet wallet
  // Each browser gets its own independent wallet
  // ═══════════════════════════════════════════

  var CHIPNET_KEYS_STORAGE = 'cashblocks_chipnet_keys';

  var ChipnetKeyManager = {
    getKeys: function() {
      try {
        var raw = localStorage.getItem(CHIPNET_KEYS_STORAGE);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    saveKeys: function(keys) {
      localStorage.setItem(CHIPNET_KEYS_STORAGE, JSON.stringify(keys));
    },
    clearKeys: function() {
      localStorage.removeItem(CHIPNET_KEYS_STORAGE);
    },
    generateKeys: function() {
      return fetch('/api/chipnet/generate-wallet', { method: 'POST' })
        .then(function(r) {
          if (!r.ok) throw new Error('Server ' + r.status);
          return r.json();
        })
        .then(function(data) {
          if (data.error) throw new Error(data.error);
          ChipnetKeyManager.saveKeys(data);
          return data;
        });
    },
    downloadKeys: function() {
      var keys = ChipnetKeyManager.getKeys();
      if (!keys) return;
      var blob = new Blob([JSON.stringify(keys, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var addr = (keys.owner && keys.owner.address) || 'chipnet';
      a.download = 'cashblocks-chipnet-keys-' + addr.slice(-8) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    importKeys: function(file) {
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function(e) {
          try {
            var keys = JSON.parse(e.target.result);
            if (!keys.owner || !keys.owner.privKey || !keys.owner.address) {
              throw new Error('Invalid key file: missing owner data');
            }
            if (!keys.recipient || !keys.recipient.address) {
              throw new Error('Invalid key file: missing recipient data');
            }
            if (!keys.oracle || !keys.oracle.address) {
              throw new Error('Invalid key file: missing oracle data');
            }
            ChipnetKeyManager.saveKeys(keys);
            resolve(keys);
          } catch (err) { reject(err); }
        };
        reader.onerror = function() { reject(new Error('Failed to read file')); };
        reader.readAsText(file);
      });
    },
    getLabel: function() {
      var keys = ChipnetKeyManager.getKeys();
      if (!keys || !keys.owner) return 'Anonymous';
      return keys.owner.address ? keys.owner.address.slice(-8) : 'Anonymous';
    },
    getOwnerAddress: function() {
      var keys = ChipnetKeyManager.getKeys();
      return (keys && keys.owner) ? keys.owner.address : null;
    }
  };

  // ─── Wallet UI (Chipnet — localStorage) ───

  function loadWalletStatus() {
    var keys = ChipnetKeyManager.getKeys();
    if (keys) {
      showWalletKeys(keys);
      // Fetch live balances from chain for all 3 wallets
      refreshChipnetBalance();
    } else {
      showNoKeys();
    }
  }

  function showWalletKeys(keys) {
    var noKeys = document.getElementById('wallet-no-keys');
    var hasKeys = document.getElementById('wallet-has-keys');
    if (noKeys) noKeys.style.display = 'none';
    if (hasKeys) hasKeys.style.display = '';

    var ownerEl = document.getElementById('wallet-owner-addr');
    var recipientEl = document.getElementById('wallet-recipient-addr');
    var oracleEl = document.getElementById('wallet-oracle-addr');
    if (ownerEl) ownerEl.textContent = keys.owner ? keys.owner.address : '';
    if (recipientEl) recipientEl.textContent = keys.recipient ? keys.recipient.address : '';
    if (oracleEl) oracleEl.textContent = keys.oracle ? keys.oracle.address : '';

    // QR code
    renderQR(keys.owner ? keys.owner.address : '');
  }

  function showNoKeys() {
    var noKeys = document.getElementById('wallet-no-keys');
    var hasKeys = document.getElementById('wallet-has-keys');
    if (noKeys) noKeys.style.display = '';
    if (hasKeys) hasKeys.style.display = 'none';
    var ids = ['wallet-balance-owner', 'wallet-balance-recipient', 'wallet-balance-oracle'];
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.textContent = '\u2014';
    });
    var utxoEl = document.getElementById('wallet-utxo-count');
    if (utxoEl) utxoEl.textContent = '';
    var qrEl = document.getElementById('wallet-qr');
    if (qrEl) qrEl.innerHTML = '<span class="wallet-hint">Generate wallet first</span>';
  }

  function refreshChipnetBalance(address) {
    // If called with a single address (legacy), refresh all from stored keys
    var keys = ChipnetKeyManager.getKeys();
    if (!keys) return;

    var wallets = [
      { address: keys.owner ? keys.owner.address : null, elId: 'wallet-balance-owner' },
      { address: keys.recipient ? keys.recipient.address : null, elId: 'wallet-balance-recipient' },
      { address: keys.oracle ? keys.oracle.address : null, elId: 'wallet-balance-oracle' },
    ];
    var totalUtxos = 0;
    var pending = wallets.length;

    wallets.forEach(function(w) {
      if (!w.address) {
        var el = document.getElementById(w.elId);
        if (el) el.textContent = '\u2014';
        pending--;
        if (pending === 0) {
          var utxoEl = document.getElementById('wallet-utxo-count');
          if (utxoEl) utxoEl.textContent = totalUtxos + ' UTXOs total';
        }
        return;
      }
      fetch('/api/chipnet/balance-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: w.address }),
      })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.error) {
            var el = document.getElementById(w.elId);
            if (el) el.textContent = satsToBch(data.balance || 0);
            totalUtxos += (data.utxoCount || 0);
          }
        })
        .catch(function(err) { console.warn('Balance check error (' + w.elId + '):', err.message); })
        .finally(function() {
          pending--;
          if (pending === 0) {
            var utxoEl = document.getElementById('wallet-utxo-count');
            if (utxoEl) utxoEl.textContent = totalUtxos + ' UTXOs total';
          }
        });
    });
  }

  function renderQR(address) {
    var qrEl = document.getElementById('wallet-qr');
    if (!qrEl || !address) return;

    function showFallback() {
      var span = document.createElement('span');
      span.className = 'wallet-addr-value';
      span.style.fontSize = '0.65rem';
      span.textContent = address;
      qrEl.innerHTML = '';
      qrEl.appendChild(span);
    }

    if (typeof qrcode === 'undefined') {
      showFallback();
      return;
    }
    try {
      var qr = qrcode(0, 'M');
      qr.addData(address);
      qr.make();
      qrEl.innerHTML = qr.createSvgTag(4, 0);
      var svg = qrEl.querySelector('svg');
      if (svg) {
        svg.style.width = '120px';
        svg.style.height = '120px';
        svg.style.background = '#fff';
        svg.style.borderRadius = '8px';
        svg.style.padding = '8px';
      }
    } catch (e) {
      showFallback();
    }
  }

  // Generate keys button — now uses localStorage
  var btnGenerate = document.getElementById('btn-generate-keys');
  if (btnGenerate) {
    btnGenerate.addEventListener('click', function() {
      btnGenerate.disabled = true;
      btnGenerate.textContent = 'Generating...';
      ChipnetKeyManager.generateKeys()
        .then(function(keys) {
          loadWalletStatus();
          showToast('success', 'Wallet Created', 'Owner: ...' + keys.owner.address.slice(-8));
        })
        .catch(function(err) { showToast('error', 'Error', err.message); })
        .finally(function() {
          btnGenerate.disabled = false;
          btnGenerate.textContent = 'Generate Keys';
        });
    });
  }

  // Import JSON button (chipnet) — now saves to localStorage
  var btnImportChipnetJson = document.getElementById('btn-import-chipnet-json');
  var importChipnetFileInput = document.getElementById('import-chipnet-json-file');
  if (btnImportChipnetJson && importChipnetFileInput) {
    btnImportChipnetJson.addEventListener('click', function() {
      importChipnetFileInput.click();
    });
    importChipnetFileInput.addEventListener('change', function() {
      if (!importChipnetFileInput.files || !importChipnetFileInput.files[0]) return;
      ChipnetKeyManager.importKeys(importChipnetFileInput.files[0])
        .then(function(keys) {
          loadWalletStatus();
          showToast('success', 'Keys Imported', 'Owner: ...' + keys.owner.address.slice(-8));
        })
        .catch(function(err) { showToast('error', 'Import Failed', err.message); });
      importChipnetFileInput.value = '';
    });
  }

  // Delete keys button — now clears localStorage
  var btnDelete = document.getElementById('btn-delete-keys');
  if (btnDelete) {
    btnDelete.addEventListener('click', function() {
      if (!confirm('Delete chipnet wallet from this browser? Download keys first if needed.')) return;
      ChipnetKeyManager.clearKeys();
      loadWalletStatus();
      showToast('info', 'Wallet Deleted', 'Keys removed from this browser');
    });
  }

  // Download chipnet keys button — now from localStorage
  var btnDownloadChipnet = document.getElementById('btn-download-chipnet-keys');
  if (btnDownloadChipnet) {
    btnDownloadChipnet.addEventListener('click', function() {
      ChipnetKeyManager.downloadKeys();
      showToast('info', 'Keys Downloaded', 'Store this file safely — it contains private keys');
    });
  }

  // Refresh balance button — refreshes all 3 wallets from localStorage
  var btnRefresh = document.getElementById('btn-refresh-balance');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', function() {
      var keys = ChipnetKeyManager.getKeys();
      if (!keys) {
        showToast('info', 'No Wallet', 'Generate a wallet first');
        return;
      }
      btnRefresh.disabled = true;
      btnRefresh.textContent = 'Refreshing...';
      refreshChipnetBalance();
      setTimeout(function() {
        btnRefresh.disabled = false;
        btnRefresh.textContent = 'Refresh All';
      }, 2000);
    });
  }

  // ─── Wallet Extension Detection (Bonus) ───
  function detectWalletExtension() {
    if (typeof window.paytaca !== 'undefined' || typeof window.bitcoincash !== 'undefined') {
      var fundCard = document.getElementById('wallet-fund-card');
      if (fundCard) {
        var walletBtn = document.createElement('button');
        walletBtn.type = 'button';
        walletBtn.className = 'btn-primary btn-sm';
        walletBtn.style.marginTop = '0.5rem';
        walletBtn.textContent = 'Fund via Wallet';
        walletBtn.addEventListener('click', function() {
          var ownerAddr = document.getElementById('wallet-owner-addr');
          if (!ownerAddr || !ownerAddr.textContent) {
            alert('Generate keys first');
            return;
          }
          try {
            if (window.paytaca && window.paytaca.send) {
              window.paytaca.send({ to: ownerAddr.textContent, amount: 0.001 });
            } else if (window.bitcoincash && window.bitcoincash.send) {
              window.bitcoincash.send({ to: ownerAddr.textContent, amount: 0.001 });
            }
          } catch (e) {
            alert('Wallet send failed: ' + e.message);
          }
        });
        fundCard.appendChild(walletBtn);
      }
    }
  }

  // Detect wallet on load
  setTimeout(detectWalletExtension, 1000);

  // Also expose globally for debugging
  window.runScenario = runScenario;

  // ═══════════════════════════════════════════
  // KeyManager — localStorage-backed identity
  // ═══════════════════════════════════════════

  var KEYS_STORAGE_KEY = 'cashblocks_user_keys';
  var SESSION_STORAGE_KEY = 'cashblocks_lending_session';

  var KeyManager = {
    getKeys: function() {
      try {
        var raw = localStorage.getItem(KEYS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    saveKeys: function(keys) {
      localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
    },
    clearKeys: function() {
      localStorage.removeItem(KEYS_STORAGE_KEY);
    },
    generateKeys: function() {
      return fetch('/api/keys/generate', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error) throw new Error(data.error);
          KeyManager.saveKeys(data);
          return data;
        });
    },
    downloadKeys: function() {
      var keys = KeyManager.getKeys();
      if (!keys) return;
      var blob = new Blob([JSON.stringify(keys, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'cashblocks-identity-' + keys.address.slice(-8) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    importKeys: function(file) {
      return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function(e) {
          try {
            var keys = JSON.parse(e.target.result);
            if (!keys.address || !keys.privKey || !keys.pubKey) {
              throw new Error('Invalid key file: missing address, privKey, or pubKey');
            }
            KeyManager.saveKeys(keys);
            resolve(keys);
          } catch (err) { reject(err); }
        };
        reader.onerror = function() { reject(new Error('Failed to read file')); };
        reader.readAsText(file);
      });
    },
    getLabel: function() {
      var keys = KeyManager.getKeys();
      if (!keys) return 'Anonymous';
      return keys.address ? keys.address.slice(-8) : 'Anonymous';
    }
  };

  // ─── Identity Panel ───

  function renderIdentityPanel() {
    var keys = KeyManager.getKeys();
    if (keys) {
      showIdentity(keys);
    } else {
      showNoIdentity();
    }
  }

  function showIdentity(keys) {
    var noKeys = document.getElementById('identity-no-keys');
    var hasKeys = document.getElementById('identity-has-keys');
    if (noKeys) noKeys.style.display = 'none';
    if (hasKeys) hasKeys.style.display = '';
    var addrEl = document.getElementById('identity-address');
    if (addrEl) addrEl.textContent = keys.address || '';
    var pubEl = document.getElementById('identity-pubkey');
    if (pubEl) pubEl.textContent = keys.pubKey ? (keys.pubKey.slice(0, 16) + '...' + keys.pubKey.slice(-8)) : '';
  }

  function showNoIdentity() {
    var noKeys = document.getElementById('identity-no-keys');
    var hasKeys = document.getElementById('identity-has-keys');
    if (noKeys) noKeys.style.display = '';
    if (hasKeys) hasKeys.style.display = 'none';
  }

  // Wire identity buttons
  var btnGenIdentity = document.getElementById('btn-generate-identity');
  if (btnGenIdentity) {
    btnGenIdentity.addEventListener('click', function() {
      btnGenIdentity.disabled = true;
      btnGenIdentity.textContent = 'Generating...';
      KeyManager.generateKeys()
        .then(function(keys) {
          renderIdentityPanel();
          showToast('success', 'Identity Created', 'Address: ...' + keys.address.slice(-8));
        })
        .catch(function(err) { showToast('error', 'Error', err.message); })
        .finally(function() {
          btnGenIdentity.disabled = false;
          btnGenIdentity.textContent = 'Generate Identity';
        });
    });
  }

  var btnDownloadIdentity = document.getElementById('btn-download-identity');
  if (btnDownloadIdentity) {
    btnDownloadIdentity.addEventListener('click', function() {
      KeyManager.downloadKeys();
      showToast('info', 'Downloaded', 'Key file saved');
    });
  }

  var btnImportIdentity = document.getElementById('btn-import-identity');
  var importFileInput = document.getElementById('import-identity-file');
  if (btnImportIdentity && importFileInput) {
    btnImportIdentity.addEventListener('click', function() {
      importFileInput.click();
    });
    importFileInput.addEventListener('change', function() {
      if (!importFileInput.files || !importFileInput.files[0]) return;
      KeyManager.importKeys(importFileInput.files[0])
        .then(function(keys) {
          renderIdentityPanel();
          showToast('success', 'Keys Imported', 'Address: ...' + keys.address.slice(-8));
        })
        .catch(function(err) { showToast('error', 'Import Failed', err.message); });
      importFileInput.value = '';
    });
  }

  var btnClearIdentity = document.getElementById('btn-clear-identity');
  if (btnClearIdentity) {
    btnClearIdentity.addEventListener('click', function() {
      if (!confirm('Clear your local identity? You can re-import later from a downloaded file.')) return;
      KeyManager.clearKeys();
      renderIdentityPanel();
      showToast('info', 'Identity Cleared', 'localStorage keys removed');
    });
  }

  // ─── Pool Browser (in Lending Dashboard tab) ───

  function loadAvailablePools() {
    fetch('/api/lending/pools')
      .then(function(r) {
        if (!r.ok) throw new Error('Server ' + r.status);
        return r.json();
      })
      .then(function(data) {
        renderPoolList(data.pools || []);
      })
      .catch(function(err) { console.warn('Pool list error:', err.message); });
  }

  function renderPoolList(pools) {
    var list = document.getElementById('pool-browser-list-dash');
    var empty = document.getElementById('pool-browser-empty-dash');
    if (!list) return;
    list.innerHTML = '';

    // Filter out current user's own pool
    var mySessionId = lendingSession ? lendingSession.sessionId : null;
    var otherPools = pools.filter(function(p) { return p.sessionId !== mySessionId; });

    if (otherPools.length === 0) {
      if (empty) {
        list.appendChild(empty);
        empty.style.display = '';
      }
      return;
    }

    otherPools.forEach(function(pool) {
      var item = document.createElement('div');
      item.className = 'pool-browser-item';

      var info = document.createElement('div');
      info.className = 'pool-browser-info';

      var owner = document.createElement('div');
      owner.className = 'pool-browser-owner';
      owner.textContent = pool.ownerLabel + "'s Pool";
      info.appendChild(owner);

      var modeBadge = pool.mode === 'chipnet' ? ' (chipnet)' : ' (mock)';
      var stats = document.createElement('div');
      stats.className = 'pool-browser-stats';
      stats.innerHTML =
        '<span>' + satsToBch(pool.remainingBalance) + ' avail</span>' +
        '<span class="pool-browser-util">' + pool.utilization.toFixed(1) + '% used</span>' +
        '<span>' + pool.txCount + ' loans</span>' +
        '<span>' + modeBadge + '</span>';
      info.appendChild(stats);

      var joinBtn = document.createElement('button');
      joinBtn.type = 'button';
      joinBtn.className = 'pool-browser-join';
      joinBtn.textContent = 'Borrow from Pool';
      joinBtn.addEventListener('click', function() { joinPool(pool.sessionId, pool.mode); });

      item.appendChild(info);
      item.appendChild(joinBtn);
      list.appendChild(item);
    });
  }

  function joinPool(sessionId, poolMode) {
    lendingSession = { sessionId: sessionId, mode: poolMode || currentMode };
    saveSession();

    fetch('/api/lending/dashboard/' + sessionId)
      .then(function(r) { return r.json(); })
      .then(function(dash) {
        if (dash.error) {
          showToast('error', 'Error', dash.error);
          return;
        }
        showActiveDashboard(dash);
        enableLendingTabs();
        updateBorrowForm(dash);
        showToast('success', 'Joined Pool', 'Borrowing from ' + (dash.ownerLabel || 'pool'));

        // Switch to borrow tab
        setTimeout(function() {
          var borrowTab = document.getElementById('ltab-borrow');
          if (borrowTab) borrowTab.click();
        }, 100);
      })
      .catch(function(err) { showToast('error', 'Error', err.message); });
  }

  var btnRefreshPoolsDash = document.getElementById('btn-refresh-pools-dash');
  if (btnRefreshPoolsDash) {
    btnRefreshPoolsDash.addEventListener('click', function() {
      btnRefreshPoolsDash.disabled = true;
      btnRefreshPoolsDash.textContent = 'Loading...';
      loadAvailablePools();
      setTimeout(function() {
        btnRefreshPoolsDash.disabled = false;
        btnRefreshPoolsDash.textContent = 'Refresh';
      }, 500);
    });
  }

  // ─── Session Persistence ───

  function saveSession() {
    if (lendingSession) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(lendingSession));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }

  function clearSavedSession() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  function tryRestoreSession() {
    try {
      var raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || !saved.sessionId) return;

      // Try to load the dashboard — if the session still exists on server
      fetch('/api/lending/dashboard/' + saved.sessionId)
        .then(function(r) { return r.json(); })
        .then(function(dash) {
          if (dash.error) {
            clearSavedSession();
            return;
          }
          lendingSession = saved;
          loanAttempts = [];
          prevDashValues = {};
          showActiveDashboard(dash);
          enableLendingTabs();
          updateBorrowForm(dash);
        })
        .catch(function() { clearSavedSession(); });
    } catch (e) { clearSavedSession(); }
  }

  // ═══════════════════════════════════════════
  // Interactive Lending Pool
  // ═══════════════════════════════════════════

  var lendingSession = null; // { sessionId, mode }
  var loanAttempts = [];

  // ─── Tab Navigation ───
  document.querySelectorAll('.lending-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (tab.classList.contains('disabled')) return;
      document.querySelectorAll('.lending-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.lending-tab-content').forEach(function(c) { c.classList.remove('active'); });
      tab.classList.add('active');
      var target = tab.dataset.ltab;
      var content = document.getElementById('ltab-content-' + target);
      if (content) content.classList.add('active');

      if (target === 'history' && lendingSession) loadHistory();
    });
  });

  // ─── Update defaults when mode switches ───
  var origUpdateModeUI = updateModeUI;
  updateModeUI = function() {
    origUpdateModeUI();
    updateInitDefaults();
    loadAvailablePools();
    if (lendingSession && lendingSession.mode !== currentMode) {
      if (confirm('Switching modes will destroy the active lending pool. Continue?')) {
        destroyPoolQuiet();
      }
    }
  };

  function updateInitDefaults() {
    var poolInput = document.getElementById('init-pool-balance');
    var maxLoanInput = document.getElementById('init-max-loan');
    if (!lendingSession) {
      if (currentMode === 'chipnet') {
        if (poolInput) poolInput.value = '50000';
        if (maxLoanInput) maxLoanInput.value = '10000';
      } else {
        if (poolInput) poolInput.value = '5000000';
        if (maxLoanInput) maxLoanInput.value = '500000';
      }
    }
  }

  // ─── Initialize Pool ───
  var btnInitPool = document.getElementById('btn-init-pool');
  if (btnInitPool) {
    btnInitPool.addEventListener('click', initLendingPool);
  }

  function initLendingPool() {
    if (!serverOnline) {
      showInitError('Server is offline. Start the server with: node server.mjs');
      showToast('error', 'Server Offline', 'Cannot reach server on port 3060');
      return;
    }

    var poolBalance = document.getElementById('init-pool-balance').value;
    var maxLoan = document.getElementById('init-max-loan').value;
    var minScore = document.getElementById('init-min-score').value;
    var errEl = document.getElementById('init-error');

    btnInitPool.disabled = true;
    btnInitPool.innerHTML = '<span class="spinner"></span> Initializing...';
    if (errEl) errEl.style.display = 'none';
    showLoadingOverlay();

    // Build init payload — include chipnet keys from localStorage if in chipnet mode
    var initPayload = {
      mode: currentMode,
      poolBalance: poolBalance,
      maxLoan: maxLoan,
      minCreditScore: minScore,
      ownerLabel: currentMode === 'chipnet' ? ChipnetKeyManager.getLabel() : KeyManager.getLabel(),
    };
    if (currentMode === 'chipnet') {
      var chipKeys = ChipnetKeyManager.getKeys();
      if (!chipKeys) {
        showInitError('No chipnet wallet found. Generate a wallet first.');
        hideLoadingOverlay();
        btnInitPool.disabled = false;
        btnInitPool.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Initialize Pool';
        return;
      }
      initPayload.keys = chipKeys;
    }

    fetch('/api/lending/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initPayload),
    })
    .then(function(r) {
      if (!r.ok) throw new Error('Server returned ' + r.status + ' ' + r.statusText);
      return r.json();
    })
    .then(function(data) {
      if (data.error) {
        showInitError(data.error);
        return;
      }
      lendingSession = { sessionId: data.sessionId, mode: currentMode };
      saveSession();
      loanAttempts = [];
      prevDashValues = {};
      showActiveDashboard(data.dashboard);
      enableLendingTabs();
      updateBorrowForm(data.dashboard);
      showToast('success', 'Pool Initialized', satsToBch(poolBalance) + ' deployed');
      loadAvailablePools();
    })
    .catch(function(err) {
      var msg = err.message || 'Unknown error';
      if (msg.indexOf('NetworkError') !== -1 || msg.indexOf('Failed to fetch') !== -1) {
        msg = 'Cannot connect to server. Make sure the server is running on port 3060 (node server.mjs)';
      }
      showInitError(msg);
    })
    .finally(function() {
      hideLoadingOverlay();
      btnInitPool.disabled = false;
      btnInitPool.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Initialize Pool';
    });
  }

  function showInitError(msg) {
    var errEl = document.getElementById('init-error');
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = '';
    }
  }

  function showActiveDashboard(dash) {
    var initCard = document.getElementById('lending-init-card');
    var dashboard = document.getElementById('lending-dashboard');
    if (initCard) initCard.style.display = 'none';
    if (dashboard) dashboard.style.display = '';
    updateDashboardCards(dash);
  }

  function updateDashboardCards(dash) {
    var el;
    // Animated counters for stat values (BCH format for balances)
    var bchFmt = function(v) { return (v / 100000000).toFixed(8); };
    el = document.getElementById('dash-pool-balance');
    if (el) animateValue(el, prevDashValues.poolBalance || 0, Number(dash.poolBalance), 600, bchFmt);

    el = document.getElementById('dash-remaining');
    if (el) animateValue(el, prevDashValues.remaining || 0, Number(dash.remainingBalance), 600, bchFmt);

    el = document.getElementById('dash-tx-count');
    if (el) animateValue(el, prevDashValues.txCount || 0, Number(dash.txCount), 600);

    // Ring chart
    updateRingChart(dash.utilization);

    // Ring stats
    var lent = Number(dash.poolBalance) - Number(dash.remainingBalance);
    var ringLent = document.getElementById('ring-lent');
    var ringAvail = document.getElementById('ring-available');
    if (ringLent) ringLent.textContent = satsToBch(lent);
    if (ringAvail) ringAvail.textContent = satsToBch(dash.remainingBalance);

    el = document.getElementById('dash-max-loan');
    if (el) el.textContent = satsToBch(dash.maxLoan);
    el = document.getElementById('dash-min-score');
    if (el) el.textContent = dash.minCreditScore;
    el = document.getElementById('dash-mode');
    if (el) el.textContent = dash.mode === 'chipnet' ? 'Chipnet' : 'Mock';

    // Store previous values for next animation
    prevDashValues = {
      poolBalance: Number(dash.poolBalance),
      remaining: Number(dash.remainingBalance),
      txCount: Number(dash.txCount),
    };

    // Recent activity
    if (dash.recentTxs && dash.recentTxs.length > 0) {
      renderRecentActivity(dash.recentTxs);
    }
  }

  // ─── Recent Activity ───
  function renderRecentActivity(txs) {
    var container = document.getElementById('recent-activity');
    var list = document.getElementById('recent-list');
    if (!container || !list) return;
    container.style.display = '';
    list.innerHTML = '';
    txs.slice(0, 5).forEach(function(tx) {
      var item = document.createElement('div');
      item.className = 'recent-item';
      var dotClass = tx.status === 'success' ? 'dot-success' : 'dot-rejected';
      var timeStr = tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : '';
      item.innerHTML =
        '<span class="recent-status-dot ' + dotClass + '"></span>' +
        '<span class="recent-amount">' + satsToBch(tx.amount) + '</span>' +
        '<span class="recent-time">' + timeStr + '</span>';
      list.appendChild(item);
    });
  }

  function enableLendingTabs() {
    var borrowTab = document.getElementById('ltab-borrow');
    var historyTab = document.getElementById('ltab-history');
    if (borrowTab) borrowTab.classList.remove('disabled');
    if (historyTab) historyTab.classList.remove('disabled');

    // Show borrow swap card, hide no-session messages
    var borrowNoSession = document.getElementById('borrow-no-session');
    var borrowCard = document.getElementById('borrow-swap-card');
    if (borrowNoSession) borrowNoSession.style.display = 'none';
    if (borrowCard) borrowCard.style.display = '';

    var historyNoSession = document.getElementById('history-no-session');
    var historyPanel = document.getElementById('history-panel');
    if (historyNoSession) historyNoSession.style.display = 'none';
    if (historyPanel) historyPanel.style.display = '';

    // Auto-fill recipient address from identity/wallet if available
    var recipientInput = document.getElementById('loan-recipient');
    if (recipientInput && !recipientInput.value) {
      if (currentMode === 'chipnet') {
        var chipKeys = ChipnetKeyManager.getKeys();
        if (chipKeys && chipKeys.recipient) {
          recipientInput.value = chipKeys.recipient.address;
        }
      } else {
        var mockKeys = KeyManager.getKeys();
        if (mockKeys && mockKeys.address) {
          recipientInput.value = mockKeys.address;
        }
      }
    }
  }

  function disableLendingTabs() {
    var borrowTab = document.getElementById('ltab-borrow');
    var historyTab = document.getElementById('ltab-history');
    if (borrowTab) borrowTab.classList.add('disabled');
    if (historyTab) historyTab.classList.add('disabled');

    var borrowNoSession = document.getElementById('borrow-no-session');
    var borrowCard = document.getElementById('borrow-swap-card');
    if (borrowNoSession) borrowNoSession.style.display = '';
    if (borrowCard) borrowCard.style.display = 'none';

    var historyNoSession = document.getElementById('history-no-session');
    var historyPanel = document.getElementById('history-panel');
    if (historyNoSession) historyNoSession.style.display = '';
    if (historyPanel) historyPanel.style.display = 'none';
  }

  function updateBorrowForm(dash) {
    cachedDash = dash;
    var effectiveMax = Math.min(Number(dash.maxLoan), Number(dash.remainingBalance));
    var maxHint = document.getElementById('loan-max-hint');
    if (maxHint) maxHint.textContent = 'Max: ' + satsToBch(effectiveMax);
    var minLabel = document.getElementById('score-min-label');
    if (minLabel) minLabel.textContent = 'Min: ' + dash.minCreditScore;
    var marker = document.getElementById('score-threshold-marker');
    if (marker) marker.style.left = dash.minCreditScore + '%';
    validateLoanInput();
  }

  // ─── Credit Score Slider ───
  var scoreSlider = document.getElementById('credit-score');
  var scoreDisplay = document.getElementById('score-display');
  var scoreTooltip = document.getElementById('score-tooltip');

  function updateScoreTooltip() {
    if (!scoreSlider || !scoreTooltip) return;
    var val = Number(scoreSlider.value);
    var pct = (val - scoreSlider.min) / (scoreSlider.max - scoreSlider.min);
    // Account for thumb width offset
    var offset = pct * (scoreSlider.offsetWidth - 26) + 13;
    scoreTooltip.style.left = offset + 'px';
    scoreTooltip.querySelector('span').textContent = val;
    scoreTooltip.className = 'score-tooltip';
    if (val < 30) scoreTooltip.classList.add('score-low');
    else if (val < 60) scoreTooltip.classList.add('score-med');
    else scoreTooltip.classList.add('score-high');
  }

  if (scoreSlider) {
    scoreSlider.addEventListener('input', function() {
      if (scoreDisplay) scoreDisplay.textContent = scoreSlider.value;
      updateScoreColor(scoreSlider.value);
      updateScoreTooltip();
      validateLoanInput();
    });
  }

  function updateScoreColor(val) {
    if (!scoreDisplay) return;
    var v = Number(val);
    if (v < 30) scoreDisplay.style.color = 'var(--red)';
    else if (v < 60) scoreDisplay.style.color = 'var(--amber)';
    else scoreDisplay.style.color = 'var(--green)';
  }
  updateScoreColor(50);

  // Initialize tooltip position after DOM is ready
  setTimeout(updateScoreTooltip, 100);

  // ─── MAX & Percentage Buttons ───
  var cachedDash = null; // stores latest dashboard data for MAX calc

  var btnMaxLoan = document.getElementById('btn-max-loan');
  if (btnMaxLoan) {
    btnMaxLoan.addEventListener('click', function() {
      var loanInput = document.getElementById('loan-amount');
      if (!loanInput || !cachedDash) return;
      var maxVal = Math.min(Number(cachedDash.maxLoan), Number(cachedDash.remainingBalance));
      loanInput.value = maxVal;
      validateLoanInput();
      clearPctActive();
    });
  }

  document.querySelectorAll('.pct-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var loanInput = document.getElementById('loan-amount');
      if (!loanInput || !cachedDash) return;
      var maxVal = Math.min(Number(cachedDash.maxLoan), Number(cachedDash.remainingBalance));
      var pct = Number(btn.dataset.pct);
      var amount = Math.floor(maxVal * pct / 100);
      if (amount < 546) amount = 546;
      loanInput.value = amount;
      validateLoanInput();
      clearPctActive();
      btn.classList.add('active');
    });
  });

  function clearPctActive() {
    document.querySelectorAll('.pct-btn').forEach(function(b) { b.classList.remove('active'); });
  }

  // ─── Input Validation ───
  function validateLoanInput() {
    var loanInput = document.getElementById('loan-amount');
    var errorMsg = document.getElementById('loan-error-msg');
    if (!loanInput) return true;
    var val = Number(loanInput.value);
    var maxVal = cachedDash ? Math.min(Number(cachedDash.maxLoan), Number(cachedDash.remainingBalance)) : Infinity;

    loanInput.classList.remove('input-error', 'input-valid');
    if (errorMsg) errorMsg.textContent = '';

    if (val < 546) {
      loanInput.classList.add('input-error');
      if (errorMsg) errorMsg.textContent = 'Minimum amount is 546 sats (' + satsToBch(546) + ', dust limit)';
      return false;
    }
    if (cachedDash && val > maxVal) {
      loanInput.classList.add('input-error');
      if (errorMsg) errorMsg.textContent = 'Exceeds maximum (' + satsToBch(maxVal) + ')';
      return false;
    }
    loanInput.classList.add('input-valid');
    return true;
  }

  var loanInput = document.getElementById('loan-amount');
  if (loanInput) {
    loanInput.addEventListener('input', function() {
      validateLoanInput();
      clearPctActive();
    });
  }

  // ─── Recipient Address ───
  var btnUseMyAddress = document.getElementById('btn-use-my-address');
  if (btnUseMyAddress) {
    btnUseMyAddress.addEventListener('click', function() {
      var recipientInput = document.getElementById('loan-recipient');
      if (!recipientInput) return;
      var myAddr = null;
      if (currentMode === 'chipnet') {
        var cKeys = ChipnetKeyManager.getKeys();
        if (cKeys && cKeys.recipient) myAddr = cKeys.recipient.address;
      } else {
        var mKeys = KeyManager.getKeys();
        if (mKeys && mKeys.address) myAddr = mKeys.address;
      }
      if (myAddr) {
        recipientInput.value = myAddr;
        recipientInput.classList.remove('input-error');
        recipientInput.classList.add('input-valid');
        var errEl = document.getElementById('recipient-error-msg');
        if (errEl) errEl.textContent = '';
      } else {
        showToast('info', 'No Wallet', 'Generate a wallet first to use your address');
      }
    });
  }

  function validateRecipient() {
    var recipientInput = document.getElementById('loan-recipient');
    var errEl = document.getElementById('recipient-error-msg');
    if (!recipientInput) return false;
    var val = recipientInput.value.trim();
    recipientInput.classList.remove('input-error', 'input-valid');
    if (errEl) errEl.textContent = '';

    if (!val) {
      // Empty is ok — server uses pool default
      return true;
    }
    if (!val.startsWith('bchtest:') && !val.startsWith('bitcoincash:')) {
      recipientInput.classList.add('input-error');
      if (errEl) errEl.textContent = 'Address must start with bchtest: or bitcoincash:';
      return false;
    }
    recipientInput.classList.add('input-valid');
    return true;
  }

  var recipientInput = document.getElementById('loan-recipient');
  if (recipientInput) {
    recipientInput.addEventListener('input', validateRecipient);
  }

  // ─── Request Loan ───
  var btnRequestLoan = document.getElementById('btn-request-loan');
  if (btnRequestLoan) {
    btnRequestLoan.addEventListener('click', requestLoanAction);
  }

  function requestLoanAction() {
    if (!lendingSession) return;
    if (!serverOnline) {
      showLoanResult(false, 'Server is offline. Make sure the server is running.');
      return;
    }
    if (!validateRecipient()) return;

    var amount = document.getElementById('loan-amount').value;
    var score = document.getElementById('credit-score').value;
    var recipientAddr = document.getElementById('loan-recipient').value.trim();
    var resultEl = document.getElementById('loan-result');

    btnRequestLoan.disabled = true;
    btnRequestLoan.innerHTML = '<span class="spinner"></span> Processing...';
    if (resultEl) resultEl.style.display = 'none';

    var payload = {
      sessionId: lendingSession.sessionId,
      amount: amount,
      creditScore: score,
      borrowerLabel: currentMode === 'chipnet' ? ChipnetKeyManager.getLabel() : KeyManager.getLabel(),
    };
    if (recipientAddr) {
      payload.recipientAddress = recipientAddr;
    }

    fetch('/api/lending/loan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    .then(function(r) {
      if (!r.ok) throw new Error('Server returned ' + r.status + ' ' + r.statusText);
      return r.json();
    })
    .then(function(data) {
      if (data.error && !data.success) {
        showLoanResult(false, data.error);
        addLoanAttempt(amount, score, 'rejected', data.error);
      } else if (data.success) {
        var msg = 'Loan approved! TxID: ' + data.txid;
        showLoanResult(true, msg, data.explorerUrl);
        addLoanAttempt(amount, score, 'success', data.txid, data.explorerUrl);
      } else {
        showLoanResult(false, data.error || 'Unknown error');
        addLoanAttempt(amount, score, 'rejected', data.error);
      }
      if (data.poolState) {
        updateDashboardCards(data.poolState);
        updateBorrowForm(data.poolState);
      }
    })
    .catch(function(err) {
      showLoanResult(false, err.message);
      addLoanAttempt(amount, score, 'failed', err.message);
    })
    .finally(function() {
      btnRequestLoan.disabled = false;
      btnRequestLoan.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Request Loan';
    });
  }

  function showLoanResult(success, msg, explorerUrl) {
    var resultEl = document.getElementById('loan-result');
    if (!resultEl) return;
    resultEl.style.display = '';
    resultEl.className = 'loan-result ' + (success ? 'loan-success' : 'loan-rejected');
    var html = '';
    if (success) {
      // Animated checkmark SVG
      html += '<svg class="checkmark-svg" viewBox="0 0 52 52">' +
        '<circle class="checkmark-circle" cx="26" cy="26" r="25"/>' +
        '<path class="checkmark-check" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>' +
        '</svg>';
      html += '<div class="loan-result-msg">' + escapeHtml(msg) + '</div>';
      showToast('success', 'Loan Approved', 'Transaction broadcasted successfully');
    } else {
      html += '<div class="loan-result-icon">\u2717</div>';
      html += '<div class="loan-result-msg">' + escapeHtml(msg) + '</div>';
      showToast('error', 'Loan Rejected', msg.length > 60 ? msg.slice(0, 60) + '...' : msg);
    }
    if (explorerUrl) {
      html += '<a href="' + explorerUrl + '" target="_blank" rel="noopener" class="explorer-link">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> View on Explorer</a>';
    }
    resultEl.innerHTML = html;
  }

  function addLoanAttempt(amount, score, status, detail, explorerUrl) {
    loanAttempts.unshift({ amount: amount, score: score, status: status, detail: detail, explorerUrl: explorerUrl });
    renderLoanAttempts();
  }

  function renderLoanAttempts() {
    var list = document.getElementById('loan-attempts-list');
    if (!list) return;
    list.innerHTML = '';
    var toShow = loanAttempts.slice(0, 10);
    toShow.forEach(function(a) {
      var div = document.createElement('div');
      div.className = 'loan-attempt ' + (a.status === 'success' ? 'attempt-success' : 'attempt-rejected');
      var statusIcon = a.status === 'success' ? '\u2713' : '\u2717';
      var detailText = a.detail;
      if (a.status === 'success' && a.detail) {
        detailText = a.detail.slice(0, 16) + '...';
      }
      div.innerHTML =
        '<span class="attempt-status">' + statusIcon + '</span>' +
        '<span class="attempt-amount">' + satsToBch(a.amount) + '</span>' +
        '<span class="attempt-score">Score: ' + a.score + '</span>' +
        '<span class="attempt-detail">' + escapeHtml(detailText || '') + '</span>';
      list.appendChild(div);
    });
  }

  // ─── Load History ───
  function loadHistory() {
    if (!lendingSession) return;
    fetch('/api/lending/history/' + lendingSession.sessionId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        renderHistoryTable(data.transactions || []);
      })
      .catch(function(err) { console.error('History load error:', err); });
  }

  function renderHistoryTable(txs) {
    var tbody = document.getElementById('history-tbody');
    var emptyEl = document.getElementById('history-empty');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (txs.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    txs.forEach(function(tx) {
      var tr = document.createElement('tr');
      tr.className = 'history-row';
      var statusClass = tx.status === 'success' ? 'status-success' : 'status-rejected';
      var txidCell = '';
      if (tx.txid) {
        var shortTx = tx.txid.slice(0, 12) + '...';
        if (tx.explorerUrl) {
          txidCell = '<div class="txid-cell"><a href="' + tx.explorerUrl + '" target="_blank" rel="noopener" class="explorer-link">' + shortTx + '</a>' +
            '<button type="button" class="copy-txid-btn" data-txid="' + escapeHtml(tx.txid) + '" title="Copy TxID">Copy</button></div>';
        } else {
          txidCell = '<div class="txid-cell"><span class="txid-mono">' + shortTx + '</span>' +
            '<button type="button" class="copy-txid-btn" data-txid="' + escapeHtml(tx.txid) + '" title="Copy TxID">Copy</button></div>';
        }
      } else {
        txidCell = '<span class="text-muted">\u2014</span>';
      }
      var timeStr = tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : '\u2014';
      tr.innerHTML =
        '<td>' + tx.index + '</td>' +
        '<td>' + satsToBch(tx.amount) + '</td>' +
        '<td>' + (tx.creditScore || '\u2014') + '</td>' +
        '<td><span class="history-status ' + statusClass + '">' + tx.status + '</span></td>' +
        '<td>' + txidCell + '</td>' +
        '<td>' + timeStr + '</td>';
      tbody.appendChild(tr);
    });

    // Attach copy handlers
    tbody.querySelectorAll('.copy-txid-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var txid = btn.dataset.txid;
        if (txid && navigator.clipboard) {
          navigator.clipboard.writeText(txid).then(function() {
            btn.textContent = '\u2713';
            showToast('info', 'Copied', 'TxID copied to clipboard');
            setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
          });
        }
      });
    });
  }

  // ─── Destroy Pool ───
  var btnDestroy = document.getElementById('btn-destroy-pool');
  if (btnDestroy) {
    btnDestroy.addEventListener('click', function() {
      if (!confirm('Destroy this lending pool? This cannot be undone.')) return;
      destroyPoolQuiet();
    });
  }

  function destroyPoolQuiet() {
    if (!lendingSession) return;
    fetch('/api/lending/session/' + lendingSession.sessionId, { method: 'DELETE' })
      .then(function() {})
      .catch(function() {});
    clearSavedSession();
    resetLendingUI();
    loadAvailablePools();
  }

  function resetLendingUI() {
    lendingSession = null;
    loanAttempts = [];
    cachedDash = null;
    prevDashValues = {};

    var initCard = document.getElementById('lending-init-card');
    var initForm = document.getElementById('lending-init-form');
    var dashboard = document.getElementById('lending-dashboard');
    if (initCard) initCard.style.display = '';
    if (initForm) initForm.style.display = '';
    if (dashboard) dashboard.style.display = 'none';

    disableLendingTabs();

    // Switch back to dashboard tab
    document.querySelectorAll('.lending-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.lending-tab-content').forEach(function(c) { c.classList.remove('active'); });
    var dashTab = document.querySelector('[data-ltab="dashboard"]');
    if (dashTab) dashTab.classList.add('active');
    var dashContent = document.getElementById('ltab-content-dashboard');
    if (dashContent) dashContent.classList.add('active');

    // Clear loan attempts
    var list = document.getElementById('loan-attempts-list');
    if (list) list.innerHTML = '';
    var resultEl = document.getElementById('loan-result');
    if (resultEl) resultEl.style.display = 'none';

    // Clear history
    var tbody = document.getElementById('history-tbody');
    if (tbody) tbody.innerHTML = '';
    var emptyEl = document.getElementById('history-empty');
    if (emptyEl) emptyEl.style.display = '';

    // Reset ring chart
    updateRingChart(0);

    // Clear recent activity
    var recentActivity = document.getElementById('recent-activity');
    if (recentActivity) recentActivity.style.display = 'none';
    var recentList = document.getElementById('recent-list');
    if (recentList) recentList.innerHTML = '';

    updateInitDefaults();
  }

  // ─── Startup ───
  // Show identity section in mock mode on load
  if (currentMode === 'mock') {
    var identitySection = document.getElementById('identity-section');
    if (identitySection) identitySection.style.display = '';
    renderIdentityPanel();
  }
  // Load available pools (visible in both modes via lending dashboard tab)
  loadAvailablePools();
  // Restore lending session from localStorage
  tryRestoreSession();

})();
