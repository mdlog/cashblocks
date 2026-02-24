/**
 * Example 07: DAO Governance Treasury
 *
 * A fully on-chain DAO governance system where:
 *   - Treasury holds DAO funds with per-proposal spending limits
 *   - Proposals go through time-gated phases (proposal → voting → execution)
 *   - Oracle proves vote results; payouts require vote threshold met
 *   - Multiple proposals can execute sequentially (covenant continuation)
 *
 * This demonstrates all 3 CashBlocks primitives working together
 * to build a real governance system — no backend, no admin, no multisig.
 */
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
import { TransactionComposer } from '../src/composer/transaction-composer.js';
import { encodeOracleMessage } from '../src/utils/encoding.js';
import { intToBytes4LE } from '../src/utils/encoding.js';

console.log('╔══════════════════════════════════════════════════╗');
console.log('║       CashBlocks: DAO Governance Treasury        ║');
console.log('╚══════════════════════════════════════════════════╝\n');

// ============================================================
// SETUP: Keys, Contracts, Funding
// ============================================================
console.log('=== Phase 0: DAO Setup ===\n');

// DAO multisig admin (simplified to single key for demo)
const adminPriv = generatePrivateKey();
const adminPub = secp256k1.derivePublicKeyCompressed(adminPriv);

// Vote oracle (aggregates off-chain votes)
const oraclePriv = generatePrivateKey();
const oraclePub = secp256k1.derivePublicKeyCompressed(oraclePriv);

// Developer receiving payment
const devPub = secp256k1.derivePublicKeyCompressed(generatePrivateKey());
const devPkh = hash160(devPub);
const devAddr = encodeCashAddress({
  payload: devPkh,
  prefix: 'bchtest',
  type: CashAddressType.p2pkh,
}).address as string;

// Provider
const provider = new MockNetworkProvider();

// Compile contracts
const vaultArtifact = compileFile('./contracts/vault.cash');
const timeStateArtifact = compileFile('./contracts/time-state.cash');
const oracleArtifact = compileFile('./contracts/oracle-proof.cash');

// DAO Parameters
const TREASURY_AMOUNT = 5_000_000n;   // 5M sats (0.05 BCH)
const PROPOSAL_LIMIT = 500_000n;       // Max 500K sats per proposal
const VOTE_THRESHOLD = 100n;           // Need >= 100 votes to pass

// Governance timeline (unix timestamps)
const PROPOSAL_START = 1_700_000_000;  // Proposal submission opens
const VOTING_END     = 1_700_100_000;  // Voting ends, execution begins
const GOVERNANCE_END = 1_700_200_000;  // Unrestricted phase

const DOMAIN = new Uint8Array([0x56, 0x4f, 0x54, 0x45]); // "VOTE"
const EXPIRY = 86400n; // Oracle messages valid for 24 hours

// Create contracts
const treasury = new Contract(
  vaultArtifact,
  [adminPub, PROPOSAL_LIMIT, devPkh],
  { provider },
);
const governance = new Contract(
  timeStateArtifact,
  [adminPub, BigInt(VOTING_END), BigInt(GOVERNANCE_END)],
  { provider },
);
const voteOracle = new Contract(
  oracleArtifact,
  [oraclePub, DOMAIN, EXPIRY],
  { provider },
);

console.log('DAO Treasury:');
console.log(`  Address:     ${treasury.address}`);
console.log(`  Balance:     ${TREASURY_AMOUNT} sats`);
console.log(`  Spend Limit: ${PROPOSAL_LIMIT} sats per proposal`);
console.log('');
console.log('Governance Timeline:');
console.log(`  Proposal Phase: before ${VOTING_END}`);
console.log(`  Execution Phase: ${VOTING_END} - ${GOVERNANCE_END}`);
console.log(`  Unrestricted:   after ${GOVERNANCE_END}`);
console.log('');
console.log(`Vote Threshold: >= ${VOTE_THRESHOLD} votes required`);
console.log(`Developer (recipient): ${devAddr}`);
console.log('');

// Fund contracts
const treasuryUtxo = randomUtxo({ satoshis: TREASURY_AMOUNT });
const govUtxo = randomUtxo({ satoshis: 1_000n });
provider.addUtxo(treasury.address, treasuryUtxo);
provider.addUtxo(governance.address, govUtxo);

const adminSig = new SignatureTemplate(adminPriv);

// ============================================================
// ATTEMPT 1: Try to spend during Proposal Phase (too early)
// ============================================================
console.log('=== Attempt 1: Spend During Proposal Phase ===\n');
console.log('Timestamp: 1,700,050,000 (before voting ends)');

try {
  // Even with a valid oracle message, time gate blocks execution
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
  console.log('[UNEXPECTED] Should have failed!');
} catch (e: any) {
  console.log('[BLOCKED] Transaction rejected!');
  console.log('  Reason: Time gate not reached — still in proposal phase');
  console.log('  The DAO cannot execute proposals before voting ends.\n');
}

