/**
 * Chipnet Helpers — Key management, UTXO polling, funding
 * Adapted from CashBlocks web/engines/chipnet/shared.ts
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import {
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import {
  secp256k1,
  generatePrivateKey,
  hash160,
  encodeCashAddress,
  CashAddressType,
  encodePrivateKeyWif,
  decodePrivateKeyWif,
} from '@bitauth/libauth';
import { DUST_LIMIT, HARDCODED_FEE } from 'cashblocks';

export const EXPLORER_BASE = 'https://chipnet.chaingraph.cash/tx/';
export const FAUCET_URL = 'https://tbch.googol.cash/';
export const KEYS_PATH = '.keys.json';

const UTXO_POLL_INTERVAL = 3000;
const UTXO_POLL_MAX_ATTEMPTS = 20;
const MTP_OFFSET = 6 * 3600; // 6 hours

// --- Singleton provider ---

let providerInstance = null;

export function getProvider() {
  if (!providerInstance) {
    providerInstance = new ElectrumNetworkProvider('chipnet');
  }
  return providerInstance;
}

export function resetProvider() {
  providerInstance = null;
}

// --- Hex utils ---

export function hexToUint8(hex) {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

export function uint8ToHex(arr) {
  return Buffer.from(arr).toString('hex');
}

// --- Key management ---

export function generateKeypair(label) {
  const privKey = generatePrivateKey();
  const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
  const pkh = hash160(pubKey);
  const address = encodeCashAddress({
    payload: pkh,
    prefix: 'bchtest',
    type: CashAddressType.p2pkh,
  }).address;
  const wif = encodePrivateKeyWif(privKey, 'testnet');

  return {
    label,
    privKey: uint8ToHex(privKey),
    pubKey: uint8ToHex(pubKey),
    pkh: uint8ToHex(pkh),
    address,
    wif,
  };
}

export function generateAndSaveKeys() {
  const lender = generateKeypair('Lender');
  const borrower = generateKeypair('Borrower');
  const assessor = generateKeypair('Credit Assessor');

  const keys = {
    owner: lender,
    recipient: borrower,
    oracle: assessor,
    network: 'chipnet',
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
  return keys;
}

export function loadKeys() {
  if (!existsSync(KEYS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(KEYS_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function keysExist() {
  return existsSync(KEYS_PATH);
}

export function importWif(wifString) {
  const decoded = decodePrivateKeyWif(wifString);
  if (typeof decoded === 'string') {
    throw new Error(`Invalid WIF: ${decoded}`);
  }
  const privKey = decoded.privateKey;
  const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
  const pkh = hash160(pubKey);
  const address = encodeCashAddress({
    payload: pkh,
    prefix: 'bchtest',
    type: CashAddressType.p2pkh,
  }).address;

  const owner = {
    label: 'Imported',
    privKey: uint8ToHex(privKey),
    pubKey: uint8ToHex(pubKey),
    pkh: uint8ToHex(pkh),
    address,
    wif: wifString,
  };

  // Load existing keys or generate fresh recipient + oracle
  let keys;
  if (existsSync(KEYS_PATH)) {
    keys = JSON.parse(readFileSync(KEYS_PATH, 'utf-8'));
    keys.owner = owner;
  } else {
    const recipient = generateKeypair('Recipient');
    const oracle = generateKeypair('Oracle');
    keys = {
      owner,
      recipient,
      oracle,
      network: 'chipnet',
      generatedAt: new Date().toISOString(),
    };
  }

  keys.importedAt = new Date().toISOString();
  writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
  return keys;
}

export function importKeysJson(jsonData) {
  if (!jsonData || typeof jsonData !== 'object') {
    throw new Error('Invalid key data: expected a JSON object.');
  }
  if (!jsonData.owner || !jsonData.owner.privKey || !jsonData.owner.address) {
    throw new Error('Invalid key file: missing owner.privKey or owner.address.');
  }
  if (!jsonData.recipient || !jsonData.recipient.address) {
    throw new Error('Invalid key file: missing recipient data.');
  }
  if (!jsonData.oracle || !jsonData.oracle.address) {
    throw new Error('Invalid key file: missing oracle data.');
  }

  const keys = {
    owner: jsonData.owner,
    recipient: jsonData.recipient,
    oracle: jsonData.oracle,
    network: jsonData.network || 'chipnet',
    generatedAt: jsonData.generatedAt || new Date().toISOString(),
    importedAt: new Date().toISOString(),
  };

  writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
  return keys;
}

export function deleteKeys() {
  if (existsSync(KEYS_PATH)) {
    unlinkSync(KEYS_PATH);
    return true;
  }
  return false;
}

// --- Balance ---

export async function getOwnerBalance(ownerAddress) {
  const provider = getProvider();
  const utxos = await provider.getUtxos(ownerAddress);
  const balance = utxos.reduce((sum, u) => sum + u.satoshis, 0n);
  return { balance, utxoCount: utxos.length };
}

// --- Timing ---

export function safeChipnetLocktime() {
  return Math.floor(Date.now() / 1000) - MTP_OFFSET;
}

export function safeOracleTimestamp() {
  return BigInt(Math.floor(Date.now() / 1000) - 25200); // 7 hours ago
}

// --- UTXO polling ---

export async function waitForUtxos(address, minCount = 1) {
  const provider = getProvider();
  for (let i = 0; i < UTXO_POLL_MAX_ATTEMPTS; i++) {
    const utxos = await provider.getUtxos(address);
    if (utxos.length >= minCount) return utxos;
    await new Promise(r => setTimeout(r, UTXO_POLL_INTERVAL));
  }
  throw new Error(`Timeout waiting for UTXOs at ${address}`);
}

export async function waitForFundedUtxo(address, fundTxid) {
  const provider = getProvider();
  for (let i = 0; i < UTXO_POLL_MAX_ATTEMPTS; i++) {
    const utxos = await provider.getUtxos(address);
    const match = utxos.find(u => u.txid === fundTxid);
    if (match) return match;
    await new Promise(r => setTimeout(r, UTXO_POLL_INTERVAL));
  }
  throw new Error(`Timeout waiting for funded UTXO (txid: ${fundTxid}) at ${address}`);
}

// --- Funding ---

export async function fundScenario(targets, ownerPriv, ownerAddress) {
  const provider = getProvider();
  const ownerUtxos = await provider.getUtxos(ownerAddress);
  if (ownerUtxos.length === 0) {
    throw new Error(`Owner has no UTXOs. Fund ${ownerAddress} via ${FAUCET_URL}`);
  }

  const totalBalance = ownerUtxos.reduce((sum, u) => sum + u.satoshis, 0n);
  const totalNeeded = targets.reduce((sum, t) => sum + t.amount, 0n);
  const fee = HARDCODED_FEE;

  if (totalBalance < totalNeeded + fee) {
    throw new Error(
      `Insufficient balance: have ${totalBalance} sats, need ${totalNeeded + fee} sats. ` +
      `Fund ${ownerAddress} via ${FAUCET_URL}`,
    );
  }

  const ownerSig = new SignatureTemplate(ownerPriv);
  const builder = new TransactionBuilder({ provider });

  for (const utxo of ownerUtxos) {
    builder.addInput(utxo, ownerSig.unlockP2PKH());
  }

  for (const { address, amount } of targets) {
    builder.addOutput({ to: address, amount });
  }

  const change = totalBalance - totalNeeded - fee;
  if (change > DUST_LIMIT) {
    builder.addOutput({ to: ownerAddress, amount: change });
  }

  const tx = await builder.send();
  return tx.txid;
}
