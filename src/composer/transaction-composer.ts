import { TransactionBuilder } from 'cashscript';
import type { NetworkProvider, Utxo, Unlocker, TokenDetails } from 'cashscript';

interface ComposerOutput {
  to: string | Uint8Array;
  amount: bigint;
  token?: TokenDetails;
}

export class TransactionComposer {
  private provider: NetworkProvider;
  private inputs: Array<{ utxo: Utxo; unlocker: Unlocker }> = [];
  private outputs: ComposerOutput[] = [];
  private locktimeValue?: number;
  private debugEnabled: boolean;

  constructor(provider: NetworkProvider, options?: { debug?: boolean }) {
    this.provider = provider;
    this.debugEnabled = options?.debug ?? false;
  }

  addInput(utxo: Utxo, unlocker: Unlocker): this {
    this.inputs.push({ utxo, unlocker });
    return this;
  }

  addOutput(to: string | Uint8Array, amount: bigint, token?: TokenDetails): this {
    this.outputs.push({ to, amount, token });
    return this;
  }

  setLocktime(locktime: number): this {
    this.locktimeValue = locktime;
    return this;
  }

  build(): TransactionBuilder {
    const builder = new TransactionBuilder({ provider: this.provider });

    for (const input of this.inputs) {
      builder.addInput(input.utxo, input.unlocker);
    }

    for (const output of this.outputs) {
      if (output.token) {
        builder.addOutput({ to: output.to, amount: output.amount, token: output.token });
      } else {
        builder.addOutput({ to: output.to, amount: output.amount });
      }
    }

    if (this.locktimeValue !== undefined) {
      builder.setLocktime(this.locktimeValue);
    }

    return builder;
  }

  logDetails() {
    const totalIn = this.inputs.reduce((s, i) => s + i.utxo.satoshis, 0n);
    const totalOut = this.outputs.reduce((s, o) => s + o.amount, 0n);
    console.log(`[Composer] inputs=${this.inputs.length} totalIn=${totalIn} outputs=${this.outputs.length} totalOut=${totalOut} fee=${totalIn - totalOut}`);
    for (let i = 0; i < this.inputs.length; i++) {
      const inp = this.inputs[i];
      const tokenInfo = inp.utxo.token ? ` token=${inp.utxo.token.amount}` : '';
      console.log(`  input[${i}] satoshis=${inp.utxo.satoshis} txid=${inp.utxo.txid.slice(0, 12)}...${tokenInfo}`);
    }
    for (let i = 0; i < this.outputs.length; i++) {
      const out = this.outputs[i];
      const tokenInfo = out.token ? ` token=${out.token.amount}` : '';
      console.log(`  output[${i}] amount=${out.amount}${tokenInfo}`);
    }
  }

  async send() {
    const builder = this.build();
    if (this.debugEnabled) this.logDetails();
    return builder.send();
  }

  async sendDirect() {
    const builder = this.build();
    if (this.debugEnabled) this.logDetails();
    const txHex = builder.build();
    const txid = await this.provider.sendRawTransaction(txHex);
    return { txid };
  }

  debug() {
    const builder = this.build();
    return builder.debug();
  }
}
