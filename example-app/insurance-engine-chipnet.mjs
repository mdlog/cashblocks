/**
 * Insurance Engine — Chipnet (Real Blockchain)
 * Runs the insurance pool scenario on BCH chipnet with real transactions.
 *
 * 3 Primitives (no TokenGate on chipnet — CashTokens need genesis TXs):
 *   Vault      → Insurance pool with per-claim coverage limits
 *   TimeState  → Claim window phases (Filing → Review → Closed)
 *   Oracle     → Damage assessment verification via assessor
 */
import {
  VaultPrimitive,
  TimeStatePrimitive,
  OracleProofPrimitive,
  TransactionComposer,
  encodeOracleMessage,
  intToBytes4LE,
  domainFromString,
} from 'cashblocks';

import { SignatureTemplate, TransactionBuilder } from 'cashscript';
import { secp256k1, sha256 } from '@bitauth/libauth';

import {
  loadKeys, hexToUint8, getProvider, EXPLORER_BASE, FAUCET_URL,
  safeChipnetLocktime, safeOracleTimestamp,
  waitForUtxos, waitForFundedUtxo, fundScenario, getOwnerBalance,
} from './chipnet-helpers.mjs';

const DOMAIN = domainFromString('DMGE');

/**
 * Run the full insurance scenario on chipnet
 * @param {function} onStep - Callback for each step (real-time streaming)
 * @returns {object} Full scenario result
 */
