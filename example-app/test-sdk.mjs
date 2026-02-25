/**
 * CashBlocks SDK Verification Test
 *
 * Tests all 4 primitives + composer + v0.3.0 utilities from the npm package.
 * Run: node test-sdk.mjs
 */
import {
  VaultPrimitive,
  TimeStatePrimitive,
  OracleProofPrimitive,
  TokenGatePrimitive,
  TransactionComposer,
  createProvider,
  encodeOracleMessage,
  intToBytes4LE,
  TimePhase,
  // v0.3.0 exports
  domainFromString,
  generateNonce,
  addressToPkh,
  pkhToAddress,
  predictChangeValue,
  categoryToVMBytes,
  DUST_LIMIT,
  HARDCODED_FEE,
  CashBlocksError,
} from 'cashblocks';
import {
  MockNetworkProvider,
  randomUtxo,
  SignatureTemplate,
} from 'cashscript';
import {
  secp256k1,
  generatePrivateKey,
  hash160,
  sha256,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \u2717 ${name}: ${e.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \u2717 ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// === Setup keys ===
const ownerPriv = generatePrivateKey();
const ownerPub = secp256k1.derivePublicKeyCompressed(ownerPriv);
const recipientPub = secp256k1.derivePublicKeyCompressed(generatePrivateKey());
const recipientPkh = hash160(recipientPub);
const oraclePriv = generatePrivateKey();
const oraclePub = secp256k1.derivePublicKeyCompressed(oraclePriv);

const provider = new MockNetworkProvider();

console.log('\n=== CashBlocks SDK Test (v0.3.0) ===\n');

// --- 1. Imports ---
console.log('1. Core Imports');
test('VaultPrimitive imported', () => assert(typeof VaultPrimitive === 'function'));
test('TimeStatePrimitive imported', () => assert(typeof TimeStatePrimitive === 'function'));
test('OracleProofPrimitive imported', () => assert(typeof OracleProofPrimitive === 'function'));
test('TokenGatePrimitive imported', () => assert(typeof TokenGatePrimitive === 'function'));
test('TransactionComposer imported', () => assert(typeof TransactionComposer === 'function'));
test('createProvider imported', () => assert(typeof createProvider === 'function'));
test('encodeOracleMessage imported', () => assert(typeof encodeOracleMessage === 'function'));
test('intToBytes4LE imported', () => assert(typeof intToBytes4LE === 'function'));
test('TimePhase enum imported', () => assert(TimePhase.LOCKED === 0 && TimePhase.RESTRICTED === 1 && TimePhase.UNRESTRICTED === 2));

// --- 2. v0.3.0 Imports ---
console.log('\n2. v0.3.0 Imports');
test('domainFromString imported', () => assert(typeof domainFromString === 'function'));
test('generateNonce imported', () => assert(typeof generateNonce === 'function'));
test('addressToPkh imported', () => assert(typeof addressToPkh === 'function'));
test('pkhToAddress imported', () => assert(typeof pkhToAddress === 'function'));
test('predictChangeValue imported', () => assert(typeof predictChangeValue === 'function'));
test('categoryToVMBytes imported', () => assert(typeof categoryToVMBytes === 'function'));
test('DUST_LIMIT is 546n', () => assert(DUST_LIMIT === 546n));
test('HARDCODED_FEE is 1000n', () => assert(HARDCODED_FEE === 1000n));
test('CashBlocksError imported', () => assert(typeof CashBlocksError === 'function'));

// --- 3. Vault Primitive ---
console.log('\n3. Vault Primitive');
const vault = new VaultPrimitive({
  ownerPk: ownerPub,
  spendLimit: 100_000n,
  whitelistHash: recipientPkh,
}, provider);

test('Vault has address', () => assert(vault.address.startsWith('bchtest:')));
test('Vault has contract', () => assert(vault.contract !== undefined));
test('Vault rejects bad ownerPk', () => {
  try {
    new VaultPrimitive({ ownerPk: new Uint8Array(32), spendLimit: 100n, whitelistHash: recipientPkh }, provider);
    assert(false, 'Should have thrown');
  } catch (e) {
    assert(e instanceof CashBlocksError, 'Expected CashBlocksError');
  }
});

// --- 4. Time-State Primitive ---
console.log('\n4. Time-State Primitive');
const timeState = new TimeStatePrimitive({
  ownerPk: ownerPub,
  phase1Time: 1_700_100_000n,
  phase2Time: 1_700_200_000n,
}, provider);

test('TimeState has address', () => assert(timeState.address.startsWith('bchtest:')));
test('getPhaseAtTime LOCKED', () => assert(timeState.getPhaseAtTime(1_700_000_000n) === TimePhase.LOCKED));
test('getPhaseAtTime RESTRICTED', () => assert(timeState.getPhaseAtTime(1_700_150_000n) === TimePhase.RESTRICTED));
test('getPhaseAtTime UNRESTRICTED', () => assert(timeState.getPhaseAtTime(1_700_300_000n) === TimePhase.UNRESTRICTED));
test('TimeState rejects phase2 <= phase1', () => {
  try {
    new TimeStatePrimitive({ ownerPk: ownerPub, phase1Time: 100n, phase2Time: 100n }, provider);
    assert(false, 'Should have thrown');
  } catch (e) {
    assert(e instanceof CashBlocksError, 'Expected CashBlocksError');
  }
});

// --- 5. TokenGate Primitive (CashTokens) ---
console.log('\n5. TokenGate Primitive (CashTokens)');
const TOKEN_CATEGORY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const tokenGate = new TokenGatePrimitive({
  requiredCategory: categoryToVMBytes(TOKEN_CATEGORY),
  minTokenAmount: 100n,
}, provider);

test('TokenGate has address', () => assert(tokenGate.address.startsWith('bchtest:')));
test('TokenGate has tokenAddress', () => assert(tokenGate.tokenAddress.startsWith('bchtest:')));
test('categoryToVMBytes returns 32-byte Uint8Array', () => {
  const bytes = categoryToVMBytes(TOKEN_CATEGORY);
  assert(bytes instanceof Uint8Array);
  assert(bytes.length === 32);
});
test('categoryToVMBytes matches TokenGatePrimitive.categoryToVMBytes', () => {
  const a = categoryToVMBytes(TOKEN_CATEGORY);
  const b = TokenGatePrimitive.categoryToVMBytes(TOKEN_CATEGORY);
  assert(a.length === b.length && a.every((v, i) => v === b[i]));
});

// --- 6. Oracle Proof Primitive ---
console.log('\n6. Oracle Proof Primitive');
const DOMAIN = domainFromString('TEST');
const oracle = new OracleProofPrimitive({
  oraclePk: oraclePub,
  domainSeparator: DOMAIN,
  expiryDuration: 3600n,
}, provider);

test('Oracle has address', () => assert(oracle.address.startsWith('bchtest:')));
test('buildMessage returns Uint8Array', () => {
  const msg = oracle.buildMessage(1_700_100_000n, 1n, new Uint8Array([0x01]));
  assert(msg instanceof Uint8Array);
  assert(msg.length === 13); // 4 domain + 4 ts + 4 nonce + 1 payload
});

// --- 7. Encoding utils ---
console.log('\n7. Encoding Utils');
test('intToBytes4LE encodes correctly', () => {
  const bytes = intToBytes4LE(256n);
  assert(bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0);
});
test('encodeOracleMessage correct length', () => {
  const msg = encodeOracleMessage(DOMAIN, 1n, 1n, intToBytes4LE(100n));
  assert(msg.length === 16); // 4+4+4+4
});

// --- 8. v0.3.0 Helper Functions ---
console.log('\n8. v0.3.0 Helper Functions');

test('domainFromString("VOTE") produces correct bytes', () => {
  const bytes = domainFromString('VOTE');
  assert(bytes[0] === 0x56 && bytes[1] === 0x4f && bytes[2] === 0x54 && bytes[3] === 0x45);
});
test('domainFromString("CRED") produces correct bytes', () => {
  const bytes = domainFromString('CRED');
  assert(bytes[0] === 0x43 && bytes[1] === 0x52 && bytes[2] === 0x45 && bytes[3] === 0x44);
});
test('domainFromString rejects wrong length', () => {
  try {
    domainFromString('AB');
    assert(false, 'Should have thrown');
  } catch (e) {
    assert(e instanceof CashBlocksError, 'Expected CashBlocksError');
  }
});
test('generateNonce returns positive bigint', () => {
  const n = generateNonce();
  assert(typeof n === 'bigint' && n > 0n);
});
test('generateNonce fits in 4-byte range', () => {
  const n = generateNonce();
  assert(n < 2n ** 32n);
});
test('predictChangeValue calculates correctly', () => {
  assert(predictChangeValue(100_000n, 5_000n) === 94_000n);
});
test('predictChangeValue returns 0n when insufficient', () => {
  assert(predictChangeValue(1_000n, 5_000n) === 0n);
});
test('predictChangeValue accepts custom fee', () => {
  assert(predictChangeValue(10_000n, 5_000n, 500n) === 4_500n);
});

test('addressToPkh extracts PKH from address', () => {
  const pkh = hash160(ownerPub);
  const addr = encodeCashAddress({ payload: pkh, prefix: 'bchtest', type: CashAddressType.p2pkh }).address;
  const extracted = addressToPkh(addr);
  assert(extracted.length === 20);
  assert(extracted.every((v, i) => v === pkh[i]));
});

test('pkhToAddress encodes chipnet address', () => {
  const pkh = hash160(ownerPub);
  const addr = pkhToAddress(Uint8Array.from(pkh), 'chipnet');
  assert(addr.startsWith('bchtest:'));
});

test('CashBlocksError has correct properties', () => {
  const err = new CashBlocksError('test error', 'INVALID_PARAM');
  assert(err.name === 'CashBlocksError');
  assert(err.code === 'INVALID_PARAM');
  assert(err instanceof Error);
});

// --- 9. Composer: 4-primitive atomic TX ---
console.log('\n9. Composer: 4-Primitive Atomic Transaction');

await testAsync('Compose Vault + TimeState + Oracle + TokenGate in 1 TX', async () => {
  const vaultUtxo = randomUtxo({ satoshis: 1_000_000n });
  const tsUtxo = randomUtxo({ satoshis: 1_000n });
  const oracleUtxo = randomUtxo({ satoshis: 1_000n });
  const govUtxo = {
    ...randomUtxo({ satoshis: 1_000n }),
    token: { amount: 100n, category: TOKEN_CATEGORY },
  };
  provider.addUtxo(vault.address, vaultUtxo);
  provider.addUtxo(timeState.address, tsUtxo);
  provider.addUtxo(oracle.address, oracleUtxo);
  provider.addUtxo(tokenGate.tokenAddress, govUtxo);

  const timestamp = 1_700_100_050n;
  const oracleMsg = encodeOracleMessage(DOMAIN, timestamp, 1n, intToBytes4LE(100n));
  const msgHash = sha256.hash(oracleMsg);
  const oracleSig = secp256k1.signMessageHashSchnorr(oraclePriv, msgHash);
  const ownerSig = new SignatureTemplate(ownerPriv);

  const composer = new TransactionComposer(provider);
  composer
    .addInput(vaultUtxo, vault.contract.unlock.composableSpend(ownerSig, 50_000n, 0n))
    .addInput(tsUtxo, timeState.contract.unlock.composableCheck(ownerSig, 1n))
    .addInput(oracleUtxo, oracle.contract.unlock.composableVerify(oracleSig, oracleMsg))
    .addInput(govUtxo, tokenGate.contract.unlock.composableVerify(2n))
    .addOutput(vault.address, 950_000n)
    .addOutput(vault.address, 50_000n)
    .addOutput(tokenGate.tokenAddress, 1_000n, { amount: 100n, category: TOKEN_CATEGORY })
    .setLocktime(Number(timestamp) + 50);

  const tx = await composer.send();
  assert(tx.txid && tx.txid.length === 64, `Expected txid, got: ${tx.txid}`);
});

// --- 10. createProvider ---
console.log('\n10. Provider Factory');
test('createProvider mock', () => {
  const p = createProvider('mock');
  assert(p !== undefined);
});

// --- 11. Chipnet Engine Imports ---
console.log('\n11. Chipnet DeFi Engines (import check)');

await testAsync('Lending chipnet engine exports runLendingChipnetScenario', async () => {
  const { runLendingChipnetScenario } = await import('./lending-engine-chipnet.mjs');
  assert(typeof runLendingChipnetScenario === 'function');
});

await testAsync('Governance chipnet engine exports runGovernanceChipnetScenario', async () => {
  const { runGovernanceChipnetScenario } = await import('./governance-engine-chipnet.mjs');
  assert(typeof runGovernanceChipnetScenario === 'function');
});

await testAsync('Yield Vault chipnet engine exports runYieldVaultChipnetScenario', async () => {
  const { runYieldVaultChipnetScenario } = await import('./yield-vault-engine-chipnet.mjs');
  assert(typeof runYieldVaultChipnetScenario === 'function');
});

await testAsync('Insurance chipnet engine exports runInsuranceChipnetScenario', async () => {
  const { runInsuranceChipnetScenario } = await import('./insurance-engine-chipnet.mjs');
  assert(typeof runInsuranceChipnetScenario === 'function');
});

// --- Result ---
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
