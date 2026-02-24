import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync, writeFileSync } from 'fs';
import { runDaoScenario } from './engines/dao-engine.js';
import { runEscrowScenario } from './engines/escrow-engine.js';
import { runInsuranceScenario } from './engines/insurance-engine.js';
import { runDaoChipnetScenario } from './engines/chipnet/dao-chipnet-engine.js';
import { runEscrowChipnetScenario } from './engines/chipnet/escrow-chipnet-engine.js';
import { runInsuranceChipnetScenario } from './engines/chipnet/insurance-chipnet-engine.js';
import { loadKeys, getProvider, resetProvider, getOwnerBalance, hexToUint8, getArtifacts } from './engines/chipnet/shared.js';
import type { StepResult } from './engines/types.js';
import {
  secp256k1,
  generatePrivateKey,
  hash160,
  encodeCashAddress,
  CashAddressType,
  encodePrivateKeyWif,
} from '@bitauth/libauth';
import { Contract } from 'cashscript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KEYS_FILE = '.keys.json';

const app = express();
const PORT = process.env.PORT || 5555;

app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

// --- Info ---

app.get('/api/info', (_req, res) => {
  res.json({
    name: 'CashBlocks Demo',
    version: '0.2.0',
    scenarios: ['dao', 'escrow', 'insurance'],
    primitives: ['Vault', 'Time-State', 'Oracle Proof'],
    modes: ['mock', 'chipnet'],
  });
});

// --- Key management ---

app.get('/api/keys', (_req, res) => {
  const keys = loadKeys();
  if (!keys) {
    return res.json({ exists: false });
  }
  res.json({
    exists: true,
    owner: { address: keys.owner.address, pubKey: keys.owner.pubKey },
    recipient: { address: keys.recipient.address, pubKey: keys.recipient.pubKey },
    oracle: { address: keys.oracle.address, pubKey: keys.oracle.pubKey },
  });
});

app.post('/api/keys/generate', (_req, res) => {
  if (existsSync(KEYS_FILE)) {
    return res.status(409).json({ error: 'Keys already exist. Delete .keys.json first to regenerate.' });
  }

  function genKeypair(label: string) {
    const privKey = generatePrivateKey();
    const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
    const pkh = hash160(pubKey);
    const address = (encodeCashAddress({
      payload: pkh,
      prefix: 'bchtest',
      type: CashAddressType.p2pkh,
    }) as { address: string }).address;
    const wif = encodePrivateKeyWif(privKey, 'testnet');
    return {
      label,
      privKey: Buffer.from(privKey).toString('hex'),
      pubKey: Buffer.from(pubKey).toString('hex'),
      pkh: Buffer.from(pkh).toString('hex'),
      address,
      wif,
    };
  }

  const owner = genKeypair('Owner');
  const recipient = genKeypair('Recipient');
  const oracle = genKeypair('Oracle');
  const keys = { owner, recipient, oracle, network: 'chipnet', generatedAt: new Date().toISOString() };

  writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  res.json({
    success: true,
    owner: { address: owner.address, pubKey: owner.pubKey },
    recipient: { address: recipient.address, pubKey: recipient.pubKey },
    oracle: { address: oracle.address, pubKey: oracle.pubKey },
  });
});

// --- Contract info ---

