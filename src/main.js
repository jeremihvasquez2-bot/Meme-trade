import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';
import { acquireLock } from './state/lock.js';
import { createLogger } from './utils/logger.js';
import { loadState, saveState, checkRiskGate, applyClosedTrade, positionSizeUsd } from './money/bankroll.js';
import { readTrades, summarize } from './money/ledger.js';
import { loadPositions, savePositions, openPosition, applySellFill, isFullyClosed, toClosedTrade } from './execution/positions.js';
import { buyPaper, sellPaper } from './execution/paper.js';
import { buyLive, sellLive, canAffordBuy } from './execution/live.js';
import { getSolUsdPrice } from './research/jupiter.js';
import { hydrateTokens, toFeatures } from './research/dexscreener.js';
import { runScan } from './research/scan.js';
import { evaluateExit } from './exits/rules.js';
import { startPath, recordTick } from './learning/paths.js';
import { addShadow, pruneExpired } from './learning/shadowTracker.js';
import { effectiveRules, loadProposals, approveProposal, rejectProposal } from './proposals/proposals.js';
import { discoverWallets, pollHoldings } from './copytrade/follow.js';
import { ensureBrain, readControlNote, writeHomeNote, appendJournal, writeTokenNote, appendLesson, writeRulesNote, writeProposalsNote } from './brain/writer.js';
import { parseControlNote } from './brain/control.js';
import { sendMessage, pollLoop } from './telegram/bot.js';
import { headerBlock, footerBlock, sellAlert } from './telegram/format.js';
import { generatePairCode } from './telegram/pairing.js';