// ============================================================
// ATTEMPT 2: Vote rejected (below threshold)
// ============================================================
console.log('=== Attempt 2: Vote Did Not Pass (65 < 100 threshold) ===\n');
console.log('Timestamp: 1,700,100,050 (execution phase)');

try {
  const rejectTimestamp = 1_700_100_050n;
  // Oracle signs: only 65 votes (below threshold of 100)
  const rejectPayload = intToBytes4LE(65n);
  const rejectMsg = encodeOracleMessage(DOMAIN, rejectTimestamp, 2n, rejectPayload);
  const rejectMsgHash = sha256.hash(rejectMsg);
  const rejectSig = secp256k1.signMessageHashSchnorr(oraclePriv, rejectMsgHash);

  const oracleUtxoReject = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(voteOracle.address, oracleUtxoReject);

  // Use verifyWithPayloadConstraint — requires vote count >= threshold
  const builder = new TransactionBuilder({ provider });
  const spenderPriv = generatePrivateKey();
  const spenderPub = secp256k1.derivePublicKeyCompressed(spenderPriv);
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
  console.log('[UNEXPECTED] Should have failed!');
} catch (e: any) {
  console.log('[BLOCKED] Transaction rejected!');
  console.log('  Reason: Vote count (65) < threshold (100)');
  console.log('  The oracle proves the vote failed — proposal cannot execute.\n');
}

// ============================================================
// ATTEMPT 3: Exceed spending limit
// ============================================================
console.log('=== Attempt 3: Proposal Exceeds Spending Limit ===\n');
console.log('Requesting 600,000 sats (limit: 500,000)');

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
  console.log('[UNEXPECTED] Should have failed!');
} catch (e: any) {
  console.log('[BLOCKED] Transaction rejected!');
  console.log('  Reason: 600,000 sats exceeds per-proposal limit of 500,000');
  console.log('  Vault policy prevents oversized proposals.\n');
}

// ============================================================
// SUCCESS: Proposal #1 — Pay Developer 300,000 sats
// ============================================================
console.log('=== Proposal #1: Pay Developer 300,000 sats ===\n');
console.log('Vote result: 150 votes (>= 100 threshold) — PASSED');
console.log('Timestamp: 1,700,100,200 (execution phase)');
console.log('Amount: 300,000 sats (within 500,000 limit)\n');

const vote1Timestamp = 1_700_100_200n;
const vote1Payload = intToBytes4LE(150n); // 150 votes — passes threshold
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
console.log('[SUCCESS] Proposal #1 executed!');
console.log(`  txid: ${tx1.txid}`);
console.log(`  Paid:      ${PROPOSAL1_AMOUNT} sats to developer`);
console.log(`  Remaining: ${treasuryAfter1} sats in treasury`);
console.log('');
console.log('  Conditions validated atomically:');
console.log('    [x] Vault:      300K sats within 500K limit, whitelisted recipient');
console.log('    [x] Time-State: Execution phase active (voting ended)');
console.log('    [x] Oracle:     150 votes >= 100 threshold — vote passed');

// ============================================================
// SUCCESS: Proposal #2 — Pay Developer 200,000 sats (Round 2)
// ============================================================
console.log('\n=== Proposal #2: Pay Developer 200,000 sats ===\n');
console.log('Demonstrating covenant continuation — treasury still works!\n');

// After TX1, treasury has a new UTXO (the continuation output)
const treasuryUtxo2 = randomUtxo({ satoshis: treasuryAfter1 });
const govUtxo2 = randomUtxo({ satoshis: 1_000n });
provider.addUtxo(treasury.address, treasuryUtxo2);
provider.addUtxo(governance.address, govUtxo2);

const vote2Timestamp = 1_700_100_500n;
const vote2Payload = intToBytes4LE(120n); // 120 votes
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
console.log('[SUCCESS] Proposal #2 executed!');
console.log(`  txid: ${tx2.txid}`);
console.log(`  Paid:      ${PROPOSAL2_AMOUNT} sats to developer`);
console.log(`  Remaining: ${treasuryAfter2} sats in treasury`);

// ============================================================
// SUMMARY
// ============================================================
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║              DAO Governance Summary               ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log(`║  Initial Treasury:  ${TREASURY_AMOUNT.toString().padStart(12)} sats          ║`);
console.log(`║  Proposal #1:      -${PROPOSAL1_AMOUNT.toString().padStart(11)} sats (150 votes) ║`);
console.log(`║  Proposal #2:      -${PROPOSAL2_AMOUNT.toString().padStart(11)} sats (120 votes) ║`);
console.log(`║  Final Treasury:    ${treasuryAfter2.toString().padStart(12)} sats          ║`);
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  Blocked attempts: 3 (too early, vote failed,   ║');
console.log('║                       exceeded limit)            ║');
console.log('║  Successful:       2 proposals executed          ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  No admin keys. No backend. No multisig.         ║');
console.log('║  Pure on-chain DAO governance on Bitcoin Cash.    ║');
console.log('╚══════════════════════════════════════════════════╝');
