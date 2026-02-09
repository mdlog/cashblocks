import { describe, it, expect } from 'vitest';
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
import { encodeOracleMessage, intToBytes4LE } from '../src/utils/encoding.js';

function makeKeypair() {
  const privKey = generatePrivateKey();
  const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
  return { privKey, pubKey };
}

function makeAddress(pubKey: Uint8Array) {
  const pkh = hash160(pubKey);
  return {
    pkh,
    address: encodeCashAddress({
      payload: pkh,
      prefix: 'bchtest',
      type: CashAddressType.p2pkh,
    }).address as string,
  };
}

function signMessage(privKey: Uint8Array, message: Uint8Array): Uint8Array {
  const msgHash = hash256(message);
  return secp256k1.signMessageHashSchnorr(privKey, msgHash);
}

function hash256(data: Uint8Array): Uint8Array {
  // double sha256 — use libauth's sha256
  // For simplicity, we'll use the Web Crypto approach
  // Actually libauth has sha256
  const { sha256: sha256Func } = require('@bitauth/libauth');
  throw new Error('Not needed — CashScript checkDataSig uses single sha256 internally');
}

// For checkDataSig, the oracle signs the raw message with Schnorr.
// CashScript's checkDataSig(datasig, msg, pubkey) checks:
//   schnorr_verify(datasig, sha256(msg), pubkey)
// So we need to sign sha256(message).
async function createDataSig(privKey: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const { sha256 } = await import('@bitauth/libauth');
  const msgHash = sha256.hash(message);
  return secp256k1.signMessageHashSchnorr(privKey, msgHash);
}

describe('Oracle Proof Primitive', () => {
  const artifact = compileFile('./contracts/oracle-proof.cash');
  const oracle = makeKeypair();
  const spender = makeKeypair();
  const recipient = makeKeypair();
  const recipientInfo = makeAddress(recipient.pubKey);

  const DOMAIN = new Uint8Array([0x56, 0x4f, 0x54, 0x45]); // "VOTE"
  const EXPIRY = 3600n;
  const TIMESTAMP = 1_700_100_000n;

  function createOracle(provider: MockNetworkProvider) {
    return new Contract(
      artifact,
      [oracle.pubKey, DOMAIN, EXPIRY],
      { provider },
    );
  }

  function buildOracleMessage(timestamp: bigint, nonce: bigint, payload: Uint8Array) {
    return encodeOracleMessage(DOMAIN, timestamp, nonce, payload);
  }

  // --- verifyAndSpend tests ---

  it('verifyAndSpend: valid oracle message', async () => {
    const provider = new MockNetworkProvider();
    const contract = createOracle(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.address, utxo);

    const message = buildOracleMessage(TIMESTAMP, 1n, new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    const oracleSig = await createDataSig(oracle.privKey, message);

    const spenderSig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyAndSpend(
      spender.pubKey, spenderSig, oracleSig, message,
    ));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });
    builder.setLocktime(Number(TIMESTAMP) + 100);

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('verifyAndSpend: rejects wrong oracle key', async () => {
    const provider = new MockNetworkProvider();
    const contract = createOracle(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.address, utxo);

    const fakeOracle = makeKeypair();
    const message = buildOracleMessage(TIMESTAMP, 1n, new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    const badSig = await createDataSig(fakeOracle.privKey, message);

    const spenderSig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyAndSpend(
      spender.pubKey, spenderSig, badSig, message,
    ));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });
    builder.setLocktime(Number(TIMESTAMP) + 100);

    await expect(builder.send()).rejects.toThrow();
  });

  it('verifyAndSpend: rejects wrong domain', async () => {
    const provider = new MockNetworkProvider();
    const contract = createOracle(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.address, utxo);

    const wrongDomain = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
    const message = encodeOracleMessage(wrongDomain, TIMESTAMP, 1n, new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    const oracleSig = await createDataSig(oracle.privKey, message);

    const spenderSig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyAndSpend(
      spender.pubKey, spenderSig, oracleSig, message,
    ));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });
    builder.setLocktime(Number(TIMESTAMP) + 100);

    await expect(builder.send()).rejects.toThrow();
  });

  it('verifyAndSpend: rejects expired message', async () => {
    const provider = new MockNetworkProvider();
    const contract = createOracle(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.address, utxo);

    // Timestamp is old, and locktime is way beyond expiry
    const oldTimestamp = 1_700_000_000n;
    const message = buildOracleMessage(oldTimestamp, 1n, new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    const oracleSig = await createDataSig(oracle.privKey, message);

    const spenderSig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyAndSpend(
      spender.pubKey, spenderSig, oracleSig, message,
    ));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });
    // locktime far beyond oldTimestamp + EXPIRY (3600)
    builder.setLocktime(Number(oldTimestamp) + 10_000);

    await expect(builder.send()).rejects.toThrow();
  });

  it('verifyAndSpend: rejects zero nonce', async () => {
    const provider = new MockNetworkProvider();
    const contract = createOracle(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.address, utxo);

    const message = buildOracleMessage(TIMESTAMP, 0n, new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    const oracleSig = await createDataSig(oracle.privKey, message);

    const spenderSig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyAndSpend(
      spender.pubKey, spenderSig, oracleSig, message,
    ));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });
    builder.setLocktime(Number(TIMESTAMP) + 100);

    await expect(builder.send()).rejects.toThrow();
  });

  // --- composableVerify tests ---

  it('composableVerify: valid oracle proof', async () => {
    const provider = new MockNetworkProvider();
    const contract = createOracle(provider);
    const utxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(contract.address, utxo);

    const message = buildOracleMessage(TIMESTAMP, 1n, new Uint8Array([0x01, 0x02, 0x03, 0x04]));
    const oracleSig = await createDataSig(oracle.privKey, message);

    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.composableVerify(oracleSig, message));
    builder.addOutput({ to: recipientInfo.address, amount: 546n });
    builder.setLocktime(Number(TIMESTAMP) + 100);

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  // --- verifyWithPayloadConstraint tests ---

  it('verifyWithPayloadConstraint: value meets minimum', async () => {
    const provider = new MockNetworkProvider();
    const contract = createOracle(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.address, utxo);

    // Payload: 4 bytes for value (1000 LE) + extra
    const valueBytes = intToBytes4LE(1000n);
    const payload = new Uint8Array([...valueBytes, 0x00, 0x00, 0x00, 0x00]);
    const message = buildOracleMessage(TIMESTAMP, 1n, payload);
    const oracleSig = await createDataSig(oracle.privKey, message);

    const spenderSig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyWithPayloadConstraint(
      spender.pubKey, spenderSig, oracleSig, message, 500n,
    ));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });
    builder.setLocktime(Number(TIMESTAMP) + 100);

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('verifyWithPayloadConstraint: rejects value below minimum', async () => {
    const provider = new MockNetworkProvider();
    const contract = createOracle(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.address, utxo);

    const valueBytes = intToBytes4LE(100n);
    const payload = new Uint8Array([...valueBytes, 0x00, 0x00, 0x00, 0x00]);
    const message = buildOracleMessage(TIMESTAMP, 1n, payload);
    const oracleSig = await createDataSig(oracle.privKey, message);

    const spenderSig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyWithPayloadConstraint(
      spender.pubKey, spenderSig, oracleSig, message, 500n,
    ));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });
    builder.setLocktime(Number(TIMESTAMP) + 100);

    await expect(builder.send()).rejects.toThrow();
  });
});
