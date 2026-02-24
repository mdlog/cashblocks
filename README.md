# CashBlocks

[![npm version](https://img.shields.io/npm/v/cashblocks.svg)](https://www.npmjs.com/package/cashblocks)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Composable UTXO building blocks for Bitcoin Cash.**

Four primitives — Vault, Time-State, Oracle Proof, and TokenGate (CashTokens) — that developers can combine in atomic transactions to build DeFi, DAOs, vesting, and more. No backends, no admins, no multisig.

Deployed & verified on BCH Chipnet — see [Chipnet Deployment](#chipnet-deployment).

## Installation

```bash
# As a dependency in your project
npm install cashblocks cashscript

# For development (clone the repo)
git clone https://github.com/mdlog/cashblocks.git
cd cashblocks
npm install
npm run compile:contracts
npm test    # 100 tests
```

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

### TokenGate (CashTokens)
Validate **CashToken ownership** before allowing spending. Supports fungible token gating for governance, membership, and access control.

```
TokenGate(requiredCategory, minTokenAmount)
├── verifyTokenAndSpend(spenderPk, sig)     → standalone token check
└── composableVerify(continuationIndex)      → for composed TX, preserves tokens
```

## Composition Pattern

Primitives don't call each other. Composition happens by **consuming multiple UTXOs in one atomic transaction**. If any primitive's script fails, the entire transaction is rejected.

```
┌──────────────────────────────────────────────────────────┐
│                    Single Transaction                     │
│                                                          │
│  Input 0: Vault UTXO        → "Is spend within policy?"  │
│  Input 1: Time-State UTXO   → "Is it time yet?"          │
│  Input 2: Oracle Proof UTXO → "Is condition met?"         │
│  Input 3: TokenGate UTXO    → "Has governance tokens?"    │
│                                                          │
│  Output 0: Vault continuation (remaining funds)           │
│  Output 1: Payment to recipient                           │
│  Output 2: TokenGate continuation (tokens preserved)      │
│                                                          │
│  ALL inputs must validate → atomic, trustless              │
└──────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
npm install cashblocks cashscript
```

```typescript
import {
  VaultPrimitive,
  TimeStatePrimitive,
  OracleProofPrimitive,
  TokenGatePrimitive,
  TransactionComposer,
  createProvider,
} from 'cashblocks';
```

## Chipnet Deployment

Vault, Time-State, and Oracle Proof contracts have been deployed and tested on BCH Chipnet (testnet). TokenGate is unit-tested (8 tests) and ready for chipnet deployment — it requires CashToken minting on-chain.

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
- **TokenGate**: Unit-tested with MockNetworkProvider (8/8 tests pass). Chipnet deployment requires minting CashTokens via a genesis transaction first.

## Project Structure

```
contracts/
  vault.cash              # Vault CashScript contract
  time-state.cash         # Time-State CashScript contract
  oracle-proof.cash       # Oracle Proof CashScript contract
  token-gate.cash         # TokenGate CashScript contract (CashTokens)
src/
  primitives/
    vault.ts              # Vault SDK helper
    time-state.ts         # Time-State SDK helper
    oracle-proof.ts       # Oracle Proof SDK helper
    token-gate.ts         # TokenGate SDK helper (CashTokens)
  composer/
    transaction-composer.ts  # Multi-primitive TX builder (supports tokens)
  utils/
    types.ts              # Shared interfaces & enums
    encoding.ts           # Oracle message encoding
    network.ts            # Provider factory
    errors.ts             # CashBlocksError class
    validation.ts         # Input validation helpers
    helpers.ts            # Utility functions (address, domain, nonce, etc.)
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
  07-dao-governance.ts    # DAO treasury with vote-gated proposals
  08-defi-escrow.ts       # Price-oracle escrow with timeout refund
  09-insurance-pool.ts    # Decentralized insurance claim processing
  10-token-gated-dao.ts   # Token-gated DAO with CashTokens (4 primitives!)
example-app/              # Standalone DeFi protocol suite (4 scenarios)
web/                      # Express web demo server (port 5555)
test/
  vault.test.ts           # 16 tests
  time-state.test.ts      # 14 tests
  oracle-proof.test.ts    # 13 tests
  token-gate.test.ts      # 10 tests (CashTokens)
  composer.test.ts        # 7 tests
  validation.test.ts      # 40 tests (validation + helpers)
```

## Examples

### Using CashBlocks from npm

```typescript
import { VaultPrimitive, TransactionComposer, createProvider } from 'cashblocks';

const provider = createProvider('chipnet');
const vault = new VaultPrimitive(
  { ownerPk, spendLimit: 10_000n, whitelistHash: recipientPkh },
  provider,
);

console.log('Vault address:', vault.address);
console.log('Balance:', await vault.getBalance());
```

### Composing Multiple Primitives

```typescript
import { TransactionComposer } from 'cashblocks';

const composer = new TransactionComposer(provider);
composer
  .addInput(vaultUtxo, vault.getComposableUnlocker(ownerKey, 100_000n, 0))
  .addInput(tsUtxo, timeState.getComposableUnlocker(ownerKey, 1))
  .addInput(oracleUtxo, oracle.getComposableUnlocker(oracleSig, message))
  .addOutput(vault.address, 4_900_000n)   // vault continuation
  .addOutput(recipientAddr, 100_000n)      // payment
  .setLocktime(1_700_100_100);

await composer.send(); // All 3 primitives validate atomically
```

### Real-World Use Case Examples

These examples demonstrate CashBlocks solving real problems — each runs with `MockNetworkProvider` (no BCH needed):

| Example | Command | What It Proves |
|---------|---------|---------------|
| **DAO Governance** | `npm run example:dao` | Treasury proposals require vote threshold (oracle) + time gate + spending limit. 3 attacks blocked, 2 proposals executed. |
| **DeFi Escrow** | `npm run example:escrow` | Escrow releases only when oracle confirms price >= minimum. Timeout refund if deal expires. |
| **Insurance Pool** | `npm run example:insurance` | Claims require assessor verification (oracle) + cooling period (time gate) + coverage cap (vault). Multi-claim covenant continuation. |
| **Token-Gated DAO** | `npm run example:token-dao` | **CashTokens!** Governance requires holding fungible tokens. 4 primitives composed atomically. 2 attacks blocked, 2 proposals with token preservation. |

Each example shows **failure cases first** (blocked attacks) then **success cases**, proving the on-chain logic enforces all conditions atomically.

### Web Demo

```bash
npm run web    # Starts Express server on port 5555
```

Interactive web UI with SSE streaming for running DAO, Escrow, and Insurance scenarios — both mock and chipnet modes.

### Example App

A standalone DeFi protocol suite in `example-app/` demonstrating 4 scenarios: Lending Pool, DAO Governance, Yield Vault, and Insurance Pool.

```bash
cd example-app
npm install
npm start           # Run all 4 scenarios (CLI)
npm run dev         # Start web dashboard (port 3060)
```

## Technical Details

### CashScript Features Used
- **Native introspection**: `tx.inputs[this.activeInputIndex]`, `tx.outputs[i]` for covenant enforcement
- **CLTV**: `tx.time >= expr` for absolute time locks
- **Locktime checks**: `tx.locktime < expr` for upper-bound time gates
- **checkDataSig**: Schnorr signature verification for oracle data
- **Self-bytecode continuation**: `tx.inputs[this.activeInputIndex].lockingBytecode` for covenant pattern
- **CashTokens introspection**: `tokenCategory`, `tokenAmount` for fungible token validation

### Key Design Decisions
- **Composable functions** separate from standalone — `composableSpend`, `composableCheck`, `composableVerify` enforce fewer output constraints for flexible multi-primitive transactions
- **Oracle is stateless** — consumed and destroyed, create new UTXOs for repeated proofs
- **Time-State uses absolute CLTV** (`tx.time`) not relative CSV — phases are calendar-based
- **Miner fee hardcoded at 1000 sats** — hackathon simplification
- **Zero runtime dependencies** — only `cashscript` as peer dependency

## Testing

```bash
# Unit tests (100 tests, MockNetworkProvider)
npm test

# Run examples (MockNetworkProvider, no BCH needed)
npx tsx examples/10-token-gated-dao.ts    # CashTokens flagship
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
- **Package**: [cashblocks on npm](https://www.npmjs.com/package/cashblocks) (zero dependencies)

## Use Cases

| Pattern | Primitives Used | Description |
|---|---|---|
| Treasury Management | Vault | Spending limits & whitelisted recipients |
| Vesting Schedule | Vault + Time-State | Cliff period + monthly withdrawals |
| Conditional Release | Vault + Oracle | Release funds when oracle confirms condition |
| Governance Treasury | Vault + Time-State + Oracle | Time-gated, vote-verified treasury spend |
| Token-Gated DAO | Vault + Time-State + Oracle + TokenGate | Governance tokens required to execute proposals (CashTokens) |
| Salary Distribution | Time-State | Phase-based payment unlocking |
| Price-Gated Spending | Oracle (payload constraint) | Only spend when oracle price meets threshold |

## Security Considerations

**This SDK has NOT been independently audited.** Use at your own risk, especially on mainnet.

- **Private key handling**: The SDK accepts raw private keys as `Uint8Array` for signing. Never log, transmit, or persist private keys. The SDK does not store private keys.
- **Oracle trust model**: `OracleProofPrimitive` trusts the oracle identified by `oraclePk`. A compromised oracle key can sign arbitrary messages. Use multiple oracles or threshold schemes for high-value applications.
- **Nonce reuse**: Oracle messages include a nonce field. The on-chain contract requires `nonce > 0` but does NOT enforce nonce uniqueness — replay detection is an application-layer concern. See [Oracle Nonce Management](#oracle-nonce-management).
- **Dust limit**: Bitcoin Cash enforces a dust limit of 546 satoshis. Outputs below this are rejected. Use the `DUST_LIMIT` constant from the SDK.
- **Fee estimation**: The SDK contracts use a hardcoded fee of 1000 satoshis (`HARDCODED_FEE`). This is sufficient for simple transactions but may be too low for complex multi-input transactions. Production applications should implement proper fee estimation.
- **Covenant continuation**: When using `partialSpend` or `spendRestricted`, the contract enforces that remaining funds are sent back to the same contract address. Ensure your transaction includes the continuation output at the correct index.
- **Input validation**: v0.3.0 validates all constructor parameters (key lengths, hash lengths, positive amounts). Invalid parameters throw `CashBlocksError` with descriptive messages.

## Mainnet Readiness

### Current Status: **Not Production Ready**

CashBlocks v0.3.0 is suitable for chipnet testing and prototyping.

| Area | Status | Notes |
|------|--------|-------|
| Smart Contracts | Functional | 4 contracts compiled and tested on chipnet |
| Input Validation | v0.3.0 | All constructor params validated with descriptive errors |
| Error Handling | v0.3.0 | `CashBlocksError` with error codes |
| Fee Estimation | Hardcoded | 1000 sats fixed fee — insufficient for production |
| Security Audit | **Not Done** | No independent audit has been performed |
| UTXO Management | Basic | No automatic UTXO selection or consolidation |
| Reorg Handling | None | No built-in chain reorganization detection |

### Before Mainnet Deployment

1. Replace hardcoded fees with dynamic fee estimation based on transaction size
2. Obtain a security audit of both the CashScript contracts and the TypeScript SDK
3. Implement UTXO management (automatic coin selection, dust consolidation)
4. Add retry logic for network failures and mempool conflicts
5. Test with real value on chipnet extensively before mainnet

## Oracle Nonce Management

Oracle messages use the format `[domain 4B][timestamp 4B][nonce 4B][payload NB]`. The nonce field prevents accidental message collision and supports replay-detection at the application layer.

### Generating Nonces

```typescript
import { generateNonce, domainFromString, encodeOracleMessage } from 'cashblocks';

const nonce = generateNonce(); // Combines timestamp + random, fits in 4 bytes LE
const domain = domainFromString('VOTE'); // "VOTE" → Uint8Array([0x56, 0x4f, 0x54, 0x45])

const timestamp = BigInt(Math.floor(Date.now() / 1000));
const payload = new Uint8Array([0x01]); // vote=YES
const message = encodeOracleMessage(domain, timestamp, nonce, payload);
```

### Best Practices

- **Use unique nonces** for each oracle message. `generateNonce()` combines a timestamp component with randomness.
- **Nonce size constraint**: Nonces are encoded as 4-byte little-endian integers. Range: `1` to `4,294,967,295`. `generateNonce()` handles this automatically.
- **Nonce tracking (optional)**: For replay detection, maintain a set of used nonces per domain. The on-chain contract does NOT enforce nonce uniqueness.
- **Zero nonce is rejected**: The oracle contract requires `nonce > 0`. Always use `generateNonce()` or ensure the nonce is positive.

## License

MIT
