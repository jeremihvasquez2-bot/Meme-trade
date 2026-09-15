const DEFAULT_CONTROL = `# Control

Tick a box or edit a list below; the bot reads this file every scan cycle.

## Pause
- [ ] pause trading

## Never buy
<!-- one mint address or symbol per line -->

## Wallets to follow
<!-- one wallet address per line -->

## Approve proposals
<!-- tick a proposal's box to approve it; see Proposals.md for the list -->
`;

export function defaultControlNote() {
  return DEFAULT_CONTROL;
}

function sectionLines(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.trim().startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

// Pure parser for the Control.md note. Returns:
// { paused, neverBuy: string[], followWallets: string[], approveIds: number[] }
export function parseControlNote(markdown) {
  const pauseLines = sectionLines(markdown, 'Pause');
  const paused = pauseLines.some((l) => /^-\s*\[[xX]\]\s*pause trading/.test(l.trim()));

  const neverBuy = sectionLines(markdown, 'Never buy')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') && !l.startsWith('<!--'))
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);

  const followWallets = sectionLines(markdown, 'Wallets to follow')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') && !l.startsWith('<!--'))
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);

  const approveIds = sectionLines(markdown, 'Approve proposals')
    .map((l) => l.trim())
    .filter((l) => /^-\s*\[[xX]\]/.test(l))
    .map((l) => {
      const m = l.match(/#(\d+)/);
      return m ? Number(m[1]) : null;
    })
    .filter((n) => n !== null);

  return { paused, neverBuy, followWallets, approveIds };
}
