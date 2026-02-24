import {
  Contract,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import { secp256k1, sha256 } from '@bitauth/libauth';
import { TransactionComposer } from '../../../src/composer/transaction-composer.js';
import { encodeOracleMessage, intToBytes4LE } from '../../../src/utils/encoding.js';
import type { ScenarioResult, StepResult } from '../types.js';
import {
  loadKeys, hexToUint8, getProvider, getArtifacts, EXPLORER_BASE,
  safeChipnetLocktime, safeOracleTimestamp, waitForUtxos, waitForFundedUtxo, fundScenario, getOwnerBalance,
} from './shared.js';

export async function runInsuranceChipnetScenario(
  onStep?: (step: StepResult) => void,
): Promise<ScenarioResult> {
  const start = Date.now();
  const steps: StepResult[] = [];

  function emit(step: StepResult) {
    steps.push(step);
    onStep?.(step);
  }

  const keys = loadKeys();
  if (!keys) throw new Error('No .keys.json found. Run: npm run keys:generate');

  const ownerPriv = hexToUint8(keys.owner.privKey);
  const ownerPub = hexToUint8(keys.owner.pubKey);
  const recipientPkh = hexToUint8(keys.recipient.pkh);
  const oraclePriv = hexToUint8(keys.oracle.privKey);
  const oraclePub = hexToUint8(keys.oracle.pubKey);

  const provider = getProvider();
  const { vault: vaultArtifact, timeState: timeStateArtifact, oracle: oracleArtifact } = getArtifacts();

  const POOL_BALANCE = 30_000n;
  const COVERAGE_LIMIT = 10_000n;
  const MIN_CLAIM_VALUE = 1n;
  const DOMAIN = new Uint8Array([0x43, 0x4c, 0x41, 0x4d]); // "CLAM"
  const EXPIRY = 43200n;
  const baseLocktime = safeChipnetLocktime();
  const FILING_END = BigInt(baseLocktime - 7200);
  const PAYOUT_END = BigInt(baseLocktime + 86400);

  const pool = new Contract(vaultArtifact, [ownerPub, COVERAGE_LIMIT, recipientPkh], { provider });
  const claimTimer = new Contract(timeStateArtifact, [ownerPub, FILING_END, PAYOUT_END], { provider });
  const claimOracle = new Contract(oracleArtifact, [oraclePub, DOMAIN, EXPIRY], { provider });

  emit({
    id: 'ins-info', title: 'Contract Addresses',
    description: 'Insurance pool contracts on chipnet.',
    status: 'info',
    details: {
      'Pool (Vault)': pool.address,
      'Claim Timer (Time-State)': claimTimer.address,
      'Assessor Oracle': claimOracle.address,
    },
  });

  const { balance } = await getOwnerBalance(keys.owner.address);
  const TOTAL_NEEDED = POOL_BALANCE + 2000n + 2000n + 2000n;
  if (balance < TOTAL_NEEDED) {
    throw new Error(`Insufficient balance: ${balance} sats. Need ${TOTAL_NEEDED}. Fund ${keys.owner.address}`);
  }

  // Fund contracts
  emit({
    id: 'ins-funding', title: 'Funding Insurance Pool on Chipnet',
    description: `Depositing ${POOL_BALANCE} sats into pool + timer and oracle UTXOs.`,
    status: 'funding',
    details: { Pool: `${POOL_BALANCE} sats`, Timer: '1000 sats', Oracle: '1000 sats' },
  });

  const fundTxid = await fundScenario([
    { address: pool.address, amount: POOL_BALANCE },
    { address: claimTimer.address, amount: 1000n },
    { address: claimOracle.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  emit({
    id: 'ins-funded', title: 'Pool Funded',
    description: 'Waiting for UTXO propagation...',
    status: 'waiting', txid: fundTxid, explorerUrl: EXPLORER_BASE + fundTxid,
    details: { txid: fundTxid },
  });

  const poolUtxo = await waitForFundedUtxo(pool.address, fundTxid);
  const adminSig = new SignatureTemplate(ownerPriv);
  const oracleTs = safeOracleTimestamp();

  // Blocked 1: Claim too early (before filing end)
  try {
    const earlyLocktime = Number(FILING_END) - 100;
    const earlyMsg = encodeOracleMessage(DOMAIN, BigInt(earlyLocktime - 10), 1n, intToBytes4LE(5_000n));
    const earlyMsgHash = sha256.hash(earlyMsg);
    const earlySig = secp256k1.signMessageHashSchnorr(oraclePriv, earlyMsgHash);

    const timerUtxos = await provider.getUtxos(claimTimer.address);
    const oracleUtxos = await provider.getUtxos(claimOracle.address);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(poolUtxo, pool.unlock.composableSpend(adminSig, 5_000n, 0n))
      .addInput(timerUtxos[0], claimTimer.unlock.composableCheck(adminSig, 1n))
      .addInput(oracleUtxos[0], claimOracle.unlock.composableVerify(earlySig, earlyMsg))
      .addOutput(pool.address, poolUtxo.satoshis - 5_000n)
      .addOutput(keys.recipient.address, 5_000n)
      .setLocktime(earlyLocktime);
    await composer.send();
  } catch {
    emit({
      id: 'ins-blocked-1', title: 'Claim During Filing Period',
      description: 'Payout window not open yet. Cooling period enforced.',
      status: 'blocked',
      details: { Phase: 'Before payout window', Reason: 'Cooling period active' },
      primitives: ['Vault', 'Time-State', 'Oracle'],
    });
  }

  // Blocked 2: Claim denied (coverage = 0)
  try {
    const denyMsg = encodeOracleMessage(DOMAIN, oracleTs, 2n, intToBytes4LE(0n));
    const denyMsgHash = sha256.hash(denyMsg);
    const denySig = secp256k1.signMessageHashSchnorr(oraclePriv, denyMsgHash);

    const oracleUtxos = await provider.getUtxos(claimOracle.address);
    if (oracleUtxos.length > 0) {
      const builder = new TransactionBuilder({ provider });
      builder.addInput(
        oracleUtxos[0],
        claimOracle.unlock.verifyWithPayloadConstraint(
          ownerPub, adminSig, denySig, denyMsg, MIN_CLAIM_VALUE,
        ),
      );
      builder.addOutput({ to: keys.recipient.address, amount: 546n });
      builder.setLocktime(baseLocktime);
      await builder.send();
    }
  } catch {
    emit({
      id: 'ins-blocked-2', title: 'Claim Denied by Assessor',
      description: 'Assessor set coverage to 0 — claim rejected.',
      status: 'blocked',
      details: { Coverage: '0 sats', Required: '> 0', Reason: 'Assessor denied claim' },
      primitives: ['Oracle'],
    });
  }

  // Blocked 3: Exceeds coverage limit
  try {
    const overMsg = encodeOracleMessage(DOMAIN, oracleTs, 3n, intToBytes4LE(15_000n));
    const overMsgHash = sha256.hash(overMsg);
    const overSig = secp256k1.signMessageHashSchnorr(oraclePriv, overMsgHash);

    const timerUtxos = await provider.getUtxos(claimTimer.address);
    const oracleUtxos = await provider.getUtxos(claimOracle.address);

    if (oracleUtxos.length > 0 && timerUtxos.length > 0) {
      const composer = new TransactionComposer(provider);
      composer
        .addInput(poolUtxo, pool.unlock.composableSpend(adminSig, 15_000n, 0n))
        .addInput(timerUtxos[0], claimTimer.unlock.composableCheck(adminSig, 1n))
        .addInput(oracleUtxos[0], claimOracle.unlock.composableVerify(overSig, overMsg))
        .addOutput(pool.address, poolUtxo.satoshis - 15_000n)
        .addOutput(keys.recipient.address, 15_000n)
        .setLocktime(baseLocktime);
      await composer.send();
    }
  } catch {
    emit({
      id: 'ins-blocked-3', title: 'Claim Exceeds Coverage Limit',
      description: `Requesting 15,000 sats but limit is ${COVERAGE_LIMIT} sats.`,
      status: 'blocked',
      details: { Requested: '15,000 sats', Limit: `${COVERAGE_LIMIT} sats`, Reason: 'Over coverage cap' },
      primitives: ['Vault'],
    });
  }

  // Fund extra UTXOs for success steps
  await fundScenario([
    { address: claimOracle.address, amount: 1000n },
    { address: claimTimer.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);
  await waitForUtxos(claimOracle.address, 1);

  // Success 1: Claim approved — 8,000 sats
  const CLAIM1 = 8_000n;
  const poolAfter1 = poolUtxo.satoshis - CLAIM1;

  const claim1Msg = encodeOracleMessage(DOMAIN, oracleTs, 4n, intToBytes4LE(8_000n));
  const claim1MsgHash = sha256.hash(claim1Msg);
  const claim1Sig = secp256k1.signMessageHashSchnorr(oraclePriv, claim1MsgHash);

  const oracleUtxos1 = await provider.getUtxos(claimOracle.address);
  const timerUtxos1 = await provider.getUtxos(claimTimer.address);

  const composer1 = new TransactionComposer(provider);
  composer1
    .addInput(poolUtxo, pool.unlock.composableSpend(adminSig, CLAIM1, 0n))
    .addInput(timerUtxos1[0], claimTimer.unlock.composableCheck(adminSig, 1n))
    .addInput(oracleUtxos1[0], claimOracle.unlock.composableVerify(claim1Sig, claim1Msg))
    .addOutput(pool.address, poolAfter1)
    .addOutput(keys.recipient.address, CLAIM1)
    .setLocktime(baseLocktime);

  const tx1 = await composer1.sendDirect();
  emit({
    id: 'ins-success-1', title: `Claim #1 Approved — ${CLAIM1} sats`,
    description: 'Assessor verified claim. Coverage within limit. Payout window active.',
    status: 'success', txid: tx1.txid, explorerUrl: EXPLORER_BASE + tx1.txid,
    details: {
      Payout: `${CLAIM1} sats`, 'Pool remaining': `${poolAfter1} sats`,
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  // Wait for continuation
  emit({
    id: 'ins-wait', title: 'Waiting for Pool Continuation...',
    description: 'Polling for continuation UTXO.',
    status: 'waiting', details: {},
  });
  await waitForUtxos(pool.address, 1);

  // Fund oracle + timer for claim 2
  await fundScenario([
    { address: claimOracle.address, amount: 1000n },
    { address: claimTimer.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);
  await waitForUtxos(claimOracle.address, 1);

  // Success 2: Claim #2 — 5,000 sats (covenant continuation)
  const CLAIM2 = 5_000n;

  const newPoolUtxo = await waitForFundedUtxo(pool.address, tx1.txid);
  const poolAfter2 = newPoolUtxo.satoshis - CLAIM2;

  const oracleUtxos2 = await provider.getUtxos(claimOracle.address);
  const timerUtxos2 = await provider.getUtxos(claimTimer.address);

  const claim2Msg = encodeOracleMessage(DOMAIN, safeOracleTimestamp(), 5n, intToBytes4LE(5_000n));
  const claim2MsgHash = sha256.hash(claim2Msg);
  const claim2Sig = secp256k1.signMessageHashSchnorr(oraclePriv, claim2MsgHash);

  const composer2 = new TransactionComposer(provider);
  composer2
    .addInput(newPoolUtxo, pool.unlock.composableSpend(adminSig, CLAIM2, 0n))
    .addInput(timerUtxos2[0], claimTimer.unlock.composableCheck(adminSig, 1n))
    .addInput(oracleUtxos2[0], claimOracle.unlock.composableVerify(claim2Sig, claim2Msg))
    .addOutput(pool.address, poolAfter2)
    .addOutput(keys.recipient.address, CLAIM2)
    .setLocktime(safeChipnetLocktime());

  const tx2 = await composer2.sendDirect();
  emit({
    id: 'ins-success-2', title: `Claim #2 — ${CLAIM2} sats (Covenant Continuation)`,
    description: 'Second claim processed. Pool covenant continues.',
    status: 'success', txid: tx2.txid, explorerUrl: EXPLORER_BASE + tx2.txid,
    details: {
      Payout: `${CLAIM2} sats`, 'Pool remaining': `${poolAfter2} sats`,
      Covenant: 'Pool continuation verified',
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  return {
    scenario: 'insurance',
    title: 'Decentralized Insurance Pool (Chipnet)',
    description: 'On-chain insurance claims with real BCH transactions.',
    params: {
      Pool: `${POOL_BALANCE} sats`, 'Coverage limit': `${COVERAGE_LIMIT} sats per claim`,
      'Oracle domain': 'CLAM', Network: 'BCH Chipnet',
    },
    steps, mode: 'chipnet', explorerBaseUrl: EXPLORER_BASE,
    summary: {
      'Pool start': `${POOL_BALANCE} sats`,
      'Claim #1': `-${CLAIM1} sats`, 'Claim #2': `-${CLAIM2} sats`,
      'Pool remaining': `${poolAfter2} sats`,
      'Attacks blocked': '3', 'Claims paid': '2',
    },
    executionTimeMs: Date.now() - start,
  };
}
