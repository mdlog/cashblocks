/**
 * Cashscript Bridge
 *
 * Re-exports cashscript to ensure all modules use the same instance.
 * With the lockfile resolving cashblocks from npm registry, there is
 * only one copy of cashscript — no duplicate instance issues.
 */
export {
  ElectrumNetworkProvider,
  MockNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  randomUtxo,
} from 'cashscript';
