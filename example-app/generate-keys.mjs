/**
 * Generate Keys for MicroLend Chipnet
 *
 * Creates 3 keypairs (Lender, Borrower, Assessor), saves to .keys.json.
 * Run: node generate-keys.mjs
 */
import { existsSync } from 'fs';
import { generateAndSaveKeys, KEYS_PATH, FAUCET_URL } from './chipnet-helpers.mjs';

if (existsSync(KEYS_PATH)) {
  console.log(`[!] ${KEYS_PATH} already exists. Delete it first to regenerate.`);
  console.log(`    rm ${KEYS_PATH} && node generate-keys.mjs`);
  process.exit(1);
}

console.log('=== Generating Keys for MicroLend (Chipnet) ===\n');

const keys = generateAndSaveKeys();

console.log('Lender (Pool Owner):');
console.log(`  Address: ${keys.owner.address}`);
console.log(`  WIF:     ${keys.owner.wif}\n`);

console.log('Borrower:');
console.log(`  Address: ${keys.recipient.address}\n`);

console.log('Credit Assessor (Oracle):');
console.log(`  Address: ${keys.oracle.address}\n`);

console.log(`[OK] Keys saved to ${KEYS_PATH}\n`);

console.log('=== Next Steps ===');
console.log('1. Get chipnet BCH from faucet:');
console.log(`   ${FAUCET_URL}`);
console.log(`   Send to Lender address: ${keys.owner.address}\n`);
console.log('2. Start the server:');
console.log('   node server.mjs\n');
console.log('[!] IMPORTANT: .keys.json contains private keys.');
console.log('    Do NOT commit it to git.');
