/**
 * Interactive Lending Pool — Session-based backend for real DeFi interactions
 * Supports both Mock and Chipnet modes with server-side pool state.
 */
import {
  VaultPrimitive,
  TimeStatePrimitive,
  OracleProofPrimitive,
  TransactionComposer,
  encodeOracleMessage,
  intToBytes4LE,
} from 'cashblocks';

import {
  MockNetworkProvider,
  randomUtxo,
  SignatureTemplate,
} from 'cashscript';

import {
  secp256k1,
  generatePrivateKey,
  hash160,
  sha256,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';

import {
  loadKeys, hexToUint8, getProvider, EXPLORER_BASE,
  safeChipnetLocktime, safeOracleTimestamp,
  waitForFundedUtxo, fundScenario, resetProvider,
} from './chipnet-helpers.mjs';

// ─── Session Store ───
const sessions = new Map();
let sessionCounter = 0;

function generateKeypair(label) {
  const privKey = generatePrivateKey();
  const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
  const pkh = hash160(pubKey);
  const address = encodeCashAddress({
    payload: pkh,
    prefix: 'bchtest',
    type: CashAddressType.p2pkh,
  }).address;
  return { label, privKey, pubKey, pkh, address };
}

// ─── Initialize Pool ───

export async function initializePool(config = {}, mode = 'mock', browserKeys = null) {
  const {
    poolBalance = mode === 'chipnet' ? 50_000n : 5_000_000n,
    maxLoan     = mode === 'chipnet' ? 10_000n : 500_000n,
    minCreditScore = 50n,
    ownerLabel = 'Anonymous',
  } = config;

  const sessionId = `pool-${++sessionCounter}-${Date.now()}`;
  const DOMAIN = new Uint8Array([0x43, 0x52, 0x45, 0x44]); // "CRED"

  if (mode === 'mock') {
    return initMockPool(sessionId, { poolBalance, maxLoan, minCreditScore, DOMAIN, ownerLabel });
  } else {
    return initChipnetPool(sessionId, { poolBalance, maxLoan, minCreditScore, DOMAIN, ownerLabel }, browserKeys);
  }
}

async function initMockPool(sessionId, { poolBalance, maxLoan, minCreditScore, DOMAIN, ownerLabel }) {
  const owner = generateKeypair('Pool Owner');
  const recipient = generateKeypair('Borrower');
  const oracle = generateKeypair('Oracle');

  const provider = new MockNetworkProvider();

  const baseLocktime = 1_700_100_000;
  const pool = new VaultPrimitive({
    ownerPk: owner.pubKey,
    spendLimit: maxLoan,
    whitelistHash: recipient.pkh,
  }, provider);

  const schedule = new TimeStatePrimitive({
    ownerPk: owner.pubKey,
    phase1Time: BigInt(baseLocktime),
    phase2Time: BigInt(baseLocktime + 100_000),
  }, provider);

  const credit = new OracleProofPrimitive({
    oraclePk: oracle.pubKey,
    domainSeparator: DOMAIN,
    expiryDuration: 7200n,
  }, provider);

  // Fund the pool
  let currentUtxo = randomUtxo({ satoshis: poolBalance });
  provider.addUtxo(pool.address, currentUtxo);

  const session = {
    id: sessionId,
    mode: 'mock',
    ownerLabel,
    createdAt: new Date().toISOString(),
    config: { poolBalance, maxLoan, minCreditScore },
    currentBalance: poolBalance,
    txCount: 0,
    nonceCounter: 0,
    history: [],
    // Internal
    provider,
    pool,
    schedule,
    credit,
    currentUtxo,
    owner,
    recipient,
    oracle,
    DOMAIN,
    baseLocktime,
  };

  sessions.set(sessionId, session);

  return {
    sessionId,
    dashboard: buildDashboard(session),
  };
}

async function initChipnetPool(sessionId, { poolBalance, maxLoan, minCreditScore, DOMAIN, ownerLabel }, browserKeys = null) {
  const keys = browserKeys || loadKeys();
  if (!keys) throw new Error('No chipnet keys found. Generate a wallet first.');

  const ownerPriv = hexToUint8(keys.owner.privKey);
  const ownerPub = hexToUint8(keys.owner.pubKey);
  const recipientPkh = hexToUint8(keys.recipient.pkh);
  const oraclePriv = hexToUint8(keys.oracle.privKey);
  const oraclePub = hexToUint8(keys.oracle.pubKey);

  resetProvider();
  const provider = getProvider();

  const baseLocktime = safeChipnetLocktime();
  const pool = new VaultPrimitive({
    ownerPk: ownerPub,
    spendLimit: maxLoan,
    whitelistHash: recipientPkh,
  }, provider);

  const schedule = new TimeStatePrimitive({
    ownerPk: ownerPub,
    phase1Time: BigInt(baseLocktime - 7200),
    phase2Time: BigInt(baseLocktime + 86400),
  }, provider);

  const credit = new OracleProofPrimitive({
    oraclePk: oraclePub,
    domainSeparator: DOMAIN,
    expiryDuration: 86400n,
  }, provider);

  // Fund pool + helper contracts
  const fundTxid = await fundScenario([
    { address: pool.address, amount: poolBalance },
    { address: schedule.address, amount: 1000n },
    { address: credit.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  const currentUtxo = await waitForFundedUtxo(pool.address, fundTxid);

  const session = {
    id: sessionId,
    mode: 'chipnet',
    ownerLabel,
    createdAt: new Date().toISOString(),
    config: { poolBalance, maxLoan, minCreditScore },
    currentBalance: currentUtxo.satoshis,
    txCount: 0,
    nonceCounter: 0,
    history: [],
    fundTxid,
    // Internal
    provider,
    pool,
    schedule,
    credit,
    currentUtxo,
    owner: { privKey: ownerPriv, pubKey: ownerPub },
    recipient: { address: keys.recipient.address, pkh: recipientPkh },
    oracle: { privKey: oraclePriv, pubKey: oraclePub },
    ownerAddress: keys.owner.address,
    DOMAIN,
    baseLocktime,
  };

  sessions.set(sessionId, session);

  return {
    sessionId,
    fundTxid,
    explorerUrl: EXPLORER_BASE + fundTxid,
    dashboard: buildDashboard(session),
  };
}

// ─── Request Loan ───

export async function requestLoan(sessionId, { amount, creditScore, borrowerLabel, recipientAddress }) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found. Initialize a pool first.');

  amount = BigInt(amount);
  creditScore = BigInt(creditScore);
  borrowerLabel = borrowerLabel || 'Anonymous';

  // Use provided recipient address, or fall back to session default
  const loanRecipient = recipientAddress || session.recipient.address;

  // Validate
  if (amount <= 0n) {
    return { success: false, error: 'Loan amount must be positive.' };
  }
  if (amount > session.config.maxLoan) {
    return {
      success: false,
      error: `Amount ${amount} exceeds max loan limit of ${session.config.maxLoan} sats.`,
      poolState: buildDashboard(session),
    };
  }
  if (amount > session.currentBalance) {
    return {
      success: false,
      error: `Insufficient pool balance. Remaining: ${session.currentBalance} sats.`,
      poolState: buildDashboard(session),
    };
  }
  if (creditScore < session.config.minCreditScore) {
    const entry = {
      amount: amount.toString(),
      creditScore: creditScore.toString(),
      borrowerLabel,
      status: 'rejected',
      reason: `Credit score ${creditScore} below minimum ${session.config.minCreditScore}`,
      timestamp: new Date().toISOString(),
    };
    session.history.push(entry);
    return {
      success: false,
      error: entry.reason,
      poolState: buildDashboard(session),
    };
  }

  try {
    if (session.mode === 'mock') {
      return await executeMockLoan(session, amount, creditScore, borrowerLabel, loanRecipient);
    } else {
      return await executeChipnetLoan(session, amount, creditScore, borrowerLabel, loanRecipient);
    }
  } catch (err) {
    const entry = {
      amount: amount.toString(),
      creditScore: creditScore.toString(),
      borrowerLabel,
      status: 'failed',
      reason: err.message,
      timestamp: new Date().toISOString(),
    };
    session.history.push(entry);
    return {
      success: false,
      error: `Transaction failed: ${err.message}`,
      poolState: buildDashboard(session),
    };
  }
}

async function executeMockLoan(session, amount, creditScore, borrowerLabel, loanRecipient) {
  const { pool, schedule, credit, provider, owner, oracle, DOMAIN, baseLocktime } = session;

  session.nonceCounter++;
  const nonce = BigInt(session.nonceCounter);
  const timestamp = BigInt(baseLocktime + 300 + session.nonceCounter * 100);

  // Sign oracle message
  const payload = intToBytes4LE(creditScore);
  const msg = encodeOracleMessage(DOMAIN, timestamp, nonce, payload);
  const msgHash = sha256.hash(msg);
  const oSig = secp256k1.signMessageHashSchnorr(oracle.privKey, msgHash);

  // Create helper UTXOs
  const timerUtxo = randomUtxo({ satoshis: 1_000n });
  const oracleUtxo = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(schedule.address, timerUtxo);
  provider.addUtxo(credit.address, oracleUtxo);

  const lenderSig = new SignatureTemplate(owner.privKey);
  const newBalance = session.currentUtxo.satoshis - amount;

  const composer = new TransactionComposer(provider);
  composer
    .addInput(session.currentUtxo, pool.contract.unlock.composableSpend(lenderSig, amount, 0n))
    .addInput(timerUtxo, schedule.contract.unlock.composableCheck(lenderSig, 1n))
    .addInput(oracleUtxo, credit.contract.unlock.composableVerify(oSig, msg))
    .addOutput(pool.address, newBalance)
    .addOutput(loanRecipient, amount)
    .setLocktime(Number(timestamp) + 10);

  const tx = await composer.send();

  // Update session state
  session.currentBalance = newBalance;
  session.txCount++;

  // Create new continuation UTXO
  const newUtxo = randomUtxo({ satoshis: newBalance });
  provider.addUtxo(pool.address, newUtxo);
  session.currentUtxo = newUtxo;

  const entry = {
    txid: tx.txid,
    amount: amount.toString(),
    creditScore: creditScore.toString(),
    borrowerLabel,
    recipientAddress: loanRecipient,
    status: 'success',
    timestamp: new Date().toISOString(),
  };
  session.history.push(entry);

  return {
    success: true,
    txid: tx.txid,
    poolState: buildDashboard(session),
  };
}

async function executeChipnetLoan(session, amount, creditScore, borrowerLabel, loanRecipient) {
  const { pool, schedule, credit, provider, owner, oracle, DOMAIN } = session;

  session.nonceCounter++;
  const nonce = BigInt(session.nonceCounter + 10);
  const oracleTs = safeOracleTimestamp();
  const locktime = safeChipnetLocktime();

  // Sign oracle message
  const payload = intToBytes4LE(creditScore);
  const msg = encodeOracleMessage(DOMAIN, oracleTs, nonce, payload);
  const msgHash = sha256.hash(msg);
  const oSig = secp256k1.signMessageHashSchnorr(oracle.privKey, msgHash);

  // Fund fresh helper UTXOs
  await fundScenario([
    { address: credit.address, amount: 1000n },
    { address: schedule.address, amount: 1000n },
  ], owner.privKey, session.ownerAddress);

  // Wait for UTXOs to propagate
  await new Promise(r => setTimeout(r, 3000));

  const oUtxos = await provider.getUtxos(credit.address);
  const tUtxos = await provider.getUtxos(schedule.address);

  if (oUtxos.length === 0 || tUtxos.length === 0) {
    throw new Error('Helper UTXOs not available yet. Try again in a few seconds.');
  }

  const lenderSig = new SignatureTemplate(owner.privKey);
  const newBalance = session.currentUtxo.satoshis - amount;

  const composer = new TransactionComposer(provider);
  composer
    .addInput(session.currentUtxo, pool.contract.unlock.composableSpend(lenderSig, amount, 0n))
    .addInput(tUtxos[0], schedule.contract.unlock.composableCheck(lenderSig, 1n))
    .addInput(oUtxos[0], credit.contract.unlock.composableVerify(oSig, msg))
    .addOutput(pool.address, newBalance)
    .addOutput(loanRecipient, amount)
    .setLocktime(locktime);

  const tx = await composer.send();

  // Wait for continuation UTXO
  const newUtxo = await waitForFundedUtxo(pool.address, tx.txid);
  session.currentUtxo = newUtxo;
  session.currentBalance = newUtxo.satoshis;
  session.txCount++;

  const entry = {
    txid: tx.txid,
    amount: amount.toString(),
    creditScore: creditScore.toString(),
    borrowerLabel,
    recipientAddress: loanRecipient,
    status: 'success',
    explorerUrl: EXPLORER_BASE + tx.txid,
    timestamp: new Date().toISOString(),
  };
  session.history.push(entry);

  return {
    success: true,
    txid: tx.txid,
    explorerUrl: EXPLORER_BASE + tx.txid,
    poolState: buildDashboard(session),
  };
}

// ─── List Pools ───

export function listPools() {
  const pools = [];
  for (const session of sessions.values()) {
    const utilized = session.config.poolBalance - session.currentBalance;
    const utilPct = session.config.poolBalance > 0n
      ? Number(utilized * 10000n / session.config.poolBalance) / 100
      : 0;
    pools.push({
      sessionId: session.id,
      ownerLabel: session.ownerLabel || 'Anonymous',
      mode: session.mode,
      createdAt: session.createdAt,
      poolBalance: session.config.poolBalance.toString(),
      remainingBalance: session.currentBalance.toString(),
      maxLoan: session.config.maxLoan.toString(),
      utilization: utilPct,
      txCount: session.txCount,
    });
  }
  return pools;
}

// ─── Dashboard ───

function buildDashboard(session) {
  const utilized = session.config.poolBalance - session.currentBalance;
  const utilPct = session.config.poolBalance > 0n
    ? Number(utilized * 10000n / session.config.poolBalance) / 100
    : 0;

  return {
    sessionId: session.id,
    ownerLabel: session.ownerLabel || 'Anonymous',
    mode: session.mode,
    poolBalance: session.config.poolBalance.toString(),
    remainingBalance: session.currentBalance.toString(),
    maxLoan: session.config.maxLoan.toString(),
    minCreditScore: session.config.minCreditScore.toString(),
    txCount: session.txCount,
    utilization: utilPct,
    recentTxs: session.history.slice(-5).reverse(),
  };
}

export function getDashboard(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found.');
  return buildDashboard(session);
}

// ─── History ───

export function getHistory(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Session not found.');
  return {
    transactions: session.history.map((h, i) => ({ index: i + 1, ...h })),
  };
}

// ─── Destroy Session ───

export function destroySession(sessionId) {
  const existed = sessions.has(sessionId);
  sessions.delete(sessionId);
  return { destroyed: existed };
}
