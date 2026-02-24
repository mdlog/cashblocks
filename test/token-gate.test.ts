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
  hexToBin,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';
import { TokenGatePrimitive } from '../src/primitives/token-gate.js';
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

// 32-byte token category (hex string in wallet/display format as used by cashscript SDK)
const TOKEN_CATEGORY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
// tokenCategory opcode returns bytes in VM (unreversed) order, which is the reverse
// of the wallet/display format. Contract constructor params must match VM byte order.
const TOKEN_CATEGORY_BYTES = Uint8Array.from(hexToBin(TOKEN_CATEGORY).reverse());

const WRONG_CATEGORY = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

describe('TokenGate Primitive', () => {
  const artifact = compileFile('./contracts/token-gate.cash');
  const spender = makeKeypair();
  const recipient = makeKeypair();
  const recipientInfo = makeAddress(recipient.pubKey);

  function createTokenGate(provider: MockNetworkProvider, minAmount = 100n) {
    const contract = new Contract(
      artifact,
      [TOKEN_CATEGORY_BYTES, minAmount],
      { provider },
    );
    return contract;
  }

  function tokenUtxo(satoshis: bigint, tokenAmount: bigint, category = TOKEN_CATEGORY) {
    return {
      ...randomUtxo({ satoshis }),
      token: {
        amount: tokenAmount,
        category,
      },
    };
  }

  // --- verifyTokenAndSpend tests ---

  it('verifyTokenAndSpend: valid with sufficient tokens', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTokenGate(provider);
    const utxo = tokenUtxo(10_000n, 500n);
    provider.addUtxo(contract.tokenAddress, utxo);

    const sig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyTokenAndSpend(spender.pubKey, sig));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('verifyTokenAndSpend: valid with exact minimum tokens', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTokenGate(provider);
    const utxo = tokenUtxo(10_000n, 100n);
    provider.addUtxo(contract.tokenAddress, utxo);

    const sig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyTokenAndSpend(spender.pubKey, sig));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('verifyTokenAndSpend: rejects insufficient tokens', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTokenGate(provider);
    const utxo = tokenUtxo(10_000n, 50n);
    provider.addUtxo(contract.tokenAddress, utxo);

    const sig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyTokenAndSpend(spender.pubKey, sig));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });

    await expect(builder.send()).rejects.toThrow();
  });

  it('verifyTokenAndSpend: rejects wrong token category', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTokenGate(provider);
    const utxo = tokenUtxo(10_000n, 500n, WRONG_CATEGORY);
    provider.addUtxo(contract.tokenAddress, utxo);

    const sig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyTokenAndSpend(spender.pubKey, sig));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });

    await expect(builder.send()).rejects.toThrow();
  });

  it('verifyTokenAndSpend: rejects UTXO without tokens', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTokenGate(provider);
    const utxo = randomUtxo({ satoshis: 10_000n });
    provider.addUtxo(contract.tokenAddress, utxo);

    const sig = new SignatureTemplate(spender.privKey);
    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.verifyTokenAndSpend(spender.pubKey, sig));
    builder.addOutput({ to: recipientInfo.address, amount: 9_000n });

    await expect(builder.send()).rejects.toThrow();
  });

  // --- composableVerify tests ---

  it('composableVerify: valid with token continuation at index 0', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTokenGate(provider);
    const utxo = tokenUtxo(10_000n, 500n);
    provider.addUtxo(contract.tokenAddress, utxo);

    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.composableVerify(0n));
    builder.addOutput({
      to: contract.tokenAddress,
      amount: 9_000n,
      token: { amount: 500n, category: TOKEN_CATEGORY },
    });

    const tx = await builder.send();
    expect(tx.txid).toBeDefined();
  });

  it('composableVerify: rejects if tokens not preserved in continuation', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTokenGate(provider);
    const utxo = tokenUtxo(10_000n, 500n);
    provider.addUtxo(contract.tokenAddress, utxo);

    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.composableVerify(0n));
    // Continuation WITHOUT tokens — should fail
    builder.addOutput({ to: contract.tokenAddress, amount: 9_000n });

    await expect(builder.send()).rejects.toThrow();
  });

  it('composableVerify: rejects if fewer tokens in continuation', async () => {
    const provider = new MockNetworkProvider();
    const contract = createTokenGate(provider);
    const utxo = tokenUtxo(10_000n, 500n);
    provider.addUtxo(contract.tokenAddress, utxo);

    const builder = new TransactionBuilder({ provider });
    builder.addInput(utxo, contract.unlock.composableVerify(0n));
    builder.addOutput({
      to: contract.tokenAddress,
      amount: 9_000n,
      token: { amount: 200n, category: TOKEN_CATEGORY },
    });

    await expect(builder.send()).rejects.toThrow();
  });
});

describe('TokenGatePrimitive validation', () => {
  const provider = new MockNetworkProvider();

  it('rejects requiredCategory that is not 32 bytes', () => {
    expect(() => new TokenGatePrimitive(
      { requiredCategory: new Uint8Array(20), minTokenAmount: 100n },
      provider,
    )).toThrow(CashBlocksError);
  });

  it('rejects zero minTokenAmount', () => {
    expect(() => new TokenGatePrimitive(
      { requiredCategory: new Uint8Array(32), minTokenAmount: 0n },
      provider,
    )).toThrow(CashBlocksError);
  });
});
