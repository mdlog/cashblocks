# CashBlocks DeFi Protocol Suite

[![npm](https://img.shields.io/npm/v/cashblocks)](https://www.npmjs.com/package/cashblocks)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A complete DeFi protocol suite built entirely with the [CashBlocks SDK](https://www.npmjs.com/package/cashblocks). Demonstrates how to compose multiple smart contract primitives into production-ready Bitcoin Cash applications.

## DeFi Scenarios

| Scenario | Primitives | Description |
|----------|-----------|-------------|
| **Lending Pool** | Vault + TimeState + Oracle + TokenGate | Credit-scored micro-lending with spend limits and governance |
| **DAO Governance** | Vault + TimeState + Oracle + TokenGate | Token-gated treasury proposals with vote verification |
| **Yield Vault** | Vault + TimeState + TokenGate | Time-locked deposits with maturity-gated withdrawals |
| **Insurance Pool** | Vault + TimeState + Oracle + TokenGate | Oracle-verified claim processing with coverage limits |

## Composable Primitives

- **Vault** — UTXO custody with spending limits, whitelisted destinations, covenant continuation
- **TimeState** — Phase-based time gates: Locked, Restricted, Unrestricted via CLTV
- **Oracle Proof** — Off-chain data verified on-chain via Schnorr checkDataSig
- **TokenGate** — CashToken ownership validation with fungible token gating
- **TransactionComposer** — Atomic multi-input transactions combining all primitives

## Quick Start

### Web Dashboard

```bash
npm install
node server.mjs
# Open http://localhost:3060
```

### CLI

```bash
# Run all 4 DeFi scenarios
node app.mjs

# Run a specific scenario
node app.mjs lending
node app.mjs governance
node app.mjs yield-vault
node app.mjs insurance
```

### Tests

```bash
node test-sdk.mjs    # 28 tests: primitives + composer + all engines
```

## Architecture

```
                    ┌──────────────────────────────┐
                    │      DeFi Protocol Suite      │
                    │  4 scenarios, 4 primitives    │
                    └──────────────┬───────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
  ┌───────▼───────┐    ┌──────────▼──────────┐   ┌─────────▼────────┐
  │    Vault      │    │    TimeState        │   │   Oracle Proof   │
  │  Pool custody │    │  Phase gates via    │   │  Off-chain data  │
  │  Spend limits │    │  CLTV timelocks     │   │  Schnorr verify  │
  └───────┬───────┘    └──────────┬──────────┘   └─────────┬────────┘
          │                       │                        │
          │            ┌──────────▼──────────┐             │
          │            │    TokenGate        │             │
          │            │  CashToken gating   │             │
          │            │  Fungible tokens    │             │
          │            └──────────┬──────────┘             │
          │                       │                        │
          └───────────────────────┼────────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │   TransactionComposer      │
                    │   N inputs → 1 atomic TX   │
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │   On-chain execution        │
                    │   All-or-nothing guarantee  │
                    └────────────────────────────┘
```

## SDK Usage

### 1. Initialize Primitives

```javascript
import { VaultPrimitive, TimeStatePrimitive,
         OracleProofPrimitive, TokenGatePrimitive } from 'cashblocks';
import { MockNetworkProvider } from 'cashscript';

const provider = new MockNetworkProvider();

const pool = new VaultPrimitive({
  ownerPk: lenderPub,
  spendLimit: 500_000n,
  whitelistHash: borrowerPkh,
}, provider);

const schedule = new TimeStatePrimitive({
  ownerPk: lenderPub,
  phase1Time: BigInt(appStart),
  phase2Time: BigInt(appEnd),
}, provider);

const credit = new OracleProofPrimitive({
  oraclePk: assessorPub,
  domainSeparator: new Uint8Array([0x43, 0x52, 0x45, 0x44]),
  expiryDuration: 7200n,
}, provider);

const governance = new TokenGatePrimitive({
  requiredCategory: TokenGatePrimitive.categoryToVMBytes(categoryHex),
  minTokenAmount: 100n,
}, provider);
```

### 2. Sign an Oracle Message

```javascript
import { encodeOracleMessage, intToBytes4LE } from 'cashblocks';
import { secp256k1, sha256 } from '@bitauth/libauth';

const payload = intToBytes4LE(85n);  // credit score = 85
const message = encodeOracleMessage(DOMAIN, timestamp, nonce, payload);
const signature = secp256k1.signMessageHashSchnorr(
  assessorPrivKey, sha256.hash(message)
);
```

### 3. Compose an Atomic Transaction

```javascript
import { TransactionComposer } from 'cashblocks';
import { SignatureTemplate } from 'cashscript';

const composer = new TransactionComposer(provider);
composer
  .addInput(poolUtxo, pool.contract.unlock.composableSpend(lenderSig, amount, 0n))
  .addInput(timerUtxo, schedule.contract.unlock.composableCheck(lenderSig, 1n))
  .addInput(oracleUtxo, credit.contract.unlock.composableVerify(oracleSig, oracleMsg))
  .addInput(govUtxo, governance.contract.unlock.composableVerify(2n))
  .addOutput(pool.address, poolBalance - amount)
  .addOutput(borrower.address, amount)
  .addOutput(governance.tokenAddress, 1000n,
    { amount: 100n, category: TOKEN_CATEGORY })
  .setLocktime(Number(timestamp) + 10);

const tx = await composer.send();
```

## Chipnet (Real Testnet)

Run the lending scenario with real BCH transactions on chipnet:

```bash
node generate-keys.mjs                # Generate keypairs
# Fund the Lender address from https://tbch.googol.cash/
node server.mjs                        # Start server
# Open http://localhost:3060 → Chipnet toggle
```

## Project Structure

```
example-app/
├── app.mjs                        # CLI: Run all 4 DeFi scenarios
├── server.mjs                     # Express server: Multi-scenario API
├── lending-engine.mjs             # Engine: Lending Pool (4 primitives)
├── governance-engine.mjs          # Engine: DAO Governance (4 primitives)
├── yield-vault-engine.mjs         # Engine: Yield Vault (3 primitives)
├── insurance-engine.mjs           # Engine: Insurance Pool (4 primitives)
├── lending-engine-chipnet.mjs     # Engine: Lending on chipnet
├── chipnet-helpers.mjs            # Utilities: Keys, UTXO polling
├── generate-keys.mjs              # Tool: Generate keypairs for chipnet
├── test-sdk.mjs                   # Tests: 28 tests (SDK + all engines)
├── package.json
└── public/
    ├── index.html                 # Dashboard: 4-scenario DeFi protocol
    ├── app.js                     # Frontend: SSE streaming, tabs
    └── styles.css                 # Frontend: Dark theme, responsive
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scenario/lending` | POST | Run lending scenario (SSE) |
| `/api/scenario/governance` | POST | Run governance scenario (SSE) |
| `/api/scenario/yield-vault` | POST | Run yield vault scenario (SSE) |
| `/api/scenario/insurance` | POST | Run insurance scenario (SSE) |
| `/api/chipnet/status` | GET | Check keys + balance |
| `/api/chipnet/generate-keys` | POST | Generate new keypairs |
| `/api/chipnet/run-stream` | POST | Run chipnet lending (SSE) |

## License

MIT
