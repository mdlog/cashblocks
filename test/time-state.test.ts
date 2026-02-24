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
import { TimeStatePrimitive } from '../src/primitives/time-state.js';
import { CashBlocksError } from '../src/utils/errors.js';

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

describe('Time-State Primitive', () => {
  const artifact = compileFile('./contracts/time-state.cash');
  const owner = makeKeypair();
  const recipient = makeKeypair();
  const recipientInfo = makeAddress(recipient.pubKey);

  const PHASE1_TIME = 1_700_100_000;
  const PHASE2_TIME = 1_700_200_000;

  function createTimeState(provider: MockNetworkProvider) {
    return new Contract(
      artifact,
      [owner.pubKey, BigInt(PHASE1_TIME), BigInt(PHASE2_TIME)],
      { provider },
    );
  }

  // --- Phase 0 (Locked) ---

  it('Phase 0: spendRestricted fails before phase1Time', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.spendRestricted(sig, 10_000n));
    builder.addOutput({ to: contract.address, amount: 89_000n });
    builder.addOutput({ to: recipientInfo.address, amount: 10_000n });
    // Locktime in Phase 0
    builder.setLocktime(PHASE1_TIME - 1000);

    await expect(builder.send()).rejects.toThrow();
  });

  it('Phase 0: spendUnrestricted fails before phase2Time', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.spendUnrestricted(sig));
    builder.addOutput({ to: recipientInfo.address, amount: 99_000n });
    builder.setLocktime(PHASE1_TIME - 1000);

    await expect(builder.send()).rejects.toThrow();
  });

  // --- Phase 1 (Restricted) ---

  it('Phase 1: spendRestricted succeeds with continuation', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.spendRestricted(sig, 10_000n));
    builder.addOutput({ to: contract.address, amount: 89_000n });
    builder.addOutput({ to: recipientInfo.address, amount: 10_000n });
    builder.setLocktime(PHASE1_TIME + 100);

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('Phase 1: spendRestricted fails without continuation (must leave funds)', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.spendRestricted(sig, 9_000n));
    // No continuation — tries to drain in Phase 1
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });
    builder.setLocktime(PHASE1_TIME + 100);

    await expect(builder.send()).rejects.toThrow();
  });

  it('Phase 1: spendUnrestricted fails during Phase 1', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.spendUnrestricted(sig));
    builder.addOutput({ to: recipientInfo.address, amount: 99_000n });
    builder.setLocktime(PHASE1_TIME + 100);

    await expect(builder.send()).rejects.toThrow();
  });

  // --- Phase 2 (Unrestricted) ---

  it('Phase 2: spendUnrestricted succeeds', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.spendUnrestricted(sig));
    builder.addOutput({ to: recipientInfo.address, amount: 99_000n });
    builder.setLocktime(PHASE2_TIME + 100);

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('Phase 2: owner can drain all funds', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 50_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.spendUnrestricted(sig));
    builder.addOutput({ to: recipientInfo.address, amount: 49_000n });
    builder.setLocktime(PHASE2_TIME + 1000);

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  // --- composableCheck ---

  it('composableCheck: Phase 1 valid', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.composableCheck(sig, 1n));
    builder.addOutput({ to: recipientInfo.address, amount: 546n });
    builder.setLocktime(PHASE1_TIME + 100);

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('composableCheck: Phase 2 valid', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.composableCheck(sig, 2n));
    builder.addOutput({ to: recipientInfo.address, amount: 546n });
    builder.setLocktime(PHASE2_TIME + 100);

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('composableCheck: Phase 0 rejected', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTimeState(provider);
    const utxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.composableCheck(sig, 1n));
    builder.addOutput({ to: recipientInfo.address, amount: 546n });
    builder.setLocktime(PHASE1_TIME - 1000);

    await expect(builder.send()).rejects.toThrow();
  });
});

describe('TimeStatePrimitive validation', () => {
  const provider = new MockNetworkProvider();

  it('rejects phase2Time equal to phase1Time', () => {
    expect(() => new TimeStatePrimitive(
      { ownerPk: new Uint8Array(33), phase1Time: 1000n, phase2Time: 1000n },
      provider,
    )).toThrow(CashBlocksError);
  });

  it('rejects phase2Time less than phase1Time', () => {
    expect(() => new TimeStatePrimitive(
      { ownerPk: new Uint8Array(33), phase1Time: 2000n, phase2Time: 1000n },
      provider,
    )).toThrow(CashBlocksError);
  });

  it('rejects zero phase1Time', () => {
    expect(() => new TimeStatePrimitive(
      { ownerPk: new Uint8Array(33), phase1Time: 0n, phase2Time: 1000n },
      provider,
    )).toThrow(CashBlocksError);
  });

  it('rejects ownerPk that is not 33 bytes', () => {
    expect(() => new TimeStatePrimitive(
      { ownerPk: new Uint8Array(65), phase1Time: 1000n, phase2Time: 2000n },
      provider,
    )).toThrow(CashBlocksError);
  });
});