async function main() {
  const config = loadConfig({});
  config.rules = effectiveRules(config);
  acquireLock(config.dataDir);
  const logger = createLogger(config.dataDir);
  ensureBrain(config);

  let state = loadState(config);
  let positions = loadPositions(config);
  logger.info('memebot starting', { mode: config.mode, bankroll: config.bankrollUsd, pid: process.pid });

  process.on('uncaughtException', (err) => logger.error('uncaughtException', { message: err.message, stack: err.stack }));
  process.on('unhandledRejection', (err) => logger.error('unhandledRejection', { message: String(err) }));

  async function openPositionsValueUsd() {
    if (!positions.length) return 0;
    let total = 0;
    const pairs = await hydrateTokens(positions.map((p) => p.mint)).catch(() => []);
    for (const p of positions) {
      const pair = pairs.find((x) => x.baseToken?.address === p.mint);
      const price = pair ? Number(pair.priceUsd) : p.entryPriceUsd;
      total += price * p.remainingTokenAmount;
    }
    return total;
  }

  async function closePosition(pos, exitReason) {
    const trade = toClosedTrade(pos, exitReason);
    const result = applyClosedTrade(config, state, trade);
    state = result.state;
    saveState(config, state);
    positions = positions.filter((p) => p.id !== pos.id);
    savePositions(config, positions);

    writeTokenNote(config, trade, { timeline: pos.fills.map((f) => `${f.type} ${f.tokenAmount.toFixed(4)} @ $${f.priceUsd.toFixed(6)}`) });
    appendJournal(config, `${trade.outcome} ${trade.symbol} ${trade.pnlUsd >= 0 ? '+' : ''}$${trade.pnlUsd.toFixed(2)} (${exitReason})`);
    if (trade.pnlUsd < 0) appendLesson(config, `${trade.symbol} lost $${Math.abs(trade.pnlUsd).toFixed(2)} via ${exitReason}.`);

    await sendMessage(config, [sellAlert({ trade, positionPeakMultiple: pos.peakPriceUsd / pos.entryPriceUsd }), '', headerBlock({ state, openPositionsValueUsd: await openPositionsValueUsd() })].join('\n'));

    for (const event of result.events) {
      if (event.type === 'round_won') await sendMessage(config, `🏆 ROUND ${event.round} WON at target $${event.targetUsd}. New round started.`);
      if (event.type === 'round_lost') await sendMessage(config, `📉 Round ${event.round} lost. New round started, same target.`);
      if (event.type === 'kill_switch') await handleKillSwitch();
    }
  }

  async function handleKillSwitch() {
    logger.error('KILL SWITCH TRIGGERED');
    if (config.mode === 'live') {
      for (const pos of [...positions]) {
        try {
          const solUsd = await getSolUsdPrice();
          const fill = await sellLive(config, { mint: pos.mint, tokenAmount: pos.remainingTokenAmount, decimals: 9, full: true, solUsd });
          applySellFill(pos, fill);
          await closePosition(pos, 'kill_switch');
        } catch (err) {
          logger.error('kill switch liquidation failed', { mint: pos.mint, error: err.message });
        }
      }
      const report = [
        'MEMEBOT KILL SWITCH REPORT',
        new Date().toISOString(),
        `Realized P&L: $${state.realizedPnlUsd.toFixed(2)}`,
        `Original bankroll: $${state.originalBankrollUsd.toFixed(2)}`,
      ].join('\n');
      try {
        fs.writeFileSync(path.join(os.homedir(), 'Desktop', 'memebot-kill-switch-report.txt'), report);
      } catch {
        // best effort
      }
      await sendMessage(config, '⛔ KILL SWITCH: realized loss reached the bankroll. All positions liquidated. Bot halted. Report on your Desktop.');
    }
  }

  async function applyControlNote() {
    const md = readControlNote(config);
    const control = parseControlNote(md);
    state.paused = control.paused;
    return control;
  }

  async function scanCycle() {
    if (state.halted) return;
    const control = await applyControlNote();
    if (control.paused) return;

    const { buyCandidates, shadowCandidates, solUsd } = await runScan(config).catch((err) => {
      logger.error('scan failed', { error: err.message });
      return { buyCandidates: [], shadowCandidates: [] };
    });
    if (!solUsd) {
      logger.error('scanCycle: could not get SOL/USD price, skipping this cycle');
      return;
    }

    const topScore = [...buyCandidates, ...shadowCandidates].reduce((max, c) => Math.max(max, c.score), 0);
    logger.info('scan complete', { safetyPassed: buyCandidates.length + shadowCandidates.length, buyCandidates: buyCandidates.length, topScore });

    for (const candidate of shadowCandidates) {
      const id = `shadow-${candidate.features.mint}-${Date.now()}`;
      startPath(config.dataDir, id, { mint: candidate.features.mint, symbol: candidate.features.symbol, entryFeatures: candidate.features, score: candidate.score, shadow: true });
      recordTick(config.dataDir, id, { priceUsd: candidate.features.priceUsd, m5Pct: candidate.features.m5Pct, buySell5m: candidate.features.buySellRatio5m, volume5mUsd: candidate.features.volume5mUsd });
      addShadow(config.dataDir, { id, mint: candidate.features.mint });
    }

    for (const candidate of buyCandidates) {
      if (control.neverBuy.includes(candidate.features.mint) || control.neverBuy.includes(candidate.features.symbol)) continue;
      const gate = checkRiskGate(config, state, { mint: candidate.features.mint, openPositionsCount: positions.length, openMints: positions.map((p) => p.mint) });
      if (!gate.allowed) continue;

      try {
        const fill =
          config.mode === 'live'
            ? await (async () => {
                if (!(await canAffordBuy(config, gate.sizeUsd, solUsd))) throw new Error('insufficient SOL after fee buffer');
                return buyLive(config, { mint: candidate.features.mint, sizeUsd: gate.sizeUsd, solUsd, decimals: candidate.features.decimals });
              })()
            : await buyPaper({ mint: candidate.features.mint, decimals: candidate.features.decimals, sizeUsd: gate.sizeUsd, solUsd });

        const pos = openPosition({
          mint: candidate.features.mint,
          symbol: candidate.features.symbol,
          source: 'scan',
          round: state.round?.number,
          sizeUsd: fill.amountUsd,
          tokenAmount: fill.tokenAmount,
          priceUsd: fill.priceUsd,
          feeUsd: fill.feeUsd,
        });
        pos.decimals = candidate.features.decimals;
        positions.push(pos);
        savePositions(config, positions);

        startPath(config.dataDir, pos.id, { mint: pos.mint, symbol: pos.symbol, entryFeatures: candidate.features, score: candidate.score, shadow: false });
        recordTick(config.dataDir, pos.id, { priceUsd: fill.priceUsd, m5Pct: candidate.features.m5Pct, buySell5m: candidate.features.buySellRatio5m, volume5mUsd: candidate.features.volume5mUsd });

        writeTokenNote(config, { symbol: candidate.features.symbol, mint: candidate.features.mint, pnlUsd: 0, outcome: 'OPEN', openedAt: pos.openedAt, closedAt: pos.openedAt, fills: pos.fills }, {
          whyBought: `score ${candidate.score} (momentum ${candidate.breakdown.momentumScore}, buy pressure ${candidate.breakdown.buyPressureScore}, turnover ${candidate.breakdown.turnoverScore}, safety ${candidate.breakdown.safetyScore}, age ${candidate.breakdown.ageScore})`,
          safetyAtEntry: `rugcheck ${candidate.features.rugcheckScore}, sell impact ${candidate.features.sellPriceImpactPct?.toFixed(1)}%, authorities revoked`,
        });
        appendJournal(config, `BUY ${candidate.features.symbol} $${gate.sizeUsd.toFixed(2)} score ${candidate.score}`);
        await sendMessage(config, [`🟡 BUY ${candidate.features.symbol} — $${fill.amountUsd.toFixed(2)} — score ${candidate.score}`, headerBlock({ state, openPositionsValueUsd: await openPositionsValueUsd() })].join('\n'));
      } catch (err) {
        logger.error('buy failed', { mint: candidate.features.mint, error: err.message });
      }
    }
  }

  async function exitCycle() {
    if (!positions.length) return;
    const solUsd = await getSolUsdPrice().catch(() => null);
    if (!solUsd) {
      logger.error('exitCycle: could not get SOL/USD price, skipping this cycle');
      return;
    }
    const pairs = await hydrateTokens(positions.map((p) => p.mint)).catch(() => []);

    for (const pos of [...positions]) {
      const pair = pairs.find((x) => x.baseToken?.address === pos.mint);
      const features = pair ? toFeatures(pair) : null;
      const market = features
        ? { priceUsd: features.priceUsd, buySellRatio5m: features.buySellRatio5m, m5Pct: features.m5Pct, volume5mUsd: features.volume5mUsd }
        : { missingPrice: true };

      recordTick(config.dataDir, pos.id, market.missingPrice
        ? { missingPrice: true }
        : { priceUsd: market.priceUsd, m5Pct: market.m5Pct, buySell5m: market.buySellRatio5m, volume5mUsd: market.volume5mUsd });

      const decision = evaluateExit(pos, market, config.rules);
      if (decision.action === 'none') {
        // evaluateExit mutates pos.peakPriceUsd / missedPriceStrikes in place even
        // when it decides not to exit yet. Persist that now, not just on a sell —
        // otherwise a restart mid-hold forgets how high the price ran and re-arms
        // the trailing stop from the stale on-disk peak (understating drawdown).
        savePositions(config, positions);
        continue;
      }

      try {
        const sellTokenAmount = pos.remainingTokenAmount * decision.portion;
        // A forced "strikes" exit means the price has been missing for a
        // while. In live mode we still try to actually get the tokens back
        // to SOL; in paper mode there's no real position to unwind and no
        // price to fairly paper-sell at, so it's written off as a total
        // loss on the remaining amount rather than attempting a fake quote
        // (or, worse, a real on-chain sell with no wallet configured).
        const fill =
          config.mode === 'live'
            ? await sellLive(config, { mint: pos.mint, tokenAmount: sellTokenAmount, decimals: pos.decimals ?? 9, full: decision.portion >= 1, solUsd })
            : decision.forceOnChain
              ? { tokenAmount: sellTokenAmount, priceUsd: 0, amountUsd: 0, feeUsd: 0 }
              : await sellPaper({ mint: pos.mint, decimals: pos.decimals ?? 9, tokenAmount: sellTokenAmount, solUsd });

        applySellFill(pos, fill);
        savePositions(config, positions);

        if (isFullyClosed(pos)) {
          await closePosition(pos, decision.reason);
        } else {
          appendJournal(config, `SELL ${decision.portion * 100}% of ${pos.symbol} (${decision.reason})`);
        }
      } catch (err) {
        logger.error('sell failed', { mint: pos.mint, error: err.message });
      }
    }
  }

  async function shadowTickCycle() {
    const active = pruneExpired(config.dataDir, config.rules.shadowPathDurationMs);
    if (!active.length) return;
    const pairs = await hydrateTokens(active.map((s) => s.mint)).catch(() => []);
    for (const shadow of active) {
      const pair = pairs.find((x) => x.baseToken?.address === shadow.mint);
      const features = pair ? toFeatures(pair) : null;
      recordTick(config.dataDir, shadow.id, features
        ? { priceUsd: features.priceUsd, m5Pct: features.m5Pct, buySell5m: features.buySellRatio5m, volume5mUsd: features.volume5mUsd }
        : { missingPrice: true });
    }
  }

  async function refreshBrain() {
    const summary = summarize(readTrades(config.dataDir));
    writeHomeNote(config, { state, summary, positions, readiness: null });
    writeRulesNote(config, config.rules);
    writeProposalsNote(config, loadProposals(config.dataDir));
  }

  async function morningReport() {
    const summary = summarize(readTrades(config.dataDir));
    await sendMessage(config, [`☀️ Morning report`, headerBlock({ state, openPositionsValueUsd: await openPositionsValueUsd() }), '', footerBlock(summary)].join('\n'));
  }

  async function copytradeDailyJob() {
    const { buyCandidates } = await runScan(config).catch(() => ({ buyCandidates: [] }));
    const topMints = buyCandidates.slice(0, config.rules.copytrade.topTokensPerDay).map((c) => c.features.mint);
    if (!topMints.length) return;
    await discoverWallets(config, topMints).catch((err) => logger.error('copytrade discovery failed', { error: err.message }));
  }

  // --- scheduling ---
  const code = generatePairCode(config.dataDir);
  logger.info(`Telegram pairing code: ${code} (send /start ${code} to your bot)`);

  setInterval(() => scanCycle().catch((err) => logger.error('scanCycle error', { error: err.message })), config.rules.scanIntervalMs);
  setInterval(() => exitCycle().catch((err) => logger.error('exitCycle error', { error: err.message })), config.rules.exitCheckIntervalMs);
  setInterval(() => shadowTickCycle().catch((err) => logger.error('shadowTickCycle error', { error: err.message })), config.rules.exitCheckIntervalMs);
  setInterval(() => refreshBrain().catch(() => {}), 5 * 60 * 1000);
  setInterval(() => pollHoldings(config).catch(() => []), config.rules.copytrade.pollIntervalMs);
  setInterval(() => copytradeDailyJob().catch(() => {}), 24 * 60 * 60 * 1000);

  let lastMorningReportDay = null;
  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === 7 && lastMorningReportDay !== today) {
      lastMorningReportDay = today;
      morningReport().catch(() => {});
    }
  }, 60 * 1000);

  pollLoop(config, {
    buildCommandContext: async () => ({
      state,
      positions,
      summary: summarize(readTrades(config.dataDir)),
      proposals: loadProposals(config.dataDir),
      openPositionsValueUsd: await openPositionsValueUsd(),
    }),
    buildQaContext: async () => ({
      state,
      positions,
      summary: summarize(readTrades(config.dataDir)),
      trades: readTrades(config.dataDir),
      lessonsText: null,
    }),
    onAction: async (action) => {
      if (action.type === 'pause') state.paused = true;
      if (action.type === 'resume') state.paused = false;
      if (action.type === 'stop') state.halted = true;
      if (action.type === 'approve') approveProposal(config, action.id);
      if (action.type === 'reject') rejectProposal(config, action.id);
      saveState(config, state);
      config.rules = effectiveRules(config);
    },
    onError: (err) => logger.error('telegram poll error', { error: err.message }),
  }).catch((err) => logger.error('telegram poll loop crashed', { error: err.message }));

  await refreshBrain();
  logger.info('memebot running');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
