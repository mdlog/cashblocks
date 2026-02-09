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
  sha256 as sha256Obj,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';
import { encodeOracleMessage, intToBytes4LE } from '../src/utils/encoding.js';
import { TransactionComposer } from '../src/composer/transaction-composer.js';

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

function createDataSig(privKey: Uint8Array, message: Uint8Array): Uint8Array {
  const msgHash = sha256Obj.hash(message);
  return secp256k1.signMessageHashSchnorr(privKey, msgHash);
}

describe('Transaction Composer', () => {
  const vaultArtifact = compileFile('./contracts/vault.cash');
  const timeStateArtifact = compileFile('./contracts/time-state.cash');
  const oracleArtifact = compileFile('./contracts/oracle-proof.cash');

  const owner = makeKeypair();
  const oracle = makeKeypair();
  const recipient = makeKeypair();
  const recipientInfo = makeAddress(recipient.pubKey);

  const DOMAIN = new Uint8Array([0x56, 0x4f, 0x54, 0x45]);
  const PHASE1_TIME = 1_700_100_000;
  const PHASE2_TIME = 1_700_200_000;
  const TIMESTAMP = 1_700_100_050n;
  const EXPIRY = 3600n;

  it('2-primitive composition: Vault + TimeState', async () => {
    const provider = new MockNetworkProvider();

    const vaultContract = new Contract(
      vaultArtifact,
      [owner.pubKey, 50_000n, recipientInfo.pkh],
      { provider },
    );
    const timeStateContract = new Contract(
      timeStateArtifact,
      [owner.pubKey, BigInt(PHASE1_TIME), BigInt(PHASE2_TIME)],
      { provider },
    );

    const vaultUtxo = randomUtxo({ satoshis: 1_000_000n });
    const tsUtxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(vaultContract.address, vaultUtxo);
    provider.addUtxo(timeStateContract.address, tsUtxo);

    const ownerSig = new SignatureTemplate(owner.privKey);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(vaultUtxo, vaultContract.unlock.composableSpend(ownerSig, 50_000n, 0n))
      .addInput(tsUtxo, timeStateContract.unlock.composableCheck(ownerSig, 1n))
      .addOutput(vaultContract.address, 950_000n) // vault continuation at index 0
      .addOutput(recipientInfo.address, 50_000n)  // payment
      .setLocktime(PHASE1_TIME + 100);

    const tx = await composer.send();
    expect(tx.txid).toBeDefined();
  });

  it('3-primitive composition: Vault + TimeState + Oracle (Conditional Treasury)', async () => {
    const provider = new MockNetworkProvider();

    const vaultContract = new Contract(
      vaultArtifact,
      [owner.pubKey, 50_000n, recipientInfo.pkh],
      { provider },
    );
    const timeStateContract = new Contract(
      timeStateArtifact,
      [owner.pubKey, BigInt(PHASE1_TIME), BigInt(PHASE2_TIME)],
      { provider },
    );
    const oracleContract = new Contract(
      oracleArtifact,
      [oracle.pubKey, DOMAIN, EXPIRY],
      { provider },
    );

    const vaultUtxo = randomUtxo({ satoshis: 1_000_000n });
    const tsUtxo = randomUtxo({ satoshis: 1_000n });
    const oracleUtxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(vaultContract.address, vaultUtxo);
    provider.addUtxo(timeStateContract.address, tsUtxo);
    provider.addUtxo(oracleContract.address, oracleUtxo);

    // Build oracle message & sig
    const message = encodeOracleMessage(
      DOMAIN, TIMESTAMP, 1n,
      new Uint8Array([0x01, 0x02, 0x03, 0x04]),
    );
    const oracleSig = createDataSig(oracle.privKey, message);
    const ownerSig = new SignatureTemplate(owner.privKey);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(vaultUtxo, vaultContract.unlock.composableSpend(ownerSig, 50_000n, 0n))
      .addInput(tsUtxo, timeStateContract.unlock.composableCheck(ownerSig, 1n))
      .addInput(oracleUtxo, oracleContract.unlock.composableVerify(oracleSig, message))
      .addOutput(vaultContract.address, 950_000n) // vault continuation at index 0
      .addOutput(recipientInfo.address, 50_000n)  // payment
      .setLocktime(Number(TIMESTAMP) + 50);

    const tx = await composer.send();
    expect(tx.txid).toBeDefined();
  });

  it('composition fails if one primitive rejects', async () => {
    const provider = new MockNetworkProvider();

    const vaultContract = new Contract(
      vaultArtifact,
      [owner.pubKey, 50_000n, recipientInfo.pkh],
      { provider },
    );
    const timeStateContract = new Contract(
      timeStateArtifact,
      [owner.pubKey, BigInt(PHASE1_TIME), BigInt(PHASE2_TIME)],
      { provider },
    );

    const vaultUtxo = randomUtxo({ satoshis: 1_000_000n });
    const tsUtxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(vaultContract.address, vaultUtxo);
    provider.addUtxo(timeStateContract.address, tsUtxo);

    const ownerSig = new SignatureTemplate(owner.privKey);

    // TimeState locked (Phase 0) — should cause entire TX to fail
    const composer = new TransactionComposer(provider);
    composer
      .addInput(vaultUtxo, vaultContract.unlock.composableSpend(ownerSig, 50_000n, 0n))
      .addInput(tsUtxo, timeStateContract.unlock.composableCheck(ownerSig, 1n))
      .addOutput(vaultContract.address, 950_000n)
      .addOutput(recipientInfo.address, 50_000n)
      .setLocktime(PHASE1_TIME - 1000); // Phase 0!

    await expect(composer.send()).rejects.toThrow();
  });

  it('composition fails if vault spend exceeds limit', async () => {
    const provider = new MockNetworkProvider();

    const vaultContract = new Contract(
      vaultArtifact,
      [owner.pubKey, 50_000n, recipientInfo.pkh],
      { provider },
    );
    const timeStateContract = new Contract(
      timeStateArtifact,
      [owner.pubKey, BigInt(PHASE1_TIME), BigInt(PHASE2_TIME)],
      { provider },
    );

    const vaultUtxo = randomUtxo({ satoshis: 1_000_000n });
    const tsUtxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(vaultContract.address, vaultUtxo);
    provider.addUtxo(timeStateContract.address, tsUtxo);

    const ownerSig = new SignatureTemplate(owner.privKey);

    // Vault spend amount exceeds limit
    const composer = new TransactionComposer(provider);
    composer
      .addInput(vaultUtxo, vaultContract.unlock.composableSpend(ownerSig, 100_000n, 0n))
      .addInput(tsUtxo, timeStateContract.unlock.composableCheck(ownerSig, 1n))
      .addOutput(vaultContract.address, 900_000n)
      .addOutput(recipientInfo.address, 100_000n)
      .setLocktime(PHASE1_TIME + 100);

    await expect(composer.send()).rejects.toThrow();
  });
});
