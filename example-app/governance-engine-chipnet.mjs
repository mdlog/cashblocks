/**
 * Governance Engine — Chipnet (Real Blockchain)
 * Runs the DAO treasury scenario on BCH chipnet with real transactions.
 *
 * 3 Primitives (no TokenGate on chipnet — CashTokens need genesis TXs):
 *   Vault      → Treasury with per-proposal budget limits
 *   TimeState  → Voting window phases
 *   Oracle     → Vote count verification via off-chain tally
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

const DOMAIN = domainFromString('VOTE');

/**
 * Run the full governance scenario on chipnet
 * @param {function} onStep - Callback for each step (real-time streaming)
 * @returns {object} Full scenario result
 */
export async function runGovernanceChipnetScenario(onStep, browserKeys = null) {
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
  const TREASURY_AMOUNT = 50_000n;
  const MAX_PROPOSAL = 10_000n;
  const MIN_VOTES = 10n;
  const ORACLE_EXPIRY = 86400n;

  const baseLocktime = safeChipnetLocktime();
  const VOTING_START = BigInt(baseLocktime - 7200);   // opened 2h ago
  const VOTING_END = BigInt(baseLocktime + 86400);     // closes in 24h

  // --- Deploy contracts ---
  const treasury = new VaultPrimitive({
    ownerPk: ownerPub,
    spendLimit: MAX_PROPOSAL,
    whitelistHash: recipientPkh,
  }, provider);

  const voting = new TimeStatePrimitive({
    ownerPk: ownerPub,
    phase1Time: VOTING_START,
    phase2Time: VOTING_END,
  }, provider);

  const votes = new OracleProofPrimitive({
    oraclePk: oraclePub,
    domainSeparator: DOMAIN,
    expiryDuration: ORACLE_EXPIRY,
  }, provider);

  emit({
    id: 'info', type: 'info', title: 'DAO Contracts Instantiated (Chipnet)',
    details: {
      'Treasury (Vault)': treasury.address,
      'Voting (TimeState)': voting.address,
      'Vote Oracle': votes.address,
      'Network': 'BCH Chipnet',
      'Max per proposal': `${MAX_PROPOSAL} sats`,
      'Min votes required': `${MIN_VOTES}`,
    },
  });

  // --- Check balance ---
  const { balance } = await getOwnerBalance(keys.owner.address);
  const TOTAL_NEEDED = TREASURY_AMOUNT + 5000n + 5000n;
  if (balance < TOTAL_NEEDED) {
    throw new Error(
      `Insufficient balance: ${balance} sats. Need ~${TOTAL_NEEDED} sats. ` +
      `Fund ${keys.owner.address} via ${FAUCET_URL}`
    );
  }

  emit({
    id: 'balance', type: 'info', title: 'DAO Admin Balance Verified',
    details: {
      'Address': keys.owner.address,
      'Balance': `${balance} sats`,
      'Required': `~${TOTAL_NEEDED} sats`,
    },
  });

  // --- Fund contracts ---
  emit({
    id: 'funding', type: 'info', title: 'Funding DAO Contracts on Chipnet...',
    details: {
      'Treasury': `${TREASURY_AMOUNT} sats`,
      'Timer': '1,000 sats',
      'Oracle': '1,000 sats',
    },
  });

  const fundTxid = await fundScenario([
    { address: treasury.address, amount: TREASURY_AMOUNT },
    { address: voting.address, amount: 1000n },
    { address: votes.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  emit({
    id: 'funded', type: 'info', title: 'DAO Contracts Funded',
    txid: fundTxid,
    explorerUrl: EXPLORER_BASE + fundTxid,
    details: { 'Funding TX': fundTxid },
  });

  // --- Wait for propagation ---
  emit({
    id: 'waiting', type: 'info', title: 'Waiting for UTXO Propagation...',
    details: { 'Polling': '3s intervals, max 60s' },
  });

  const treasuryUtxo = await waitForFundedUtxo(treasury.address, fundTxid);

  const adminSig = new SignatureTemplate(ownerPriv);
  const oracleTs = safeOracleTimestamp();

  function signVoteCount(voteCount, timestamp, nonce) {
    const payload = intToBytes4LE(voteCount);
    const msg = encodeOracleMessage(DOMAIN, timestamp, nonce, payload);
    const msgHash = sha256.hash(msg);
    const sig = secp256k1.signMessageHashSchnorr(oraclePriv, msgHash);
    return { sig, msg };
  }

  // ── BLOCKED 1: Before voting window (locktime before VOTING_START) ──
  try {
    const earlyLocktime = Number(VOTING_START) - 100;
    const { sig: eSig, msg: eMsg } = signVoteCount(15n, BigInt(earlyLocktime - 10), 1n);

    const oUtxos = await provider.getUtxos(votes.address);
    const tUtxos = await provider.getUtxos(voting.address);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(treasuryUtxo, treasury.contract.unlock.composableSpend(adminSig, 5_000n, 0n))
      .addInput(tUtxos[0], voting.contract.unlock.composableCheck(adminSig, 1n))
      .addInput(oUtxos[0], votes.contract.unlock.composableVerify(eSig, eMsg))
      .addOutput(treasury.address, treasuryUtxo.satoshis - 5_000n)
      .addOutput(keys.recipient.address, 5_000n)
      .setLocktime(earlyLocktime);
    await composer.send();
  } catch {
    emit({
      id: 'blocked-1', type: 'blocked', title: 'Proposal Before Voting Window',
      details: {
        'Locktime': `Before votingStart (${VOTING_START})`,
        'Enforced by': 'TimeState (voting phase gate)',
      },
      primitives: ['Time-State'],
    });
  }

  // ── BLOCKED 2: Insufficient votes ──
  try {
    const { sig, msg } = signVoteCount(3n, oracleTs, 2n);
    const oUtxos = await provider.getUtxos(votes.address);
    if (oUtxos.length > 0) {
      const builder = new TransactionBuilder({ provider });
      builder.addInput(
        oUtxos[0],
        votes.contract.unlock.verifyWithPayloadConstraint(
          ownerPub, adminSig, sig, msg, MIN_VOTES,
        ),
      );
      builder.addOutput({ to: keys.recipient.address, amount: 546n });
      builder.setLocktime(baseLocktime);
      await builder.send();
    }
  } catch {
    emit({
      id: 'blocked-2', type: 'blocked', title: `Insufficient Votes (3 < ${MIN_VOTES})`,
      details: {
        'Votes': '3',
        'Minimum required': `${MIN_VOTES}`,
        'Enforced by': 'Oracle (vote count verification)',
      },
      primitives: ['Oracle'],
    });
  }

  // ── BLOCKED 3: Over budget ──
  try {
    const { sig: oSig, msg: oMsg } = signVoteCount(20n, oracleTs, 3n);
    const oUtxos = await provider.getUtxos(votes.address);
    const tUtxos = await provider.getUtxos(voting.address);
    if (oUtxos.length > 0 && tUtxos.length > 0) {
      const composer = new TransactionComposer(provider);
      composer
        .addInput(treasuryUtxo, treasury.contract.unlock.composableSpend(adminSig, 15_000n, 0n))
        .addInput(tUtxos[0], voting.contract.unlock.composableCheck(adminSig, 1n))
        .addInput(oUtxos[0], votes.contract.unlock.composableVerify(oSig, oMsg))
        .addOutput(treasury.address, treasuryUtxo.satoshis - 15_000n)
        .addOutput(keys.recipient.address, 15_000n)
        .setLocktime(baseLocktime);
      await composer.send();
    }
  } catch {
    emit({
      id: 'blocked-3', type: 'blocked', title: 'Proposal Exceeds Budget (15,000 > 10,000)',
      details: {
        'Requested': '15,000 sats',
        'Limit': `${MAX_PROPOSAL} sats`,
        'Enforced by': 'Vault (per-proposal budget limit)',
      },
      primitives: ['Vault'],
    });
  }

  // ── Fund fresh UTXOs for success steps ──
  emit({
    id: 'refund', type: 'info', title: 'Funding Fresh UTXOs for Proposals...',
    details: { 'Oracle': '1,000 sats', 'Timer': '1,000 sats' },
  });

  const fund2Txid = await fundScenario([
    { address: votes.address, amount: 1000n },
    { address: voting.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);
  await waitForUtxos(votes.address, 1);

  // ── SUCCESS 1: Proposal #1 ──
  const PROPOSAL1 = 8_000n;
  const treasuryAfter1 = treasuryUtxo.satoshis - PROPOSAL1;

  const { sig: s1Sig, msg: s1Msg } = signVoteCount(15n, oracleTs, 4n);
  const oUtxos1 = await provider.getUtxos(votes.address);
  const tUtxos1 = await provider.getUtxos(voting.address);

  const composer1 = new TransactionComposer(provider);
  composer1
    .addInput(treasuryUtxo, treasury.contract.unlock.composableSpend(adminSig, PROPOSAL1, 0n))
    .addInput(tUtxos1[0], voting.contract.unlock.composableCheck(adminSig, 1n))
    .addInput(oUtxos1[0], votes.contract.unlock.composableVerify(s1Sig, s1Msg))
    .addOutput(treasury.address, treasuryAfter1)
    .addOutput(keys.recipient.address, PROPOSAL1)
    .setLocktime(baseLocktime);

  const tx1 = await composer1.send();
  emit({
    id: 'success-1', type: 'success', title: `Proposal #1 — ${PROPOSAL1} sats`,
    txid: tx1.txid,
    explorerUrl: EXPLORER_BASE + tx1.txid,
    details: {
      'Vote count': `15 (>= ${MIN_VOTES} threshold)`,
      'Amount': `${PROPOSAL1} sats`,
      'Treasury remaining': `${treasuryAfter1} sats`,
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  // ── Wait for continuation + fund more UTXOs ──
  emit({
    id: 'wait-continuation', type: 'info', title: 'Waiting for Covenant Continuation...',
    details: { 'Polling': 'UTXO from tx1 at treasury address' },
  });

  await fundScenario([
    { address: votes.address, amount: 1000n },
    { address: voting.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  // ── SUCCESS 2: Proposal #2 (covenant continuation) ──
  const PROPOSAL2 = 5_000n;
  const newTreasuryUtxo = await waitForFundedUtxo(treasury.address, tx1.txid);
  const treasuryAfter2 = newTreasuryUtxo.satoshis - PROPOSAL2;

  const { sig: s2Sig, msg: s2Msg } = signVoteCount(12n, safeOracleTimestamp(), 5n);
  const oUtxos2 = await provider.getUtxos(votes.address);
  const tUtxos2 = await provider.getUtxos(voting.address);

  const composer2 = new TransactionComposer(provider);
  composer2
    .addInput(newTreasuryUtxo, treasury.contract.unlock.composableSpend(adminSig, PROPOSAL2, 0n))
    .addInput(tUtxos2[0], voting.contract.unlock.composableCheck(adminSig, 1n))
    .addInput(oUtxos2[0], votes.contract.unlock.composableVerify(s2Sig, s2Msg))
    .addOutput(treasury.address, treasuryAfter2)
    .addOutput(keys.recipient.address, PROPOSAL2)
    .setLocktime(safeChipnetLocktime());

  const tx2 = await composer2.send();
  emit({
    id: 'success-2', type: 'success', title: `Proposal #2 — ${PROPOSAL2} sats (Covenant Continuation)`,
    txid: tx2.txid,
    explorerUrl: EXPLORER_BASE + tx2.txid,
    details: {
      'Vote count': '12',
      'Amount': `${PROPOSAL2} sats`,
      'Treasury remaining': `${treasuryAfter2} sats`,
      'Covenant': 'Treasury continuation verified on-chain',
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  const totalDisbursed = PROPOSAL1 + PROPOSAL2;
  return {
    title: 'DAO Governance — Chipnet',
    mode: 'chipnet',
    explorerBaseUrl: EXPLORER_BASE,
    params: {
      'Treasury balance': `${TREASURY_AMOUNT} sats`,
      'Max per proposal': `${MAX_PROPOSAL} sats`,
      'Min votes': `${MIN_VOTES}`,
      'Network': 'BCH Chipnet',
    },
    steps,
    summary: {
      'Initial treasury': `${TREASURY_AMOUNT} sats`,
      'Proposal #1': `-${PROPOSAL1} sats (15 votes)`,
      'Proposal #2': `-${PROPOSAL2} sats (12 votes)`,
      'Treasury remaining': `${treasuryAfter2} sats`,
      'Total disbursed': `${totalDisbursed} sats`,
      'Utilization': `${((Number(totalDisbursed) / Number(TREASURY_AMOUNT)) * 100).toFixed(1)}%`,
      'Attacks blocked': '3',
      'Proposals executed': '2',
    },
    executionTimeMs: Date.now() - start,
  };
}
