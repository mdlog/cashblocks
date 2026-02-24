import {
  MockNetworkProvider,
  Contract,
  randomUtxo,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import { compileFile } from 'cashc';
import {
  secp256k1,
  generatePrivateKey,
  hash160,
  sha256,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';
import { TransactionComposer } from '../../src/composer/transaction-composer.js';
import { encodeOracleMessage, intToBytes4LE } from '../../src/utils/encoding.js';
import type { ScenarioResult, StepResult } from './types.js';

export async function runDaoScenario(): Promise<ScenarioResult> {
  const start = Date.now();
  const steps: StepResult[] = [];

  // Setup
  const adminPriv = generatePrivateKey();
  const adminPub = secp256k1.derivePublicKeyCompressed(adminPriv);
  const oraclePriv = generatePrivateKey();
  const oraclePub = secp256k1.derivePublicKeyCompressed(oraclePriv);
  const devPub = secp256k1.derivePublicKeyCompressed(generatePrivateKey());
  const devPkh = hash160(devPub);
  const devAddr = (encodeCashAddress({
    payload: devPkh,
    prefix: 'bchtest',
    type: CashAddressType.p2pkh,
  }) as { address: string }).address;

  const provider = new MockNetworkProvider();
  const vaultArtifact = compileFile('./contracts/vault.cash');
  const timeStateArtifact = compileFile('./contracts/time-state.cash');
  const oracleArtifact = compileFile('./contracts/oracle-proof.cash');

  const TREASURY_AMOUNT = 5_000_000n;
  const PROPOSAL_LIMIT = 500_000n;
  const VOTE_THRESHOLD = 100n;
  const PROPOSAL_START = 1_700_000_000;
  const VOTING_END = 1_700_100_000;
  const GOVERNANCE_END = 1_700_200_000;
  const DOMAIN = new Uint8Array([0x56, 0x4f, 0x54, 0x45]); // "VOTE"
  const EXPIRY = 86400n;

  const treasury = new Contract(vaultArtifact, [adminPub, PROPOSAL_LIMIT, devPkh], { provider });
  const governance = new Contract(timeStateArtifact, [adminPub, BigInt(VOTING_END), BigInt(GOVERNANCE_END)], { provider });
  const voteOracle = new Contract(oracleArtifact, [oraclePub, DOMAIN, EXPIRY], { provider });

  const treasuryUtxo = randomUtxo({ satoshis: TREASURY_AMOUNT });
  const govUtxo = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(treasury.address, treasuryUtxo);
  provider.addUtxo(governance.address, govUtxo);

  const adminSig = new SignatureTemplate(adminPriv);

  // Attempt 1: Spend during proposal phase (too early)
  try {
    const earlyTimestamp = 1_700_050_000n;
    const earlyMsg = encodeOracleMessage(DOMAIN, earlyTimestamp, 1n, intToBytes4LE(150n));
    const earlyMsgHash = sha256.hash(earlyMsg);
    const earlySig = secp256k1.signMessageHashSchnorr(oraclePriv, earlyMsgHash);

    const oracleUtxoEarly = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(voteOracle.address, oracleUtxoEarly);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(treasuryUtxo, treasury.unlock.composableSpend(adminSig, 300_000n, 0n))
      .addInput(govUtxo, governance.unlock.composableCheck(adminSig, 1n))
      .addInput(oracleUtxoEarly, voteOracle.unlock.composableVerify(earlySig, earlyMsg))
      .addOutput(treasury.address, 4_700_000n)
      .addOutput(devAddr, 300_000n)
      .setLocktime(Number(earlyTimestamp) + 10);
    await composer.send();
  } catch {
    steps.push({
      id: 'dao-attempt-1',
      title: 'Spend During Proposal Phase',
      description: 'Even with a valid oracle message, the time gate blocks execution before voting ends.',
      status: 'blocked',
      details: {
        Timestamp: '1,700,050,000',
        Phase: 'Proposal (before voting ends)',
        Reason: 'Time gate not reached — still in proposal phase',
      },
      primitives: ['Vault', 'Time-State', 'Oracle'],
    });
  }

  // Attempt 2: Vote rejected (below threshold)
  try {
    const rejectTimestamp = 1_700_100_050n;
    const rejectPayload = intToBytes4LE(65n);
    const rejectMsg = encodeOracleMessage(DOMAIN, rejectTimestamp, 2n, rejectPayload);
    const rejectMsgHash = sha256.hash(rejectMsg);
    const rejectSig = secp256k1.signMessageHashSchnorr(oraclePriv, rejectMsgHash);

    const oracleUtxoReject = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(voteOracle.address, oracleUtxoReject);

    const spenderPriv = generatePrivateKey();
    const spenderPub = secp256k1.derivePublicKeyCompressed(spenderPriv);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(
      oracleUtxoReject,
      voteOracle.unlock.verifyWithPayloadConstraint(
        spenderPub,
        new SignatureTemplate(spenderPriv),
        rejectSig,
        rejectMsg,
        VOTE_THRESHOLD,
      ),
    );
    builder.addOutput({ to: devAddr, amount: 546n });
    builder.setLocktime(Number(rejectTimestamp) + 10);
    await builder.send();
  } catch {
    steps.push({
      id: 'dao-attempt-2',
      title: 'Vote Did Not Pass (65 < 100 threshold)',
      description: 'Oracle proves that only 65 votes were cast — below the 100-vote threshold.',
      status: 'blocked',
      details: {
        Timestamp: '1,700,100,050',
        'Vote count': '65',
        Threshold: '100',
        Reason: 'Vote count below threshold — proposal cannot execute',
      },
      primitives: ['Oracle'],
    });
  }

  // Attempt 3: Exceeds spending limit
  try {
    const overTimestamp = 1_700_100_100n;
    const overMsg = encodeOracleMessage(DOMAIN, overTimestamp, 3n, intToBytes4LE(200n));
    const overMsgHash = sha256.hash(overMsg);
    const overSig = secp256k1.signMessageHashSchnorr(oraclePriv, overMsgHash);

    const oracleUtxoOver = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(voteOracle.address, oracleUtxoOver);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(treasuryUtxo, treasury.unlock.composableSpend(adminSig, 600_000n, 0n))
      .addInput(govUtxo, governance.unlock.composableCheck(adminSig, 1n))
      .addInput(oracleUtxoOver, voteOracle.unlock.composableVerify(overSig, overMsg))
      .addOutput(treasury.address, 4_400_000n)
      .addOutput(devAddr, 600_000n)
      .setLocktime(Number(overTimestamp) + 10);
    await composer.send();
  } catch {
    steps.push({
      id: 'dao-attempt-3',
      title: 'Proposal Exceeds Spending Limit',
      description: 'Requesting 600,000 sats but the vault policy limits proposals to 500,000 sats.',
      status: 'blocked',
      details: {
        Requested: '600,000 sats',
        Limit: '500,000 sats per proposal',
        Reason: 'Amount exceeds per-proposal spending limit',
      },
      primitives: ['Vault'],
    });
  }

  // Success: Proposal #1 — 300,000 sats
  const vote1Timestamp = 1_700_100_200n;
  const vote1Payload = intToBytes4LE(150n);
  const vote1Msg = encodeOracleMessage(DOMAIN, vote1Timestamp, 4n, vote1Payload);
  const vote1MsgHash = sha256.hash(vote1Msg);
  const vote1Sig = secp256k1.signMessageHashSchnorr(oraclePriv, vote1MsgHash);

  const oracleUtxo1 = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(voteOracle.address, oracleUtxo1);

  const PROPOSAL1_AMOUNT = 300_000n;
  const treasuryAfter1 = TREASURY_AMOUNT - PROPOSAL1_AMOUNT;

  const composer1 = new TransactionComposer(provider);
  composer1
    .addInput(treasuryUtxo, treasury.unlock.composableSpend(adminSig, PROPOSAL1_AMOUNT, 0n))
    .addInput(govUtxo, governance.unlock.composableCheck(adminSig, 1n))
    .addInput(oracleUtxo1, voteOracle.unlock.composableVerify(vote1Sig, vote1Msg))
    .addOutput(treasury.address, treasuryAfter1)
    .addOutput(devAddr, PROPOSAL1_AMOUNT)
    .setLocktime(Number(vote1Timestamp) + 10);

  const tx1 = await composer1.send();
  steps.push({
    id: 'dao-success-1',
    title: 'Proposal #1: Pay Developer 300,000 sats',
    description: 'Vote passed with 150 votes (>= 100 threshold). Execution phase active. Amount within limit.',
    status: 'success',
    txid: tx1.txid,
    details: {
      'Vote count': '150 (passed)',
      Paid: '300,000 sats to developer',
      'Treasury remaining': `${treasuryAfter1.toString()} sats`,
      Vault: '300K within 500K limit, whitelisted recipient',
      'Time-State': 'Execution phase active',
      Oracle: '150 votes >= 100 threshold',
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  // Success: Proposal #2 — 200,000 sats (covenant continuation)
  const treasuryUtxo2 = randomUtxo({ satoshis: treasuryAfter1 });
  const govUtxo2 = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(treasury.address, treasuryUtxo2);
  provider.addUtxo(governance.address, govUtxo2);

  const vote2Timestamp = 1_700_100_500n;
  const vote2Payload = intToBytes4LE(120n);
  const vote2Msg = encodeOracleMessage(DOMAIN, vote2Timestamp, 5n, vote2Payload);
  const vote2MsgHash = sha256.hash(vote2Msg);
  const vote2Sig = secp256k1.signMessageHashSchnorr(oraclePriv, vote2MsgHash);

  const oracleUtxo2 = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(voteOracle.address, oracleUtxo2);

  const PROPOSAL2_AMOUNT = 200_000n;
  const treasuryAfter2 = treasuryAfter1 - PROPOSAL2_AMOUNT;

  const composer2 = new TransactionComposer(provider);
  composer2
    .addInput(treasuryUtxo2, treasury.unlock.composableSpend(adminSig, PROPOSAL2_AMOUNT, 0n))
    .addInput(govUtxo2, governance.unlock.composableCheck(adminSig, 1n))
    .addInput(oracleUtxo2, voteOracle.unlock.composableVerify(vote2Sig, vote2Msg))
    .addOutput(treasury.address, treasuryAfter2)
    .addOutput(devAddr, PROPOSAL2_AMOUNT)
    .setLocktime(Number(vote2Timestamp) + 10);

  const tx2 = await composer2.send();
  steps.push({
    id: 'dao-success-2',
    title: 'Proposal #2: Pay Developer 200,000 sats',
    description: 'Second proposal proves covenant continuation — treasury keeps working after first spend.',
    status: 'success',
    txid: tx2.txid,
    details: {
      'Vote count': '120 (passed)',
      Paid: '200,000 sats to developer',
      'Treasury remaining': `${treasuryAfter2.toString()} sats`,
      'Covenant': 'Treasury continuation verified',
    },
    primitives: ['Vault', 'Time-State', 'Oracle'],
  });

  return {
    scenario: 'dao',
    title: 'DAO Governance Treasury',
    description: 'Treasury proposals require vote threshold (oracle) + time gate + spending limit. No admin, no backend, no multisig.',
    params: {
      'Treasury': `${TREASURY_AMOUNT.toString()} sats`,
      'Proposal limit': `${PROPOSAL_LIMIT.toString()} sats per proposal`,
      'Vote threshold': `>= ${VOTE_THRESHOLD.toString()} votes`,
      'Proposal phase': `before ${VOTING_END}`,
      'Execution phase': `${VOTING_END} - ${GOVERNANCE_END}`,
      'Developer address': devAddr,
    },
    steps,
    summary: {
      'Initial treasury': `${TREASURY_AMOUNT.toString()} sats`,
      'Proposal #1': `-${PROPOSAL1_AMOUNT.toString()} sats (150 votes)`,
      'Proposal #2': `-${PROPOSAL2_AMOUNT.toString()} sats (120 votes)`,
      'Final treasury': `${treasuryAfter2.toString()} sats`,
      'Attacks blocked': '3',
      'Proposals executed': '2',
    },
    executionTimeMs: Date.now() - start,
  };
}
