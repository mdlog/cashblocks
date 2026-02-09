/**
 * Example 02: Time-State Basic
 * Demonstrates time-based phase transitions.
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

const ownerPriv = generatePrivateKey();
const ownerPub = secp256k1.derivePublicKeyCompressed(ownerPriv);
const recipientPriv = generatePrivateKey();
const recipientPub = secp256k1.derivePublicKeyCompressed(recipientPriv);
const recipientPkh = hash160(recipientPub);
const recipientAddr = encodeCashAddress({
  payload: recipientPkh,
  prefix: 'bchtest',
  type: CashAddressType.p2pkh,
}).address as string;

const provider = new MockNetworkProvider();
const artifact = compileFile('./contracts/time-state.cash');

const PHASE1_TIME = 1_700_100_000n;
const PHASE2_TIME = 1_700_200_000n;

const contract = new Contract(artifact, [ownerPub, PHASE1_TIME, PHASE2_TIME], { provider });
console.log('Time-State address:', contract.address);
console.log(`Phase 1 starts at: ${PHASE1_TIME} (Restricted)`);
console.log(`Phase 2 starts at: ${PHASE2_TIME} (Unrestricted)`);

// Fund
const utxo = randomUtxo({ satoshis: 100_000n });
provider.addUtxo(contract.address, utxo);
console.log('Funded with 100,000 sats\n');

// === Phase 0: Locked ===
console.log('--- Phase 0 (Locked) ---');
try {
  const builder = new TransactionBuilder({ provider });
  builder.addInput(utxo, contract.unlock.spendRestricted(new SignatureTemplate(ownerPriv), 10_000n));
  builder.addOutput({ to: contract.address, amount: 89_000n });
  builder.addOutput({ to: recipientAddr, amount: 10_000n });
  builder.setLocktime(1_700_000_000); // Before Phase 1
  await builder.send();
  console.log('ERROR: should not succeed in Phase 0');
} catch {
  console.log('Correctly rejected: funds are locked in Phase 0');
}

// === Phase 1: Restricted ===
console.log('\n--- Phase 1 (Restricted) ---');
const ownerSig = new SignatureTemplate(ownerPriv);
const builder1 = new TransactionBuilder({ provider });
builder1.addInput(utxo, contract.unlock.spendRestricted(ownerSig, 20_000n));
builder1.addOutput({ to: contract.address, amount: 79_000n }); // Continuation required
builder1.addOutput({ to: recipientAddr, amount: 20_000n });
builder1.setLocktime(Number(PHASE1_TIME) + 500);

const tx1 = await builder1.send();
console.log('Phase 1 spend succeeded! txid:', tx1.txid);
console.log('Spent: 20,000 sats | Continuation: 79,000 sats');

// === Phase 2: Unrestricted ===
console.log('\n--- Phase 2 (Unrestricted) ---');
const utxo2 = randomUtxo({ satoshis: 50_000n });
provider.addUtxo(contract.address, utxo2);

const builder2 = new TransactionBuilder({ provider });
builder2.addInput(utxo2, contract.unlock.spendUnrestricted(ownerSig));
builder2.addOutput({ to: recipientAddr, amount: 49_000n });
builder2.setLocktime(Number(PHASE2_TIME) + 500);

const tx2 = await builder2.send();
console.log('Phase 2 spend succeeded! txid:', tx2.txid);
console.log('Full drain: 49,000 sats to recipient (no continuation needed)');

console.log('\nDone!');