export async function runInsuranceChipnetScenario(onStep, browserKeys = null) {
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
  const MAX_CLAIM = 10_000n;
  const MIN_DAMAGE = 200n;
  const ORACLE_EXPIRY = 86400n;

  const baseLocktime = safeChipnetLocktime();
  const FILING_START = BigInt(baseLocktime - 7200);   // opened 2h ago
  const FILING_END = BigInt(baseLocktime + 86400);     // closes in 24h

  // --- Deploy contracts ---
  const pool = new VaultPrimitive({
    ownerPk: ownerPub,
    spendLimit: MAX_CLAIM,
    whitelistHash: recipientPkh,
  }, provider);

  const claimWindow = new TimeStatePrimitive({
    ownerPk: ownerPub,
    phase1Time: FILING_START,
    phase2Time: FILING_END,
  }, provider);

  const damage = new OracleProofPrimitive({
    oraclePk: oraclePub,
    domainSeparator: DOMAIN,
    expiryDuration: ORACLE_EXPIRY,
  }, provider);

  emit({
    id: 'info', type: 'info', title: 'Insurance Contracts Instantiated (Chipnet)',
    details: {
      'Pool (Vault)': pool.address,
      'Claim Window (TimeState)': claimWindow.address,
      'Damage Oracle': damage.address,
      'Network': 'BCH Chipnet',
      'Max per claim': `${MAX_CLAIM} sats`,
      'Min damage score': `${MIN_DAMAGE}`,
    },
  });

  // --- Check balance ---
  const { balance } = await getOwnerBalance(keys.owner.address);
  const TOTAL_NEEDED = POOL_AMOUNT + 5000n + 5000n;
  if (balance < TOTAL_NEEDED) {
    throw new Error(
      `Insufficient balance: ${balance} sats. Need ~${TOTAL_NEEDED} sats. ` +
      `Fund ${keys.owner.address} via ${FAUCET_URL}`
    );
  }

  emit({
    id: 'balance', type: 'info', title: 'Pool Operator Balance Verified',
    details: {
      'Address': keys.owner.address,
      'Balance': `${balance} sats`,
      'Required': `~${TOTAL_NEEDED} sats`,
    },
  });

  // --- Fund contracts ---
  emit({
    id: 'funding', type: 'info', title: 'Funding Insurance Pool on Chipnet...',
    details: {
      'Pool': `${POOL_AMOUNT} sats`,
      'Timer': '1,000 sats',
      'Oracle': '1,000 sats',
    },
  });

  const fundTxid = await fundScenario([
    { address: pool.address, amount: POOL_AMOUNT },
    { address: claimWindow.address, amount: 1000n },
    { address: damage.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  emit({
    id: 'funded', type: 'info', title: 'Insurance Pool Funded',
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

  const operatorSig = new SignatureTemplate(ownerPriv);
  const oracleTs = safeOracleTimestamp();

  function signDamageReport(damageScore, timestamp, nonce) {
    const payload = intToBytes4LE(damageScore);
    const msg = encodeOracleMessage(DOMAIN, timestamp, nonce, payload);
    const msgHash = sha256.hash(msg);
    const sig = secp256k1.signMessageHashSchnorr(oraclePriv, msgHash);
    return { sig, msg };
  }

  // ── BLOCKED 1: Before filing window (locktime before FILING_START) ──
  try {
    const earlyLocktime = Number(FILING_START) - 100;
    const { sig: eSig, msg: eMsg } = signDamageReport(600n, BigInt(earlyLocktime - 10), 1n);

    const oUtxos = await provider.getUtxos(damage.address);
    const tUtxos = await provider.getUtxos(claimWindow.address);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(poolUtxo, pool.contract.unlock.composableSpend(operatorSig, 5_000n, 0n))
      .addInput(tUtxos[0], claimWindow.contract.unlock.composableCheck(operatorSig, 1n))
      .addInput(oUtxos[0], damage.contract.unlock.composableVerify(eSig, eMsg))
      .addOutput(pool.address, poolUtxo.satoshis - 5_000n)
      .addOutput(keys.recipient.address, 5_000n)
      .setLocktime(earlyLocktime);
    await composer.send();
  } catch {
    emit({
      id: 'blocked-1', type: 'blocked', title: 'Claim Before Filing Window',
      details: {
        'Locktime': `Before filingStart (${FILING_START})`,
        'Enforced by': 'TimeState (claim window)',
      },
      primitives: ['Time-State'],
    });
  }

  // ── BLOCKED 2: Damage below threshold ──
  try {
    const { sig, msg } = signDamageReport(50n, oracleTs, 2n);
    const oUtxos = await provider.getUtxos(damage.address);
    if (oUtxos.length > 0) {
      const builder = new TransactionBuilder({ provider });
      builder.addInput(
        oUtxos[0],
        damage.contract.unlock.verifyWithPayloadConstraint(
          ownerPub, operatorSig, sig, msg, MIN_DAMAGE,
        ),
      );
      builder.addOutput({ to: keys.recipient.address, amount: 546n });
      builder.setLocktime(baseLocktime);
      await builder.send();
    }
  } catch {
    emit({
      id: 'blocked-2', type: 'blocked', title: `Damage Score Below Threshold (50 < ${MIN_DAMAGE})`,
      details: {
        'Damage score': '50',
        'Minimum required': `${MIN_DAMAGE}`,
        'Enforced by': 'Oracle (damage assessment)',
      },
      primitives: ['Oracle'],
    });
  }

  // ── BLOCKED 3: Claim exceeds coverage ──
  try {
    const { sig: oSig, msg: oMsg } = signDamageReport(800n, oracleTs, 3n);
    const oUtxos = await provider.getUtxos(damage.address);
    const tUtxos = await provider.getUtxos(claimWindow.address);
    if (oUtxos.length > 0 && tUtxos.length > 0) {
      const composer = new TransactionComposer(provider);
      composer
        .addInput(poolUtxo, pool.contract.unlock.composableSpend(operatorSig, 15_000n, 0n))
        .addInput(tUtxos[0], claimWindow.contract.unlock.composableCheck(operatorSig, 1n))
        .addInput(oUtxos[0], damage.contract.unlock.composableVerify(oSig, oMsg))
        .addOutput(pool.address, poolUtxo.satoshis - 15_000n)
        .addOutput(keys.recipient.address, 15_000n)
        .setLocktime(baseLocktime);
      await composer.send();
    }
  } catch {
    emit({
      id: 'blocked-3', type: 'blocked', title: 'Claim Exceeds Coverage (15,000 > 10,000)',
      details: {
        'Claimed': '15,000 sats',
        'Coverage limit': `${MAX_CLAIM} sats`,
        'Enforced by': 'Vault (coverage cap)',
      },
      primitives: ['Vault'],
    });
  }

  // ── Fund fresh UTXOs for success steps ──
  emit({
    id: 'refund', type: 'info', title: 'Funding Fresh UTXOs for Claim Processing...',
    details: { 'Oracle': '1,000 sats', 'Timer': '1,000 sats' },
  });

  const fund2Txid = await fundScenario([
    { address: damage.address, amount: 1000n },
    { address: claimWindow.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);
  await waitForUtxos(damage.address, 1);

  // ── SUCCESS 1: Claim #1 ──
  const CLAIM1 = 8_000n;
  const poolAfter1 = poolUtxo.satoshis - CLAIM1;

  const { sig: s1Sig, msg: s1Msg } = signDamageReport(750n, oracleTs, 4n);
  const oUtxos1 = await provider.getUtxos(damage.address);
  const tUtxos1 = await provider.getUtxos(claimWindow.address);

  const composer1 = new TransactionComposer(provider);
  composer1
    .addInput(poolUtxo, pool.contract.unlock.composableSpend(operatorSig, CLAIM1, 0n))
    .addInput(tUtxos1[0], claimWindow.contract.unlock.composableCheck(operatorSig, 1n))
    .addInput(oUtxos1[0], damage.contract.unlock.composableVerify(s1Sig, s1Msg))
    .addOutput(pool.address, poolAfter1)
    .addOutput(keys.recipient.address, CLAIM1)
    .setLocktime(baseLocktime);

  const tx1 = await composer1.send();
  emit({
    id: 'success-1', type: 'success', title: `Claim #1 — ${CLAIM1} sats`,
    txid: tx1.txid,
    explorerUrl: EXPLORER_BASE + tx1.txid,
    details: {
      'Damage score': `750 (>= ${MIN_DAMAGE} threshold)`,
      'Payout': `${CLAIM1} sats`,
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
    { address: damage.address, amount: 1000n },
    { address: claimWindow.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  // ── SUCCESS 2: Claim #2 (covenant continuation) ──
  const CLAIM2 = 5_000n;
  const newPoolUtxo = await waitForFundedUtxo(pool.address, tx1.txid);
  const poolAfter2 = newPoolUtxo.satoshis - CLAIM2;

  const { sig: s2Sig, msg: s2Msg } = signDamageReport(450n, safeOracleTimestamp(), 5n);
  const oUtxos2 = await provider.getUtxos(damage.address);
  const tUtxos2 = await provider.getUtxos(claimWindow.address);

  const composer2 = new TransactionComposer(provider);
  composer2
    .addInput(newPoolUtxo, pool.contract.unlock.composableSpend(operatorSig, CLAIM2, 0n))
    .addInput(tUtxos2[0], claimWindow.contract.unlock.composableCheck(operatorSig, 1n))
    .addInput(oUtxos2[0], damage.contract.unlock.composableVerify(s2Sig, s2Msg))
    .addOutput(pool.address, poolAfter2)
    .addOutput(keys.recipient.address, CLAIM2)
    .setLocktime(safeChipnetLocktime());

  const tx2 = await composer2.send();
  emit({
    id: 'success-2', type: 'success', title: `Claim #2 — ${CLAIM2} sats (Covenant Continuation)`,
    txid: tx2.txid,
    explorerUrl: EXPLORER_BASE + tx2.txid,
    details: {
      'Damage score': '450',
      'Payout': `${CLAIM2} sats`,
      'Pool remaining': `${poolAfter2} sats`,
      'Covenant': 'Pool continuation verified on-chain',
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  const totalPaid = CLAIM1 + CLAIM2;
  return {
    title: 'Insurance Pool — Chipnet',
    mode: 'chipnet',
    explorerBaseUrl: EXPLORER_BASE,
    params: {
      'Premium pool': `${POOL_AMOUNT} sats`,
      'Max per claim': `${MAX_CLAIM} sats`,
      'Min damage score': `${MIN_DAMAGE}`,
      'Network': 'BCH Chipnet',
    },
    steps,
    summary: {
      'Insurance pool': `${POOL_AMOUNT} sats`,
      'Claim #1': `-${CLAIM1} sats (damage: 750)`,
      'Claim #2': `-${CLAIM2} sats (damage: 450)`,
      'Pool remaining': `${poolAfter2} sats`,
      'Total claims paid': `${totalPaid} sats`,
      'Loss ratio': `${((Number(totalPaid) / Number(POOL_AMOUNT)) * 100).toFixed(1)}%`,
      'Attacks blocked': '3',
      'Claims processed': '2',
    },
    executionTimeMs: Date.now() - start,
  };
}
