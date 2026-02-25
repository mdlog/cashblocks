# CashBlocks DeFi Protocol Suite

[![npm](https://img.shields.io/npm/v/cashblocks)](https://www.npmjs.com/package/cashblocks)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A complete DeFi protocol suite built entirely with the [CashBlocks SDK v0.3.0](https://www.npmjs.com/package/cashblocks). Demonstrates how to compose multiple smart contract primitives into production-ready Bitcoin Cash applications.

## DeFi Scenarios

| Scenario | Primitives | Description |
|----------|-----------|-------------|
| **Lending Pool** | Vault + TimeState + Oracle | Credit-scored micro-lending with spend limits |
| **DAO Governance** | Vault + TimeState + Oracle | Vote-verified treasury proposals |
| **Yield Vault** | Vault + TimeState | Time-locked deposits with maturity-gated withdrawals |
| **Insurance Pool** | Vault + TimeState + Oracle | Oracle-verified claim processing with coverage limits |

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
npm run dev
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
node test-sdk.mjs    # 44 tests: primitives + v0.3.0 utils + composer + engines
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
         OracleProofPrimitive, TokenGatePrimitive,
         domainFromString, categoryToVMBytes } from 'cashblocks';
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
  domainSeparator: domainFromString('CRED'),
  expiryDuration: 7200n,
}, provider);

const governance = new TokenGatePrimitive({
  requiredCategory: categoryToVMBytes(categoryHex),
  minTokenAmount: 100n,
}, provider);
```

### 2. Sign an Oracle Message

```javascript
import { encodeOracleMessage, intToBytes4LE, generateNonce,
         domainFromString } from 'cashblocks';
import { secp256k1, sha256 } from '@bitauth/libauth';

const DOMAIN = domainFromString('CRED');
const nonce = generateNonce();
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

## v0.3.0 Features Used

This example app uses the following v0.3.0 SDK features:

- **`domainFromString()`** — Convert `"CRED"`, `"VOTE"`, `"DMGE"` to 4-byte domain separators
- **`categoryToVMBytes()`** — Convert token category hex to VM byte order
- **`generateNonce()`** — Generate unique nonces for oracle messages
- **`DUST_LIMIT` / `HARDCODED_FEE`** — SDK constants for dust (546 sats) and fees (1000 sats)
- **`CashBlocksError`** — Structured error handling with error codes
- **`addressToPkh()` / `pkhToAddress()`** — Address encoding helpers
- **`predictChangeValue()`** — Change calculation utility
- **Input validation** — All primitive constructors validate parameters

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
├── lending-interactive.mjs        # Interactive lending: Session-based pool
├── lending-engine-chipnet.mjs     # Engine: Lending Pool on chipnet
├── governance-engine-chipnet.mjs  # Engine: DAO Governance on chipnet
├── yield-vault-engine-chipnet.mjs # Engine: Yield Vault on chipnet
├── insurance-engine-chipnet.mjs   # Engine: Insurance Pool on chipnet
├── chipnet-helpers.mjs            # Utilities: Keys, UTXO polling, funding
├── generate-keys.mjs             # Tool: Generate keypairs for chipnet
├── test-sdk.mjs                   # Tests: 44 tests (SDK v0.3.0 + engines)
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
| `/api/chipnet/generate-wallet` | POST | Generate new keypairs |
| `/api/chipnet/balance-check` | POST | Check address balance |
| `/api/keys/generate` | POST | Generate single keypair |
| `/api/lending/init` | POST | Initialize lending pool |
| `/api/lending/loan` | POST | Request loan |
| `/api/lending/pools` | GET | List active pools |
| `/api/lending/dashboard/:id` | GET | Pool dashboard |
| `/api/lending/history/:id` | GET | Transaction history |
| `/api/lending/session/:id` | DELETE | Destroy session |

## License

MIT
