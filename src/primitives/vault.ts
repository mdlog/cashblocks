import { Contract, SignatureTemplate } from 'cashscript';
import type { Artifact, NetworkProvider, Utxo } from 'cashscript';
import type { VaultParams } from '../utils/types.js';
import { validatePublicKey, validateHash160, validatePositiveBigInt } from '../utils/validation.js';
import defaultArtifact from '../artifacts/vault.json' with { type: 'json' };

export class VaultPrimitive {
  public contract: Contract;
  private params: VaultParams;

  constructor(params: VaultParams, provider: NetworkProvider, artifact?: Artifact) {
    validatePublicKey(params.ownerPk, 'ownerPk');
    validatePositiveBigInt(params.spendLimit, 'spendLimit');
    validateHash160(params.whitelistHash, 'whitelistHash');
    const art = artifact ?? (defaultArtifact as unknown as Artifact);
    this.params = params;
    this.contract = new Contract(art, [
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
