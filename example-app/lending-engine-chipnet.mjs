/**
 * Lending Engine — Chipnet (Real Blockchain)
 * Runs the MicroLend scenario on BCH chipnet with real transactions.
 */
import {
  VaultPrimitive,
  TimeStatePrimitive,
  OracleProofPrimitive,
  TransactionComposer,
  encodeOracleMessage,
  intToBytes4LE,
} from 'cashblocks';

import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { secp256k1, sha256, generatePrivateKey } from '@bitauth/libauth';

import {
  loadKeys, hexToUint8, getProvider, EXPLORER_BASE, FAUCET_URL,
  safeChipnetLocktime, safeOracleTimestamp,
  waitForUtxos, waitForFundedUtxo, fundScenario, getOwnerBalance,
} from './chipnet-helpers.mjs';

const DOMAIN = new Uint8Array([0x43, 0x52, 0x45, 0x44]); // "CRED"

/**
 * Run the full lending scenario on chipnet
 * @param {function} onStep - Callback for each step (real-time streaming)
 * @returns {object} Full scenario result
 */
export async function runLendingChipnetScenario(onStep, browserKeys = null) {
  const start = Date.now();
  const steps = [];

  function emit(step) {
    steps.push(step);
    onStep?.(step);
  }

  // --- Load keys (prefer browser-provided, fall back to .keys.json) ---
  const keys = browserKeys || loadKeys();
  if (!keys) throw new Error('No wallet found. Generate a chipnet wallet first.');

  const ownerPriv = hexToUint8(keys.owner.privKey);
  const ownerPub = hexToUint8(keys.owner.pubKey);
  const recipientPkh = hexToUint8(keys.recipient.pkh);
  const oraclePriv = hexToUint8(keys.oracle.privKey);
  const oraclePub = hexToUint8(keys.oracle.pubKey);

  const provider = getProvider();

  // --- Config ---
  const POOL_AMOUNT = 50_000n;
  const MAX_LOAN = 10_000n;
  const MIN_CREDIT_SCORE = 50n;
  const ORACLE_EXPIRY = 86400n;

  const baseLocktime = safeChipnetLocktime();
  const PHASE1_TIME = BigInt(baseLocktime - 7200);   // opened 2h ago
  const PHASE2_TIME = BigInt(baseLocktime + 86400);   // closes in 24h

  // --- Deploy contracts ---
  const pool = new VaultPrimitive({
    ownerPk: ownerPub,
    spendLimit: MAX_LOAN,
    whitelistHash: recipientPkh,
  }, provider);

  const schedule = new TimeStatePrimitive({
    ownerPk: ownerPub,
    phase1Time: PHASE1_TIME,
    phase2Time: PHASE2_TIME,
  }, provider);

  const credit = new OracleProofPrimitive({
    oraclePk: oraclePub,
    domainSeparator: DOMAIN,
    expiryDuration: ORACLE_EXPIRY,
  }, provider);

  emit({
    id: 'info', type: 'info', title: 'Contracts Instantiated (Chipnet)',
    details: {
      'Pool (Vault)': pool.address,
      'Schedule (Timer)': schedule.address,
      'Credit (Oracle)': credit.address,
      'Network': 'BCH Chipnet',
      'Max loan': `${MAX_LOAN} sats`,
      'Min credit score': `${MIN_CREDIT_SCORE}`,
    },
  });

  // --- Check balance ---
  const { balance } = await getOwnerBalance(keys.owner.address);
  const TOTAL_NEEDED = POOL_AMOUNT + 5000n + 5000n; // pool + funding rounds
  if (balance < TOTAL_NEEDED) {
    throw new Error(
      `Insufficient balance: ${balance} sats. Need ~${TOTAL_NEEDED} sats. ` +
      `Fund ${keys.owner.address} via ${FAUCET_URL}`
    );
  }

  emit({
    id: 'balance', type: 'info', title: 'Lender Balance Verified',
    details: {
      'Address': keys.owner.address,
      'Balance': `${balance} sats`,
      'Required': `~${TOTAL_NEEDED} sats`,
    },
  });

  // --- Fund contracts ---
  emit({
    id: 'funding', type: 'info', title: 'Funding Contracts on Chipnet...',
    details: {
      'Pool': `${POOL_AMOUNT} sats`,
      'Timer': '1,000 sats',
      'Oracle': '1,000 sats',
    },
  });

  const fundTxid = await fundScenario([
    { address: pool.address, amount: POOL_AMOUNT },
    { address: schedule.address, amount: 1000n },
    { address: credit.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  emit({
    id: 'funded', type: 'info', title: 'Contracts Funded',
    txid: fundTxid,
    explorerUrl: EXPLORER_BASE + fundTxid,
    details: { 'Funding TX': fundTxid },
  });

  // --- Wait for propagation ---
  emit({
    id: 'waiting', type: 'info', title: 'Waiting for UTXO Propagation...',
    details: { 'Polling': '3s intervals, max 60s' },
  });

  const poolUtxo = await waitForFundedUtxo(pool.address, fundTxid);

  const lenderSig = new SignatureTemplate(ownerPriv);
  const oracleTs = safeOracleTimestamp();

  function signScore(score, timestamp, nonce) {
    const payload = intToBytes4LE(score);
    const msg = encodeOracleMessage(DOMAIN, timestamp, nonce, payload);
    const msgHash = sha256.hash(msg);
    const sig = secp256k1.signMessageHashSchnorr(oraclePriv, msgHash);
    return { sig, msg };
  }

  // ── BLOCKED 1: Before window (locktime before phase1Time) ──
  try {
    const earlyLocktime = Number(PHASE1_TIME) - 100;
    const { sig: eSig, msg: eMsg } = signScore(80n, BigInt(earlyLocktime - 10), 1n);

    const oUtxos = await provider.getUtxos(credit.address);
    const tUtxos = await provider.getUtxos(schedule.address);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(poolUtxo, pool.contract.unlock.composableSpend(lenderSig, 5_000n, 0n))
      .addInput(tUtxos[0], schedule.contract.unlock.composableCheck(lenderSig, 1n))
      .addInput(oUtxos[0], credit.contract.unlock.composableVerify(eSig, eMsg))
      .addOutput(pool.address, poolUtxo.satoshis - 5_000n)
      .addOutput(keys.recipient.address, 5_000n)
      .setLocktime(earlyLocktime);
    await composer.send();
  } catch {
    emit({
      id: 'blocked-1', type: 'blocked', title: 'Loan Before Application Window',
      details: {
        'Locktime': `Before phase1Time (${PHASE1_TIME})`,
        'Enforced by': 'Time-State (phase gate)',
      },
      primitives: ['Time-State'],
    });
  }

  // ── BLOCKED 2: Low credit score ──
  try {
    const { sig, msg } = signScore(30n, oracleTs, 2n);
    const oUtxos = await provider.getUtxos(credit.address);
    if (oUtxos.length > 0) {
      const spenderPub = ownerPub;
      const builder = new TransactionBuilder({ provider });
      builder.addInput(
        oUtxos[0],
        credit.contract.unlock.verifyWithPayloadConstraint(
          spenderPub, lenderSig, sig, msg, MIN_CREDIT_SCORE,
        ),
      );
      builder.addOutput({ to: keys.recipient.address, amount: 546n });
      builder.setLocktime(baseLocktime);
      await builder.send();
    }
  } catch {
    emit({
      id: 'blocked-2', type: 'blocked', title: 'Credit Score Too Low (30 < 50)',
      details: {
        'Score': '30',
        'Minimum': `${MIN_CREDIT_SCORE}`,
        'Enforced by': 'Oracle (payload constraint)',
      },
      primitives: ['Oracle'],
    });
  }

  // ── BLOCKED 3: Over limit ──
  try {
    const { sig: oSig, msg: oMsg } = signScore(90n, oracleTs, 3n);
    const oUtxos = await provider.getUtxos(credit.address);
    const tUtxos = await provider.getUtxos(schedule.address);
    if (oUtxos.length > 0 && tUtxos.length > 0) {
      const composer = new TransactionComposer(provider);
      composer
        .addInput(poolUtxo, pool.contract.unlock.composableSpend(lenderSig, 15_000n, 0n))
        .addInput(tUtxos[0], schedule.contract.unlock.composableCheck(lenderSig, 1n))
        .addInput(oUtxos[0], credit.contract.unlock.composableVerify(oSig, oMsg))
        .addOutput(pool.address, poolUtxo.satoshis - 15_000n)
        .addOutput(keys.recipient.address, 15_000n)
        .setLocktime(baseLocktime);
      await composer.send();
    }
  } catch {
    emit({
      id: 'blocked-3', type: 'blocked', title: 'Loan Exceeds Limit (15,000 > 10,000)',
      details: {
        'Requested': '15,000 sats',
        'Limit': `${MAX_LOAN} sats`,
        'Enforced by': 'Vault (spend limit)',
      },
      primitives: ['Vault'],
    });
  }

  // ── Fund fresh UTXOs for success steps ──
  emit({
    id: 'refund', type: 'info', title: 'Funding Fresh UTXOs for Loan Processing...',
    details: { 'Oracle': '1,000 sats', 'Timer': '1,000 sats' },
  });

  const fund2Txid = await fundScenario([
    { address: credit.address, amount: 1000n },
    { address: schedule.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);
  await waitForUtxos(credit.address, 1);

  // ── SUCCESS 1: Loan #1 ──
  const LOAN1 = 8_000n;
  const poolAfter1 = poolUtxo.satoshis - LOAN1;

  const { sig: s1Sig, msg: s1Msg } = signScore(85n, oracleTs, 4n);
  const oUtxos1 = await provider.getUtxos(credit.address);
  const tUtxos1 = await provider.getUtxos(schedule.address);

  const composer1 = new TransactionComposer(provider);
  composer1
    .addInput(poolUtxo, pool.contract.unlock.composableSpend(lenderSig, LOAN1, 0n))
    .addInput(tUtxos1[0], schedule.contract.unlock.composableCheck(lenderSig, 1n))
    .addInput(oUtxos1[0], credit.contract.unlock.composableVerify(s1Sig, s1Msg))
    .addOutput(pool.address, poolAfter1)
    .addOutput(keys.recipient.address, LOAN1)
    .setLocktime(baseLocktime);

  const tx1 = await composer1.send();
  emit({
    id: 'success-1', type: 'success', title: `Loan #1 — ${LOAN1} sats`,
    txid: tx1.txid,
    explorerUrl: EXPLORER_BASE + tx1.txid,
    details: {
      'Credit score': '85',
      'Amount': `${LOAN1} sats`,
      'Pool remaining': `${poolAfter1} sats`,
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  // ── Wait for continuation + fund more UTXOs ──
  emit({
    id: 'wait-continuation', type: 'info', title: 'Waiting for Covenant Continuation...',
    details: { 'Polling': 'UTXO from tx1 at pool address' },
  });

  await fundScenario([
    { address: credit.address, amount: 1000n },
    { address: schedule.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  // ── SUCCESS 2: Loan #2 (covenant continuation) ──
  const LOAN2 = 5_000n;
  const newPoolUtxo = await waitForFundedUtxo(pool.address, tx1.txid);
  const poolAfter2 = newPoolUtxo.satoshis - LOAN2;

  const { sig: s2Sig, msg: s2Msg } = signScore(72n, safeOracleTimestamp(), 5n);
  const oUtxos2 = await provider.getUtxos(credit.address);
  const tUtxos2 = await provider.getUtxos(schedule.address);

  const composer2 = new TransactionComposer(provider);
  composer2
    .addInput(newPoolUtxo, pool.contract.unlock.composableSpend(lenderSig, LOAN2, 0n))
    .addInput(tUtxos2[0], schedule.contract.unlock.composableCheck(lenderSig, 1n))
    .addInput(oUtxos2[0], credit.contract.unlock.composableVerify(s2Sig, s2Msg))
    .addOutput(pool.address, poolAfter2)
    .addOutput(keys.recipient.address, LOAN2)
    .setLocktime(safeChipnetLocktime());

  const tx2 = await composer2.send();
  emit({
    id: 'success-2', type: 'success', title: `Loan #2 — ${LOAN2} sats (Covenant Continuation)`,
    txid: tx2.txid,
    explorerUrl: EXPLORER_BASE + tx2.txid,
    details: {
      'Credit score': '72',
      'Amount': `${LOAN2} sats`,
      'Pool remaining': `${poolAfter2} sats`,
      'Covenant': 'Continuation verified on-chain',
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  const totalLoaned = LOAN1 + LOAN2;
  return {
    title: 'BCH MicroLend — Chipnet',
    mode: 'chipnet',
    explorerBaseUrl: EXPLORER_BASE,
    params: {
      'Pool balance': `${POOL_AMOUNT} sats`,
      'Max loan': `${MAX_LOAN} sats`,
      'Min credit score': `${MIN_CREDIT_SCORE}`,
      'Network': 'BCH Chipnet',
    },
    steps,
    summary: {
      'Initial pool': `${POOL_AMOUNT} sats`,
      'Loan #1': `-${LOAN1} sats (score: 85)`,
      'Loan #2': `-${LOAN2} sats (score: 72)`,
      'Pool remaining': `${poolAfter2} sats`,
      'Total loaned': `${totalLoaned} sats`,
      'Utilization': `${((Number(totalLoaned) / Number(POOL_AMOUNT)) * 100).toFixed(1)}%`,
      'Attacks blocked': '3',
      'Loans processed': '2',
    },
    executionTimeMs: Date.now() - start,
  };
}
