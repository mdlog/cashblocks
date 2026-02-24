import { readFileSync, existsSync } from 'fs';
import {
  ElectrumNetworkProvider,
  Contract,
  SignatureTemplate,
  TransactionBuilder,
  type Utxo,
  type NetworkProvider,
} from 'cashscript';
import { compileFile } from 'cashc';

export const EXPLORER_BASE = 'https://chipnet.chaingraph.cash/tx/';
export const KEYS_PATH = '.keys.json';
const UTXO_POLL_INTERVAL = 3000;
const UTXO_POLL_MAX_ATTEMPTS = 20;
const MTP_OFFSET = 6 * 3600; // 6 hours

export interface ChipnetKeys {
  owner: { privKey: string; pubKey: string; pkh: string; address: string; wif: string };
  recipient: { privKey: string; pubKey: string; pkh: string; address: string; wif: string };
  oracle: { privKey: string; pubKey: string; pkh: string; address: string; wif: string };
}

let providerInstance: ElectrumNetworkProvider | null = null;

export function getProvider(): ElectrumNetworkProvider {
  if (!providerInstance) {
    providerInstance = new ElectrumNetworkProvider('chipnet');
  }
  return providerInstance;
}

export function resetProvider(): void {
  providerInstance = null;
}

export function loadKeys(): ChipnetKeys | null {
  if (!existsSync(KEYS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(KEYS_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function hexToUint8(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

let artifactCache: { vault: any; timeState: any; oracle: any } | null = null;

export function getArtifacts() {
  if (!artifactCache) {
    artifactCache = {
      vault: compileFile('./contracts/vault.cash'),
      timeState: compileFile('./contracts/time-state.cash'),
      oracle: compileFile('./contracts/oracle-proof.cash'),
    };
  }
  return artifactCache;
}

export async function getOwnerBalance(ownerAddress: string): Promise<{ balance: bigint; utxoCount: number }> {
  const provider = getProvider();
  const utxos = await provider.getUtxos(ownerAddress);
  const balance = utxos.reduce((sum, u) => sum + u.satoshis, 0n);
  return { balance, utxoCount: utxos.length };
}

export function safeChipnetLocktime(): number {
  return Math.floor(Date.now() / 1000) - MTP_OFFSET;
}

export function safeOracleTimestamp(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) - 25200); // 7 hours ago (must be <= locktime which is now-6h)
}

export async function waitForUtxos(
  address: string,
  minCount: number = 1,
): Promise<Utxo[]> {
  const provider = getProvider();
  for (let i = 0; i < UTXO_POLL_MAX_ATTEMPTS; i++) {
    const utxos = await provider.getUtxos(address);
    if (utxos.length >= minCount) return utxos;
    await new Promise(r => setTimeout(r, UTXO_POLL_INTERVAL));
  }
  throw new Error(`Timeout waiting for UTXOs at ${address}`);
}

export async function waitForFundedUtxo(
  address: string,
  fundTxid: string,
): Promise<Utxo> {
  const provider = getProvider();
  for (let i = 0; i < UTXO_POLL_MAX_ATTEMPTS; i++) {
    const utxos = await provider.getUtxos(address);
    const match = utxos.find(u => u.txid === fundTxid);
    if (match) return match;
    await new Promise(r => setTimeout(r, UTXO_POLL_INTERVAL));
  }
  throw new Error(`Timeout waiting for funded UTXO (txid: ${fundTxid}) at ${address}`);
}

export async function fundScenario(
  targets: { address: string; amount: bigint }[],
  ownerPriv: Uint8Array,
  ownerAddress: string,
): Promise<string> {
  const provider = getProvider();
  const ownerUtxos = await provider.getUtxos(ownerAddress);
  if (ownerUtxos.length === 0) throw new Error('Owner has no UTXOs');

  const totalBalance = ownerUtxos.reduce((sum, u) => sum + u.satoshis, 0n);
  const totalNeeded = targets.reduce((sum, t) => sum + t.amount, 0n);
  const fee = 1000n;

  if (totalBalance < totalNeeded + fee) {
    throw new Error(
      `Insufficient balance: have ${totalBalance} sats, need ${totalNeeded + fee} sats. ` +
      `Fund ${ownerAddress} via https://tbch.googol.cash/`,
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
  if (change > 546n) {
    builder.addOutput({ to: ownerAddress, amount: change });
  }

  const tx = await builder.send();
  return tx.txid;
}
