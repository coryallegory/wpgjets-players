// COMC merge helper for get-cards-baseline-build.mjs (offline, no requests). Reads the already-gathered COMC findings
// (temp/comc/comc-findings.json) and turns each eligible first-year card into a synthetic SCP-shaped row so the normal
// ranking rules apply. Reference links only: no COMC images or prices are ever stored.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from './cards-baseline-lib.mjs';

const slugOf = (s) => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9&]+/g, '-').replace(/^-|-$/g, '');
/** COMC set names accepted as mainstream when SCP's slug classifier knows nothing about them (oddball regional / Finnish / food sets are never mainstream). */
export const MAINSTREAM = /^(O-Pee-Chee|Topps|Upper Deck|Parkhurst|In the Game Be A Player|ITG Be A Player|Pinnacle|Score|Fleer|Pacific|Panini|SP|SPx|Donruss|Leaf|Bowman|Pro Set|Ultra|Stadium Club|Playoff|Zenith|Select|Skybox|Flair|Collector's Edge|Be A Player)/i;
// Sets that are not mainstream base sets even though COMC tags them [Base]: team/regional issues, redemptions, oversize.
const SKIP = /Pepsi|Vachon|Bottle Caps|Luxury Suite|Esso|Kellogg|Zellers|Loblaws|Sports Action|Hershey Bears|Toronto Maple Leafs|Calgary Flames|Boston Bruins|Heritage Classic|Super\b|Fire on Ice|\[Base\] - /i;

/** Normalised set key for dedupe: lower-case alphanumerics without the year; a COMC "Topps Chrome" equals SCP "Topps Chrome" but never "O-Pee-Chee Chrome". */
export const setKey = (set) => set.replace(/^\d{4}(-\d\d)?\s+/, '').toLowerCase().replace(/^upper deck (series (one|two|1|2)|extended series)$/, 'upper deck').replace(/series (one|1)\b/, 'series1').replace(/series (two|2)\b/, 'series2').replace(/^panini /, '').replace(/^score rookies? (&|and) traded$/, 'score').replace(/[^a-z0-9]+/g, '');
export const numKey = (n) => String(n ?? '').replace(/^0+(?=\d)/, '').toLowerCase();

export async function loadComc() {
  let findings = [];
  try { findings = JSON.parse(await readFile(resolve(ROOT, 'temp/comc/comc-findings.json'), 'utf8')); } catch { return new Map(); }
  const out = new Map();
  for (const f of findings) {
    const rows = [];
    const teamRows = [];
    if (f.suggestedAction === 'new-candidate') {
      for (const c of f.eligibleFirstYearCards ?? []) {
        if (SKIP.test(c.set) || !/ - \[Base\]$/.test(c.set)) continue;
        const name = c.set.replace(/ - \[Base\]$/, '');
        const cy = +c.season.slice(0, 4);
        const sub = c.title?.includes(' - ') ? c.title.split(' - ')[0] : null;
        rows.push({
          id: `comc-${c.comcUrl.split('/').pop()}`, src: 'comc', via: 'comc', multi: false,
          player: f.name, title: c.title, set: `${cy} ${name}`, slug: `hockey-cards-${cy}-${slugOf(name)}`,
          cardNumber: c.cardNumber, rc: c.flags.includes('RC'), serial: null, url: null, comcUrl: c.comcUrl, subset: sub, cy,
          comcMatch: f.matchConfidence,
        });
      }
    }
    for (const c of f.teamSetCards ?? []) {
      const name = c.set.replace(/ - \[Base\]$/, '');
      const cy = +c.season.slice(0, 4);
      teamRows.push({ id: `comc-${c.comcUrl.split('/').pop()}`, src: 'comc', via: 'comc', multi: false, player: f.name, title: c.title, set: `${cy} ${name}`, slug: `hockey-cards-${cy}-${slugOf(name)}`, cardNumber: c.cardNumber, rc: c.flags.includes('RC'), serial: null, url: null, comcUrl: c.comcUrl, subset: null, cy, comcMatch: f.matchConfidence, teamSet: true });
    }
    out.set(f.playerId, { rows, teamRows, comcUrl: f.comcUrl ?? null, matchConfidence: f.matchConfidence, action: f.suggestedAction, note: f.note });
  }
  return out;
}
