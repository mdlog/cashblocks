/**
 * CashBlocks DeFi Protocol — Web Server
 * Serves the dashboard and provides API for all DeFi scenarios
 *
 * Run: node server.mjs
 */
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  initializePool, requestLoan, getDashboard, getHistory, destroySession, listPools,
} from './lending-interactive.mjs';
import { runLendingChipnetScenario } from './lending-engine-chipnet.mjs';
import { runGovernanceChipnetScenario } from './governance-engine-chipnet.mjs';
import { runYieldVaultChipnetScenario } from './yield-vault-engine-chipnet.mjs';
import { runInsuranceChipnetScenario } from './insurance-engine-chipnet.mjs';
import {
  getOwnerBalance,
  resetProvider, FAUCET_URL,
  generateKeypair,
} from './chipnet-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3060;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const jsonBigInt = (_, v) => typeof v === 'bigint' ? v.toString() : v;

const engines = {
  lending: runLendingChipnetScenario,
  governance: runGovernanceChipnetScenario,
  'yield-vault': runYieldVaultChipnetScenario,
  insurance: runInsuranceChipnetScenario,
};

// ─── Chipnet Scenario SSE Endpoint ───

// POST /api/scenario/:name — Run chipnet scenario with SSE streaming
app.post('/api/scenario/:name', async (req, res) => {
  const engine = engines[req.params.name];
  if (!engine) {
    return res.status(404).json({ error: `Unknown chipnet scenario: ${req.params.name}` });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    resetProvider();
    // Accept keys from browser localStorage (passed in request body)
    const keys = (req.body && req.body.keys) || null;
    const result = await engine((step) => {
      res.write(`data: ${JSON.stringify(step, jsonBigInt)}\n\n`);
    }, keys);
    res.write(`event: done\ndata: ${JSON.stringify(
      JSON.parse(JSON.stringify(result, jsonBigInt))
    )}\n\n`);
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// ─── Chipnet Management Endpoints ───

// Generate wallet (returns keys, does NOT save to file — browser stores in localStorage)
app.post('/api/chipnet/generate-wallet', (req, res) => {
  try {
    const owner = generateKeypair('Owner');
    const recipient = generateKeypair('Recipient');
    const oracle = generateKeypair('Oracle');
    res.json({
      owner,
      recipient,
      oracle,
      network: 'chipnet',
      generatedAt: new Date().toISOString(),
      faucetUrl: FAUCET_URL,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Balance check for any address (no server-side keys needed)
app.post('/api/chipnet/balance-check', async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Missing "address" field.' });
    }
    const { balance, utxoCount } = await getOwnerBalance(address);
    res.json(JSON.parse(JSON.stringify({ balance, utxoCount }, jsonBigInt)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Key Generation ───

app.post('/api/keys/generate', (req, res) => {
  try {
    const kp = generateKeypair('User');
    res.json({
      privKey: kp.privKey,
      pubKey: kp.pubKey,
      pkh: kp.pkh,
      address: kp.address,
      wif: kp.wif,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Interactive Lending Endpoints ───

app.post('/api/lending/init', async (req, res) => {
  try {
    const raw = req.body || {};
    const mode = 'chipnet';
    const config = {};
    if (raw.poolBalance) config.poolBalance = BigInt(raw.poolBalance);
    if (raw.maxLoan) config.maxLoan = BigInt(raw.maxLoan);
    if (raw.minCreditScore) config.minCreditScore = BigInt(raw.minCreditScore);
    if (raw.ownerLabel) config.ownerLabel = String(raw.ownerLabel);

    // Accept keys from browser localStorage for chipnet mode
    const keys = raw.keys || null;
    const result = await initializePool(config, mode, keys);
    res.json(JSON.parse(JSON.stringify(result, jsonBigInt)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lending/loan', async (req, res) => {
  try {
    const { sessionId, amount, creditScore, borrowerLabel, recipientAddress } = req.body || {};
    if (!sessionId || !amount || creditScore === undefined) {
      return res.status(400).json({ error: 'Missing sessionId, amount, or creditScore.' });
    }
    const result = await requestLoan(sessionId, { amount, creditScore, borrowerLabel, recipientAddress });
    res.json(JSON.parse(JSON.stringify(result, jsonBigInt)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/lending/pools', (req, res) => {
  try {
    const pools = listPools();
    res.json(JSON.parse(JSON.stringify({ pools }, jsonBigInt)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/lending/dashboard/:id', (req, res) => {
  try {
    const dashboard = getDashboard(req.params.id);
    res.json(JSON.parse(JSON.stringify(dashboard, jsonBigInt)));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/api/lending/history/:id', (req, res) => {
  try {
    const history = getHistory(req.params.id);
    res.json(JSON.parse(JSON.stringify(history, jsonBigInt)));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.delete('/api/lending/session/:id', (req, res) => {
  try {
    const result = destroySession(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  CashBlocks DeFi Protocol`);
  console.log(`  http://localhost:${PORT}\n`);
});
