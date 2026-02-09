/**
 * Example 04: Vault + Time-State Composition (Vesting)
 * Two primitives consumed in a single atomic transaction.
 * Vault holds funds with spending policy.
 * Time-State gates WHEN spending can begin.
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
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';
import { TransactionComposer } from '../src/composer/transaction-composer.js';

const ownerPriv = generatePrivateKey();
const ownerPub = secp256k1.derivePublicKeyCompressed(ownerPriv);
const recipientPub = secp256k1.derivePublicKeyCompressed(generatePrivateKey());
const recipientPkh = hash160(recipientPub);
const recipientAddr = encodeCashAddress({
  payload: recipientPkh,
  prefix: 'bchtest',
  type: CashAddressType.p2pkh,
}).address as string;

const provider = new MockNetworkProvider();
const vaultArtifact = compileFile('./contracts/vault.cash');
const timeStateArtifact = compileFile('./contracts/time-state.cash');

const PHASE1_TIME = 1_700_100_000;
const PHASE2_TIME = 1_700_200_000;
const SPEND_LIMIT = 50_000n;

const vault = new Contract(vaultArtifact, [ownerPub, SPEND_LIMIT, recipientPkh], { provider });
const timeState = new Contract(timeStateArtifact, [ownerPub, BigInt(PHASE1_TIME), BigInt(PHASE2_TIME)], { provider });

console.log('Vault address:', vault.address);
console.log('Time-State address:', timeState.address);
console.log(`Spend limit: ${SPEND_LIMIT} sats per TX`);
console.log(`Phase 1 (Restricted): starts at ${PHASE1_TIME}`);
console.log(`Phase 2 (Unrestricted): starts at ${PHASE2_TIME}\n`);

// Fund both primitives
const vaultUtxo = randomUtxo({ satoshis: 1_000_000n });
const tsUtxo = randomUtxo({ satoshis: 1_000n });
provider.addUtxo(vault.address, vaultUtxo);
provider.addUtxo(timeState.address, tsUtxo);
console.log('Funded vault: 1,000,000 sats');
console.log('Funded time-state: 1,000 sats (gate UTXO)\n');

// === Attempt during Phase 0 (should fail) ===
console.log('--- Phase 0: Attempt Vesting Withdrawal ---');
try {
  const ownerSig = new SignatureTemplate(ownerPriv);
  const composer = new TransactionComposer(provider);
  composer
    .addInput(vaultUtxo, vault.unlock.composableSpend(ownerSig, 50_000n, 0n))
    .addInput(tsUtxo, timeState.unlock.composableCheck(ownerSig, 1n))
    .addOutput(vault.address, 950_000n)
    .addOutput(recipientAddr, 50_000n)
    .setLocktime(PHASE1_TIME - 5000);
  await composer.send();
  console.log('ERROR: should not succeed');
} catch {
  console.log('Correctly blocked: vesting has not started yet');
}

// === Phase 1: First vesting withdrawal ===
console.log('\n--- Phase 1: First Vesting Withdrawal ---');
const ownerSig = new SignatureTemplate(ownerPriv);
const composer1 = new TransactionComposer(provider);
composer1
  .addInput(vaultUtxo, vault.unlock.composableSpend(ownerSig, 50_000n, 0n))
  .addInput(tsUtxo, timeState.unlock.composableCheck(ownerSig, 1n))
  .addOutput(vault.address, 950_000n)   // vault continuation at index 0
  .addOutput(recipientAddr, 50_000n)    // payment
  .setLocktime(PHASE1_TIME + 500);

const tx1 = await composer1.send();
console.log('TX sent! txid:', tx1.txid);
console.log('Withdrawn: 50,000 sats');
console.log('Vault remaining: 950,000 sats');
console.log('Both Vault policy AND Time-State phase validated atomically!');

console.log('\nDone!');