app.get('/api/contracts/:scenario', async (req, res) => {
  const { scenario } = req.params;
  const keys = loadKeys();
  if (!keys) {
    return res.status(400).json({ error: 'No keys found. Generate keys first.' });
  }

  try {
    const provider = getProvider();
    const { vault: vaultArtifact, timeState: timeStateArtifact, oracle: oracleArtifact } = getArtifacts();
    const ownerPub = hexToUint8(keys.owner.pubKey);
    const recipientPkh = hexToUint8(keys.recipient.pkh);
    const oraclePub = hexToUint8(keys.oracle.pubKey);

    let contracts: Record<string, { address: string; role: string }> = {};

    if (scenario === 'dao') {
      const treasury = new Contract(vaultArtifact, [ownerPub, 500_000n, recipientPkh], { provider });
      const governance = new Contract(timeStateArtifact, [ownerPub, 1_700_100_000n, 1_700_200_000n], { provider });
      const voteOracle = new Contract(oracleArtifact, [oraclePub, new Uint8Array([0x56, 0x4f, 0x54, 0x45]), 86400n], { provider });
      contracts = {
        'Treasury (Vault)': { address: treasury.address, role: 'Holds DAO funds with per-proposal spend limits' },
        'Governance (Time-State)': { address: governance.address, role: 'Enforces voting and execution time phases' },
        'Vote Oracle': { address: voteOracle.address, role: 'Verifies vote counts from off-chain tallying' },
      };
    } else if (scenario === 'escrow') {
      const escrow = new Contract(vaultArtifact, [ownerPub, 1_000_000n, recipientPkh], { provider });
      const dealTimer = new Contract(timeStateArtifact, [ownerPub, 1_700_000_000n, 1_700_100_000n], { provider });
      const priceOracle = new Contract(oracleArtifact, [oraclePub, new Uint8Array([0x50, 0x52, 0x49, 0x43]), 7200n], { provider });
      contracts = {
        'Escrow (Vault)': { address: escrow.address, role: 'Holds escrowed funds with price-gated release' },
        'Deal Timer (Time-State)': { address: dealTimer.address, role: 'Enforces deal window + timeout refund' },
        'Price Oracle': { address: priceOracle.address, role: 'Verifies BCH/USD price from feed' },
      };
    } else if (scenario === 'insurance') {
      const baseLocktime = Math.floor(Date.now() / 1000) - 6 * 3600;
      const FILING_END = BigInt(baseLocktime - 7200);
      const PAYOUT_END = BigInt(baseLocktime + 86400);
      const pool = new Contract(vaultArtifact, [ownerPub, 10_000n, recipientPkh], { provider });
      const claimTimer = new Contract(timeStateArtifact, [ownerPub, FILING_END, PAYOUT_END], { provider });
      const claimOracle = new Contract(oracleArtifact, [oraclePub, new Uint8Array([0x43, 0x4c, 0x41, 0x4d]), 43200n], { provider });
      contracts = {
        'Pool (Vault)': { address: pool.address, role: 'Insurance pool with per-claim coverage limits' },
        'Claim Timer (Time-State)': { address: claimTimer.address, role: 'Enforces filing + payout phases' },
        'Assessor Oracle': { address: claimOracle.address, role: 'Verifies claim assessments' },
      };
    } else {
      return res.status(404).json({ error: `Unknown scenario: ${scenario}` });
    }

    const contractsWithBalance: Record<string, any> = {};
    for (const [name, info] of Object.entries(contracts)) {
      try {
        const utxos = await provider.getUtxos(info.address);
        const balance = utxos.reduce((sum, u) => sum + u.satoshis, 0n);
        contractsWithBalance[name] = { ...info, balance: Number(balance), utxoCount: utxos.length };
      } catch {
        contractsWithBalance[name] = { ...info, balance: 0, utxoCount: 0 };
      }
    }

    res.json({ scenario, contracts: contractsWithBalance });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- UTXO lookup ---

app.get('/api/utxos/:address', async (req, res) => {
  try {
    const provider = getProvider();
    const utxos = await provider.getUtxos(req.params.address);
    res.json({
      address: req.params.address,
      utxos: utxos.map(u => ({ txid: u.txid, vout: u.vout, satoshis: Number(u.satoshis) })),
      balance: Number(utxos.reduce((s, u) => s + u.satoshis, 0n)),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Mock scenario routes ---

app.get('/api/scenario/dao', async (_req, res) => {
  try {
    const result = await runDaoScenario();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scenario/escrow', async (_req, res) => {
  try {
    const result = await runEscrowScenario();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scenario/insurance', async (_req, res) => {
  try {
    const result = await runInsuranceScenario();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Chipnet routes ---

app.get('/api/chipnet/status', async (_req, res) => {
  try {
    const keys = loadKeys();
    if (!keys) {
      return res.json({ available: false, keysLoaded: false, error: 'No .keys.json found. Generate keys from the Setup panel.' });
    }
    const { balance, utxoCount } = await getOwnerBalance(keys.owner.address);
    res.json({
      available: true,
      keysLoaded: true,
      network: 'chipnet',
      owner: { address: keys.owner.address, balance: Number(balance), utxoCount },
      recipient: { address: keys.recipient.address },
      oracle: { address: keys.oracle.address },
      scenarios: {
        dao: { minFunding: 57000 },
        escrow: { minFunding: 26000 },
        insurance: { minFunding: 36000 },
      },
    });
  } catch (e: any) {
    res.status(500).json({ available: false, error: e.message });
  }
});

app.get('/api/chipnet/scenario/:name', async (req, res) => {
  const { name } = req.params;

  const engines: Record<string, (onStep?: (s: StepResult) => void) => Promise<any>> = {
    dao: runDaoChipnetScenario,
    escrow: runEscrowChipnetScenario,
    insurance: runInsuranceChipnetScenario,
  };

  const engine = engines[name];
  if (!engine) return res.status(404).json({ error: `Unknown scenario: ${name}` });

  resetProvider();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    const result = await engine((step: StepResult) => {
      res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
    });
    res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
  } catch (e: any) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(`CashBlocks demo running at http://localhost:${PORT}`);
});
