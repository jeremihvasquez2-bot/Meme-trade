// The runner. Two loops, a Telegram poller, a brain refresh and a 7am report.
// Everything else is in the modules; this file only decides when.
import { cfg, reload } from './config.js';
import { log, logCrash } from './log.js';
import { acquireLock, releaseLock } from './lock.js';
import { createEngine } from './engine.js';
import { createClient, startPolling, loadPairing, newPairingCode, isPaired } from './telegram.js';
import { ask, buildContext } from './ask.js';
import { pollHoldings } from './copytrade.js';
import { sleep, num, MINUTE } from './util.js';
import { ensureBrain } from './brain.js';

const BRAIN_REFRESH_MS = 5 * MINUTE;

async function main() {
  reload();
  const lock = acquireLock();
  if (!lock.ok) {
    console.error(
      `Another memebot is already running (pid ${lock.holder.pid}). Two copies would share one bankroll, so this one is stopping.`,
    );
    process.exit(1);
  }
  process.on('exit', () => releaseLock());
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      log.info(`${sig} — shutting down`);
      releaseLock();
      process.exit(0);
    });
  }
  process.on('uncaughtException', (err) => logCrash(err, 'uncaughtException'));
  process.on('unhandledRejection', (err) => logCrash(err, 'unhandledRejection'));

  ensureBrain();
  const client = createClient();
  const pairing = newPairingCode();

  const engine = createEngine({
    notify: async (text) => {
      const chatId = loadPairing().chatId;
      if (chatId) await client.send(chatId, text);
    },
  });

  // Plain-language questions the keyword answers do not cover.
  engine.api.fallback = async (question) =>
    (await ask(question, buildContext(engine.state, engine.positions))) ||
    'I did not understand that. Try /status, /positions, /money or /help.';

  const poller = startPolling(engine.api, { client });

  log.info(`memebot up — ${cfg.MODE.toUpperCase()} · bankroll $${cfg.BANKROLL_USD} · data ${cfg.DATA_DIR}`);
  if (!isPaired()) {
    log.info(`Telegram not paired yet. Send your bot:  /start ${pairing.code}`);
  }
  engine.refreshBrain();

  let lastBrain = 0;
  let lastWalletPoll = 0;
  let lastScan = 0;
  let lastReportDay = new Date().toISOString().slice(0, 10);

  const loop = async () => {
    for (;;) {
      const now = Date.now();
      try {
        await engine.exitOnce();

        if (now - lastScan >= cfg.SCAN_INTERVAL_MS) {
          lastScan = now;
          await engine.scanOnce();
        }
        if (now - lastWalletPoll >= cfg.WALLET_POLL_INTERVAL_MS) {
          lastWalletPoll = now;
          await pollHoldings().catch((err) => log.debug(`wallet poll: ${err.message}`));
        }
        if (now - lastBrain >= BRAIN_REFRESH_MS) {
          lastBrain = now;
          engine.refreshBrain();
        }
        const today = new Date().toISOString().slice(0, 10);
        if (today !== lastReportDay && new Date().getHours() >= cfg.MORNING_REPORT_HOUR) {
          lastReportDay = today;
          await engine.morningReport();
        }
      } catch (err) {
        logCrash(err, 'main loop');
      }
      await sleep(num(cfg.EXIT_INTERVAL_MS, 15000));
    }
  };

  await loop();
  poller.stop();
}

main().catch((err) => {
  logCrash(err, 'startup');
  process.exit(1);
});
