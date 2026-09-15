// The engine. Everything that moves money passes through here, in one place,
// so there is exactly one story about how a trade opens and closes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cfg } from './config.js';
import { log } from './log.js';
import * as dex from './sources/dexscreener.js';
import * as exec from './exec.js';
import * as brain from './brain.js';
import * as proposals from './proposals.js';
import * as copytrade from './copytrade.js';
import * as paths from './paths.js';
import * as research from './research.js';
import { decideExit, EXIT_REASONS } from './exits.js';
import { canOpen } from './risk.js';
import { formatSellAlert, formatPositions } from './telegram.js';
import { header, footer, tally, wrap } from './money.js';
import {
  checkRound, halt, loadState, positionSize, pruneBlocked, recordClosedTrade,
  rollDay, saveState, shouldKill,
} from './state.js';
import {
  applySale, closeTrade, isClosed, loadPositions, loadTrades, newPosition,
  recordTrade, savePositions,
} from './positions.js';
import { checks as readinessChecks, render as renderReadiness } from './readiness.js';
import { replayAll } from './replay.js';
import { simulate, breakEvenWinRate } from './montecarlo.js';
import { humanDuration, num, round, signedUsd, usd, shortMint } from './util.js';

export function createEngine({ notify = async () => {} } = {}) {
  const state = loadState();
  let positions = loadPositions();

  const save = () => {
    saveState(state);
    savePositions(positions);
  };

  const say = async (body) => {
    const text = wrap(state, positions, body);
    log.info(body.split('\n')[0]);
    await notify(text).catch((err) => log.warn(`notify failed: ${err.message}`));
  };

  // --- opening -----------------------------------------------------------

  async function openPosition(candidate, sizeUsd) {
    const fill = await exec.buy(candidate, sizeUsd);
    const position = newPosition({
      candidate,
      fill,
      sizeUsd,
      score: candidate.score,
      features: candidate.features,
      followers: copytrade.holdersOf(candidate.mint),
    });
    const record = paths.startPath({
      mint: candidate.mint,
      symbol: candidate.symbol,
      kind: 'position',
      entryPriceUsd: fill.priceUsd,
      features: candidate.features,
      score: candidate.score,
      positionId: position.id,
    });
    position.pathId = record.id;
    position.whyBought = research.whyBought(candidate);

    state.cash = round(num(state.cash) - fill.costUsd, 4);
    positions.push(position);
    save();

    brain.journal(
      `🟡 BOUGHT **${candidate.symbol}** ${usd(sizeUsd)} at $${fill.priceUsd.toPrecision(4)} — score ${candidate.score}`,
    );
    await say(
      [
        `🟡 BOUGHT ${candidate.symbol} (${shortMint(candidate.mint)})`,
        `${usd(sizeUsd)} at $${fill.priceUsd.toPrecision(4)} · impact ${round(num(fill.priceImpactPct), 2)}%`,
        research.whyBought(candidate),
        `Out at ${cfg.TAKE_PROFIT_X}x, stop ${(cfg.STOP_LOSS_PCT * 100).toFixed(0)}%, trail ${(cfg.TRAILING_STOP_PCT * 100).toFixed(0)}%, ${cfg.MAX_HOLD_HOURS}h max.`,
      ].join('\n'),
    );
    return position;
  }

  // --- closing -----------------------------------------------------------

  async function sellPart(position, fraction, reason) {
    const sale = await exec.sell(position, fraction, reason);
    applySale(position, sale);
    state.cash = round(num(state.cash) + sale.proceedsUsd, 4);
    if (reason === 'take_profit_partial') position.tookConviction = true;
    position.lastPriceUsd = sale.priceUsd || position.lastPriceUsd;

    if (!isClosed(position)) {
      save();
      brain.journal(
        `🟢 PART SOLD **${position.symbol}** ${(fraction * 100).toFixed(0)}% for ${usd(sale.proceedsUsd)} — ${reason.replace(/_/g, ' ')}, letting ${(
          (1 - fraction) * 100
        ).toFixed(0)}% ride`,
      );
      await say(
        [
          `🟢 PART SOLD ${position.symbol} — ${EXIT_REASONS[reason] || reason}`,
          `This sale: ${usd(sale.proceedsUsd)} for ${(fraction * 100).toFixed(0)}% of the bag`,
          `Still holding ${(100 - fraction * 100).toFixed(0)}% · trade so far ${signedUsd(num(position.realisedUsd) - num(position.costUsd))}`,
        ].join('\n'),
      );
      return null;
    }
    return finishTrade(position, sale, reason);
  }

  async function finishTrade(position, sale, reason) {
    const trade = closeTrade(position, { reason });
    trade.exitMarketPriceUsd = position.lastMarketPriceUsd || null;
    trade.whyBought = position.whyBought || '';
    positions = positions.filter((p) => p.id !== position.id);
    recordClosedTrade(state, trade);
    recordTrade(trade);
    if (position.pathId) paths.closePath(position.pathId, trade.outcome);
    save();

    const lesson = drawLesson(trade);
    brain.tokenNote(trade, {
      why: position.whyBought,
      safety: {
        rugcheck: num(position.features?.rugcheckScore),
        'sell impact %': num(position.features?.sellImpactPct),
        liquidity: usd(num(position.features?.liquidityUsd)),
        'age at entry': `${num(position.features?.ageHours)}h`,
      },
      timeline: [
        `bought ${usd(trade.costUsd)} at $${num(trade.entryPriceUsd).toPrecision(4)}`,
        ...position.partials.map(
          (p) => `${new Date(p.at).toISOString().slice(11, 16)} sold ${(p.fraction * 100).toFixed(0)}% for ${usd(p.proceedsUsd)} (${p.reason})`,
        ),
        `closed ${trade.outcome} ${signedUsd(trade.pnlUsd)} after ${humanDuration(trade.holdMs)}`,
      ],
      lesson,
    });
    brain.lesson(`${trade.symbol}: ${lesson}`);
    brain.journal(
      `${trade.outcome === 'WIN' ? '🟢' : '🔴'} **${trade.symbol}** ${trade.outcome} ${signedUsd(trade.pnlUsd)} — ${reason.replace(/_/g, ' ')}`,
    );
    await say(formatSellAlert(trade, sale));

    const finished = checkRound(state, positions);
    if (finished) {
      save();
      await say(
        [
          `🏁 ROUND ${finished.n} ${finished.outcome} at ${usd(finished.endEquity)} (target ${usd(finished.target)})`,
          `Fresh ${usd(cfg.BANKROLL_USD)} on the table. Round ${state.round.n} → target ${usd(state.round.target)}.`,
        ].join('\n'),
      );
    }
    await killSwitchCheck();
    return trade;
  }

  /** The lesson is drawn by rule, not by vibes, so it is comparable later. */
  function drawLesson(trade) {
    const f = trade.features || {};
    if (trade.reason === 'stop_loss' && num(trade.peakMultiple) < 1.05) {
      return `bought the top — it never traded above entry. Entry buy/sell was ${f.buySellM5}, 5m ${f.m5}%.`;
    }
    if (trade.reason === 'trailing_stop' && num(trade.peakMultiple) >= cfg.TAKE_PROFIT_X) {
      return `peaked at ${trade.peakMultiple}x, above the ${cfg.TAKE_PROFIT_X}x target, and the trail gave back the difference.`;
    }
    if (trade.reason === 'trailing_stop') {
      return `ran to ${trade.peakMultiple}x then rolled over; the ${(cfg.TRAILING_STOP_PCT * 100).toFixed(0)}% trail took it out.`;
    }
    if (trade.reason === 'max_hold') {
      return `went nowhere for ${cfg.MAX_HOLD_HOURS}h (peak ${trade.peakMultiple}x) — dead money costs the same as a loser.`;
    }
    if (trade.reason === 'no_price_bailout') {
      return 'price feed went dark and stayed dark — treated as a rug and got out.';
    }
    if (trade.outcome === 'WIN') {
      return `worked: ${trade.peakMultiple}x peak in ${humanDuration(trade.holdMs)} from liquidity $${f.liquidityUsd} and ${f.buySellM5}:1 buy pressure.`;
    }
    return `lost ${signedUsd(trade.pnlUsd)} on ${trade.reason.replace(/_/g, ' ')} with a ${trade.peakMultiple}x peak.`;
  }

  // --- the two loops -----------------------------------------------------

  async function applyControl() {
    const control = brain.readControl();
    state.paused = control.pause;
    state.neverBuy = control.neverBuy;
    for (const owner of control.follow) copytrade.followManually(owner);
    for (const n of control.approve) {
      try {
        const result = proposals.approve(n);
        await say(result.ok ? `✅ Applied proposal #${n}: ${result.proposal.title}` : `⚠️ Proposal #${n} failed its tests and was reverted.`);
      } catch (err) {
        await say(`⚠️ Could not apply proposal #${n}: ${err.message}`);
      }
      brain.untickProposal(n);
    }
    return control;
  }

  async function scanOnce() {
    if (state.halted) return { skipped: 'halted' };
    rollDay(state);
    pruneBlocked(state);
    await applyControl();
    paths.expirePaths();

    const book = copytrade.loadWallets();
    const smartMoney = new Map(copytrade.smartMoneyMints(book).map((s) => [s.mint, s.count]));
    const sizeUsd = positionSize(state, positions);
    const result = await research.scan({
      sizeUsd: Math.max(cfg.MIN_POSITION_USD, sizeUsd),
      smartMoney,
      neverBuy: new Set(state.neverBuy || []),
    });
    state.lastScanAt = Date.now();
    state.lastUniverse = result.universe.length;

    if (copytrade.dueForDiscovery(book)) {
      copytrade.discover(result.universe).then((r) => {
        if (r.added) {
          for (const w of copytrade.followed().slice(-r.added)) brain.walletNote(w.grade);
          say(`🧠 Now following ${r.added} more wallet(s) — ${copytrade.followed().length} in total.`);
        }
      }).catch((err) => log.warn(`wallet discovery: ${err.message}`));
    }

    const best = result.passed.find((c) => num(c.score) >= cfg.SCORE_THRESHOLD);
    let bought = null;
    let blocked = null;
    let error = null;

    if (best) {
      const gate = canOpen(state, best, positions);
      if (!gate.ok) {
        log.debug(`not buying ${best.symbol}: ${gate.reason}`);
        blocked = gate.reason;
      } else {
        try {
          bought = await openPosition(best, gate.sizeUsd);
        } catch (err) {
          log.warn(`buy failed for ${best.symbol}: ${err.message}`);
          brain.journal(`⚠️ Could not buy **${best.symbol}**: ${err.message}`);
          error = err.message;
        }
      }
    }

    // Shadow paths: record what WOULD have happened for everything that was
    // safe enough to buy but did not get bought. This is where most of the
    // learning data comes from, and it costs nothing but a price lookup.
    const recording = new Set(paths.openPaths().map((m) => m.mint));
    for (const candidate of result.passed) {
      if (recording.has(candidate.mint)) continue;
      paths.startPath({
        mint: candidate.mint,
        symbol: candidate.symbol,
        kind: 'shadow',
        entryPriceUsd: candidate.priceUsd,
        features: candidate.features,
        score: candidate.score,
      });
      recording.add(candidate.mint);
    }

    save();
    return { ...result, bought, blocked, error };
  }

  async function tickPosition(position) {
    let pair = null;
    try {
      pair = await dex.priceOf(position.mint);
    } catch {
      pair = null;
    }
    const tick = pair
      ? { priceUsd: pair.priceUsd, m5: pair.m5, buysM5: pair.buysM5, sellsM5: pair.sellsM5, volumeM5: pair.volumeM5 }
      : null;

    if (tick?.priceUsd > 0) {
      position.strikes = 0;
      position.lastPriceUsd = tick.priceUsd;
      position.lastMarketPriceUsd = tick.priceUsd;
      position.lastPriceAt = Date.now();
      position.peakPriceUsd = Math.max(num(position.peakPriceUsd), tick.priceUsd);
    } else {
      position.strikes = num(position.strikes) + 1;
    }
    if (position.pathId) paths.recordTick(position.pathId, tick || { priceUsd: 0 });

    let decision = decideExit(position, tick, Date.now());
    if (decision.action === 'hold' && copytrade.followersLeft(position)) {
      decision = { action: 'sell', fraction: 1, reason: 'smart_money_left' };
    }
    if (decision.action !== 'sell') return null;

    try {
      return await sellPart(position, decision.fraction, decision.reason);
    } catch (err) {
      log.warn(`sell failed for ${position.symbol}: ${err.message}`);
      if (decision.reason === 'no_price_bailout' && cfg.MODE !== 'live') {
        // Paper: nothing to sell into. Write it off at zero and move on.
        position.forceClosed = true;
        return finishTrade(position, { reason: decision.reason, fraction: 1, proceedsUsd: 0 }, decision.reason);
      }
      return null;
    }
  }

  async function exitOnce() {
    for (const position of [...positions]) {
      await tickPosition(position);
    }
    await recordShadowTicks();
    save();
    return positions;
  }

  async function recordShadowTicks() {
    const open = paths.openPaths().filter((m) => m.kind === 'shadow');
    for (const meta of open) {
      try {
        const pair = await dex.priceOf(meta.mint);
        paths.recordTick(meta.id, pair ? { priceUsd: pair.priceUsd, m5: pair.m5, buysM5: pair.buysM5, sellsM5: pair.sellsM5, volumeM5: pair.volumeM5 } : { priceUsd: 0 });
      } catch {
        paths.recordTick(meta.id, { priceUsd: 0 });
      }
    }
  }

  // --- the kill switch ---------------------------------------------------

  async function sellEverything(reason) {
    for (const position of [...positions]) {
      try {
        await sellPart(position, 1, reason);
      } catch (err) {
        log.warn(`could not liquidate ${position.symbol}: ${err.message}`);
        position.forceClosed = true;
        await finishTrade(position, { reason, fraction: 1, proceedsUsd: 0 }, reason).catch(() => {});
      }
    }
  }

  function writeFinalReport(reason) {
    const desktop = fs.existsSync(path.join(os.homedir(), 'Desktop')) ? path.join(os.homedir(), 'Desktop') : os.homedir();
    const file = path.join(desktop, `MEMEBOT-final-report-${new Date().toISOString().slice(0, 10)}.txt`);
    const trades = loadTrades();
    const t = tally(state, positions);
    const body = [
      'MEMEBOT — FINAL REPORT',
      `Stopped: ${new Date().toISOString()}`,
      `Reason: ${reason}`,
      '',
      `Bankroll: ${usd(t.bankroll)}`,
      `Made ${usd(t.madeUsd)} · lost ${usd(t.lostUsd)} · net ${signedUsd(t.netUsd)} · fees ${usd(t.feesUsd)}`,
      `Record: ${t.wins} WIN – ${t.losses} LOSE over ${t.trades} trades`,
      '',
      'Every trade:',
      ...trades.map(
        (tr) =>
          `  ${new Date(tr.closedAt).toISOString().slice(0, 16)} ${String(tr.symbol).padEnd(12)} ${tr.outcome.padEnd(5)} ` +
          `${signedUsd(tr.pnlUsd).padStart(9)}  peak ${tr.peakMultiple}x  ${tr.reason}`,
      ),
      '',
      'The data is still in the data/ folder and the notes are still in your vault.',
      'Most meme-coin bots lose money. This one stopped when it hit the limit you set.',
    ].join('\n');
    try {
      fs.writeFileSync(file, body);
      log.info(`final report written to ${file}`);
    } catch (err) {
      log.warn(`could not write the final report: ${err.message}`);
    }
    return file;
  }

  async function killSwitchCheck() {
    if (!shouldKill(state)) return false;
    log.error('kill switch: realised loss reached the bankroll');
    await say('🛑 KILL SWITCH — realised loss reached the bankroll. Selling everything and stopping.');
    await sellEverything('kill_switch');
    const file = writeFinalReport('realised loss reached the bankroll');
    halt(state, 'kill switch: realised loss reached the bankroll');
    save();
    await say(`🛑 HALTED. Final report: ${file}`);
    if (cfg.KILL_SWITCH_DELETE_PROJECT) {
      log.error('KILL_SWITCH_DELETE_PROJECT is on — deleting the project folder');
      try {
        fs.rmSync(cfg.ROOT, { recursive: true, force: true });
      } catch (err) {
        log.error(`could not delete the project: ${err.message}`);
      }
    }
    return true;
  }

  // --- reports -----------------------------------------------------------

  function readiness() {
    return renderReadiness(readinessChecks(state, { trades: loadTrades() }));
  }

  function sims() {
    const replay = replayAll();
    if (replay.trades < 5) return `Only ${replay.trades} recorded paths so far — not enough to simulate anything honest.`;
    const returns = replay.results.map((r) => r.returnPct);
    const mc = simulate({ returns });
    const breakEven = breakEvenWinRate(returns);
    return [
      `Over ${replay.trades} recorded paths with a measured ${replay.costPct}% round-trip cost:`,
      `  ${replay.avgPct}%/trade average, ${replay.winRate}% of them profitable`,
      `Monte Carlo (${mc.runs} rounds of ${usd(mc.bankroll)} → ${usd(mc.target)}):`,
      `  wins the round ${mc.winRate}% of the time, busts ${mc.lossRate}%`,
      `  median ${mc.medianTrades} trades to settle it`,
      breakEven ? `Break-even win rate at these sizes: ${breakEven}%` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async function morningReport() {
    const trades = loadTrades();
    const since = Date.now() - 86_400_000;
    const yesterday = trades.filter((t) => t.closedAt >= since);
    const net = round(yesterday.reduce((a, t) => a + num(t.pnlUsd), 0), 2);
    const lines = [
      `☀️ Morning report — ${new Date().toISOString().slice(0, 10)}`,
      `Last 24h: ${yesterday.length} trade(s), ${signedUsd(net)}`,
      yesterday.length
        ? yesterday
            .map((t) => `  ${t.outcome === 'WIN' ? '🟢' : '🔴'} ${t.symbol} ${signedUsd(t.pnlUsd)} (${t.reason.replace(/_/g, ' ')})`)
            .join('\n')
        : '  nothing closed',
      '',
      `Holding ${positions.length}: ${positions.map((p) => p.symbol).join(', ') || '—'}`,
      '',
      readiness(),
    ];
    await say(lines.join('\n'));
    state.lastMorningReport = Date.now();
    save();
  }

  function refreshBrain() {
    try {
      const check = readinessChecks(state, { trades: loadTrades() });
      brain.writeHome(state, positions, { readiness: check.go ? 'GO' : 'NOT YET' });
      brain.writeRules(proposals.loadHistory());
      brain.writeProposals(proposals.loadProposals());
    } catch (err) {
      log.warn(`brain refresh: ${err.message}`);
    }
  }

  // --- what Telegram is allowed to ask for -------------------------------

  const api = {
    status: () =>
      [
        header(state, positions),
        '',
        `${cfg.MODE.toUpperCase()} · ${state.halted ? 'HALTED' : state.paused ? 'PAUSED' : 'running'}`,
        `Holding ${positions.length} of ${cfg.MAX_OPEN_POSITIONS} · next bet ${usd(positionSize(state, positions))}`,
        `Last scan ${state.lastScanAt ? humanDuration(Date.now() - state.lastScanAt) + ' ago' : 'not yet'} (${num(state.lastUniverse)} tokens looked at)`,
        '',
        footer(state, positions),
      ].join('\n'),
    positions: () => wrap(state, positions, formatPositions(positions)),
    money: () => {
      const t = tally(state, positions);
      return wrap(
        state,
        positions,
        [
          `Cash ${usd(t.cash)} · in trades ${usd(t.inTrades)} · fees paid ${usd(t.feesUsd)}`,
          `Rounds: won ${t.roundsWon}, lost ${t.roundsLost}, now on round ${t.round} → ${usd(t.target)}`,
          `Average result per trade: ${t.trades ? signedUsd(t.netUsd / t.trades) : '—'}`,
        ].join('\n'),
      );
    },
    rounds: () =>
      wrap(
        state,
        positions,
        `Round ${state.round.n}, target ${usd(state.round.target)}.\nWon ${state.roundsWon} — lost ${state.roundsLost}.\nA round ends at $0 or at the target; the target rises ${usd(cfg.ROUND_TARGET_STEP_USD)} per win.`,
      ),
    readiness: () => wrap(state, positions, readiness()),
    sims: () => wrap(state, positions, sims()),
    lessons: () => {
      const trades = loadTrades().slice(-8);
      if (!trades.length) return wrap(state, positions, 'Nothing closed yet, so nothing learned yet.');
      return wrap(state, positions, trades.map((t) => `${t.symbol}: ${drawLesson(t)}`).join('\n'));
    },
    whySold: (symbol) => {
      const trades = loadTrades();
      const trade = symbol
        ? [...trades].reverse().find((t) => String(t.symbol).toLowerCase() === String(symbol).toLowerCase())
        : trades.at(-1);
      if (!trade) return wrap(state, positions, symbol ? `I have never sold ${symbol}.` : 'I have not sold anything yet.');
      return wrap(
        state,
        positions,
        [
          `${trade.symbol}: ${EXIT_REASONS[trade.reason] || trade.reason}.`,
          `In ${usd(trade.costUsd)}, out ${usd(trade.proceedsUsd)} = ${signedUsd(trade.pnlUsd)} (${trade.pnlPct}%).`,
          `Peak ${trade.peakMultiple}x, held ${humanDuration(trade.holdMs)}.`,
          `Why I bought it: ${trade.whyBought || `score ${trade.score}`}`,
        ].join('\n'),
      );
    },
    pause: () => {
      state.paused = true;
      save();
      return wrap(state, positions, '⏸ Paused. No new trades. Open ones will still exit on their rules.');
    },
    resume: () => {
      state.paused = false;
      save();
      return wrap(state, positions, '▶️ Running again.');
    },
    stop: async () => {
      await sellEverything('manual');
      writeFinalReport('you sent /stop confirm');
      halt(state, 'stopped by owner');
      save();
      return wrap(state, positions, '🛑 Sold everything and halted. Restart me to start over.');
    },
    proposals: () => {
      const list = proposals.loadProposals().filter((p) => p.status === 'pending');
      if (!list.length) return 'Nothing waiting on you.';
      return `${list.map(proposals.describe).join('\n\n')}\n\nApprove with /approve N — I re-run my own tests first and revert if they fail.`;
    },
    approve: (n) => {
      if (!Number.isFinite(n)) return 'Which one? /approve 3';
      try {
        const result = proposals.approve(n);
        return result.ok
          ? `✅ Applied #${n}: ${result.proposal.title}\nTests passed.`
          : `⚠️ #${n} broke the tests, so I reverted it.\n${result.output.split('\n').slice(-6).join('\n')}`;
      } catch (err) {
        return `Cannot: ${err.message}`;
      }
    },
    reject: (n) => {
      if (!Number.isFinite(n)) return 'Which one? /reject 3';
      try {
        proposals.reject(n);
        return `Binned #${n}.`;
      } catch (err) {
        return `Cannot: ${err.message}`;
      }
    },
    fallback: () => null,
  };

  return {
    state,
    get positions() {
      return positions;
    },
    api,
    save,
    say,
    scanOnce,
    exitOnce,
    openPosition,
    sellPart,
    finishTrade,
    sellEverything,
    killSwitchCheck,
    morningReport,
    refreshBrain,
    readiness,
    sims,
    drawLesson,
    writeFinalReport,
    applyControl,
  };
}
