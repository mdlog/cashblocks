import { Contract, SignatureTemplate } from 'cashscript';
import type { Artifact, NetworkProvider, Utxo } from 'cashscript';
import type { TimeStateParams } from '../utils/types.js';
import { TimePhase } from '../utils/types.js';
import { validatePublicKey, validatePositiveBigInt } from '../utils/validation.js';
import { CashBlocksError } from '../utils/errors.js';
import defaultArtifact from '../artifacts/time-state.json' with { type: 'json' };

export class TimeStatePrimitive {
  public contract: Contract;
  private params: TimeStateParams;

  constructor(params: TimeStateParams, provider: NetworkProvider, artifact?: Artifact) {
    validatePublicKey(params.ownerPk, 'ownerPk');
    validatePositiveBigInt(params.phase1Time, 'phase1Time');
    validatePositiveBigInt(params.phase2Time, 'phase2Time');
    if (params.phase2Time <= params.phase1Time) {
      throw new CashBlocksError(
        `phase2Time (${params.phase2Time}) must be greater than phase1Time (${params.phase1Time})`,
        'INVALID_PARAM',
      );
    }
    const art = artifact ?? (defaultArtifact as unknown as Artifact);
    this.params = params;
    this.contract = new Contract(art, [
      params.ownerPk,
      params.phase1Time,
      params.phase2Time,
    ], { provider });
  }

  get address(): string {
    return this.contract.address;
  }

  async getBalance(): Promise<bigint> {
    return this.contract.getBalance();
  }

  async getUtxos(): Promise<Utxo[]> {
    return this.contract.getUtxos();
  }

  getPhaseAtTime(timestamp: bigint): TimePhase {
    if (timestamp < this.params.phase1Time) return TimePhase.LOCKED;
    if (timestamp < this.params.phase2Time) return TimePhase.RESTRICTED;
    return TimePhase.UNRESTRICTED;
  }

  buildRestrictedSpend(ownerKey: Uint8Array, spendAmount: bigint) {
    const sigTemplate = new SignatureTemplate(ownerKey);
    return this.contract.functions.spendRestricted(sigTemplate, spendAmount);
  }

  buildUnrestrictedSpend(ownerKey: Uint8Array) {
    const sigTemplate = new SignatureTemplate(ownerKey);
    return this.contract.functions.spendUnrestricted(sigTemplate);
  }

  getComposableUnlocker(ownerKey: Uint8Array, requiredPhase: TimePhase) {
    const sigTemplate = new SignatureTemplate(ownerKey);
    return this.contract.unlock.composableCheck(sigTemplate, BigInt(requiredPhase));
  }
}
