/**
 * Example 03: Oracle Proof Basic
 * Demonstrates oracle signature verification on-chain.
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
import { encodeOracleMessage } from '../src/utils/encoding.js';

const oraclePriv = generatePrivateKey();
const oraclePub = secp256k1.derivePublicKeyCompressed(oraclePriv);
const spenderPriv = generatePrivateKey();
const spenderPub = secp256k1.derivePublicKeyCompressed(spenderPriv);
const recipientPriv = generatePrivateKey();
const recipientPub = secp256k1.derivePublicKeyCompressed(recipientPriv);
const recipientPkh = hash160(recipientPub);
const recipientAddr = encodeCashAddress({
  payload: recipientPkh,
  prefix: 'bchtest',
  type: CashAddressType.p2pkh,
}).address as string;

const provider = new MockNetworkProvider();
const artifact = compileFile('./contracts/oracle-proof.cash');

const DOMAIN = new Uint8Array([0x56, 0x4f, 0x54, 0x45]); // "VOTE"
const EXPIRY = 3600n; // 1 hour
const TIMESTAMP = 1_700_100_000n;

const contract = new Contract(artifact, [oraclePub, DOMAIN, EXPIRY], { provider });
console.log('Oracle Proof address:', contract.address);
console.log(`Domain: VOTE (0x564f5445)`);
console.log(`Expiry duration: ${EXPIRY} seconds\n`);

// Fund the oracle proof UTXO
const utxo = randomUtxo({ satoshis: 10_000n });
provider.addUtxo(contract.address, utxo);

// === Oracle signs a message off-chain ===
console.log('--- Oracle Signs Message ---');
const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]); // arbitrary data
const message = encodeOracleMessage(DOMAIN, TIMESTAMP, 1n, payload);
console.log('Message bytes:', Buffer.from(message).toString('hex'));

// checkDataSig verifies: schnorr_verify(sig, sha256(msg), pubkey)
const msgHash = sha256.hash(message);
const oracleSig = secp256k1.signMessageHashSchnorr(oraclePriv, msgHash);
console.log('Oracle signature created (Schnorr)');

// === Verify and Spend ===
console.log('\n--- Verify and Spend ---');
const spenderSig = new SignatureTemplate(spenderPriv);
const builder = new TransactionBuilder({ provider });
builder.addInput(utxo, contract.unlock.verifyAndSpend(spenderPub, spenderSig, oracleSig, message));
builder.addOutput({ to: recipientAddr, amount: 9_000n });
builder.setLocktime(Number(TIMESTAMP) + 100);

const tx = await builder.send();
console.log('TX sent! txid:', tx.txid);
console.log('Oracle proof verified on-chain!');

// === Expired message fails ===
console.log('\n--- Expired Message Test ---');
const utxo2 = randomUtxo({ satoshis: 10_000n });
provider.addUtxo(contract.address, utxo2);

try {
  const builder2 = new TransactionBuilder({ provider });
  builder2.addInput(utxo2, contract.unlock.verifyAndSpend(spenderPub, spenderSig, oracleSig, message));
  builder2.addOutput({ to: recipientAddr, amount: 9_000n });
  builder2.setLocktime(Number(TIMESTAMP) + 10_000); // Way past expiry
  await builder2.send();
  console.log('ERROR: should have failed');
} catch {
  console.log('Correctly rejected: oracle message has expired');
}

console.log('\nDone!');
