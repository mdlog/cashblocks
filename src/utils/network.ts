import { ElectrumNetworkProvider, MockNetworkProvider } from 'cashscript';

export type NetworkType = 'mainnet' | 'chipnet' | 'mock';

export function createProvider(network: NetworkType) {
  if (network === 'mock') {
    return new MockNetworkProvider();
  }
  return new ElectrumNetworkProvider(network);
}
