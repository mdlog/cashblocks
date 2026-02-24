# CashBlocks — Social Posts for BCH-1 Hackcelerator

> 3 mandatory posts required for eligibility. Post these on X (Twitter).
> Tag: `@bch_1_official` `@DoraHacks`
> Hashtags: `#BCH1Hackcelerator` `#BitcoinCash` `#CashBlocks` `#BuildOnBCH`

---

## Post 1 — Project Announcement

**When:** Day 1 of sprint

```
Building for the @bch_1_official Hackcelerator on @DoraHacks — meet CashBlocks.

The problem: Bitcoin Cash has powerful smart contract capabilities (covenants, CashTokens, Schnorr sigs), but developers have to wire everything from scratch every time. There's no reusable toolkit.

CashBlocks is an open-source TypeScript SDK that gives you 4 ready-made smart contract primitives:

- Vault — spending limits & whitelisted recipients
- Time-State — time-gated phases (locked → restricted → open)
- Oracle Proof — verify off-chain data on-chain via Schnorr
- TokenGate — require CashToken ownership before spending

The key idea: these primitives compose. You combine multiple UTXOs in a single atomic transaction — if ANY check fails, the ENTIRE transaction is rejected. No backends, no multisig, no admin keys. Pure on-chain logic.

Think of it as the building blocks for DeFi on Bitcoin Cash.

npm install cashblocks
https://github.com/mdlog/cashblocks

#BCH1Hackcelerator #BitcoinCash #CashBlocks #BuildOnBCH
```

**Attach:** Architecture diagram or composition pattern screenshot from README

---

## Post 2 — Technical Progress / Demo

**When:** Mid-sprint

```
CashBlocks progress update for @bch_1_official Hackcelerator

Quick recap: CashBlocks is an SDK that turns Bitcoin Cash smart contracts into reusable, composable building blocks. Instead of writing custom scripts from zero, developers pick primitives (Vault, TimeState, Oracle, TokenGate) and snap them together in atomic transactions.

Where we are now:
- 4 CashScript contracts, all compiled & deployed
- 42 unit tests passing
- Verified on BCH Chipnet with real on-chain TXs
- Published on npm: cashblocks@0.2.0

Here's the flagship demo — a token-gated DAO treasury using ALL 4 primitives in one TX:

Vault (spend limit) + TimeState (cooldown) + Oracle (vote proof) + TokenGate (must hold governance tokens)

One transaction. All-or-nothing. If you don't have the tokens or the vote hasn't passed — the whole TX fails. That's the power of composable UTXOs.

Chipnet proof:
https://chipnet.chaingraph.cash/tx/efa7a54408a3a1739d572a53eebec05b88bf666cc363d3988f73338e516c9e00

#BCH1Hackcelerator #BitcoinCash #CashTokens #BuildOnBCH
```

**Attach:** Screenshot of `npm test` output (42 tests passing) or terminal running Example 10

---

## Post 3 — Vision & What's Next

**When:** Before Demo Day

```
Why CashBlocks exists — and where it's going.

Bitcoin Cash developers keep solving the same problems: how to enforce spending limits, how to add time locks, how to verify oracle data, how to gate access with tokens. Each time, they write custom CashScript from scratch.

CashBlocks packages these patterns into a standard SDK. Four primitives, zero runtime dependencies, one npm install. You import what you need, compose them in an atomic transaction, and the Bitcoin Cash VM enforces everything.

What you can build with CashBlocks today:
- DAO treasuries with token-gated voting
- Vesting schedules with cliff periods & monthly unlocks
- Price-oracle escrow with automatic timeout refunds
- Insurance pools with multi-claim covenant processing

10 runnable examples included — from basic vault ops to a full 4-primitive token-gated DAO. All open source (MIT).

The goal: become the OpenZeppelin of Bitcoin Cash — the standard library every BCH developer reaches for.

npm: https://www.npmjs.com/package/cashblocks
GitHub: https://github.com/mdlog/cashblocks

@DoraHacks #BCH1Hackcelerator #BitcoinCash #CashBlocks
```

**Attach:** Screenshot of web demo UI or Example app dashboard

---

## Bonus Post (Optional) — CashTokens Deep Dive

```
CashTokens + CashBlocks = on-chain governance without trusted parties.

CashBlocks is a composable smart contract SDK for Bitcoin Cash. One of its 4 primitives — TokenGate — lets you require CashToken ownership before any spending can happen.

Combined with the other 3 primitives, here's how a DAO proposal works entirely on-chain:

1. Oracle signs the vote result (Oracle Proof verifies via Schnorr)
2. Cooldown period enforced (Time-State checks the phase)
3. Token ownership verified (TokenGate requires governance tokens)
4. Treasury releases funds (Vault enforces spending limit)

All 4 checks happen in ONE atomic transaction. If any fails — nothing happens. Tokens are never burned — preserved via covenant continuation.

This is programmable money on Bitcoin Cash. No EVM, no bridges, no trusted parties.

Try it yourself:
npm install cashblocks cashscript
npx tsx examples/10-token-gated-dao.ts

#BitcoinCash #CashTokens #DeFi #BCH1Hackcelerator
```

---

## Tips

- Post images/screenshots — tweets with media get 2-3x engagement
- Reply to your own thread with chipnet TX links as proof
- Tag BCH community accounts for visibility
- Space posts across different days during the sprint
