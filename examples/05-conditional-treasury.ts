/**
 * Example 05: Conditional Treasury Spend (Flagship)
 * All 3 primitives composed in a single atomic transaction.
 *
 * Scenario: A treasury vault that can only be spent when:
 *   1. Vault policy allows it (spend limit, whitelisted recipient)
 *   2. Time has reached Phase 1 or Phase 2
 *   3. Oracle has attested to an external condition (e.g. governance vote passed)
 *
 * Transaction:
 *   Inputs:  [Vault] [Time-State] [Oracle Proof]
 *   Outputs: [Vault Continuation] [Payment to Recipient]
 */
import {
  MockNetworkProvider,
  Contract,
  randomUtxo,
  SignatureTemplate,
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
import { TransactionComposer } from '../src/composer/transaction-composer.js';
import { encodeOracleMessage } from '../src/utils/encoding.js';

// === Key Setup ===
const treasuryOwnerPriv = generatePrivateKey();
const treasuryOwnerPub = secp256k1.derivePublicKeyCompressed(treasuryOwnerPriv);
const oraclePriv = generatePrivateKey();
const oraclePub = secp256k1.derivePublicKeyCompressed(oraclePriv);
const recipientPub = secp256k1.derivePublicKeyCompressed(generatePrivateKey());
const recipientPkh = hash160(recipientPub);
const recipientAddr = encodeCashAddress({
  payload: recipientPkh,
  prefix: 'bchtest',
  type: CashAddressType.p2pkh,
}).address as string;

// === Contract Setup ===
const provider = new MockNetworkProvider();
const vaultArtifact = compileFile('./contracts/vault.cash');
const timeStateArtifact = compileFile('./contracts/time-state.cash');
const oracleArtifact = compileFile('./contracts/oracle-proof.cash');

const PHASE1_TIME = 1_700_100_000;
const PHASE2_TIME = 1_700_200_000;
const SPEND_LIMIT = 100_000n;
const DOMAIN = new Uint8Array([0x56, 0x4f, 0x54, 0x45]); // "VOTE"
const EXPIRY = 3600n;

const vault = new Contract(vaultArtifact, [treasuryOwnerPub, SPEND_LIMIT, recipientPkh], { provider });
const timeState = new Contract(timeStateArtifact, [treasuryOwnerPub, BigInt(PHASE1_TIME), BigInt(PHASE2_TIME)], { provider });
const oracle = new Contract(oracleArtifact, [oraclePub, DOMAIN, EXPIRY], { provider });

console.log('=== Conditional Treasury Setup ===');
console.log('Vault:', vault.address);
console.log('Time-State:', timeState.address);
console.log('Oracle Proof:', oracle.address);
console.log(`Spend limit: ${SPEND_LIMIT} sats`);
console.log(`Domain: VOTE | Expiry: ${EXPIRY}s\n`);

// === Fund All Primitives ===
const vaultUtxo = randomUtxo({ satoshis: 5_000_000n });
const tsUtxo = randomUtxo({ satoshis: 1_000n });
const oracleUtxo = randomUtxo({ satoshis: 1_000n });
provider.addUtxo(vault.address, vaultUtxo);
provider.addUtxo(timeState.address, tsUtxo);
provider.addUtxo(oracle.address, oracleUtxo);

console.log('Treasury funded: 5,000,000 sats (0.05 BCH)');
console.log('Time-State gate: 1,000 sats');
console.log('Oracle gate: 1,000 sats\n');

// === Oracle Signs Governance Vote Result ===
console.log('--- Oracle: Governance Vote Passed ---');
const ORACLE_TIMESTAMP = 1_700_100_050n;
const oracleMessage = encodeOracleMessage(
  DOMAIN,
  ORACLE_TIMESTAMP,
  1n,
  new Uint8Array([0x61, 0x70, 0x70, 0x72]), // "appr" (approved)
);
const msgHash = sha256.hash(oracleMessage);
const oracleSig = secp256k1.signMessageHashSchnorr(oraclePriv, msgHash);
console.log('Oracle message signed (governance vote: approved)');

// === Compose the Treasury Spend ===
console.log('\n--- Conditional Treasury Spend ---');
const ownerSig = new SignatureTemplate(treasuryOwnerPriv);

const composer = new TransactionComposer(provider);
composer
  // Input 0: Vault — enforce spending policy
  .addInput(vaultUtxo, vault.unlock.composableSpend(ownerSig, 100_000n, 0n))
  // Input 1: Time-State — enforce time gate (Phase 1)
  .addInput(tsUtxo, timeState.unlock.composableCheck(ownerSig, 1n))
  // Input 2: Oracle Proof — enforce external condition
  .addInput(oracleUtxo, oracle.unlock.composableVerify(oracleSig, oracleMessage))
  // Output 0: Vault continuation (remaining treasury)
  .addOutput(vault.address, 4_900_000n)
  // Output 1: Payment to approved recipient
  .addOutput(recipientAddr, 100_000n)
  // Locktime must satisfy both Time-State and Oracle timestamp
  .setLocktime(Number(ORACLE_TIMESTAMP) + 50);

const tx = await composer.send();
console.log('TX sent! txid:', tx.txid);
console.log('\nTransaction validated ALL 3 conditions atomically:');
console.log('  [x] Vault: 100,000 sats within limit, whitelisted recipient');
console.log('  [x] Time-State: Phase 1 active (time gate passed)');
console.log('  [x] Oracle: Governance vote confirmed as "approved"');
console.log(`\nTreasury remaining: 4,900,000 sats`);
console.log('No admin. No backend. No multisig. Pure on-chain logic.');

console.log('\nDone!');
