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

describe('Vault Primitive', () => {
  const artifact = compileFile('./contracts/vault.cash');
  const owner = makeKeypair();
  const recipient = makeKeypair();
  const recipientInfo = makeAddress(recipient.pubKey);
  const nonOwner = makeKeypair();

  function createVault(provider: MockNetworkProvider, spendLimit = 10_000n) {
    const contract = new Contract(
      artifact,
      [owner.pubKey, spendLimit, recipientInfo.pkh],
      { provider },
    );
    return contract;
  }

  // --- partialSpend tests ---

  it('partialSpend: valid spend within limit', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.partialSpend(sig, 5_000n));
    builder.addOutput({ to: recipientInfo.address, amount: 5_000n });
    builder.addOutput({ to: contract.address, amount: 94_000n });

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('partialSpend: spend exactly at limit', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.partialSpend(sig, 10_000n));
    builder.addOutput({ to: recipientInfo.address, amount: 10_000n });
    builder.addOutput({ to: contract.address, amount: 89_000n });

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('partialSpend: rejects spend exceeding limit', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.partialSpend(sig, 20_000n));
    builder.addOutput({ to: recipientInfo.address, amount: 20_000n });
    builder.addOutput({ to: contract.address, amount: 79_000n });

    await expect(builder.send()).rejects.toThrow();
  });

  it('partialSpend: rejects wrong signer', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(nonOwner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.partialSpend(sig, 5_000n));
    builder.addOutput({ to: recipientInfo.address, amount: 5_000n });
    builder.addOutput({ to: contract.address, amount: 94_000n });

    await expect(builder.send()).rejects.toThrow();
  });

  it('partialSpend: rejects wrong destination', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const wrongRecipient = makeKeypair();
    const wrongAddr = makeAddress(wrongRecipient.pubKey);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.partialSpend(sig, 5_000n));
    builder.addOutput({ to: wrongAddr.address, amount: 5_000n });
    builder.addOutput({ to: contract.address, amount: 94_000n });

    await expect(builder.send()).rejects.toThrow();
  });

  it('partialSpend: rejects broken covenant (no continuation)', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.partialSpend(sig, 5_000n));
    builder.addOutput({ to: recipientInfo.address, amount: 5_000n });
    // No continuation output — should fail

    await expect(builder.send()).rejects.toThrow();
  });

  it('partialSpend: rejects zero spend amount', () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    // SDK rejects 0 satoshi output at builder level
    expect(() => {
      const builder = new TransactionBuilder({ provider });
      builder.addInput(utxo, contract.unlock.partialSpend(sig, 0n));
      builder.addOutput({ to: recipientInfo.address, amount: 0n });
    }).toThrow();
  });

  // --- fullSpend tests ---

  it('fullSpend: valid when balance within limit', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.fullSpend(sig));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('fullSpend: rejects when balance exceeds limit', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.fullSpend(sig));
    builder.addOutput({ to: recipientInfo.address, amount: 99_000n });

    await expect(builder.send()).rejects.toThrow();
  });

  // --- composableSpend tests ---

  it('composableSpend: valid with correct continuation index', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    // Continuation at index 1
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.composableSpend(sig, 5_000n, 1n));
    builder.addOutput({ to: recipientInfo.address, amount: 5_000n });
    builder.addOutput({ to: contract.address, amount: 95_000n });

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('composableSpend: continuation at index 0', async () => {
    const provider = new MockNetworkProvider();
    const contract = createVault(provider);
    const utxo = randomUtxo({ satoshis: 100_000n });
    provider.addUtxo(contract.address, utxo);

    const sig = new SignatureTemplate(owner.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.composableSpend(sig, 5_000n, 0n));
    builder.addOutput({ to: contract.address, amount: 95_000n });
    builder.addOutput({ to: recipientInfo.address, amount: 5_000n });

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });
});
