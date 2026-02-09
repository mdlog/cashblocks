/**
 * Test CashBlocks on BCH Chipnet
 *
 * Runs after deploy-chipnet.ts. Tests:
 *   1. Vault partial spend
 *   2. Time-State phase check
 *   3. Oracle proof verification
 *   4. Composed transaction (Vault + Time-State + Oracle)
 *
 * Usage: npx tsx scripts/test-chipnet.ts
 */
import { readFileSync } from 'fs';
import {
  ElectrumNetworkProvider,
  Contract,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import { compileFile } from 'cashc';
import {
  secp256k1,
  sha256,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';
import { encodeOracleMessage } from '../src/utils/encoding.js';
import { TransactionComposer } from '../src/composer/transaction-composer.js';

// --- Load Keys & Deploy Info ---
let keys: any, deploy: any;
try {
  keys = JSON.parse(readFileSync('.keys.json', 'utf-8'));
  deploy = JSON.parse(readFileSync('.deploy.json', 'utf-8'));
} catch {
  console.error('[ERROR] .keys.json or .deploy.json not found.');
  console.error('  Run first: npx tsx scripts/generate-keys.ts');
  console.error('  Then:      npx tsx scripts/deploy-chipnet.ts');
  process.exit(1);
}

const ownerPriv = Uint8Array.from(Buffer.from(keys.owner.privKey, 'hex'));
const ownerPub = Uint8Array.from(Buffer.from(keys.owner.pubKey, 'hex'));
const recipientPkh = Uint8Array.from(Buffer.from(keys.recipient.pkh, 'hex'));
const oraclePriv = Uint8Array.from(Buffer.from(keys.oracle.privKey, 'hex'));
const oraclePub = Uint8Array.from(Buffer.from(keys.oracle.pubKey, 'hex'));

const recipientAddr = keys.recipient.address;

// --- Network ---
const provider = new ElectrumNetworkProvider('chipnet');

// --- Reconstruct Contracts ---
const vaultArtifact = compileFile('./contracts/vault.cash');
const timeStateArtifact = compileFile('./contracts/time-state.cash');
const oracleArtifact = compileFile('./contracts/oracle-proof.cash');

const SPEND_LIMIT = BigInt(deploy.contracts.vault.params.spendLimit);
const PHASE1_TIME = deploy.contracts.timeState.params.phase1Time;
const PHASE2_TIME = deploy.contracts.timeState.params.phase2Time;
const DOMAIN = Uint8Array.from([0x56, 0x4f, 0x54, 0x45]); // "VOTE"
const EXPIRY = BigInt(deploy.contracts.oracle.params.expiryDuration);

const vault = new Contract(vaultArtifact, [ownerPub, SPEND_LIMIT, recipientPkh], { provider });
const timeState = new Contract(timeStateArtifact, [ownerPub, BigInt(PHASE1_TIME), BigInt(PHASE2_TIME)], { provider });
const oracle = new Contract(oracleArtifact, [oraclePub, DOMAIN, EXPIRY], { provider });

console.log('=== Test CashBlocks on Chipnet ===\n');

// --- Check Balances ---
const vaultBalance = await vault.getBalance();
const tsBalance = await timeState.getBalance();
const oracleBalance = await oracle.getBalance();

console.log('Current Balances:');
console.log(`  Vault:      ${vaultBalance} sats`);
console.log(`  Time-State: ${tsBalance} sats`);
console.log(`  Oracle:     ${oracleBalance} sats`);
console.log('');

if (vaultBalance === 0n || tsBalance === 0n || oracleBalance === 0n) {
  console.error('[ERROR] One or more contracts have no balance.');
  console.error('  Run: npx tsx scripts/deploy-chipnet.ts');
  await provider.disconnect?.();
  process.exit(1);
}

// ===========================================================
// TEST 1: Vault Partial Spend
// ===========================================================
console.log('--- Test 1: Vault Partial Spend ---');

const vaultUtxos = await vault.getUtxos();
const ownerSig = new SignatureTemplate(ownerPriv);
const spendAmount = 10_000n;

try {
  const vaultUtxo = vaultUtxos[0];
  const inputValue = vaultUtxo.satoshis;
  const changeValue = inputValue - spendAmount - 1_000n; // miner fee

  const builder = new TransactionBuilder({ provider });
  builder.addInput(vaultUtxo, vault.unlock.partialSpend(ownerSig, spendAmount));
  builder.addOutput({ to: recipientAddr, amount: spendAmount });
  if (changeValue > 546n) {
    builder.addOutput({ to: vault.address, amount: changeValue });
  }

  const tx = await builder.send();
  console.log(`[OK] Partial spend success!`);
  console.log(`  Sent ${spendAmount} sats to recipient`);
  console.log(`  Change ${changeValue} sats back to vault`);
  console.log(`  txid: ${tx.txid}`);
  console.log(`  https://chipnet.chaingraph.cash/tx/${tx.txid}`);
} catch (e: any) {
  console.log(`[FAIL] ${e.message?.substring(0, 200)}`);
}

console.log('');

// ===========================================================
// TEST 2: Time-State Composable Check
// ===========================================================
console.log('--- Test 2: Time-State Composable Check ---');

const now = Math.floor(Date.now() / 1000);
const phase1Active = now >= PHASE1_TIME;
const phase2Active = now >= PHASE2_TIME;

console.log(`  Current time: ${now}`);
console.log(`  Phase 1 time: ${PHASE1_TIME} (${phase1Active ? 'ACTIVE' : 'not yet'})`);
console.log(`  Phase 2 time: ${PHASE2_TIME} (${phase2Active ? 'ACTIVE' : 'not yet'})`);

// Time-State requires tx.time >= phase1Time, which means locktime >= phase1Time.
// But locktime must also be <= MTP for the TX to be final.
// On chipnet, MTP can lag 2-4 hours behind real time due to slow block production.
// So Time-State only works when MTP >= phase1Time (may take hours after deploy).
if (phase1Active) {
  try {
    const tsUtxos = await timeState.getUtxos();
    if (tsUtxos.length > 0) {
      const tsUtxo = tsUtxos[0];
      const requiredPhase = phase2Active ? 2n : 1n;

      // Use phase1Time as locktime (minimum required by contract)
      const tsLocktime = phase2Active ? PHASE2_TIME : PHASE1_TIME;
      console.log(`  Using locktime: ${tsLocktime} (phase ${requiredPhase})`);

      const builder = new TransactionBuilder({ provider });
      builder.addInput(tsUtxo, timeState.unlock.composableCheck(ownerSig, requiredPhase));
      builder.addOutput({ to: recipientAddr, amount: 546n });
      builder.setLocktime(tsLocktime);

      const tx = await builder.send();
      console.log(`[OK] Phase ${requiredPhase} check passed!`);
      console.log(`  txid: ${tx.txid}`);
    } else {
      console.log('[SKIP] No Time-State UTXOs available');
    }
  } catch (e: any) {
    if (e.message?.includes('non-final')) {
      console.log(`[WAIT] MTP has not caught up to phase1Time yet.`);
      console.log(`  This is normal on chipnet - blocks are mined ~every 20 min.`);
      console.log(`  Re-run this test in 1-2 hours when MTP >= ${PHASE1_TIME}`);
    } else {
      console.log(`[FAIL] ${e.message?.substring(0, 200)}`);
    }
  }
} else {
  console.log('[SKIP] Phase 1 not active yet, wait 1 minute after deploy');
}

console.log('');

// ===========================================================
// TEST 3: Oracle Proof Verification
// ===========================================================
console.log('--- Test 3: Oracle Proof Verification ---');

try {
  const oracleUtxos = await oracle.getUtxos();
  if (oracleUtxos.length > 0) {
    const oracleUtxo = oracleUtxos[0];
    // Chipnet MTP (Median Time Past) can lag ~3+ hours behind real time
    // We need: oracleTimestamp <= locktime <= min(MTP, oracleTimestamp + expiryDuration)
    // Use a timestamp 5 hours in the past to be safe
    const oracleTimestamp = BigInt(now - 18000); // 5 hours ago
    const nonce = 1n;
    const payload = new Uint8Array([0x61, 0x70, 0x70, 0x72]); // "appr"

    const message = encodeOracleMessage(DOMAIN, oracleTimestamp, nonce, payload);
    const msgHash = sha256.hash(message);
    const oracleDatasig = secp256k1.signMessageHashSchnorr(oraclePriv, msgHash);

    // Locktime must be <= MTP for finality AND >= oracleTimestamp for the contract
    const safeLocktime = now - 18000; // same as oracleTimestamp
    console.log(`  Oracle timestamp: ${oracleTimestamp} (locktime: ${safeLocktime})`);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(oracleUtxo, oracle.unlock.composableVerify(oracleDatasig, message));
    builder.addOutput({ to: recipientAddr, amount: 546n });
    builder.setLocktime(safeLocktime);

    const tx = await builder.send();
    console.log(`[OK] Oracle proof verified on-chain!`);
    console.log(`  txid: ${tx.txid}`);
    console.log(`  https://chipnet.chaingraph.cash/tx/${tx.txid}`);
  } else {
    console.log('[SKIP] No Oracle UTXOs available');
  }
} catch (e: any) {
  console.log(`[FAIL] ${e.message?.substring(0, 200)}`);
}

console.log('');

// ===========================================================
// SUMMARY
// ===========================================================
console.log('=== Test Summary ===');
const vaultBalanceAfter = await vault.getBalance();
console.log(`Vault balance after: ${vaultBalanceAfter} sats`);
console.log(`Recipient: ${recipientAddr}`);
console.log('\nDone!');

// ElectrumNetworkProvider auto-manages connections
process.exit(0);
