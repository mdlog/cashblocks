/**
 * Deploy CashBlocks to BCH Chipnet
 *
 * Prerequisites:
 *   1. Run: npx tsx scripts/generate-keys.ts
 *   2. Fund owner address with chipnet BCH from https://tbch.googol.cash/
 *   3. Run: npx tsx scripts/deploy-chipnet.ts
 *
 * This script:
 *   - Loads keys from .keys.json
 *   - Compiles all 3 contracts
 *   - Shows contract addresses
 *   - Waits for owner to have balance
 *   - Funds each contract with a P2PKH transaction
 *   - Saves deployment info to .deploy.json
 */
import { readFileSync, writeFileSync } from 'fs';
import {
  ElectrumNetworkProvider,
  Contract,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import { compileFile } from 'cashc';
import {
  secp256k1,
  hash160,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';

// --- Load Keys ---
let keys: any;
try {
  keys = JSON.parse(readFileSync('.keys.json', 'utf-8'));
} catch {
  console.error('[ERROR] .keys.json not found. Run first:');
  console.error('  npx tsx scripts/generate-keys.ts');
  process.exit(1);
}

const ownerPriv = Uint8Array.from(Buffer.from(keys.owner.privKey, 'hex'));
const ownerPub = Uint8Array.from(Buffer.from(keys.owner.pubKey, 'hex'));
const recipientPkh = Uint8Array.from(Buffer.from(keys.recipient.pkh, 'hex'));
const oraclePub = Uint8Array.from(Buffer.from(keys.oracle.pubKey, 'hex'));

// --- Network ---
console.log('=== Deploy to BCH Chipnet ===\n');
const provider = new ElectrumNetworkProvider('chipnet');

// --- Compile Contracts ---
console.log('Compiling contracts...');
const vaultArtifact = compileFile('./contracts/vault.cash');
const timeStateArtifact = compileFile('./contracts/time-state.cash');
const oracleArtifact = compileFile('./contracts/oracle-proof.cash');
console.log('[OK] All contracts compiled\n');

// --- Contract Parameters ---
const SPEND_LIMIT = 100_000n;        // 0.001 BCH per TX
const PHASE1_TIME = BigInt(Math.floor(Date.now() / 1000) + 60);       // 1 minute from now
const PHASE2_TIME = BigInt(Math.floor(Date.now() / 1000) + 300);      // 5 minutes from now
const DOMAIN = Uint8Array.from([0x56, 0x4f, 0x54, 0x45]); // "VOTE"
const EXPIRY = 3600n;                // 1 hour

// --- Instantiate Contracts ---
const vault = new Contract(
  vaultArtifact,
  [ownerPub, SPEND_LIMIT, recipientPkh],
  { provider },
);

const timeState = new Contract(
  timeStateArtifact,
  [ownerPub, PHASE1_TIME, PHASE2_TIME],
  { provider },
);

const oracle = new Contract(
  oracleArtifact,
  [oraclePub, DOMAIN, EXPIRY],
  { provider },
);

console.log('Contract Addresses:');
console.log(`  Vault:      ${vault.address}`);
console.log(`  Time-State: ${timeState.address}`);
console.log(`  Oracle:     ${oracle.address}`);
console.log(`  Owner P2PKH: ${keys.owner.address}`);
console.log('');

// --- Check Owner Balance ---
console.log('Checking owner balance...');

async function getOwnerUtxos() {
  return provider.getUtxos(keys.owner.address);
}

let ownerUtxos = await getOwnerUtxos();

if (ownerUtxos.length === 0) {
  console.log('[!] No BCH found at owner address.');
  console.log(`    Send chipnet BCH to: ${keys.owner.address}`);
  console.log('    Faucet: https://tbch.googol.cash/');
  console.log('');
  console.log('Waiting for funding (checking every 10s)...');

  while (ownerUtxos.length === 0) {
    await new Promise(r => setTimeout(r, 10_000));
    ownerUtxos = await getOwnerUtxos();
    process.stdout.write('.');
  }
  console.log('');
}

const totalBalance = ownerUtxos.reduce((sum, u) => sum + u.satoshis, 0n);
console.log(`[OK] Owner balance: ${totalBalance} sats (${ownerUtxos.length} UTXOs)\n`);

// --- Fund Contracts ---
const VAULT_FUNDING = 500_000n;
const TIMESTATE_FUNDING = 2_000n;
const ORACLE_FUNDING = 2_000n;
const FEE = 1_000n;
const TOTAL_NEEDED = VAULT_FUNDING + TIMESTATE_FUNDING + ORACLE_FUNDING + FEE;

if (totalBalance < TOTAL_NEEDED) {
  console.error(`[ERROR] Need at least ${TOTAL_NEEDED} sats, have ${totalBalance}.`);
  console.error(`  Send more chipnet BCH to: ${keys.owner.address}`);
  await provider.disconnect?.();
  process.exit(1);
}

console.log('Funding contracts...');
console.log(`  Vault:      ${VAULT_FUNDING} sats`);
console.log(`  Time-State: ${TIMESTATE_FUNDING} sats`);
console.log(`  Oracle:     ${ORACLE_FUNDING} sats`);
console.log(`  Fee:        ${FEE} sats`);
console.log('');

const ownerSig = new SignatureTemplate(ownerPriv);

const builder = new TransactionBuilder({ provider });

// Add all owner UTXOs as inputs
for (const utxo of ownerUtxos) {
  builder.addInput(utxo, ownerSig.unlockP2PKH());
}

// Outputs: fund each contract
builder.addOutput({ to: vault.address, amount: VAULT_FUNDING });
builder.addOutput({ to: timeState.address, amount: TIMESTATE_FUNDING });
builder.addOutput({ to: oracle.address, amount: ORACLE_FUNDING });

// Change back to owner
const change = totalBalance - VAULT_FUNDING - TIMESTATE_FUNDING - ORACLE_FUNDING - FEE;
if (change > 546n) {
  builder.addOutput({ to: keys.owner.address, amount: change });
}

try {
  const tx = await builder.send();
  console.log(`[OK] Funding TX sent!`);
  console.log(`  txid: ${tx.txid}`);
  console.log(`  Explorer: https://chipnet.chaingraph.cash/tx/${tx.txid}`);
} catch (e: any) {
  console.error('[ERROR] Funding TX failed:', e.message);
  await provider.disconnect?.();
  process.exit(1);
}

// --- Verify Deployment ---
console.log('\nVerifying deployment...');
await new Promise(r => setTimeout(r, 3000)); // Wait for propagation

const vaultBalance = await vault.getBalance();
const tsBalance = await timeState.getBalance();
const oracleBalance = await oracle.getBalance();

console.log(`  Vault balance:      ${vaultBalance} sats`);
console.log(`  Time-State balance: ${tsBalance} sats`);
console.log(`  Oracle balance:     ${oracleBalance} sats`);

// --- Save Deployment Info ---
const deployInfo = {
  network: 'chipnet',
  deployedAt: new Date().toISOString(),
  contracts: {
    vault: {
      address: vault.address,
      balance: Number(vaultBalance),
      params: {
        ownerPub: keys.owner.pubKey,
        spendLimit: Number(SPEND_LIMIT),
        whitelistHash: keys.recipient.pkh,
      },
    },
    timeState: {
      address: timeState.address,
      balance: Number(tsBalance),
      params: {
        ownerPub: keys.owner.pubKey,
        phase1Time: Number(PHASE1_TIME),
        phase2Time: Number(PHASE2_TIME),
      },
    },
    oracle: {
      address: oracle.address,
      balance: Number(oracleBalance),
      params: {
        oraclePub: keys.oracle.pubKey,
        domain: 'VOTE',
        expiryDuration: Number(EXPIRY),
      },
    },
  },
  keys: {
    owner: keys.owner.address,
    recipient: keys.recipient.address,
    oracle: keys.oracle.address,
  },
};

writeFileSync('.deploy.json', JSON.stringify(deployInfo, null, 2));
console.log('\n[OK] Deployment info saved to .deploy.json');

console.log('\n=== Deployment Complete ===');
console.log('');
console.log('Next: Test spending on chipnet:');
console.log('  npx tsx scripts/test-chipnet.ts');

// ElectrumNetworkProvider auto-manages connections
process.exit(0);
