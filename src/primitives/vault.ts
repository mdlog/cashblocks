import { Contract, SignatureTemplate, TransactionBuilder } from 'cashscript';
import type { NetworkProvider, Utxo } from 'cashscript';
import { compileFile } from 'cashc';
import type { VaultParams } from '../utils/types.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTRACT_PATH = resolve(__dirname, '../../contracts/vault.cash');

export class VaultPrimitive {
  public contract: Contract;
  private params: VaultParams;

  constructor(params: VaultParams, provider: NetworkProvider) {
    const artifact = compileFile(CONTRACT_PATH);
    this.params = params;
    this.contract = new Contract(artifact, [
      params.ownerPk,
      params.spendLimit,
      params.whitelistHash,
    ], { provider });
  }

  get address(): string {
    return this.contract.address;
  }

  get tokenAddress(): string {
    return this.contract.tokenAddress;
  }

  async getBalance(): Promise<bigint> {
    return this.contract.getBalance();
  }

  async getUtxos(): Promise<Utxo[]> {
    return this.contract.getUtxos();
  }

  buildPartialSpend(ownerKey: Uint8Array, spendAmount: bigint) {
    const sigTemplate = new SignatureTemplate(ownerKey);
    return this.contract.functions.partialSpend(sigTemplate, spendAmount);
  }

  buildFullSpend(ownerKey: Uint8Array) {
    const sigTemplate = new SignatureTemplate(ownerKey);
    return this.contract.functions.fullSpend(sigTemplate);
  }

  getComposableUnlocker(ownerKey: Uint8Array, spendAmount: bigint, continuationIndex: bigint) {
    const sigTemplate = new SignatureTemplate(ownerKey);
    return this.contract.unlock.composableSpend(sigTemplate, spendAmount, continuationIndex);
  }
}
