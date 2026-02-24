import { Contract, SignatureTemplate } from 'cashscript';
import type { Artifact, NetworkProvider, Utxo } from 'cashscript';
import type { TokenGateParams } from '../utils/types.js';
import { validateCategory, validatePositiveBigInt } from '../utils/validation.js';
import defaultArtifact from '../artifacts/token-gate.json' with { type: 'json' };

export class TokenGatePrimitive {
  public contract: Contract;
  private params: TokenGateParams;

  /**
   * Create a TokenGate primitive that validates CashToken ownership.
   *
   * IMPORTANT: `requiredCategory` must be in VM byte order (unreversed).
   * Wallets/explorers display token categories in reversed byte order.
   * Use `categoryToVMBytes(hexString)` to convert from display format.
   */
  constructor(params: TokenGateParams, provider: NetworkProvider, artifact?: Artifact) {
    validateCategory(params.requiredCategory, 'requiredCategory');
    validatePositiveBigInt(params.minTokenAmount, 'minTokenAmount');
    const art = artifact ?? (defaultArtifact as unknown as Artifact);
    this.params = params;
    this.contract = new Contract(art, [
      params.requiredCategory,
      params.minTokenAmount,
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

  buildVerifyTokenAndSpend(spenderKey: Uint8Array) {
    const sigTemplate = new SignatureTemplate(spenderKey);
    return this.contract.functions.verifyTokenAndSpend(spenderKey, sigTemplate);
  }

  getComposableUnlocker(continuationIndex: bigint) {
    return this.contract.unlock.composableVerify(continuationIndex);
  }

  /**
   * Convert a token category hex string (display/wallet format) to VM byte order.
   * Use this when constructing TokenGateParams.requiredCategory.
   */
  static categoryToVMBytes(categoryHex: string): Uint8Array {
    const bytes = new Uint8Array(categoryHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    return Uint8Array.from(bytes.reverse());
  }
}
