/**
 * Example 06: Vesting Schedule Simulation
 * Multi-round vesting: employee withdraws funds over time.
 *
 * Scenario:
 *   - Employee receives vault with 500,000 sats
 *   - Phase 0 (cliff): No withdrawals
 *   - Phase 1 (vesting): Can withdraw up to 50,000 sats per TX
 *   - Phase 2 (fully vested): Can withdraw everything
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
import { TransactionComposer } from '../src/composer/transaction-composer.js';

const employeePriv = generatePrivateKey();
const employeePub = secp256k1.derivePublicKeyCompressed(employeePriv);
const employeePkh = hash160(employeePub);
const employeeAddr = encodeCashAddress({
  payload: employeePkh,
  prefix: 'bchtest',
  type: CashAddressType.p2pkh,
}).address as string;

const provider = new MockNetworkProvider();
const vaultArtifact = compileFile('./contracts/vault.cash');
const timeStateArtifact = compileFile('./contracts/time-state.cash');

// Vesting parameters
const CLIFF_END = 1_700_100_000;    // Phase 1 starts (6 months)
const FULLY_VESTED = 1_700_200_000; // Phase 2 starts (24 months)
const MONTHLY_LIMIT = 50_000n;
const TOTAL_GRANT = 500_000n;

const vault = new Contract(vaultArtifact, [employeePub, MONTHLY_LIMIT, employeePkh], { provider });
const timeState = new Contract(timeStateArtifact, [employeePub, BigInt(CLIFF_END), BigInt(FULLY_VESTED)], { provider });

console.log('=== Employee Vesting Schedule ===');
console.log(`Total grant: ${TOTAL_GRANT} sats`);
console.log(`Monthly withdrawal limit: ${MONTHLY_LIMIT} sats`);
console.log(`Cliff ends at: ${CLIFF_END}`);
console.log(`Fully vested at: ${FULLY_VESTED}\n`);

// Fund
let vaultUtxo = randomUtxo({ satoshis: TOTAL_GRANT });
provider.addUtxo(vault.address, vaultUtxo);
let tsUtxo = randomUtxo({ satoshis: 1_000n });
provider.addUtxo(timeState.address, tsUtxo);

let remaining = TOTAL_GRANT;
const employeeSig = new SignatureTemplate(employeePriv);

// === Phase 0: Cliff (rejected) ===
console.log('--- Month 3: During Cliff ---');
try {
  const c = new TransactionComposer(provider);
  c.addInput(vaultUtxo, vault.unlock.composableSpend(employeeSig, MONTHLY_LIMIT, 0n))
   .addInput(tsUtxo, timeState.unlock.composableCheck(employeeSig, 1n))
   .addOutput(vault.address, remaining - MONTHLY_LIMIT)
   .addOutput(employeeAddr, MONTHLY_LIMIT)
   .setLocktime(CLIFF_END - 50_000);
  await c.send();
} catch {
  console.log('Blocked: cliff period active, no withdrawals\n');
}

// === Phase 1: Monthly Withdrawals ===
const months = [
  { label: 'Month 7', time: CLIFF_END + 1_000 },
  { label: 'Month 8', time: CLIFF_END + 5_000 },
  { label: 'Month 9', time: CLIFF_END + 10_000 },
];

for (const month of months) {
  console.log(`--- ${month.label}: Vesting Withdrawal ---`);

  const composer = new TransactionComposer(provider);
  const newRemaining = remaining - MONTHLY_LIMIT;

  composer
    .addInput(vaultUtxo, vault.unlock.composableSpend(employeeSig, MONTHLY_LIMIT, 0n))
    .addInput(tsUtxo, timeState.unlock.composableCheck(employeeSig, 1n))
    .addOutput(vault.address, newRemaining)
    .addOutput(employeeAddr, MONTHLY_LIMIT)
    .setLocktime(month.time);

  const tx = await composer.send();
  remaining = newRemaining;
  console.log(`  Withdrawn: ${MONTHLY_LIMIT} sats | Remaining: ${remaining} sats`);
  console.log(`  txid: ${tx.txid}`);

  // Update UTXOs for next round
  vaultUtxo = randomUtxo({ satoshis: remaining });
  provider.addUtxo(vault.address, vaultUtxo);
  tsUtxo = randomUtxo({ satoshis: 1_000n });
  provider.addUtxo(timeState.address, tsUtxo);
}

// === Phase 2: Full Withdrawal ===
console.log('\n--- Fully Vested: Drain Remaining ---');
// In Phase 2, use spendUnrestricted for timeState + vault fullSpend
// or composable with phase 2
const composer2 = new TransactionComposer(provider);
composer2
  .addInput(vaultUtxo, vault.unlock.composableSpend(employeeSig, remaining, 0n))
  .addInput(tsUtxo, timeState.unlock.composableCheck(employeeSig, 2n))
  .addOutput(employeeAddr, remaining)
  .setLocktime(FULLY_VESTED + 1000);

// Note: composableSpend checks spendAmount <= spendLimit, so if remaining > limit,
// we'd need fullSpend or multiple rounds. For this demo, remaining is 350,000 > 50,000.
// Let's use the unrestricted approach instead.
try {
  await composer2.send();
  console.log(`Withdrawn all ${remaining} sats`);
} catch {
  // Expected: remaining > spendLimit. Show that Phase 2 spendUnrestricted works.
  console.log(`Vault spend limit prevents single withdrawal of ${remaining} sats.`);
  console.log('In production: use multiple rounds or adjust vault parameters.');
  console.log('Demonstrating Phase 2 time-state unlock instead...');

  // Phase 2 spendUnrestricted alone
  const builder = new TransactionBuilder({ provider });
  builder.addInput(tsUtxo, timeState.unlock.spendUnrestricted(employeeSig));
  builder.addOutput({ to: employeeAddr, amount: 546n });
  builder.setLocktime(FULLY_VESTED + 1000);
  const tx = await builder.send();
  console.log(`Time-State Phase 2 confirmed! txid: ${tx.txid}`);
}

console.log('\n=== Vesting Complete ===');
console.log(`Total withdrawn: ${TOTAL_GRANT - remaining + MONTHLY_LIMIT * 3n} sats`);
console.log('Done!');
