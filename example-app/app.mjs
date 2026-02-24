/**
 * CashBlocks DeFi Protocol Suite — CLI Demo
 *
 * Run all 4 DeFi scenarios or pick one:
 *   node app.mjs              # Run all scenarios
 *   node app.mjs lending      # Lending pool only
 *   node app.mjs governance   # DAO governance only
 *   node app.mjs yield-vault  # Yield vault only
 *   node app.mjs insurance    # Insurance pool only
 */

import { runLendingChipnetScenario } from './lending-engine-chipnet.mjs';
import { runGovernanceChipnetScenario } from './governance-engine-chipnet.mjs';
import { runYieldVaultChipnetScenario } from './yield-vault-engine-chipnet.mjs';
import { runInsuranceChipnetScenario } from './insurance-engine-chipnet.mjs';

// ═══ Helpers ═══

function line() { console.log('─'.repeat(62)); }
function header(text) { line(); console.log(`  ${text}`); line(); }

const stepIcons = { info: 'ℹ️ ', blocked: '\u{1F6E1}\u{FE0F} ', success: '\u2705' };

function onStep(step) {
  const icon = stepIcons[step.type] || '  ';
  console.log(`\n  ${icon} ${step.title}`);
  if (step.details) {
    for (const [k, v] of Object.entries(step.details)) {
      console.log(`     ${k}: ${v}`);
    }
  }
  if (step.txid) {
    console.log(`     TX: ${step.txid.slice(0, 20)}...`);
  }
  if (step.primitives?.length) {
    console.log(`     Primitives: ${step.primitives.join(' + ')}`);
  }
}

const scenarios = {
  lending: {
    name: 'Lending Pool',
    desc: 'Credit-scored micro-lending with 4-primitive atomic composition',
    run: runLendingChipnetScenario,
  },
  governance: {
    name: 'DAO Governance',
    desc: 'Token-gated treasury proposals with vote verification',
    run: runGovernanceChipnetScenario,
  },
  'yield-vault': {
    name: 'Yield Vault',
    desc: 'Time-locked deposits with maturity-gated withdrawals',
    run: runYieldVaultChipnetScenario,
  },
  insurance: {
    name: 'Insurance Pool',
    desc: 'Oracle-verified claim processing with coverage limits',
    run: runInsuranceChipnetScenario,
  },
};

async function runOne(key) {
  const scenario = scenarios[key];
  console.log();
  console.log(`${'='.repeat(62)}`);
  console.log(`  ${scenario.name}`);
  console.log(`  ${scenario.desc}`);
  console.log(`${'='.repeat(62)}`);

  const result = await scenario.run(onStep);

  header('Summary');
  for (const [k, v] of Object.entries(result.summary)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`  Execution time: ${(result.executionTimeMs / 1000).toFixed(2)}s`);
  line();

  return result;
}

async function main() {
  console.log();
  console.log('\u2554' + '\u2550'.repeat(60) + '\u2557');
  console.log('\u2551  CashBlocks DeFi Protocol Suite                            \u2551');
  console.log('\u2551  Composable UTXO Building Blocks for Bitcoin Cash           \u2551');
  console.log('\u255A' + '\u2550'.repeat(60) + '\u255D');

  const arg = process.argv[2];

  if (arg && !scenarios[arg]) {
    console.error(`\n  Unknown scenario: "${arg}"`);
    console.error(`  Available: ${Object.keys(scenarios).join(', ')}\n`);
    process.exit(1);
  }

  const keys = arg ? [arg] : Object.keys(scenarios);
  let totalBlocked = 0;
  let totalProcessed = 0;

  for (const key of keys) {
    const result = await runOne(key);
    const blocked = parseInt(result.summary['Attacks blocked'] || '0', 10);
    const processed = parseInt(
      result.summary['Loans processed'] ||
      result.summary['Proposals executed'] ||
      result.summary['Withdrawals processed'] ||
      result.summary['Claims processed'] ||
      '0', 10
    );
    totalBlocked += blocked;
    totalProcessed += processed;
  }

  if (keys.length > 1) {
    console.log();
    console.log(`${'='.repeat(62)}`);
    console.log('  Protocol Suite Totals');
    console.log(`${'='.repeat(62)}`);
    console.log(`  Scenarios run:      ${keys.length}`);
    console.log(`  Total blocked:      ${totalBlocked}`);
    console.log(`  Total processed:    ${totalProcessed}`);
    console.log(`  Primitives:         Vault + TimeState + Oracle + TokenGate`);
    line();
  }

  console.log('\n  No backend. No admin. No multisig.');
  console.log('  Pure on-chain DeFi with CashBlocks SDK.\n');
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
