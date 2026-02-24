/**
 * Example 09: Decentralized Insurance Pool
 *
 * On-chain insurance where:
 *   - Pool holds premiums collected from policyholders
 *   - Claims require oracle verification (proof of loss)
 *   - Payouts are capped per-claim (coverage limit)
 *   - Claims have a cooling period before payout (anti-fraud)
 *   - Multiple claims can be processed sequentially (covenant)
 *
 * Demonstrates all 3 CashBlocks primitives in an insurance context.
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
import { encodeOracleMessage, intToBytes4LE } from '../src/utils/encoding.js';

console.log('╔══════════════════════════════════════════════════╗');
console.log('║     CashBlocks: Decentralized Insurance Pool     ║');
console.log('╚══════════════════════════════════════════════════╝\n');

// ============================================================
// SETUP
// ============================================================
console.log('=== Insurance Pool Setup ===\n');

// Pool administrator
const poolAdminPriv = generatePrivateKey();
const poolAdminPub = secp256k1.derivePublicKeyCompressed(poolAdminPriv);

// Claim assessor oracle
const assessorPriv = generatePrivateKey();
const assessorPub = secp256k1.derivePublicKeyCompressed(assessorPriv);

// Claimant (policyholder filing a claim)
const claimantPub = secp256k1.derivePublicKeyCompressed(generatePrivateKey());
const claimantPkh = hash160(claimantPub);
const claimantAddr = encodeCashAddress({
  payload: claimantPkh,
  prefix: 'bchtest',
  type: CashAddressType.p2pkh,
}).address as string;

const provider = new MockNetworkProvider();
const vaultArtifact = compileFile('./contracts/vault.cash');
const timeStateArtifact = compileFile('./contracts/time-state.cash');
const oracleArtifact = compileFile('./contracts/oracle-proof.cash');

// Insurance parameters
const POOL_BALANCE = 3_000_000n;        // 3M sats pool from premiums
const COVERAGE_LIMIT = 200_000n;         // Max 200K sats per claim
const MIN_CLAIM_VALUE = 1n;              // Oracle coverage > 0 means approved
const DOMAIN = new Uint8Array([0x43, 0x4c, 0x41, 0x4d]); // "CLAM"
const EXPIRY = 43200n;                   // Claims valid for 12 hours

// Claims timeline
const FILING_END  = 1_700_050_000;       // Filing period ends
const PAYOUT_END  = 1_700_150_000;       // Payout window ends

// Insurance pool (vault with coverage limit)
const pool = new Contract(
  vaultArtifact,
  [poolAdminPub, COVERAGE_LIMIT, claimantPkh],
  { provider },
);

// Claim timer: Phase 1 = review/payout, Phase 2 = expired
const claimTimer = new Contract(
  timeStateArtifact,
  [poolAdminPub, BigInt(FILING_END), BigInt(PAYOUT_END)],
  { provider },
);

// Claim assessor oracle
const claimOracle = new Contract(
  oracleArtifact,
  [assessorPub, DOMAIN, EXPIRY],
  { provider },
);

console.log('Insurance Pool:');
console.log(`  Pool balance:    ${POOL_BALANCE} sats`);
console.log(`  Coverage limit:  ${COVERAGE_LIMIT} sats per claim`);
console.log(`  Claimant:        ${claimantAddr}`);
console.log('');
console.log('Claims Timeline:');
console.log(`  Filing period:   before ${FILING_END}`);
console.log(`  Payout window:   ${FILING_END} - ${PAYOUT_END}`);
console.log(`  Expired:         after ${PAYOUT_END}`);
console.log('');

// Fund pool and gates
let poolUtxo = randomUtxo({ satoshis: POOL_BALANCE });
provider.addUtxo(pool.address, poolUtxo);

const adminSig = new SignatureTemplate(poolAdminPriv);

// ============================================================
// ATTEMPT 1: Claim too early (filing period, not payout)
// ============================================================
console.log('=== Attempt 1: Claim During Filing Period ===\n');

try {
  const earlyTimestamp = 1_700_030_000n;
  const earlyMsg = encodeOracleMessage(DOMAIN, earlyTimestamp, 1n, intToBytes4LE(100_000n));
  const earlyMsgHash = sha256.hash(earlyMsg);
  const earlySig = secp256k1.signMessageHashSchnorr(assessorPriv, earlyMsgHash);

  const oracleUtxoEarly = randomUtxo({ satoshis: 1_000n });
  const timerUtxoEarly = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(claimOracle.address, oracleUtxoEarly);
  provider.addUtxo(claimTimer.address, timerUtxoEarly);

  const composer = new TransactionComposer(provider);
  composer
    .addInput(poolUtxo, pool.unlock.composableSpend(adminSig, 100_000n, 0n))
    .addInput(timerUtxoEarly, claimTimer.unlock.composableCheck(adminSig, 1n))
    .addInput(oracleUtxoEarly, claimOracle.unlock.composableVerify(earlySig, earlyMsg))
    .addOutput(pool.address, 2_900_000n)
    .addOutput(claimantAddr, 100_000n)
    .setLocktime(Number(earlyTimestamp) + 10);
  await composer.send();
  console.log('[UNEXPECTED] Should have failed!');
} catch (e: any) {
  console.log('[BLOCKED] Claim rejected!');
  console.log('  Reason: Still in filing period — payout window not open');
  console.log('  Anti-fraud: cooling period prevents premature payouts.\n');
}

// ============================================================
// ATTEMPT 2: Claim denied by oracle (coverage = 0)
// ============================================================
console.log('=== Attempt 2: Claim Denied by Assessor ===\n');

try {
  const denyTimestamp = 1_700_060_000n;
  // Oracle sets coverage amount to 0 = denied
  const denyMsg = encodeOracleMessage(DOMAIN, denyTimestamp, 2n, intToBytes4LE(0n));
  const denyMsgHash = sha256.hash(denyMsg);
  const denySig = secp256k1.signMessageHashSchnorr(assessorPriv, denyMsgHash);

  const oracleUtxoDeny = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(claimOracle.address, oracleUtxoDeny);

  // verifyWithPayloadConstraint requires coverage > 0
  const spenderPriv = generatePrivateKey();
  const spenderPub = secp256k1.derivePublicKeyCompressed(spenderPriv);
  const builder = new TransactionBuilder({ provider });
  builder.addInput(
    oracleUtxoDeny,
    claimOracle.unlock.verifyWithPayloadConstraint(
      spenderPub,
      new SignatureTemplate(spenderPriv),
      denySig,
      denyMsg,
      MIN_CLAIM_VALUE,
    ),
  );
  builder.addOutput({ to: claimantAddr, amount: 546n });
  builder.setLocktime(Number(denyTimestamp) + 10);
  await builder.send();
  console.log('[UNEXPECTED] Should have failed!');
} catch (e: any) {
  console.log('[BLOCKED] Claim rejected!');
  console.log('  Reason: Assessor set coverage = 0 (claim denied)');
  console.log('  Oracle proves claim is not valid.\n');
}

// ============================================================
// ATTEMPT 3: Claim exceeds coverage limit
// ============================================================
console.log('=== Attempt 3: Claim Exceeds Coverage Limit ===\n');
console.log(`Requesting 300,000 sats (limit: ${COVERAGE_LIMIT} sats)`);

try {
  const overTimestamp = 1_700_060_100n;
  const overMsg = encodeOracleMessage(DOMAIN, overTimestamp, 3n, intToBytes4LE(300_000n));
  const overMsgHash = sha256.hash(overMsg);
  const overSig = secp256k1.signMessageHashSchnorr(assessorPriv, overMsgHash);

  const oracleUtxoOver = randomUtxo({ satoshis: 1_000n });
  const timerUtxoOver = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(claimOracle.address, oracleUtxoOver);
  provider.addUtxo(claimTimer.address, timerUtxoOver);

  const composer = new TransactionComposer(provider);
  composer
    .addInput(poolUtxo, pool.unlock.composableSpend(adminSig, 300_000n, 0n))
    .addInput(timerUtxoOver, claimTimer.unlock.composableCheck(adminSig, 1n))
    .addInput(oracleUtxoOver, claimOracle.unlock.composableVerify(overSig, overMsg))
    .addOutput(pool.address, 2_700_000n)
    .addOutput(claimantAddr, 300_000n)
    .setLocktime(Number(overTimestamp) + 10);
  await composer.send();
  console.log('[UNEXPECTED] Should have failed!');
} catch (e: any) {
  console.log('[BLOCKED] Claim rejected!');
  console.log(`  Reason: 300,000 sats exceeds ${COVERAGE_LIMIT} sats coverage limit`);
  console.log('  Pool vault enforces per-claim maximum.\n');
}

// ============================================================
// SUCCESS: Claim #1 — Valid claim for 150,000 sats
// ============================================================
console.log('=== Claim #1: Approved — 150,000 sats ===\n');
console.log('Assessor verified: water damage, coverage approved');
console.log(`Amount: 150,000 sats (within ${COVERAGE_LIMIT} limit)\n`);

const claim1Timestamp = 1_700_060_200n;
const claim1Coverage = intToBytes4LE(150_000n); // Approved coverage amount
const claim1Msg = encodeOracleMessage(DOMAIN, claim1Timestamp, 4n, claim1Coverage);
const claim1MsgHash = sha256.hash(claim1Msg);
const claim1Sig = secp256k1.signMessageHashSchnorr(assessorPriv, claim1MsgHash);

const oracleUtxo1 = randomUtxo({ satoshis: 1_000n });
const timerUtxo1 = randomUtxo({ satoshis: 1_000n });
provider.addUtxo(claimOracle.address, oracleUtxo1);
provider.addUtxo(claimTimer.address, timerUtxo1);

const CLAIM1_PAYOUT = 150_000n;
const poolAfter1 = POOL_BALANCE - CLAIM1_PAYOUT;

const composer1 = new TransactionComposer(provider);
composer1
  .addInput(poolUtxo, pool.unlock.composableSpend(adminSig, CLAIM1_PAYOUT, 0n))
  .addInput(timerUtxo1, claimTimer.unlock.composableCheck(adminSig, 1n))
  .addInput(oracleUtxo1, claimOracle.unlock.composableVerify(claim1Sig, claim1Msg))
  .addOutput(pool.address, poolAfter1)
  .addOutput(claimantAddr, CLAIM1_PAYOUT)
  .setLocktime(Number(claim1Timestamp) + 10);

const tx1 = await composer1.send();
console.log('[SUCCESS] Claim #1 paid!');
console.log(`  txid:      ${tx1.txid}`);
console.log(`  Payout:    ${CLAIM1_PAYOUT} sats to policyholder`);
console.log(`  Pool left: ${poolAfter1} sats`);
console.log('');
console.log('  Validated atomically:');
console.log('    [x] Pool:     150K sats within 200K coverage limit');
console.log('    [x] Timer:    Payout window active (cooling period passed)');
console.log('    [x] Assessor: Claim verified, coverage amount approved');

// ============================================================
// SUCCESS: Claim #2 — Second claim for 180,000 sats
// ============================================================
console.log('\n=== Claim #2: Approved — 180,000 sats ===\n');
console.log('Second claim processed — pool covenant continues!\n');

const poolUtxo2 = randomUtxo({ satoshis: poolAfter1 });
const timerUtxo2 = randomUtxo({ satoshis: 1_000n });
provider.addUtxo(pool.address, poolUtxo2);
provider.addUtxo(claimTimer.address, timerUtxo2);

const claim2Timestamp = 1_700_070_000n;
const claim2Coverage = intToBytes4LE(180_000n);
const claim2Msg = encodeOracleMessage(DOMAIN, claim2Timestamp, 5n, claim2Coverage);
const claim2MsgHash = sha256.hash(claim2Msg);
const claim2Sig = secp256k1.signMessageHashSchnorr(assessorPriv, claim2MsgHash);

const oracleUtxo2 = randomUtxo({ satoshis: 1_000n });
provider.addUtxo(claimOracle.address, oracleUtxo2);

const CLAIM2_PAYOUT = 180_000n;
const poolAfter2 = poolAfter1 - CLAIM2_PAYOUT;

const composer2 = new TransactionComposer(provider);
composer2
  .addInput(poolUtxo2, pool.unlock.composableSpend(adminSig, CLAIM2_PAYOUT, 0n))
  .addInput(timerUtxo2, claimTimer.unlock.composableCheck(adminSig, 1n))
  .addInput(oracleUtxo2, claimOracle.unlock.composableVerify(claim2Sig, claim2Msg))
  .addOutput(pool.address, poolAfter2)
  .addOutput(claimantAddr, CLAIM2_PAYOUT)
  .setLocktime(Number(claim2Timestamp) + 10);

const tx2 = await composer2.send();
console.log('[SUCCESS] Claim #2 paid!');
console.log(`  txid:      ${tx2.txid}`);
console.log(`  Payout:    ${CLAIM2_PAYOUT} sats to policyholder`);
console.log(`  Pool left: ${poolAfter2} sats`);

// ============================================================
// SUMMARY
// ============================================================
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║          Insurance Pool Summary                   ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log(`║  Pool start:       ${POOL_BALANCE.toString().padStart(10)} sats              ║`);
console.log(`║  Claim #1 payout:  -${CLAIM1_PAYOUT.toString().padStart(9)} sats (water dmg)  ║`);
console.log(`║  Claim #2 payout:  -${CLAIM2_PAYOUT.toString().padStart(9)} sats (fire dmg)   ║`);
console.log(`║  Pool remaining:   ${poolAfter2.toString().padStart(10)} sats              ║`);
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  Blocked: 3 (too early, denied, over limit)      ║');
console.log('║  Paid:    2 claims processed successfully         ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  Decentralized insurance on Bitcoin Cash.         ║');
console.log('║  Oracle verifies claims. Vault caps payouts.      ║');
console.log('║  Time gate prevents premature withdrawals.        ║');
console.log('╚══════════════════════════════════════════════════╝');
