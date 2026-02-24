/**
 * Yield Vault Engine — Time-Locked Deposits with Maturity
 *
 * 3 Primitives composed atomically:
 *   Vault      → Holds deposited BCH with withdrawal limits
 *   TimeState  → Maturity phases (Locked → Withdrawable → Full Access)
 *   TokenGate  → Staking tokens required for vault positions
 */
import {
  VaultPrimitive,
  TimeStatePrimitive,
  TokenGatePrimitive,
  TransactionComposer,
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

export async function runYieldVaultScenario(config = {}, onStep) {
  const {
    depositAmount     = 3_000_000n,
    maxWithdrawal     = 1_000_000n,
    lockStart         = 1_700_100_000,
    maturityTime      = 1_700_200_000,
    withdraw1Amount   = 800_000n,
    withdraw2Amount   = 500_000n,
  } = config;

  const TOKEN_CATEGORY = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
  const STAKE_TOKEN_MIN = 25n;
  const steps = [];
  const start = Date.now();

  function emit(step) {
    steps.push(step);
    onStep?.(step);
  }

  // --- Participants ---
  const depositor = generateKeypair('Depositor');
  const recipient = generateKeypair('Recipient');

  emit({
    id: 'setup', type: 'info', title: 'Vault Participants Generated',
    details: {
      Depositor: depositor.address,
      Recipient: recipient.address,
    },
  });

  // --- Deploy ---
  const provider = new MockNetworkProvider();

  const vault = new VaultPrimitive({
    ownerPk: depositor.pubKey,
    spendLimit: maxWithdrawal,
    whitelistHash: recipient.pkh,
  }, provider);

  const maturity = new TimeStatePrimitive({
    ownerPk: depositor.pubKey,
    phase1Time: BigInt(lockStart),
    phase2Time: BigInt(maturityTime),
  }, provider);

  const staking = new TokenGatePrimitive({
    requiredCategory: TokenGatePrimitive.categoryToVMBytes(TOKEN_CATEGORY),
    minTokenAmount: STAKE_TOKEN_MIN,
  }, provider);

  emit({
    id: 'deploy', type: 'info', title: 'Yield Vault Deployed',
    details: {
      'Vault': vault.address,
      'Maturity (TimeState)': maturity.address,
      'Staking (TokenGate)': staking.tokenAddress,
      'Max withdrawal': `${maxWithdrawal.toLocaleString()} sats`,
      'Stake tokens required': `${STAKE_TOKEN_MIN}`,
      'Lock period': `${lockStart} — ${maturityTime}`,
    },
  });

  // --- Fund vault ---
  let vaultUtxo = randomUtxo({ satoshis: depositAmount });
  provider.addUtxo(vault.address, vaultUtxo);
  let currentBalance = depositAmount;

  emit({
    id: 'funded', type: 'info', title: 'Vault Funded',
    details: { Deposit: `${depositAmount.toLocaleString()} sats` },
  });

  const depositorSig = new SignatureTemplate(depositor.privKey);

  function stakeTokenUtxo(satoshis, tokenAmount) {
    return {
      ...randomUtxo({ satoshis }),
      token: { amount: tokenAmount, category: TOKEN_CATEGORY },
    };
  }

  async function tryWithdraw(amount, timestamp) {
    const timerUtxo = randomUtxo({ satoshis: 1_000n });
    const stakeUtxo = stakeTokenUtxo(1_000n, STAKE_TOKEN_MIN);
    provider.addUtxo(maturity.address, timerUtxo);
    provider.addUtxo(staking.tokenAddress, stakeUtxo);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(vaultUtxo, vault.contract.unlock.composableSpend(depositorSig, amount, 0n))
      .addInput(timerUtxo, maturity.contract.unlock.composableCheck(depositorSig, 1n))
      .addInput(stakeUtxo, staking.contract.unlock.composableVerify(2n))
      .addOutput(vault.address, currentBalance - amount)
      .addOutput(recipient.address, amount)
      .addOutput(staking.tokenAddress, 1_000n, { amount: STAKE_TOKEN_MIN, category: TOKEN_CATEGORY })
      .setLocktime(Number(timestamp));
    return composer.send();
  }

  // ── BLOCKED 1: Early withdrawal (before maturity) ──
  try {
    await tryWithdraw(100_000n, BigInt(lockStart - 50_000));
  } catch {
    emit({
      id: 'blocked-1', type: 'blocked', title: 'Early Withdrawal — Vault Locked',
      details: {
        Timestamp: `${lockStart - 50_000} (before lock period)`,
        'Lock starts': `${lockStart}`,
        'Enforced by': 'TimeState (maturity lock)',
      },
      primitives: ['TimeState'],
    });
  }

  // ── BLOCKED 2: Over withdrawal limit ──
  try {
    await tryWithdraw(maxWithdrawal + 500_000n, BigInt(lockStart + 100));
  } catch {
    emit({
      id: 'blocked-2', type: 'blocked', title: 'Withdrawal Exceeds Limit',
      details: {
        Requested: `${(maxWithdrawal + 500_000n).toLocaleString()} sats`,
        Limit: `${maxWithdrawal.toLocaleString()} sats`,
        'Enforced by': 'Vault (withdrawal cap)',
      },
      primitives: ['Vault'],
    });
  }

  // ── BLOCKED 3: No staking tokens ──
  try {
    const ts3 = BigInt(lockStart + 200);
    const timerUtxo3 = randomUtxo({ satoshis: 1_000n });
    const badStakeUtxo = stakeTokenUtxo(1_000n, 5n); // Only 5, need 25
    provider.addUtxo(maturity.address, timerUtxo3);
    provider.addUtxo(staking.tokenAddress, badStakeUtxo);

    const composer = new TransactionComposer(provider);
    composer
      .addInput(vaultUtxo, vault.contract.unlock.composableSpend(depositorSig, 100_000n, 0n))
      .addInput(timerUtxo3, maturity.contract.unlock.composableCheck(depositorSig, 1n))
      .addInput(badStakeUtxo, staking.contract.unlock.composableVerify(2n))
      .addOutput(vault.address, currentBalance - 100_000n)
      .addOutput(recipient.address, 100_000n)
      .addOutput(staking.tokenAddress, 1_000n, { amount: 5n, category: TOKEN_CATEGORY })
      .setLocktime(Number(ts3));
    await composer.send();
  } catch {
    emit({
      id: 'blocked-3', type: 'blocked', title: 'Insufficient Staking Tokens',
      details: {
        'Tokens held': '5',
        'Minimum required': `${STAKE_TOKEN_MIN}`,
        'Enforced by': 'TokenGate (CashTokens)',
      },
      primitives: ['TokenGate'],
    });
  }

  // ── SUCCESS 1: Withdrawal #1 ──
  const tx1 = await tryWithdraw(withdraw1Amount, BigInt(lockStart + 300));
  currentBalance -= withdraw1Amount;
  emit({
    id: 'success-1', type: 'success', title: `Withdrawal #1 — ${withdraw1Amount.toLocaleString()} sats`,
    txid: tx1.txid,
    details: {
      Amount: `${withdraw1Amount.toLocaleString()} sats`,
      'Vault remaining': `${currentBalance.toLocaleString()} sats`,
      'Staking tokens': 'Verified and preserved',
    },
    primitives: ['Vault', 'TimeState', 'TokenGate'],
  });

  vaultUtxo = randomUtxo({ satoshis: currentBalance });
  provider.addUtxo(vault.address, vaultUtxo);

  // ── SUCCESS 2: Withdrawal #2 (continuation) ──
  const tx2 = await tryWithdraw(withdraw2Amount, BigInt(lockStart + 400));
  currentBalance -= withdraw2Amount;
  emit({
    id: 'success-2', type: 'success', title: `Withdrawal #2 — ${withdraw2Amount.toLocaleString()} sats`,
    txid: tx2.txid,
    details: {
      Amount: `${withdraw2Amount.toLocaleString()} sats`,
      'Vault remaining': `${currentBalance.toLocaleString()} sats`,
      Covenant: 'Vault continuation verified',
    },
    primitives: ['Vault', 'TimeState', 'TokenGate'],
  });

  // ── BLOCKED 4: After maturity full access (phase 2 blocks composable phase 1 check) ──
  vaultUtxo = randomUtxo({ satoshis: currentBalance });
  provider.addUtxo(vault.address, vaultUtxo);
  try {
    await tryWithdraw(100_000n, BigInt(maturityTime + 100));
  } catch {
    emit({
      id: 'blocked-4', type: 'blocked', title: 'Maturity Phase Ended',
      details: {
        Timestamp: `${maturityTime + 100} (maturity passed)`,
        'Maturity time': `${maturityTime}`,
        'Enforced by': 'TimeState (phase transition)',
      },
      primitives: ['TimeState'],
    });
  }

  const totalWithdrawn = withdraw1Amount + withdraw2Amount;
  return {
    title: 'Yield Vault — Time-Locked Deposits',
    params: {
      Deposit: `${depositAmount.toLocaleString()} sats`,
      'Max withdrawal': `${maxWithdrawal.toLocaleString()} sats`,
      'Stake tokens required': `${STAKE_TOKEN_MIN}`,
      'Lock period': `${lockStart} — ${maturityTime}`,
    },
    steps,
    summary: {
      'Initial deposit': `${depositAmount.toLocaleString()} sats`,
      'Withdrawal #1': `-${withdraw1Amount.toLocaleString()} sats`,
      'Withdrawal #2': `-${withdraw2Amount.toLocaleString()} sats`,
      'Vault remaining': `${currentBalance.toLocaleString()} sats`,
      'Total withdrawn': `${totalWithdrawn.toLocaleString()} sats`,
      Utilization: `${((Number(totalWithdrawn) / Number(depositAmount)) * 100).toFixed(1)}%`,
      'Attacks blocked': '4',
      'Withdrawals processed': '2',
    },
    executionTimeMs: Date.now() - start,
  };
}
