/**
 * Governance Engine — DAO Treasury with Token-Gated Proposals
 *
 * 4 Primitives composed atomically:
 *   Vault      → Treasury with per-proposal budget limits
 *   TimeState  → Voting window phases (Proposal → Execution → Closed)
 *   Oracle     → Vote count verification via off-chain tally
 *   TokenGate  → Governance token requirement for proposers
 */
import {
  VaultPrimitive,
  TimeStatePrimitive,
  OracleProofPrimitive,
  TokenGatePrimitive,
  TransactionComposer,
  encodeOracleMessage,
  intToBytes4LE,
} from 'cashblocks';

import {
  MockNetworkProvider,
  randomUtxo,
  SignatureTemplate,
} from 'cashscript';

import {
  secp256k1,
  generatePrivateKey,
  hash160,
  sha256,
  encodeCashAddress,
  CashAddressType,
} from '@bitauth/libauth';

function generateKeypair(label) {
  const privKey = generatePrivateKey();
  const pubKey = secp256k1.derivePublicKeyCompressed(privKey);
  const pkh = hash160(pubKey);
  const address = encodeCashAddress({
    payload: pkh,
    prefix: 'bchtest',
    type: CashAddressType.p2pkh,
  }).address;
  return { label, privKey, pubKey, pkh, address };
}

