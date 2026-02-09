/**
 * Generate Keys for CashBlocks
 *
 * Generates 3 keypairs (owner, recipient, oracle), saves to .keys.json.
 * Shows chipnet addresses for faucet funding.
 *
 * Usage: npx tsx scripts/generate-keys.ts
 */
import { writeFileSync, existsSync } from 'fs';
import {
  secp256k1,
  generatePrivateKey,
  hash160,
  encodeCashAddress,
  CashAddressType,
  encodePrivateKeyWif,
} from '@bitauth/libauth';

const KEYS_FILE = '.keys.json';

if (existsSync(KEYS_FILE)) {
  console.log(`[!] ${KEYS_FILE} already exists. Delete it first to regenerate.`);
  console.log('    rm .keys.json && npx tsx scripts/generate-keys.ts');
  process.exit(1);
}

function generateKeypair(label: string) {
  const privKey = generatePrivateKey();
  const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
  const pkh = hash160(pubKey);
  const address = encodeCashAddress({
    payload: pkh,
    prefix: 'bchtest',
    type: CashAddressType.p2pkh,
  }).address as string;

  const wif = encodePrivateKeyWif(privKey, 'testnet');

  console.log(`\n${label}:`);
  console.log(`  Address:    ${address}`);
  console.log(`  PubKey:     ${Buffer.from(pubKey).toString('hex')}`);
  console.log(`  PrivKey:    ${Buffer.from(privKey).toString('hex')}`);
  console.log(`  WIF:        ${wif}`);

  return {
    label,
    privKey: Buffer.from(privKey).toString('hex'),
    pubKey: Buffer.from(pubKey).toString('hex'),
    pkh: Buffer.from(pkh).toString('hex'),
    address,
    wif,
  };
}

console.log('=== Generating Keys for CashBlocks ===');
console.log('Network: BCH Chipnet (testnet)');

const owner = generateKeypair('Owner (treasury/vault owner)');
const recipient = generateKeypair('Recipient (whitelisted destination)');
const oracle = generateKeypair('Oracle (data signer)');

const keys = { owner, recipient, oracle, network: 'chipnet', generatedAt: new Date().toISOString() };

writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
console.log(`\n[OK] Keys saved to ${KEYS_FILE}`);

console.log('\n=== Next Steps ===');
console.log('1. Get chipnet BCH from faucet:');
console.log(`   https://tbch.googol.cash/`);
console.log(`   Send to Owner address: ${owner.address}`);
console.log('');
console.log('2. Deploy contracts:');
console.log('   npx tsx scripts/deploy-chipnet.ts');
console.log('');
console.log('[!] IMPORTANT: .keys.json contains private keys.');
console.log('    Do NOT commit it to git. It is already in .gitignore.');
