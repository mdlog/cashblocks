# CashBlocks

**Composable UTXO building blocks for Bitcoin Cash.**

Three primitives — Vault, Time-State, and Oracle Proof — that developers can combine in atomic transactions to build DeFi, DAOs, vesting, and more. No backends, no admins, no multisig.

Deployed & verified on BCH Chipnet — see [Chipnet Deployment](#chipnet-deployment).

## Primitives

### Vault
UTXO with **spending policy**: owner signature, per-transaction spend limit, and whitelisted destination.

```
Vault(ownerPk, spendLimit, whitelistHash)
├── partialSpend(sig, amount)     → spend within limit, covenant continues
├── fullSpend(sig)                → drain when balance ≤ limit
└── composableSpend(sig, amount, idx) → flexible output for multi-primitive TX
```

### Time-State
UTXO whose **behavior changes over time** through three phases:

```
TimeState(ownerPk, phase1Time, phase2Time)
├── Phase 0 (Locked)      → no spending allowed
├── Phase 1 (Restricted)  → partial spend, must leave continuation
├── Phase 2 (Unrestricted)→ full spend, no restrictions
│
├── spendRestricted(sig, amount)    → Phase 1 only
├── spendUnrestricted(sig)          → Phase 2 only
└── composableCheck(sig, phase)     → phase gate for composed TX
```

### Oracle Proof
Verify **off-chain data on-chain** via signature-based oracle. Stateless — consumed and destroyed after use.

```
OracleProof(oraclePk, domainSeparator, expiryDuration)

Message format: [domain 4B][timestamp 4B][nonce 4B][payload NB]

├── verifyAndSpend(spenderPk, sig, oracleSig, msg)     → full verification
├── composableVerify(oracleSig, msg)                    → for composed TX
└── verifyWithPayloadConstraint(... , minValue)         → value-gated
```

## Composition Pattern

Primitives don't call each other. Composition happens by **consuming multiple UTXOs in one atomic transaction**. If any primitive's script fails, the entire transaction is rejected.

```
┌─────────────────────────────────────────────────────┐
│                 Single Transaction                   │
│                                                      │
│  Input 0: Vault UTXO       → "Is spend within policy?" │
│  Input 1: Time-State UTXO  → "Is it time yet?"       │
│  Input 2: Oracle Proof UTXO → "Is condition met?"    │
│                                                      │
│  Output 0: Vault continuation (remaining funds)      │
│  Output 1: Payment to recipient                      │
│                                                      │
│  ALL inputs must validate → atomic, trustless         │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
npm install
npm run compile:contracts
npm test                        # 33 tests
npx tsx examples/05-conditional-treasury.ts  # flagship demo
```

## Chipnet Deployment

All three contracts have been deployed and tested on BCH Chipnet (testnet).

### Deploy Your Own

```bash
# 1. Generate keys (owner, recipient, oracle)
npm run keys:generate

# 2. Fund owner address with chipnet BCH
#    Faucet: https://tbch.googol.cash/ (select "chipnet")

# 3. Deploy contracts (funds vault, time-state, oracle)
npm run deploy:chipnet

# 4. Run on-chain tests
npm run test:chipnet
```

### Verified On-Chain Transactions

| Test | TX | Result |
|------|----|--------|
| Contract Funding | [eec8e12b...](https://chipnet.chaingraph.cash/tx/eec8e12b6296578bd689af32981757ea3f3b10762bbab82509dac9b0c417a349) | 500K sats to Vault, 2K to Time-State, 2K to Oracle |
| Vault Partial Spend | [efa7a544...](https://chipnet.chaingraph.cash/tx/efa7a54408a3a1739d572a53eebec05b88bf666cc363d3988f73338e516c9e00) | 10K sats to recipient, covenant enforced change back |
| Vault Partial Spend #2 | [8bbed7a3...](https://chipnet.chaingraph.cash/tx/8bbed7a35b041ccec516cdfad6ca99c8d9a879e4eb0da8de4665e82e09f7fa9f) | Repeat spend, proving covenant continuation works |
| Oracle Proof Verify | [31cb5e72...](https://chipnet.chaingraph.cash/tx/31cb5e72b298061f2e95319ed12cba789f864d1702c6ff2563a93105f88229f3) | Schnorr datasig verified on-chain, UTXO consumed |

### Chipnet Notes

- **Vault**: Fully functional. Partial spend with covenant continuation verified multiple times on-chain.
- **Oracle Proof**: Fully functional. Schnorr `checkDataSig` verification with domain, timestamp, nonce, and expiry all validated on-chain.
- **Time-State**: Requires the network's Median Time Past (MTP) to catch up to `phase1Time`. On chipnet, blocks are mined every ~20 minutes and MTP can lag 2-4 hours behind real time. Time-State works correctly once MTP >= the configured phase time.

## Project Structure

```
contracts/
  vault.cash              # Vault CashScript contract
  time-state.cash         # Time-State CashScript contract
  oracle-proof.cash       # Oracle Proof CashScript contract
src/
  primitives/
    vault.ts              # Vault SDK helper
    time-state.ts         # Time-State SDK helper
    oracle-proof.ts       # Oracle Proof SDK helper
  composer/
    transaction-composer.ts  # Multi-primitive TX builder
  utils/
    types.ts              # Shared interfaces & enums
    encoding.ts           # Oracle message encoding
    network.ts            # Provider factory
  index.ts                # Barrel export
scripts/
  generate-keys.ts        # Generate owner/recipient/oracle keypairs
  deploy-chipnet.ts       # Deploy & fund contracts on chipnet
  test-chipnet.ts         # Run on-chain integration tests
examples/
  01-vault-basic.ts       # Create vault, partial/full spend
  02-time-state-basic.ts  # Phase transitions demo
  03-oracle-proof-basic.ts # Oracle verify on-chain
  04-vault-with-timelock.ts # Vault + Time-State (2 primitives)
  05-conditional-treasury.ts # All 3 primitives composed
  06-vesting-schedule.ts  # Multi-round vesting simulation
test/
  vault.test.ts           # 11 tests
  time-state.test.ts      # 10 tests
  oracle-proof.test.ts    # 8 tests
  composer.test.ts        # 4 tests
```

## Examples

### Basic Vault
```typescript
import { Contract, SignatureTemplate, TransactionBuilder, MockNetworkProvider, randomUtxo } from 'cashscript';
import { compileFile } from 'cashc';

const artifact = compileFile('./contracts/vault.cash');
const contract = new Contract(artifact, [ownerPub, 10_000n, recipientPkh], { provider });

// Fund the vault
provider.addUtxo(contract.address, randomUtxo({ satoshis: 100_000n }));

// Partial spend
const builder = new TransactionBuilder({ provider });
builder.addInput(utxo, contract.unlock.partialSpend(new SignatureTemplate(ownerPriv), 5_000n));
builder.addOutput({ to: recipientAddr, amount: 5_000n });
builder.addOutput({ to: contract.address, amount: 94_000n }); // covenant continuation
await builder.send();
```

### Conditional Treasury (3 Primitives)
```typescript
import { TransactionComposer } from './src/composer/transaction-composer.js';

const composer = new TransactionComposer(provider);
composer
  .addInput(vaultUtxo, vault.unlock.composableSpend(ownerSig, 100_000n, 0n))
  .addInput(tsUtxo, timeState.unlock.composableCheck(ownerSig, 1n))
  .addInput(oracleUtxo, oracle.unlock.composableVerify(oracleSig, message))
  .addOutput(vault.address, 4_900_000n)   // vault continuation
  .addOutput(recipientAddr, 100_000n)      // payment
  .setLocktime(1_700_100_100);

await composer.send(); // All 3 primitives validate atomically
```

## Technical Details

### CashScript Features Used
- **Native introspection**: `tx.inputs[this.activeInputIndex]`, `tx.outputs[i]` for covenant enforcement
- **CLTV**: `tx.time >= expr` for absolute time locks
- **Locktime checks**: `tx.locktime < expr` for upper-bound time gates
- **checkDataSig**: Schnorr signature verification for oracle data
- **Self-bytecode continuation**: `tx.inputs[this.activeInputIndex].lockingBytecode` for covenant pattern

### Key Design Decisions
- **Composable functions** separate from standalone — `composableSpend`, `composableCheck`, `composableVerify` enforce fewer output constraints for flexible multi-primitive transactions
- **Oracle is stateless** — consumed and destroyed, create new UTXOs for repeated proofs
- **Time-State uses absolute CLTV** (`tx.time`) not relative CSV — phases are calendar-based
- **Miner fee hardcoded at 1000 sats** — hackathon simplification

## Testing

```bash
# Unit tests (33 tests, MockNetworkProvider)
npm test

# Run examples (MockNetworkProvider, no BCH needed)
npx tsx examples/01-vault-basic.ts
npx tsx examples/05-conditional-treasury.ts

# Chipnet integration tests (requires funded keys)
npm run test:chipnet
```

## Tech Stack

- **Smart Contracts**: CashScript ^0.11.0
- **SDK**: TypeScript + cashscript npm package
- **Crypto**: @bitauth/libauth (Schnorr signatures, hashing, address encoding)
- **Testing**: Vitest + MockNetworkProvider (unit), Chipnet (integration)
- **Runtime**: Node.js >= 18

## Use Cases

| Pattern | Primitives Used | Description |
|---|---|---|
| Treasury Management | Vault | Spending limits & whitelisted recipients |
| Vesting Schedule | Vault + Time-State | Cliff period + monthly withdrawals |
| Conditional Release | Vault + Oracle | Release funds when oracle confirms condition |
| Governance Treasury | Vault + Time-State + Oracle | Time-gated, vote-verified treasury spend |
| Salary Distribution | Time-State | Phase-based payment unlocking |
| Price-Gated Spending | Oracle (payload constraint) | Only spend when oracle price meets threshold |

## License

MIT
