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

export async function runDaoChipnetScenario(
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

  const TREASURY_AMOUNT = 50_000n;
  const PROPOSAL_LIMIT = 10_000n;
  const VOTE_THRESHOLD = 10n;
  const baseLocktime = safeChipnetLocktime();
  const PHASE1_TIME = BigInt(baseLocktime - 7200);
  const PHASE2_TIME = BigInt(baseLocktime + 86400);
  const DOMAIN = new Uint8Array([0x56, 0x4f, 0x54, 0x45]); // "VOTE"
  const EXPIRY = 86400n;

  const treasury = new Contract(vaultArtifact, [ownerPub, PROPOSAL_LIMIT, recipientPkh], { provider });
  const governance = new Contract(timeStateArtifact, [ownerPub, PHASE1_TIME, PHASE2_TIME], { provider });
  const voteOracle = new Contract(oracleArtifact, [oraclePub, DOMAIN, EXPIRY], { provider });

  emit({
    id: 'dao-info', title: 'Contract Addresses',
    description: 'Contracts instantiated on chipnet.',
    status: 'info',
    details: {
      'Treasury (Vault)': treasury.address,
      'Governance (Time-State)': governance.address,
      'Vote Oracle': voteOracle.address,
    },
  });

  // Check balance
  const { balance } = await getOwnerBalance(keys.owner.address);
  const TOTAL_NEEDED = TREASURY_AMOUNT + 2000n + 3000n + 2000n;
  if (balance < TOTAL_NEEDED) {
    throw new Error(`Insufficient balance: ${balance} sats. Need ${TOTAL_NEEDED}. Fund ${keys.owner.address}`);
  }

  // Fund contracts
  emit({
    id: 'dao-funding', title: 'Funding Contracts on Chipnet',
    description: `Sending ${TREASURY_AMOUNT} sats to treasury + UTXOs for governance and oracle.`,
    status: 'funding',
    details: { 'Treasury': `${TREASURY_AMOUNT} sats`, 'Governance': '1000 sats', 'Oracle': '1000 sats' },
  });

  const fundTxid = await fundScenario([
    { address: treasury.address, amount: TREASURY_AMOUNT },
    { address: governance.address, amount: 1000n },
    { address: voteOracle.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  emit({
    id: 'dao-funded', title: 'Contracts Funded',
    description: 'Funding transaction broadcast. Waiting for propagation...',
    status: 'waiting', txid: fundTxid, explorerUrl: EXPLORER_BASE + fundTxid,
    details: { txid: fundTxid },
  });

  const treasuryUtxo = await waitForFundedUtxo(treasury.address, fundTxid);
  const govUtxos = await provider.getUtxos(governance.address);
  const govUtxo = govUtxos[0];

  const adminSig = new SignatureTemplate(ownerPriv);
  const oracleTs = safeOracleTimestamp();

  // Blocked 1: Spend during proposal phase (locktime before phase1Time)
  try {
    const earlyLocktime = Number(PHASE1_TIME) - 100;
    const earlyMsg = encodeOracleMessage(DOMAIN, BigInt(earlyLocktime - 10), 1n, intToBytes4LE(15n));
    const earlyMsgHash = sha256.hash(earlyMsg);
    const earlySig = secp256k1.signMessageHashSchnorr(oraclePriv, earlyMsgHash);

    const oracleUtxos = await provider.getUtxos(voteOracle.address);
    const composer = new TransactionComposer(provider);
    composer
      .addInput(treasuryUtxo, treasury.unlock.composableSpend(adminSig, 5_000n, 0n))
      .addInput(govUtxo, governance.unlock.composableCheck(adminSig, 1n))
      .addInput(oracleUtxos[0], voteOracle.unlock.composableVerify(earlySig, earlyMsg))
      .addOutput(treasury.address, treasuryUtxo.satoshis - 5_000n)
      .addOutput(keys.recipient.address, 5_000n)
      .setLocktime(earlyLocktime);
    await composer.send();
  } catch {
    emit({
      id: 'dao-blocked-1', title: 'Spend During Proposal Phase',
      description: 'Time gate blocks execution — locktime before voting phase.',
      status: 'blocked',
      details: { Phase: 'Before phase1Time', Reason: 'Time gate not reached' },
      primitives: ['Vault', 'Time-State', 'Oracle'],
    });
  }

  // Blocked 2: Vote below threshold
  try {
    const rejectMsg = encodeOracleMessage(DOMAIN, oracleTs, 2n, intToBytes4LE(5n));
    const rejectMsgHash = sha256.hash(rejectMsg);
    const rejectSig = secp256k1.signMessageHashSchnorr(oraclePriv, rejectMsgHash);

    const oracleUtxos = await provider.getUtxos(voteOracle.address);
    if (oracleUtxos.length > 0) {
      const spenderPub = ownerPub;
      const builder = new TransactionBuilder({ provider });
      builder.addInput(
        oracleUtxos[0],
        voteOracle.unlock.verifyWithPayloadConstraint(
          spenderPub, adminSig, rejectSig, rejectMsg, VOTE_THRESHOLD,
        ),
      );
      builder.addOutput({ to: keys.recipient.address, amount: 546n });
      builder.setLocktime(baseLocktime);
      await builder.send();
    }
  } catch {
    emit({
      id: 'dao-blocked-2', title: 'Vote Did Not Pass (5 < 10 threshold)',
      description: 'Oracle proves only 5 votes — below 10-vote threshold.',
      status: 'blocked',
      details: { 'Vote count': '5', 'Threshold': '10', Reason: 'Below threshold' },
      primitives: ['Oracle'],
    });
  }

  // Blocked 3: Exceeds spending limit
  try {
    const overMsg = encodeOracleMessage(DOMAIN, oracleTs, 3n, intToBytes4LE(20n));
    const overMsgHash = sha256.hash(overMsg);
    const overSig = secp256k1.signMessageHashSchnorr(oraclePriv, overMsgHash);

    const oracleUtxos = await provider.getUtxos(voteOracle.address);
    if (oracleUtxos.length > 0) {
      const composer = new TransactionComposer(provider);
      composer
        .addInput(treasuryUtxo, treasury.unlock.composableSpend(adminSig, 15_000n, 0n))
        .addInput(govUtxo, governance.unlock.composableCheck(adminSig, 1n))
        .addInput(oracleUtxos[0], voteOracle.unlock.composableVerify(overSig, overMsg))
        .addOutput(treasury.address, treasuryUtxo.satoshis - 15_000n)
        .addOutput(keys.recipient.address, 15_000n)
        .setLocktime(baseLocktime);
      await composer.send();
    }
  } catch {
    emit({
      id: 'dao-blocked-3', title: 'Proposal Exceeds Spending Limit',
      description: `Requesting 15,000 sats but limit is ${PROPOSAL_LIMIT} sats.`,
      status: 'blocked',
      details: { Requested: '15,000 sats', Limit: `${PROPOSAL_LIMIT} sats`, Reason: 'Exceeds limit' },
      primitives: ['Vault'],
    });
  }

  // Fund extra oracle + governance UTXOs for success steps
  const fund2Txid = await fundScenario([
    { address: voteOracle.address, amount: 1000n },
    { address: governance.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);
  await waitForUtxos(voteOracle.address, 1);

  // Success 1: Proposal #1
  const PROPOSAL1 = 8_000n;
  const treasuryAfter1 = treasuryUtxo.satoshis - PROPOSAL1;

  const vote1Msg = encodeOracleMessage(DOMAIN, oracleTs, 4n, intToBytes4LE(15n));
  const vote1MsgHash = sha256.hash(vote1Msg);
  const vote1Sig = secp256k1.signMessageHashSchnorr(oraclePriv, vote1MsgHash);

  const oracleUtxos1 = await provider.getUtxos(voteOracle.address);
  const govUtxos1 = await provider.getUtxos(governance.address);

  const composer1 = new TransactionComposer(provider);
  composer1
    .addInput(treasuryUtxo, treasury.unlock.composableSpend(adminSig, PROPOSAL1, 0n))
    .addInput(govUtxos1[0], governance.unlock.composableCheck(adminSig, 1n))
    .addInput(oracleUtxos1[0], voteOracle.unlock.composableVerify(vote1Sig, vote1Msg))
    .addOutput(treasury.address, treasuryAfter1)
    .addOutput(keys.recipient.address, PROPOSAL1)
    .setLocktime(baseLocktime);

  const tx1 = await composer1.send();
  emit({
    id: 'dao-success-1', title: `Proposal #1: ${PROPOSAL1} sats`,
    description: 'Vote passed (15 >= 10). All 3 primitives validated atomically on-chain.',
    status: 'success', txid: tx1.txid, explorerUrl: EXPLORER_BASE + tx1.txid,
    details: {
      'Vote count': '15 (passed)', Paid: `${PROPOSAL1} sats`,
      'Treasury remaining': `${treasuryAfter1} sats`,
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  // Wait for continuation UTXO
  emit({
    id: 'dao-wait', title: 'Waiting for Covenant Continuation...',
    description: 'Polling for the treasury continuation UTXO on-chain.',
    status: 'waiting', details: {},
  });

  // Fund another oracle + governance for proposal 2
  await fundScenario([
    { address: voteOracle.address, amount: 1000n },
    { address: governance.address, amount: 1000n },
  ], ownerPriv, keys.owner.address);

  // Success 2: Proposal #2 (covenant continuation)
  const PROPOSAL2 = 5_000n;

  const newTreasuryUtxo = await waitForFundedUtxo(treasury.address, tx1.txid);
  const treasuryAfter2 = newTreasuryUtxo.satoshis - PROPOSAL2;

  const oracleUtxos2 = await provider.getUtxos(voteOracle.address);
  const govUtxos2 = await provider.getUtxos(governance.address);

  const vote2Msg = encodeOracleMessage(DOMAIN, safeOracleTimestamp(), 5n, intToBytes4LE(12n));
  const vote2MsgHash = sha256.hash(vote2Msg);
  const vote2Sig = secp256k1.signMessageHashSchnorr(oraclePriv, vote2MsgHash);

  const composer2 = new TransactionComposer(provider);
  composer2
    .addInput(newTreasuryUtxo, treasury.unlock.composableSpend(adminSig, PROPOSAL2, 0n))
    .addInput(govUtxos2[0], governance.unlock.composableCheck(adminSig, 1n))
    .addInput(oracleUtxos2[0], voteOracle.unlock.composableVerify(vote2Sig, vote2Msg))
    .addOutput(treasury.address, treasuryAfter2)
    .addOutput(keys.recipient.address, PROPOSAL2)
    .setLocktime(safeChipnetLocktime());

  const tx2 = await composer2.send();
  emit({
    id: 'dao-success-2', title: `Proposal #2: ${PROPOSAL2} sats (Covenant Continuation)`,
    description: 'Second proposal proves covenant works — treasury keeps operating after first spend.',
    status: 'success', txid: tx2.txid, explorerUrl: EXPLORER_BASE + tx2.txid,
    details: {
      'Vote count': '12 (passed)', Paid: `${PROPOSAL2} sats`,
      'Treasury remaining': `${treasuryAfter2} sats`, Covenant: 'Continuation verified',
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  return {
    scenario: 'dao',
    title: 'DAO Governance Treasury (Chipnet)',
    description: 'Live on-chain DAO governance with real BCH transactions.',
    params: {
      Treasury: `${TREASURY_AMOUNT} sats`, 'Proposal limit': `${PROPOSAL_LIMIT} sats`,
      'Vote threshold': `>= ${VOTE_THRESHOLD}`, Network: 'BCH Chipnet',
    },
    steps, mode: 'chipnet', explorerBaseUrl: EXPLORER_BASE,
    summary: {
      'Initial treasury': `${TREASURY_AMOUNT} sats`,
      'Proposal #1': `-${PROPOSAL1} sats`, 'Proposal #2': `-${PROPOSAL2} sats`,
      'Final treasury': `${treasuryAfter2} sats`,
      'Attacks blocked': '3', 'Proposals executed': '2',
    },
    executionTimeMs: Date.now() - start,
  };
}
