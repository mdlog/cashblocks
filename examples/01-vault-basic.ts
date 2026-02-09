/**
 * Example 01: Vault Basic
 * Demonstrates creating a vault, partial spend, and full spend.
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

// Generate keys
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

// Setup
const provider = new MockNetworkProvider();
const artifact = compileFile('./contracts/vault.cash');
const spendLimit = 10_000n;

const contract = new Contract(artifact, [ownerPub, spendLimit, recipientPkh], { provider });
console.log('Vault address:', contract.address);

// Fund the vault with 100,000 sats
const utxo = randomUtxo({ satoshis: 100_000n });
provider.addUtxo(contract.address, utxo);
console.log('Funded vault with 100,000 sats');

// === Partial Spend ===
console.log('\n--- Partial Spend (5,000 sats) ---');
const ownerSig = new SignatureTemplate(ownerPriv);
const builder1 = new TransactionBuilder({ provider });
builder1.addInput(utxo, contract.unlock.partialSpend(ownerSig, 5_000n));
builder1.addOutput({ to: recipientAddr, amount: 5_000n });
builder1.addOutput({ to: contract.address, amount: 94_000n });

const tx1 = await builder1.send();
console.log('TX sent! txid:', tx1.txid);
console.log('Recipient received: 5,000 sats');
console.log('Vault continuation: 94,000 sats');

// === Full Spend (drain remaining small vault) ===
console.log('\n--- Full Spend (drain 9,000 sats) ---');
const smallUtxo = randomUtxo({ satoshis: 10_000n });
provider.addUtxo(contract.address, smallUtxo);

const builder2 = new TransactionBuilder({ provider });
builder2.addInput(smallUtxo, contract.unlock.fullSpend(ownerSig));
builder2.addOutput({ to: recipientAddr, amount: 9_000n });

const tx2 = await builder2.send();
console.log('TX sent! txid:', tx2.txid);
console.log('Vault fully drained to recipient');

console.log('\nDone!');