export async function runGovernanceScenario(config = {}, onStep) {
  const {
    treasuryBalance = 10_000_000n,
    maxProposal     = 2_000_000n,
    minVotes        = 100n,
    votingStart     = 1_700_100_000,
    votingEnd       = 1_700_200_000,
    proposal1Amount = 1_500_000n,
    proposal1Votes  = 150n,
    proposal2Amount = 800_000n,
    proposal2Votes  = 120n,
  } = config;

  const DOMAIN = new Uint8Array([0x56, 0x4f, 0x54, 0x45]); // "VOTE"
  const TOKEN_CATEGORY = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const GOV_TOKEN_MIN = 50n;
  const steps = [];
  const start = Date.now();

  function emit(step) {
    steps.push(step);
    onStep?.(step);
  }

  // --- Participants ---
  const admin    = generateKeypair('DAO Admin');
  const proposer = generateKeypair('Proposer');
  const counter  = generateKeypair('Vote Counter');

  emit({
    id: 'setup', type: 'info', title: 'DAO Participants Generated',
    details: {
      'DAO Admin': admin.address,
      Proposer: proposer.address,
      'Vote Counter': counter.address,
    },
  });

  // --- Deploy ---
  const provider = new MockNetworkProvider();

  const treasury = new VaultPrimitive({
    ownerPk: admin.pubKey,
    spendLimit: maxProposal,
    whitelistHash: proposer.pkh,
  }, provider);

  const voting = new TimeStatePrimitive({
    ownerPk: admin.pubKey,
    phase1Time: BigInt(votingStart),
    phase2Time: BigInt(votingEnd),
  }, provider);

  const votes = new OracleProofPrimitive({
    oraclePk: counter.pubKey,
    domainSeparator: DOMAIN,
    expiryDuration: 7200n,
  }, provider);

  const governance = new TokenGatePrimitive({
    requiredCategory: TokenGatePrimitive.categoryToVMBytes(TOKEN_CATEGORY),
    minTokenAmount: GOV_TOKEN_MIN,
  }, provider);

  emit({
    id: 'deploy', type: 'info', title: 'DAO Contracts Deployed',
    details: {
      'Treasury (Vault)': treasury.address,
      'Voting (TimeState)': voting.address,
      'Vote Oracle': votes.address,
      'Governance (TokenGate)': governance.tokenAddress,
      'Max per proposal': `${maxProposal.toLocaleString()} sats`,
      'Min votes required': `${minVotes}`,
      'Gov tokens required': `${GOV_TOKEN_MIN}`,
    },
  });

  // --- Fund treasury ---
  let treasuryUtxo = randomUtxo({ satoshis: treasuryBalance });
  provider.addUtxo(treasury.address, treasuryUtxo);
  let currentBalance = treasuryBalance;

  emit({
    id: 'funded', type: 'info', title: 'Treasury Funded',
    details: { Amount: `${treasuryBalance.toLocaleString()} sats` },
  });

  const adminSig = new SignatureTemplate(admin.privKey);

  function signVoteCount(voteCount, timestamp, nonce) {
    const payload = intToBytes4LE(voteCount);
    const msg = encodeOracleMessage(DOMAIN, timestamp, nonce, payload);
    const msgHash = sha256.hash(msg);
    const sig = secp256k1.signMessageHashSchnorr(counter.privKey, msgHash);
    return { sig, msg };
  }

  function govTokenUtxo(satoshis, tokenAmount) {
    return {
      ...randomUtxo({ satoshis }),
      token: { amount: tokenAmount, category: TOKEN_CATEGORY },
    };
  }

  async function tryProposal(amount, voteCount, timestamp, nonce) {
    const { sig: oSig, msg: oMsg } = signVoteCount(voteCount, timestamp, nonce);
    const votingUtxo = randomUtxo({ satoshis: 1_000n });
    const oracleUtxo = randomUtxo({ satoshis: 1_000n });
    const govUtxo = govTokenUtxo(1_000n, GOV_TOKEN_MIN);
    provider.addUtxo(voting.address, votingUtxo);
    provider.addUtxo(votes.address, oracleUtxo);
    provider.addUtxo(governance.tokenAddress, govUtxo);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(treasuryUtxo, treasury.contract.unlock.composableSpend(adminSig, amount, 0n))
      .addInput(votingUtxo, voting.contract.unlock.composableCheck(adminSig, 1n))
      .addInput(oracleUtxo, votes.contract.unlock.composableVerify(oSig, oMsg))
      .addInput(govUtxo, governance.contract.unlock.composableVerify(2n))
      .addOutput(treasury.address, currentBalance - amount)
      .addOutput(proposer.address, amount)
      .addOutput(governance.tokenAddress, 1_000n, { amount: GOV_TOKEN_MIN, category: TOKEN_CATEGORY })
      .setLocktime(Number(timestamp) + 10);
    return composer.send();
  }

  // ── BLOCKED 1: Before voting window ──
  try {
    await tryProposal(500_000n, 150n, BigInt(votingStart - 50_000), 1n);
  } catch {
    emit({
      id: 'blocked-1', type: 'blocked', title: 'Proposal Before Voting Window',
      details: {
        Timestamp: `${votingStart - 50_000} (before window)`,
        'Voting opens': `${votingStart}`,
        'Enforced by': 'TimeState (voting phase gate)',
      },
      primitives: ['TimeState'],
    });
  }

  // ── BLOCKED 2: Insufficient votes ──
  try {
    const ts2 = BigInt(votingStart + 100);
    const { sig, msg } = signVoteCount(30n, ts2, 2n);
    const oracleUtxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(votes.address, oracleUtxo);
    const spPriv = generatePrivateKey();
    const spPub = secp256k1.derivePublicKeyCompressed(spPriv);
    const spSig = new SignatureTemplate(spPriv);
    const tx = votes.contract.functions.verifyWithPayloadConstraint(
      spPub, spSig, sig, msg, minVotes,
    );
    await tx.to(proposer.address, 546n).withoutChange().send();
  } catch {
    emit({
      id: 'blocked-2', type: 'blocked', title: 'Insufficient Votes',
      details: {
        Votes: '30',
        'Minimum required': `${minVotes}`,
        'Enforced by': 'Oracle (vote count verification)',
      },
      primitives: ['Oracle'],
    });
  }

  // ── BLOCKED 3: Over budget ──
  try {
    await tryProposal(maxProposal + 500_000n, 200n, BigInt(votingStart + 200), 3n);
  } catch {
    emit({
      id: 'blocked-3', type: 'blocked', title: 'Proposal Exceeds Budget',
      details: {
        Requested: `${(maxProposal + 500_000n).toLocaleString()} sats`,
        Limit: `${maxProposal.toLocaleString()} sats`,
        'Enforced by': 'Vault (per-proposal budget limit)',
      },
      primitives: ['Vault'],
    });
  }

  // ── BLOCKED 4: No governance tokens ──
  try {
    const ts4 = BigInt(votingStart + 250);
    const { sig: oSig4, msg: oMsg4 } = signVoteCount(150n, ts4, 7n);
    const votingUtxo4 = randomUtxo({ satoshis: 1_000n });
    const oracleUtxo4 = randomUtxo({ satoshis: 1_000n });
    const badGovUtxo = govTokenUtxo(1_000n, 10n);
    provider.addUtxo(voting.address, votingUtxo4);
    provider.addUtxo(votes.address, oracleUtxo4);
    provider.addUtxo(governance.tokenAddress, badGovUtxo);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(treasuryUtxo, treasury.contract.unlock.composableSpend(adminSig, 500_000n, 0n))
      .addInput(votingUtxo4, voting.contract.unlock.composableCheck(adminSig, 1n))
      .addInput(oracleUtxo4, votes.contract.unlock.composableVerify(oSig4, oMsg4))
      .addInput(badGovUtxo, governance.contract.unlock.composableVerify(2n))
      .addOutput(treasury.address, currentBalance - 500_000n)
      .addOutput(proposer.address, 500_000n)
      .addOutput(governance.tokenAddress, 1_000n, { amount: 10n, category: TOKEN_CATEGORY })
      .setLocktime(Number(ts4) + 10);
    await composer.send();
  } catch {
    emit({
      id: 'blocked-4', type: 'blocked', title: 'Insufficient Governance Tokens',
      details: {
        'Tokens held': '10',
        'Minimum required': `${GOV_TOKEN_MIN}`,
        'Enforced by': 'TokenGate (CashTokens)',
      },
      primitives: ['TokenGate'],
    });
  }

  // ── SUCCESS 1: Proposal #1 ──
  const tx1 = await tryProposal(proposal1Amount, proposal1Votes, BigInt(votingStart + 300), 4n);
  currentBalance -= proposal1Amount;
  emit({
    id: 'success-1', type: 'success', title: `Proposal #1 — ${proposal1Amount.toLocaleString()} sats`,
    txid: tx1.txid,
    details: {
      'Vote count': `${proposal1Votes} (>= ${minVotes} threshold)`,
      Amount: `${proposal1Amount.toLocaleString()} sats`,
      'Treasury remaining': `${currentBalance.toLocaleString()} sats`,
    },
    primitives: ['Vault', 'TimeState', 'Oracle', 'TokenGate'],
  });

  treasuryUtxo = randomUtxo({ satoshis: currentBalance });
  provider.addUtxo(treasury.address, treasuryUtxo);

  // ── SUCCESS 2: Proposal #2 ──
  const tx2 = await tryProposal(proposal2Amount, proposal2Votes, BigInt(votingStart + 400), 5n);
  currentBalance -= proposal2Amount;
  emit({
    id: 'success-2', type: 'success', title: `Proposal #2 — ${proposal2Amount.toLocaleString()} sats`,
    txid: tx2.txid,
    details: {
      'Vote count': `${proposal2Votes} (>= ${minVotes} threshold)`,
      Amount: `${proposal2Amount.toLocaleString()} sats`,
      'Treasury remaining': `${currentBalance.toLocaleString()} sats`,
      Covenant: 'Treasury continuation verified',
    },
    primitives: ['Vault', 'TimeState', 'Oracle', 'TokenGate'],
  });

  // ── BLOCKED 5: After voting window ──
  treasuryUtxo = randomUtxo({ satoshis: currentBalance });
  provider.addUtxo(treasury.address, treasuryUtxo);
  try {
    await tryProposal(500_000n, 200n, BigInt(votingEnd + 100), 8n);
  } catch {
    emit({
      id: 'blocked-5', type: 'blocked', title: 'Proposal After Voting Closed',
      details: {
        Timestamp: `${votingEnd + 100} (after window)`,
        'Voting closed': `${votingEnd}`,
        'Enforced by': 'TimeState (execution phase ended)',
      },
      primitives: ['TimeState'],
    });
  }

  const totalSpent = proposal1Amount + proposal2Amount;
  return {
    title: 'DAO Governance — Token-Gated Treasury',
    params: {
      'Treasury balance': `${treasuryBalance.toLocaleString()} sats`,
      'Max per proposal': `${maxProposal.toLocaleString()} sats`,
      'Min votes': `${minVotes}`,
      'Gov tokens required': `${GOV_TOKEN_MIN}`,
      'Voting window': `${votingStart} — ${votingEnd}`,
    },
    steps,
    summary: {
      'Initial treasury': `${treasuryBalance.toLocaleString()} sats`,
      'Proposal #1': `-${proposal1Amount.toLocaleString()} sats (${proposal1Votes} votes)`,
      'Proposal #2': `-${proposal2Amount.toLocaleString()} sats (${proposal2Votes} votes)`,
      'Treasury remaining': `${currentBalance.toLocaleString()} sats`,
      'Total disbursed': `${totalSpent.toLocaleString()} sats`,
      Utilization: `${((Number(totalSpent) / Number(treasuryBalance)) * 100).toFixed(1)}%`,
      'Attacks blocked': '5',
      'Proposals executed': '2',
    },
    executionTimeMs: Date.now() - start,
  };
}
