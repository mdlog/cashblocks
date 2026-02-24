# CashBlocks Roadmap & Business Plan

## Vision

CashBlocks becomes the standard SDK for composable smart contracts on Bitcoin Cash — the "OpenZeppelin of BCH". Every DeFi app, DAO, and token system on BCH uses CashBlocks primitives as building blocks.

## Current State (v0.1.0)

- 4 composable primitives: Vault, Time-State, Oracle Proof, TokenGate
- CashTokens integration (fungible token gating)
- TypeScript SDK with TransactionComposer
- 42 unit tests, verified on BCH Chipnet
- Web demo UI + MicroLend example app
- npm package ready (`cashblocks`)

## Roadmap

### Phase 1: Foundation (Q1 2026) — Current
- [x] Core primitives (Vault, Time-State, Oracle Proof)
- [x] CashTokens integration (TokenGate)
- [x] SDK with TransactionComposer
- [x] Unit tests + Chipnet deployment
- [x] Web demo + Example app
- [ ] npm publish to registry
- [ ] Developer documentation site

### Phase 2: Expansion (Q2 2026)
- [ ] **NFT primitives**: Minting contracts, NFT-gated access, collectible vaults
- [ ] **Multi-party primitives**: Escrow with arbiter, multi-sig vaults
- [ ] **Dynamic fee calculation**: Replace hardcoded 1000 sats
- [ ] **Mainnet deployment**: Production-ready contracts on BCH mainnet
- [ ] **CLI tool**: `cashblocks init` scaffolding for new projects
- [ ] Developer tutorials and video walkthroughs

### Phase 3: Ecosystem (Q3-Q4 2026)
- [ ] **DEX primitive**: Atomic swap building blocks
- [ ] **Staking primitive**: Token staking with rewards
- [ ] **Governance framework**: Full DAO toolkit with proposal lifecycle
- [ ] **Plugin system**: Community-contributed primitives
- [ ] **Audit**: Third-party security audit of core contracts
- [ ] **Grants program**: Fund developers building with CashBlocks

### Phase 4: Maturity (2027)
- [ ] **Cross-chain bridges**: Composable primitives for BCH interoperability
- [ ] **Advanced scripting**: Leverage future BCH CHIPs (VM limits, BigInt)
- [ ] **Enterprise SDK**: Managed hosting, monitoring, analytics
- [ ] **Certification**: Verified contract registry

## Business Model

### Open Source Core (MIT)
All primitives, SDK, and tooling remain open source. Revenue from:

1. **Premium Support & Consulting**: Help teams integrate CashBlocks
2. **Managed Infrastructure**: Hosted oracle services, UTXO indexing
3. **Enterprise Features**: Monitoring dashboards, automated testing
4. **Grants & Ecosystem Funding**: BCH ecosystem grants, hackathon prizes

### Target Users
- **DeFi developers** building on Bitcoin Cash
- **DAO creators** needing governance infrastructure
- **Token projects** requiring smart contract logic
- **Enterprise** exploring BCH for settlement/escrow

## Key Metrics

| Metric | Current | Q2 2026 Target | Q4 2026 Target |
|--------|---------|----------------|----------------|
| Primitives | 4 | 8 | 15+ |
| npm downloads/month | - | 500 | 5,000 |
| GitHub stars | - | 100 | 500 |
| Projects using CashBlocks | 1 | 10 | 50 |
| Unit tests | 42 | 80 | 150+ |
| Chipnet verified TXs | 4 | 20 | 50+ |

## Team

**MDlabs** — Building developer tooling for Bitcoin Cash.

## Links

- GitHub: https://github.com/mdlog/cashblocks
- npm: cashblocks
- Demo: Web UI (port 5555)
- Chipnet TXs: Verified on chipnet.chaingraph.cash
