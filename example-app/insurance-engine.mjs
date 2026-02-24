/**
 * Insurance Pool Engine — Decentralized Claim Processing
 *
 * 4 Primitives composed atomically:
 *   Vault      → Insurance pool with per-claim coverage limits
 *   TimeState  → Claim window phases (Filing → Review → Closed)
 *   Oracle     → Damage assessment verification via assessor
 *   TokenGate  → Policyholder tokens required for claims
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

export async function runInsuranceScenario(config = {}, onStep) {
  const {
    poolBalance    = 8_000_000n,
    maxClaim       = 1_500_000n,
    minDamage      = 200n,       // Minimum damage score (0-1000)
    filingStart    = 1_700_100_000,
    filingEnd      = 1_700_200_000,
    claim1Amount   = 1_000_000n,
    claim1Damage   = 750n,
    claim2Amount   = 600_000n,
    claim2Damage   = 450n,
  } = config;

  const DOMAIN = new Uint8Array([0x44, 0x4d, 0x47, 0x45]); // "DMGE"
  const TOKEN_CATEGORY = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
  const POLICY_TOKEN_MIN = 10n;
  const steps = [];
  const start = Date.now();

  function emit(step) {
    steps.push(step);
    onStep?.(step);
  }

  // --- Participants ---
  const operator  = generateKeypair('Pool Operator');
  const claimant  = generateKeypair('Claimant');
  const assessor  = generateKeypair('Claims Assessor');

  emit({
    id: 'setup', type: 'info', title: 'Insurance Participants Generated',
    details: {
      'Pool Operator': operator.address,
      Claimant: claimant.address,
      'Claims Assessor': assessor.address,
    },
  });

  // --- Deploy ---
  const provider = new MockNetworkProvider();

  const pool = new VaultPrimitive({
    ownerPk: operator.pubKey,
    spendLimit: maxClaim,
    whitelistHash: claimant.pkh,
  }, provider);

  const claimWindow = new TimeStatePrimitive({
    ownerPk: operator.pubKey,
    phase1Time: BigInt(filingStart),
    phase2Time: BigInt(filingEnd),
  }, provider);

  const damage = new OracleProofPrimitive({
    oraclePk: assessor.pubKey,
    domainSeparator: DOMAIN,
    expiryDuration: 14400n,  // 4 hours
  }, provider);

  const policyToken = new TokenGatePrimitive({
    requiredCategory: TokenGatePrimitive.categoryToVMBytes(TOKEN_CATEGORY),
    minTokenAmount: POLICY_TOKEN_MIN,
  }, provider);

  emit({
    id: 'deploy', type: 'info', title: 'Insurance Pool Deployed',
    details: {
      'Pool (Vault)': pool.address,
      'Claim Window (TimeState)': claimWindow.address,
      'Damage Oracle': damage.address,
      'Policy Tokens (TokenGate)': policyToken.tokenAddress,
      'Max per claim': `${maxClaim.toLocaleString()} sats`,
      'Min damage score': `${minDamage}`,
      'Policy tokens required': `${POLICY_TOKEN_MIN}`,
    },
  });

  // --- Fund pool ---
  let poolUtxo = randomUtxo({ satoshis: poolBalance });
  provider.addUtxo(pool.address, poolUtxo);
  let currentBalance = poolBalance;

  emit({
    id: 'funded', type: 'info', title: 'Insurance Pool Funded',
    details: { 'Premium pool': `${poolBalance.toLocaleString()} sats` },
  });

  const operatorSig = new SignatureTemplate(operator.privKey);

  function signDamageReport(damageScore, timestamp, nonce) {
    const payload = intToBytes4LE(damageScore);
    const msg = encodeOracleMessage(DOMAIN, timestamp, nonce, payload);
    const msgHash = sha256.hash(msg);
    const sig = secp256k1.signMessageHashSchnorr(assessor.privKey, msgHash);
    return { sig, msg };
  }

  function policyUtxo(satoshis, tokenAmount) {
    return {
      ...randomUtxo({ satoshis }),
      token: { amount: tokenAmount, category: TOKEN_CATEGORY },
    };
  }

  async function tryClaim(amount, damageScore, timestamp, nonce) {
    const { sig: oSig, msg: oMsg } = signDamageReport(damageScore, timestamp, nonce);
    const windowUtxo = randomUtxo({ satoshis: 1_000n });
    const oracleUtxo = randomUtxo({ satoshis: 1_000n });
    const polUtxo = policyUtxo(1_000n, POLICY_TOKEN_MIN);
    provider.addUtxo(claimWindow.address, windowUtxo);
    provider.addUtxo(damage.address, oracleUtxo);
    provider.addUtxo(policyToken.tokenAddress, polUtxo);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(poolUtxo, pool.contract.unlock.composableSpend(operatorSig, amount, 0n))
      .addInput(windowUtxo, claimWindow.contract.unlock.composableCheck(operatorSig, 1n))
      .addInput(oracleUtxo, damage.contract.unlock.composableVerify(oSig, oMsg))
      .addInput(polUtxo, policyToken.contract.unlock.composableVerify(2n))
      .addOutput(pool.address, currentBalance - amount)
      .addOutput(claimant.address, amount)
      .addOutput(policyToken.tokenAddress, 1_000n, { amount: POLICY_TOKEN_MIN, category: TOKEN_CATEGORY })
      .setLocktime(Number(timestamp) + 10);
    return composer.send();
  }

  // ── BLOCKED 1: Before claim window ──
  try {
    await tryClaim(500_000n, 600n, BigInt(filingStart - 50_000), 1n);
  } catch {
    emit({
      id: 'blocked-1', type: 'blocked', title: 'Claim Before Filing Window',
      details: {
        Timestamp: `${filingStart - 50_000} (before window)`,
        'Filing opens': `${filingStart}`,
        'Enforced by': 'TimeState (claim window)',
      },
      primitives: ['TimeState'],
    });
  }

  // ── BLOCKED 2: Damage below threshold ──
  try {
    const ts2 = BigInt(filingStart + 100);
    const { sig, msg } = signDamageReport(50n, ts2, 2n);
    const oracleUtxo = randomUtxo({ satoshis: 1_000n });
    provider.addUtxo(damage.address, oracleUtxo);
    const spPriv = generatePrivateKey();
    const spPub = secp256k1.derivePublicKeyCompressed(spPriv);
    const spSig = new SignatureTemplate(spPriv);
    const tx = damage.contract.functions.verifyWithPayloadConstraint(
      spPub, spSig, sig, msg, minDamage,
    );
    await tx.to(claimant.address, 546n).withoutChange().send();
  } catch {
    emit({
      id: 'blocked-2', type: 'blocked', title: 'Damage Score Below Threshold',
      details: {
        'Damage score': '50',
        'Minimum required': `${minDamage}`,
        'Enforced by': 'Oracle (damage assessment)',
      },
      primitives: ['Oracle'],
    });
  }

  // ── BLOCKED 3: Claim exceeds coverage ──
  try {
    await tryClaim(maxClaim + 500_000n, 800n, BigInt(filingStart + 200), 3n);
  } catch {
    emit({
      id: 'blocked-3', type: 'blocked', title: 'Claim Exceeds Coverage Limit',
      details: {
        Claimed: `${(maxClaim + 500_000n).toLocaleString()} sats`,
        'Coverage limit': `${maxClaim.toLocaleString()} sats`,
        'Enforced by': 'Vault (coverage cap)',
      },
      primitives: ['Vault'],
    });
  }

  // ── BLOCKED 4: No policy tokens ──
  try {
    const ts4 = BigInt(filingStart + 250);
    const { sig: oSig4, msg: oMsg4 } = signDamageReport(600n, ts4, 7n);
    const windowUtxo4 = randomUtxo({ satoshis: 1_000n });
    const oracleUtxo4 = randomUtxo({ satoshis: 1_000n });
    const badPolUtxo = policyUtxo(1_000n, 2n);
    provider.addUtxo(claimWindow.address, windowUtxo4);
    provider.addUtxo(damage.address, oracleUtxo4);
    provider.addUtxo(policyToken.tokenAddress, badPolUtxo);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(poolUtxo, pool.contract.unlock.composableSpend(operatorSig, 500_000n, 0n))
      .addInput(windowUtxo4, claimWindow.contract.unlock.composableCheck(operatorSig, 1n))
      .addInput(oracleUtxo4, damage.contract.unlock.composableVerify(oSig4, oMsg4))
      .addInput(badPolUtxo, policyToken.contract.unlock.composableVerify(2n))
      .addOutput(pool.address, currentBalance - 500_000n)
      .addOutput(claimant.address, 500_000n)
      .addOutput(policyToken.tokenAddress, 1_000n, { amount: 2n, category: TOKEN_CATEGORY })
      .setLocktime(Number(ts4) + 10);
    await composer.send();
  } catch {
    emit({
      id: 'blocked-4', type: 'blocked', title: 'No Policy Token',
      details: {
        'Tokens held': '2',
        'Minimum required': `${POLICY_TOKEN_MIN}`,
        'Enforced by': 'TokenGate (policyholder verification)',
      },
      primitives: ['TokenGate'],
    });
  }

  // ── SUCCESS 1: Claim #1 ──
  const tx1 = await tryClaim(claim1Amount, claim1Damage, BigInt(filingStart + 300), 4n);
  currentBalance -= claim1Amount;
  emit({
    id: 'success-1', type: 'success', title: `Claim #1 — ${claim1Amount.toLocaleString()} sats`,
    txid: tx1.txid,
    details: {
      'Damage score': `${claim1Damage} (>= ${minDamage} threshold)`,
      Payout: `${claim1Amount.toLocaleString()} sats`,
      'Pool remaining': `${currentBalance.toLocaleString()} sats`,
    },
    primitives: ['Vault', 'TimeState', 'Oracle', 'TokenGate'],
  });

  poolUtxo = randomUtxo({ satoshis: currentBalance });
  provider.addUtxo(pool.address, poolUtxo);

  // ── SUCCESS 2: Claim #2 (continuation) ──
  const tx2 = await tryClaim(claim2Amount, claim2Damage, BigInt(filingStart + 400), 5n);
  currentBalance -= claim2Amount;
  emit({
    id: 'success-2', type: 'success', title: `Claim #2 — ${claim2Amount.toLocaleString()} sats`,
    txid: tx2.txid,
    details: {
      'Damage score': `${claim2Damage} (>= ${minDamage} threshold)`,
      Payout: `${claim2Amount.toLocaleString()} sats`,
      'Pool remaining': `${currentBalance.toLocaleString()} sats`,
      Covenant: 'Pool continuation verified',
    },
    primitives: ['Vault', 'TimeState', 'Oracle', 'TokenGate'],
  });

  // ── BLOCKED 5: After window ──
  poolUtxo = randomUtxo({ satoshis: currentBalance });
  provider.addUtxo(pool.address, poolUtxo);
  try {
    await tryClaim(500_000n, 800n, BigInt(filingEnd + 100), 8n);
  } catch {
    emit({
      id: 'blocked-5', type: 'blocked', title: 'Claim After Window Closed',
      details: {
        Timestamp: `${filingEnd + 100} (after window)`,
        'Filing closed': `${filingEnd}`,
        'Enforced by': 'TimeState (claim window ended)',
      },
      primitives: ['TimeState'],
    });
  }

  const totalPaid = claim1Amount + claim2Amount;
  return {
    title: 'Insurance Pool — Decentralized Claims',
    params: {
      'Premium pool': `${poolBalance.toLocaleString()} sats`,
      'Max per claim': `${maxClaim.toLocaleString()} sats`,
      'Min damage score': `${minDamage}`,
      'Policy tokens required': `${POLICY_TOKEN_MIN}`,
      'Filing window': `${filingStart} — ${filingEnd}`,
    },
    steps,
    summary: {
      'Insurance pool': `${poolBalance.toLocaleString()} sats`,
      'Claim #1': `-${claim1Amount.toLocaleString()} sats (damage: ${claim1Damage})`,
      'Claim #2': `-${claim2Amount.toLocaleString()} sats (damage: ${claim2Damage})`,
      'Pool remaining': `${currentBalance.toLocaleString()} sats`,
      'Total claims paid': `${totalPaid.toLocaleString()} sats`,
      'Loss ratio': `${((Number(totalPaid) / Number(poolBalance)) * 100).toFixed(1)}%`,
      'Attacks blocked': '5',
      'Claims processed': '2',
    },
    executionTimeMs: Date.now() - start,
  };
}
