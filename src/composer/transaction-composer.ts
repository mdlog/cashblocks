import { TransactionBuilder } from 'cashscript';
import type { NetworkProvider, Utxo, Unlocker } from 'cashscript';

interface ComposerOutput {
  to: string | Uint8Array;
  amount: bigint;
}

export class TransactionComposer {
  private provider: NetworkProvider;
  private inputs: Array<{ utxo: Utxo; unlocker: Unlocker }> = [];
  private outputs: ComposerOutput[] = [];
  private locktimeValue?: number;

  constructor(provider: NetworkProvider) {
    this.provider = provider;
  }

  addInput(utxo: Utxo, unlocker: Unlocker): this {
    this.inputs.push({ utxo, unlocker });
    return this;
  }

  addOutput(to: string | Uint8Array, amount: bigint): this {
    this.outputs.push({ to, amount });
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
      builder.addOutput({ to: output.to, amount: output.amount });
    }

    if (this.locktimeValue !== undefined) {
      builder.setLocktime(this.locktimeValue);
    }

    return builder;
  }

  async send() {
    const builder = this.build();
    return builder.send();
  }

  debug() {
    const builder = this.build();
    return builder.debug();
  }
}
