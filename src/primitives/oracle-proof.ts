import { Contract, SignatureTemplate } from 'cashscript';
import type { NetworkProvider, Utxo } from 'cashscript';
import { compileFile } from 'cashc';
import type { OracleProofParams } from '../utils/types.js';
import { encodeOracleMessage } from '../utils/encoding.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTRACT_PATH = resolve(__dirname, '../../contracts/oracle-proof.cash');

export class OracleProofPrimitive {
  public contract: Contract;
  private params: OracleProofParams;

  constructor(params: OracleProofParams, provider: NetworkProvider) {
    const artifact = compileFile(CONTRACT_PATH);
    this.params = params;
    this.contract = new Contract(artifact, [
      params.oraclePk,
      params.domainSeparator,
      params.expiryDuration,
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

  buildMessage(timestamp: bigint, nonce: bigint, payload: Uint8Array): Uint8Array {
    return encodeOracleMessage(this.params.domainSeparator, timestamp, nonce, payload);
  }

  buildVerifyAndSpend(
    spenderPk: Uint8Array,
    spenderKey: Uint8Array,
    oracleSig: Uint8Array,
    oracleMessage: Uint8Array,
  ) {
    const sigTemplate = new SignatureTemplate(spenderKey);
    return this.contract.functions.verifyAndSpend(
      spenderPk,
      sigTemplate,
      oracleSig,
      oracleMessage,
    );
  }

  buildVerifyWithPayloadConstraint(
    spenderPk: Uint8Array,
    spenderKey: Uint8Array,
    oracleSig: Uint8Array,
    oracleMessage: Uint8Array,
    requiredMinValue: bigint,
  ) {
    const sigTemplate = new SignatureTemplate(spenderKey);
    return this.contract.functions.verifyWithPayloadConstraint(
      spenderPk,
      sigTemplate,
      oracleSig,
      oracleMessage,
      requiredMinValue,
    );
  }

  getComposableUnlocker(oracleSig: Uint8Array, oracleMessage: Uint8Array) {
    return this.contract.unlock.composableVerify(oracleSig, oracleMessage);
  }
}
