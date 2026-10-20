#!/usr/bin/env node
// Phase 2 baseline, step 2 (offline, no requests): turns gathered SCP rows (name searches + the wide set crawl in
// temp/cache/scp-wide/index.jsonl) into temp/reference/cards-baseline.json following docs/cards.md. Re-runnable.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { classifySlug } from './cards-wide-sets.mjs';
import { loadComc, setKey, numKey, MAINSTREAM } from './cards-comc-merge.mjs';
import { ROOT, loadTargets, startYear, isWhaOnly, parsePlayerText, nameVariants, matchRowCompat, fold } from './cards-baseline-lib.mjs';

const CHECKED_ON = '2026-10-19';
const OPC_ERA_END = 1988;   // rookie seasons through 1988-89: OPC (then Topps / Parkhurst) leads, auto-pick
const YG_ERA = 1999;        // rookie seasons 1999-00 on: Young Guns leads where one exists
const LATE = 3;             // first card this many seasons after rookieSeason or more -> needs-review

const readJsonl = async (f) => { try { return (await readFile(f, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const gathered = new Map();
for (const file of ['gather.jsonl', 'gather2.jsonl', 'gather3.jsonl']) for (const g of await readJsonl(resolve(ROOT, 'temp/cache/scp-baseline', file))) gathered.set(g.playerId, g);
const wideIndex = [...new Map((await readJsonl(resolve(ROOT, 'temp/cache/scp-wide/index.jsonl'))).map((s) => [s.slug, s])).values()];
const comcAll = await loadComc(); // COMC findings merged in as extra candidates (reference links only)
const pilot = JSON.parse(await readFile(resolve(ROOT, 'temp/reference/cards-pilot.json'), 'utf8')).records;
const pilotById = new Map(pilot.map((r) => [r.playerId, r]));

// ---- wide rows: index every crawled set row by surname so players can be matched offline ----
const bySurname = new Map();
let wideRowCount = 0;
for (const s of wideIndex) for (const r of s.rows) {
  const { names } = parsePlayerText(r.player);
  if (names.length !== 1) continue;
  const parts = names[0].split(' ');
  if (parts.length < 2) continue;
  const key = parts.slice(1).join(' ');
  if (!bySurname.has(key)) bySurname.set(key, []);
  bySurname.get(key).push({ ...r, set: r.set || s.setName, multi: false, via: 'wide' });
  wideRowCount++;
}
function wideRowsFor(p) {
  const Y = startYear(p);
  const firsts = nameVariants(p);
  const out = [];
  for (const r of bySurname.get(fold(p.lastName)) ?? []) {
    const cy = +(r.set.match(/^(\d{4})/)?.[1] ?? 0);
    if (cy < Y - 1) continue; // no upper bound: the first-year rule needs the earliest card, wherever the crawl found it
    if (matchRowCompat(r, firsts, p.lastName)) out.push(r);
  }
  return out;
}

const seasonLabel = (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

// ---- row classification ----
// Kind comes from the SCP set slug (the same classifySlug the crawl uses), so the crawl and the ranking agree on which
// sets count. Sets not in the audited family list (inserts, oddball, minor/junior, Classic, ...) are kind 'other' = not eligible.
function prep(r) {
  const nonHockey = /\((?!Hockey)[^)]+\)$/.test(r.set);
  const m = r.set.match(/^(\d{4})\s+(.*)$/);
  if (!m || nonHockey) return null;
  const variant = r.src === 'comc' ? null : parsePlayerText(r.player).variant;
  const base = m[2];
  const slug = r.slug ?? (r.url ?? '').match(/\/game\/([^/]+)\//)?.[1];
  const cls = slug ? classifySlug(slug) : null;
  let kind = cls ? cls.kind : (r.src === 'comc' && MAINSTREAM.test(m[2]) ? 'main' : 'other'); // COMC-only rows: an unclassified set counts as mainstream only for the known brands (never oddball regional sets)
  if (kind === 'ud' && !/^upper-deck(-series-(one|two|1|2)|-extended-series|-update)?$/.test(cls.rest)) kind = 'udother';
  if (kind === 'udother' && /artifacts$/.test(cls.rest)) kind = 'artifacts';
  if (kind === 'toppsp' || kind === 'opcp' || kind === 'opcx') { /* kept as is: toppsp = other Topps family, opcp = OPC/Topps Premier, opcx = OPC Chrome/Platinum/Update/Retro */ }
  if (kind === 'parkhurst' && !/^parkhurst$/.test(cls.rest)) kind = 'main';
  const num = /^\d+$/.test(r.cardNumber ?? '') ? +r.cardNumber : null;
  const premTxt = `${r.title ?? ''} ${base} ${variant ?? ''}`.replace(/Be A Player (Memorabilia|Millennium Signature Series)/i, r.comcUrl ? 'Be A Player' : '$&'); // ITG Be A Player Memorabilia is a base set
  const premium = kind === 'premium' || /\b(Auto|Autograph|Signature|Patch|Jersey|Relic|Memorabilia|Future Watch|Scripts)\b/i.test(premTxt) || (kind === 'sp' && !!r.serial && +m[1] >= 2001);
  return { ...r, cy: +m[1], base, kind, variant, num, ext: /Extended/.test(base), premium, reprint: /Reprint|Buyback|Tiffany|Factory/i.test(base) };
}
const cmp = (a, b) => a.cy - b.cy || (a.num ?? 1e9) - (b.num ?? 1e9);
const FLAG = new Set(['opc', 'topps', 'parkhurst', 'ud']);
const OPCG = new Set(['opc', 'opcp', 'opcx']); // O-Pee-Chee family
const label = (r) => `${r.set}${r.cardNumber != null ? ' #' + r.cardNumber : ''}`;
const inBlock = (n) => (n >= 201 && n <= 250) || (n >= 451 && n <= 500) || (n >= 701 && n <= 750);
/**
 * Young Guns (base-set Upper Deck rookie block). Number blocks checked against the crawled set pages: 1992-93 #555-599,
 * 2000-01 #181-230, 2001-02 #181-211, 2002-03 #196-240, from 2003-04 #201-250 / #451-500 / #701-750. For 1993-1999 SCP's
 * [RC] flag on a base Upper Deck card is the only signal ("possible Young Guns").
 */
const YG_BLOCKS = { 1992: [555, 599], 2000: [181, 230], 2001: [181, 211], 2002: [196, 240] };
const isYG = (r) => r.kind === 'ud' && r.num != null && (r.cy >= 2003 ? inBlock(r.num) : YG_BLOCKS[r.cy] ? r.num >= YG_BLOCKS[r.cy][0] && r.num <= YG_BLOCKS[r.cy][1] : (r.cy >= 1993 && r.cy <= 1999 && r.rc));

const CONF = ['low', 'medium', 'high'];
let CAP = 'low'; // highest confidence a COMC confirmation may reach for the player being decided
function toCard(r, why, conf) {
  if (r.comcConfirm && r.scpRc && r.comcRc && r.comcMatch === 'name+era' && conf !== 'high' && CONF.indexOf(conf) < CONF.indexOf(CAP)) conf = CONF[CONF.indexOf(conf) + 1];
  if (r.src === 'comc') why += ' (Found on COMC)'; else if (r.comcConfirm) why += ' (confirmed on COMC)';
  const brand = ({ opc: 'O-Pee-Chee', opcp: 'O-Pee-Chee', opcx: 'O-Pee-Chee', topps: 'Topps', parkhurst: 'Parkhurst', ud: 'Upper Deck', udrookie: 'Upper Deck' })[r.kind] ?? r.base.replace(/ .*/, '');
  return {
    set: r.set, scpYear: String(r.cy), brand, subset: r.subset ?? null, variant: r.variant, cardNumber: r.cardNumber,
    serialNumbered: r.serial, rookieFlag: r.rc, sourceIds: r.src === 'comc' ? { scp: null, comc: r.id } : { scp: r.id }, url: r.url ?? null,
    ...(r.comcUrl ? { comcUrl: r.comcUrl, ...(r.src === 'comc' ? { foundOnComc: true, label: 'Found on COMC' } : { confirmedOnComc: true }) } : {}),
    ungradedPriceUsd: r.ungradedPrice ?? null, season: seasonLabel(r.cy), why: /Topps Chrome$/.test(r.set) && !r.comcConfirm ? `${why} (SportsCardsPro lists the O-Pee-Chee Chrome set as Topps Chrome)` : why, confidence: conf,
  };
}
function record(p, o) {
  const usesComc = [o.chosen, ...(o.candidates ?? [])].some((c) => c?.comcUrl);
  const cm = comcAll.get(p.playerId);
  return {
    playerId: p.playerId, name: p.name, birthDate: p.birthDate, rookieSeason: p.rookieSeason,
    status: o.status, chosen: o.chosen ?? null, candidates: o.candidates ?? [], rule: o.rule, confidence: o.confidence,
    source: usesComc ? 'sportscardspro.com + comc.com' : 'sportscardspro.com',
    ...(cm?.comcUrl ? { comc: { url: cm.comcUrl, match: cm.matchConfidence, action: cm.action, note: cm.action === 'supports-no-card' ? 'COMC supports no card: ' + cm.note : cm.note } } : {}), checkedOn: CHECKED_ON, reason: o.reason ?? null, reviewed: false,
    ...(o.pendingRelease ? { pendingRelease: true, recheckAfter: o.recheckAfter } : {}),
    ...(o.tags ? { tags: o.tags } : {}),
    ...(o.firstCardSeason ? { firstCardSeason: o.firstCardSeason } : {}),
  };
}
/** Ladder: keep options up to and including the first high one, max 3. */
function ladder(opts) {
  const out = [];
  const seen = new Set();
  for (const o of opts) {
    const k = o.sourceIds.scp ?? o.sourceIds.comc;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
    if (o.confidence === 'high' || out.length === 3) break;
  }
  return out;
}
function stripCard(c) { const { why, confidence, ...rest } = c; return rest; }
function multiSame(rows, lead) { return rows.some((r) => r.cy === lead.cy && r.kind === lead.kind && r.id !== lead.id); }

const report = { udEarlierThanOpc: [], laterYoungGuns: [], laterCardsMentioned: 0 };
const firstYearOf = new Map(); // playerId -> first card year (used by the verified Young Guns override)

function decide(p) {
  const g = gathered.get(p.playerId) ?? { rows: [], queries: [], fallback: false };
  const Y = startYear(p);
  const whaOnly = isWhaOnly(p);
  const tags = [];
  const wide = wideRowsFor(p);
  const rowsAll = new Map(g.rows.map((r) => [r.id, r]));
  for (const r of wide) if (!rowsAll.has(r.id)) rowsAll.set(r.id, r);
  // ---- COMC merge: same season + set + card number as an SCP row = same card (keep the SCP id, add the COMC link);
  // otherwise a COMC-only candidate. Weak finds (no RC flag) later than the NHL rookie season are ignored, so they can neither
  // outrank SCP candidates nor lock a later first year. COMC "O-Pee-Chee Chrome" and SCP "Topps Chrome" are different sets here.
  const comc = comcAll.get(p.playerId);
  CAP = 'low';
  if (comc?.rows.length) {
    const key = (r) => `${r.set.match(/^(\d{4})/)?.[1]}|${setKey(r.set)}|${numKey(r.cardNumber)}`;
    const scpKeys = new Map();
    for (const r of rowsAll.values()) if (r.src !== 'comc' && parsePlayerText(r.player).variant === null && !scpKeys.has(key(r))) scpKeys.set(key(r), r); // base rows only, never a parallel with the same set name
    for (const c of comc.rows) {
      if (!c.rc && c.cy > Y) continue;
      const s = scpKeys.get(key(c));
      if (s) rowsAll.set(s.id, { ...s, rc: s.rc || c.rc, comcUrl: c.comcUrl, comcConfirm: true, comcRc: c.rc, scpRc: s.rc, comcMatch: c.comcMatch }); // flags agree = both RC
      else rowsAll.set(c.id, c);
    }
  }
  const all = [...rowsAll.values()].map(prep).filter(Boolean).filter((r) => !r.multi);
  if (g.fallback && !wide.length) tags.push('lastname-initial-match');
  // eligible = recognised set, not a parallel/variant, not a reprint/oddball/minor/junior set
  const base = all.filter((r) => r.kind !== 'other' && r.variant === null && !r.reprint && !/(Sticker|Jumbo|Acetate|Renewed|French|Exclusives)/.test(r.base) && (!whaOnly || ['opc', 'topps'].includes(r.kind)));
  const pendingNote = { pendingRelease: true, recheckAfter: 'Upper Deck Series 2 / Extended Series release' };
  if (!all.length) {
    const searches = g.queries.length ? ` (name searches: ${g.queries.map((q) => q.q).join(' | ')}; plus the full set pages of the OPC/Topps/Parkhurst families (and the Upper Deck family from 1989-90) for ${seasonLabel(Y - 1)} to ${seasonLabel(Y + 3)})` : '';
    if (whaOnly || Y <= OPC_ERA_END) return record(p, { status: 'no-card', rule: whaOnly ? 'wha-earliest-opc' : 'none-found', confidence: 'medium', reason: `${whaOnly ? 'WHA-only' : 'Pre-1989 player'}; SCP has no hockey card rows for this name${searches}. Not verified outside SCP (TCDB/Beckett blocked).` });
    if (Y >= 2025) return record(p, { status: 'needs-review', rule: 'modern-ud-young-guns', confidence: 'none', ...pendingNote, reason: `Rookie season ${p.rookieSeason}; no SCP listing found. Card likely not released/listed yet.` });
    return record(p, { status: 'needs-review', rule: 'none-found', confidence: 'none', reason: `Played from ${p.rookieSeason} but SCP has no hockey rows for the name${searches}. Check name spelling / card existence manually.` });
  }
  const preRows = base.filter((r) => (FLAG.has(r.kind) || r.kind === 'main') && r.cy < Y - 1);
  // Pre-debut cards are legitimate before the 2005-06 Rookie Rule, so no namesake tag for earlier rookies.
  if (Y >= 2005 && preRows.length) tags.push('name-collision-suspect');
  const T = tags.length ? tags : undefined;
  const effY = whaOnly ? Math.max(Y, 1974) : Y;
  const pending = Y >= 2025;

  // ---- FIRST-YEAR RULE: the flagship must come from the first season in which cards of the player exist ----
  const LB = Y >= 2005 ? Y : Y - 1;
  const pool0 = base.filter((r) => r.cy >= LB);
  if (!pool0.length) {
    const early = [...base].sort(cmp).slice(0, 3);
    if (whaOnly || Y <= OPC_ERA_END) return record(p, { status: 'no-card', rule: whaOnly ? 'wha-earliest-opc' : 'none-found', confidence: 'medium', reason: `${whaOnly ? 'WHA-only' : 'Rookie ' + p.rookieSeason}: SCP has hockey rows for the name but no eligible flagship-set card from the rookie period (earliest rows: ${[...all].sort(cmp).slice(0, 3).map(label).join(', ') || 'none'}). Not verified outside SCP.`, tags: T });
    if (!early.length) return record(p, { status: 'needs-review', rule: 'none-flagship', confidence: 'low', candidates: [...all].sort(cmp).slice(0, 3).map((r) => toCard(r, label(r), 'low')), reason: `Only non-flagship rows found (${[...all].sort(cmp).slice(0, 3).map(label).join(', ')}).`, tags: T, ...(pending ? pendingNote : {}) });
    return record(p, { status: 'needs-review', rule: 'none-flagship', confidence: 'low', candidates: early.map((r) => toCard(r, label(r), 'low')), reason: `No eligible card in the rookie period; earliest eligible rows are ${early.map(label).join(', ')}.`, tags: T, ...(pending ? pendingNote : {}) });
  }
  const fy = Math.min(...pool0.map((r) => r.cy));
  firstYearOf.set(p.playerId, fy);
  const pool = pool0.filter((r) => r.cy === fy);
  const later = base.filter((r) => r.cy > fy);
  const laterYG = later.filter((r) => isYG(r) && !r.premium).sort(cmp)[0];
  const laterNote = (() => {
    const bits = [];
    if (laterYG) bits.push(`a Young Guns exists later (${label(laterYG)}, ${seasonLabel(laterYG.cy)}) but is disqualified by the first-year rule`);
    const lo = later.filter((r) => OPCG.has(r.kind) && !r.premium).sort(cmp)[0];
    if (lo && !laterYG) bits.push(`a later-year OPC card exists (${label(lo)}, ${seasonLabel(lo.cy)}), not eligible`);
    if (bits.length) report.laterCardsMentioned++;
    return bits.length ? `First-year rule: first card season is ${seasonLabel(fy)}; ${bits.join('; ')}.` : `First card season is ${seasonLabel(fy)}.`;
  })();
  const d = fy - effY;
  CAP = d >= LATE ? 'low' : (Y > OPC_ERA_END && Y < YG_ERA) || d >= 2 || tags.includes('lastname-initial-match') ? 'medium' : 'high';
  const premOpts = (rows, n) => rows.filter((r) => r.premium).sort((a, b) => (b.rc - a.rc) || cmp(a, b)).slice(0, n)
    .map((r) => ({ ...toCard(r, `Premium fallback: ${label(r)}${r.rc ? ' [RC]' : ''}${r.serial ? ` (${r.serial})` : ''}, ${seasonLabel(r.cy)}; autograph/patch/numbered card, shown because fewer than 3 non-premium options exist`, 'low'), variant: r.variant ?? 'premium fallback' }));
  /** Appends premium cards when fewer than 3 non-premium options exist. */
  const withPremium = (opts) => (opts.length >= 3 ? opts : [...opts, ...premOpts(pool, 3 - opts.length)]);
  const needs = (rule, reason, opts, extra = {}) => { const c = ladder(opts); return record(p, { status: 'needs-review', rule, confidence: c[0]?.confidence ?? 'none', candidates: c, reason, tags: T, firstCardSeason: seasonLabel(fy), ...extra }); };
  const chosen = (rule, reason, opts) => {
    const c = ladder(opts);
    if (tags.includes('lastname-initial-match')) {
      if (c[0].confidence === 'high') c[0].confidence = 'medium';
      reason = (reason ? reason + ' ' : '') + 'Matched on surname + compatible first name only (SCP uses a different first-name form); verify identity.';
    }
    return record(p, { status: 'chosen', rule, chosen: stripCard(c[0]), candidates: c, confidence: c[0].confidence, reason, tags: T, firstCardSeason: seasonLabel(fy) });
  };
  const nonPrem = pool.filter((r) => !r.premium);
  const sep = (s) => (s ? ' ' + s : '');

  if (d >= LATE) {
    // Generic late-first-card handling: rank the first-year pool, low confidence.
    const ord = rankFlat(nonPrem.length ? nonPrem : pool);
    const o = withPremium(ord.slice(0, 3).map((r) => toCard(r, `${label(r)}${r.rc ? ' [RC]' : ''}; earliest eligible card, ${d} season(s) after rookie season`, 'low')));
    return needs('first-card-late', `First eligible card is ${seasonLabel(fy)}, more than 2 seasons after rookieSeason ${p.rookieSeason}.${whaOnly && Y < 1974 ? ' OPC WHA sets start with 1974-75.' : ''}${sep(laterNote)}`, o, pending ? pendingNote : {});
  }

  // ---- Era C: rookie season 1999-00 on: Young Guns leads, then base rookie cards, premium last ----
  if (Y >= YG_ERA) {
    const yg = nonPrem.filter(isYG).sort(cmp);
    if (!yg.length) CAP = 'medium'; // no Young Guns: the flagship is a judgement call, so a COMC confirmation never makes it 'high' (keeps the three options visible)
    const sus = tags.includes('name-collision-suspect');
    const t1 = nonPrem.filter((r) => !isYG(r) && (r.kind === 'udrookie' || (r.kind === 'ud' && r.rc) || (OPCG.has(r.kind) && r.rc)));
    const used = new Set(t1.map((r) => r.id));
    const t2 = nonPrem.filter((r) => !used.has(r.id) && !isYG(r) && r.kind !== 'topps' && (r.rc || FLAG.has(r.kind) || OPCG.has(r.kind) || ['artifacts', 'udother', 'main', 'sp', 'toppsp'].includes(r.kind)));
    const t2b = nonPrem.filter((r) => !used.has(r.id) && !t2.includes(r) && !isYG(r));
    const SCORE = { udrookie: 0, ud: 1, opc: 2, opcx: 2, opcp: 3, artifacts: 3, parkhurst: 3, udother: 4, main: 4, sp: 4, toppsp: 5, topps: 5 };
    const ord1 = (a, b) => ((SCORE[a.kind] ?? 6) - (SCORE[b.kind] ?? 6)) || cmp(a, b);
    const ord2 = (a, b) => (b.rc - a.rc) || ((SCORE[a.kind] ?? 6) - (SCORE[b.kind] ?? 6)) || cmp(a, b);
    const ser = (r) => (r.serial ? ` (${r.serial})` : '');
    const fb = [
      ...t1.sort(ord1).map((r) => toCard(r, `${label(r)}${r.rc ? ' [RC]' : ''}, ${seasonLabel(r.cy)}; base-set rookie card (no Young Guns in the first card year)`, 'medium')),
      ...[...t2, ...t2b].sort(ord2).map((r) => toCard(r, `${label(r)}${r.rc ? ' [RC]' : ''}${ser(r)}, ${seasonLabel(r.cy)}; other card from the first card year`, 'low')),
    ];
    if (yg.length === 1 || yg.length >= 2) {
      const solid = yg[0].cy >= 2001 && yg[0].rc;
      const conf = (sus || !solid || yg.length > 1) ? 'medium' : 'high';
      const lead = yg.map((r) => toCard(r, `${label(r)} Young Guns${yg.length > 1 ? ' candidate' : ''}, ${seasonLabel(r.cy)}`, conf));
      const reasonYG = `Base-set Upper Deck Young Guns (${yg[0].cy < 2003 ? 'number block checked against the set page' : yg[0].num >= 701 ? 'Extended Series block 701-750' : 'number block'}${yg[0].rc ? ', [RC]' : ', no [RC] flag'}), in the first card year ${seasonLabel(fy)}.` + (sus ? ' Cards dated before the rookie season exist: possible name collision, check.' : '');
      if (yg.length >= 2) return needs('modern-ud-young-guns', `Multiple Young Guns candidates (${yg.map(label).join(', ')}). Pick one.`, lead);
      const opts = conf === 'high' ? lead : [...lead, ...fb];
      return chosen('modern-ud-young-guns', reasonYG, opts);
    }
    const opts = withPremium(fb);
    if (!opts.length) return needs('none-flagship', `Only non-flagship rows found in ${seasonLabel(fy)} (${pool.slice(0, 3).map(label).join(', ')}).`, pool.slice(0, 3).map((r) => toCard(r, label(r), 'low')), pending ? pendingNote : {});
    const prem = /^Premium fallback/.test(opts[0].why);
    const laterYGnote = laterYG ? ` A later-year Young Guns exists (${label(laterYG)}, ${seasonLabel(laterYG.cy)}); the first-year rule disqualifies it${Y >= 2005 ? ' (2005-06+ rookie: owner decides)' : ''}.` : '';
    if (laterYG && Y >= 2005) {
      report.laterYoungGuns.push({ playerId: p.playerId, name: p.name, rookieSeason: p.rookieSeason, firstCardSeason: seasonLabel(fy), youngGuns: label(laterYG) });
      const ygc = toCard(laterYG, `${label(laterYG)} Young Guns, ${seasonLabel(laterYG.cy)}: LATER than the first card year ${seasonLabel(fy)}; owner decides`, 'medium');
      return needs('modern-young-guns-later', `Young Guns falls in a later year (${seasonLabel(laterYG.cy)}) than the player's first card (${seasonLabel(fy)}); kept as the owner-decides case.`, [ygc, ...opts], pending ? pendingNote : {});
    }
    if (laterYG) report.laterYoungGuns.push({ playerId: p.playerId, name: p.name, rookieSeason: p.rookieSeason, firstCardSeason: seasonLabel(fy), youngGuns: label(laterYG), notOption: true });
    return needs(prem ? 'modern-premium-fallback' : 'modern-base-rookie-fallback',
      `No base-set Young Guns in the first card year ${seasonLabel(fy)}${pending ? ' (may not be released/listed yet)' : ''}. ` + (prem ? 'Only autograph/patch/numbered premium cards exist in that year, so these are a last-resort fallback.' : 'Fallback order: base-set rookie cards (Rookie Class, Series base [RC], OPC rookie incl. Chrome), then other rookie cards, premium cards last.') + laterYGnote, opts, pending ? pendingNote : {});
  }

  // ---- Era B: rookie season 1989-90 to 1998-99: OPC / OPC Premier are the core pool, then UD, SP, others ----
  if (Y > OPC_ERA_END) {
    const opcs = nonPrem.filter((r) => OPCG.has(r.kind)).sort((a, b) => ({ opc: 0, opcp: 1, opcx: 2 }[a.kind] - { opc: 0, opcp: 1, opcx: 2 }[b.kind]) || (b.rc - a.rc) || cmp(a, b));
    const uds = nonPrem.filter((r) => r.kind === 'ud').sort((a, b) => (isYG(b) - isYG(a)) || (b.rc - a.rc) || cmp(a, b));
    const sps = nonPrem.filter((r) => r.kind === 'sp').sort(cmp);
    const others = nonPrem.filter((r) => ['main', 'parkhurst', 'udother', 'udrookie', 'topps', 'toppsp', 'artifacts'].includes(r.kind)).sort((a, b) => (b.rc - a.rc) || cmp(a, b));
    // owner-decides report: an Upper Deck card in an EARLIER year than the OPC-family card
    const allWin = base.filter((r) => r.cy >= Y - 1 && r.cy <= Y + 3);
    const ud0 = allWin.filter((r) => r.kind === 'ud' && !r.premium).sort(cmp)[0];
    const opc0 = allWin.filter((r) => OPCG.has(r.kind) && !r.premium).sort(cmp)[0];
    if (ud0 && opc0 && ud0.cy < opc0.cy) report.udEarlierThanOpc.push({ playerId: p.playerId, name: p.name, rookieSeason: p.rookieSeason, ud: label(ud0), opc: label(opc0), udFlag: ud0.rc });
    const list = [];
    const used = new Set();
    const add = (r, w) => { if (r && !used.has(r.id)) { used.add(r.id); list.push([r, w]); } };
    add(opcs[0], opcs[0] && (opcs[0].kind === 'opc' ? 'OPC base' : opcs[0].kind === 'opcp' ? 'O-Pee-Chee/Topps Premier' : 'O-Pee-Chee ' + opcs[0].base.replace(/^O[- ]Pee[- ]Chee ?/i, '')));
    add(uds[0], isYG(uds[0] ?? {}) ? 'Upper Deck Young Guns / [RC]' : 'first Upper Deck card');
    const opc2 = opcs.find((r) => !used.has(r.id));
    add(opc2, opc2 && (opc2.kind === 'opcp' ? 'O-Pee-Chee/Topps Premier' : opc2.kind === 'opcx' ? 'O-Pee-Chee ' + opc2.base.replace(/^O[- ]Pee[- ]Chee ?/i, '') : 'OPC base'));
    add(uds.find((r) => !used.has(r.id)), 'Upper Deck');
    add(sps[0], 'SP / SP Authentic');
    for (const r of others.slice(0, 2)) add(r, `other ${r.base} card`);
    if (!list.length) {
      const o = withPremium([]);
      if (!o.length) return needs('none-flagship', `Cards exist in ${seasonLabel(fy)} but none in the OPC/Upper Deck/SP/mainstream sets; earliest rows: ${pool.slice(0, 3).map(label).join(', ')}.`, pool.slice(0, 3).map((r) => toCard(r, label(r), 'low')));
      return needs('contested-era-ranked', 'Contested era; only premium cards exist in the first card year. ' + laterNote, o);
    }
    const hadOpc = list.some(([r]) => OPCG.has(r.kind));
    const conf = (i, r) => (i === 0 ? 'medium' : (OPCG.has(r.kind) || r.kind === 'ud') ? 'medium' : 'low');
    const opts = list.map(([r, w], i) => toCard(r, `${label(r)} ${w}${r.rc ? ', [RC]' : ''}, ${seasonLabel(r.cy)}`, conf(i, r)));
    const notes = [];
    if (d === 2) notes.push(`first card is ${seasonLabel(fy)}, 2 seasons after rookieSeason ${p.rookieSeason}`);
    if (!uds.length) notes.push('no Upper Deck card in the first card year');
    if (!hadOpc) notes.push(Y <= 1993 ? 'no OPC-family card in the first card year' : 'no OPC base set existed in this period, ranked directly');
    if (ud0 && opc0 && ud0.cy < opc0.cy) notes.push(`an Upper Deck card (${label(ud0)}) is in an earlier year than the first OPC-family card (${label(opc0)}); owner decides`);
    return chosen('contested-era-ranked', `Contested era (1989-90 to 1998-99): first-year options ranked OPC/OPC Premier first, then Upper Deck, SP, other; confidence capped at medium. ${laterNote}` + (notes.length ? ' ' + notes.join('; ') + '.' : ''), opts);
  }

  // ---- Era A: through 1988-89 (incl. WHA and pre-OPC): OPC, then Topps, then Parkhurst ----
  const ordA = (a, b) => ({ opc: 0, opcp: 1, opcx: 1, topps: 2, parkhurst: 3 }[a.kind] ?? 5) - ({ opc: 0, opcp: 1, opcx: 1, topps: 2, parkhurst: 3 }[b.kind] ?? 5) || (b.rc - a.rc) || cmp(a, b);
  const ranked = [...nonPrem].sort(ordA);
  if (!ranked.length) return needs('first-card-late', `First card season ${seasonLabel(fy)} holds only premium cards. ${laterNote}`, withPremium([]), {});
  const lead = ranked[0];
  const leadFlag = ['opc', 'topps', 'parkhurst'].includes(lead.kind);
  const rule = lead.kind === 'opc' ? (/WHA/.test(lead.base) ? 'wha-earliest-opc' : 'era-flagship-opc') : lead.kind === 'topps' ? 'era-flagship-topps' : lead.kind === 'parkhurst' ? 'era-flagship-parkhurst' : 'closest-defensible';
  const kname = { opc: 'O-Pee-Chee', topps: 'Topps', parkhurst: 'Parkhurst' }[lead.kind] ?? lead.base;
  const whaNote = whaOnly && Y < 1974 ? 'OPC WHA sets start with 1974-75, so this is a later-season card.' : '';
  if (preRows.length) {
    const o = [toCard(lead, `${label(lead)} earliest eligible card; but cards dated before the rookie season exist (${preRows.slice(0, 2).map(label).join(', ')})`, 'medium'), ...ranked.slice(1, 3).map((r) => toCard(r, label(r), 'low'))];
    return needs('name-collision', `Possible name collision: flagship cards dated before rookieSeason ${p.rookieSeason} (${preRows.slice(0, 3).map(label).join(', ')}). Matching on name alone is unsafe.`, o);
  }
  const ambiguous = multiSame(ranked, lead);
  const conf = !leadFlag || ambiguous || d === 2 ? 'medium' : 'high';
  const opts = [toCard(lead, `${label(lead)}${lead.rc ? ' [RC]' : ''}, ${leadFlag ? 'earliest ' + kname + ' card' : 'closest defensible card'}, ${seasonLabel(lead.cy)}`, conf), ...ranked.slice(1, 3).map((r) => toCard(r, `${label(r)}${r.rc ? ' [RC]' : ''}; alternate`, 'low'))];
  const reasons = [];
  if (d === 2) reasons.push(`rookieSeason ${p.rookieSeason} but first card is ${seasonLabel(lead.cy)} (2 seasons late, accepted)`);
  if (d === 1) reasons.push(`rookieSeason ${p.rookieSeason} but first card is ${seasonLabel(lead.cy)}`);
  if (ambiguous) reasons.push('several base rows in the same set');
  if (!leadFlag) reasons.push('no OPC/Topps/Parkhurst card in the first card year');
  if (whaNote) reasons.push(whaNote);
  if (later.length && (laterYG || later.some((r) => OPCG.has(r.kind)))) reasons.push(laterNote.replace(/^First-year rule: /, ''));
  return chosen(rule, reasons.length ? 'Edge: ' + reasons.join('; ') + '.' : null, opts);
}
/** Generic flat ranking for the late-first-card case. */
function rankFlat(rows) {
  const o = { opc: 0, opcp: 1, opcx: 1, topps: 2, ud: 2, udrookie: 2, parkhurst: 3, sp: 4, udother: 4, main: 4, artifacts: 4, toppsp: 5 };
  return [...rows].sort((a, b) => ((o[a.kind] ?? 6) - (o[b.kind] ?? 6)) || (b.rc - a.rc) || cmp(a, b));
}

// ---- pilot records: reused, with the owner decisions applied ----
function pilotRecord(p) {
  const r = structuredClone(pilotById.get(p.playerId));
  const rate = (rec) => rec.candidates.forEach((c, i) => { if (!c.confidence) c.confidence = i === 0 ? rec.confidence : 'low'; });
  if (/^Hull,/.test(p.name)) {
    r.confidence = 'high';
    r.reason = 'Owner confirmed 2026-10-18: 1958-59 Topps #66 is the rookie card (no 1957 Parkhurst exists). rookieSeason is 1957-58, first card 1958-59.';
    r.reviewed = true;
    r.candidates = [r.candidates[0]];
    rate(r);
  } else if (/^Selanne,/.test(p.name)) {
    const by = (s, n) => r.candidates.find((c) => c.set === s && c.cardNumber === n);
    const ud = by('1991 Upper Deck', '21'), yg = by('1992 Upper Deck', '574'), ultra = by('1992 Ultra', '444'), prem = by('1992 O-Pee-Chee Premier', '68');
    ud.why = '1991-92 Upper Deck #21, his first card; owner confirmed as the rookie card'; ud.confidence = 'high';
    yg.why = 'Young Guns 1992-93 #574; alternate (Young Guns not yet an established benchmark in early UD years)'; yg.confidence = 'medium';
    ultra.confidence = 'low'; prem.confidence = 'low';
    const { why, confidence, ...card } = ud;
    r.chosen = card;
    r.candidates = [ud, yg, ultra, prem];
    r.rule = 'early-ud-first-card'; r.confidence = 'high'; r.reviewed = true;
    r.reason = 'Owner confirmed 2026-10-18: 1991-92 Upper Deck #21 is the rookie card even though the Young Guns (1992-93 #574) came a year later. Young Guns first applies only once Young Guns were an established benchmark.';
  } else rate(r);
  return r;
}

const targets = await loadTargets();
const lastYear = (p) => Math.max(startYear(p), ...[...(p.nhl.seasons ?? []), ...(p.wha?.seasons ?? [])].map((s) => +s.season.slice(0, 4)));
function farCheck(p, r) {
  if (r.status !== 'needs-review' || r.rule !== 'first-card-late' || !r.candidates.length) return r;
  const cy = +r.candidates[0].scpYear;
  if (cy > lastYear(p) + 10) {
    r.tags = [...new Set([...(r.tags ?? []), 'name-collision-suspect'])];
    r.reason += ` The first card is ${cy - lastYear(p)} years after his last Jets season: likely a namesake, so possibly no card of his own.`;
  }
  return r;
}
// ---- owner-verified Young Guns (data/decisions/young-guns-verified.json) ----
const verified = new Map(JSON.parse(await readFile(resolve(ROOT, 'data/decisions/young-guns-verified.json'), 'utf8')).decisions.map((d) => [d.playerId, d]));
const verifiedUsed = { matchedScp: 0, noScpRow: [] };
/** Applies the owner's verified Young Guns: from 2005-06 on it becomes the chosen (reviewed) card; before that it is a high-confidence alternate. */
function applyVerified(p, rec) {
  const v = verified.get(p.playerId);
  if (!v) return rec;
  const cy = +v.season.slice(0, 4);
  const g = gathered.get(p.playerId);
  const rows = [...(g ? g.rows : []), ...wideRowsFor(p)].map(prep).filter((r) => r && !r.multi && r.variant === null && r.kind === 'ud' && !/(Sticker|Jumbo|Acetate|Renewed|French|Exclusives)/.test(r.base));
  const row = rows.find((r) => r.cy === cy && String(r.cardNumber) === v.cardNumber);
  let card;
  if (row) {
    verifiedUsed.matchedScp++;
    card = toCard(row, `${label(row)} Young Guns, ${v.season}; owner-verified (collection records)`, 'high');
  } else {
    verifiedUsed.noScpRow.push(p.name);
    card = { set: `${cy} Upper Deck`, scpYear: String(cy), brand: 'Upper Deck', subset: null, variant: null, cardNumber: v.cardNumber, serialNumbered: null, rookieFlag: null, sourceIds: { scp: null }, url: null, ungradedPriceUsd: null, season: v.season,
      why: `${cy} Upper Deck #${v.cardNumber} Young Guns, ${v.season}; owner-verified (collection records); no SCP row found`, confidence: 'high' };
  }
  card.verified = true;
  const same = (c) => c.set === card.set && String(c.cardNumber) === String(card.cardNumber);
  const prior = [...(rec.chosen ? [{ ...rec.chosen, why: rec.chosen.why ?? `${rec.chosen.set} #${rec.chosen.cardNumber}`, confidence: rec.confidence }] : []), ...rec.candidates].filter((c) => !same(c));
  const seen = new Set();
  const priorU = prior.filter((c) => { const k = c.set + '#' + c.cardNumber; if (seen.has(k)) return false; seen.add(k); return true; });
  const tags = (rec.tags ?? []).filter((t) => t !== 'name-collision-suspect' && t !== 'lastname-initial-match');
  const tagsOut = tags.length ? { tags } : {};
  const { tags: _t, ...recNoTags } = rec;
  const fy = firstYearOf.get(p.playerId);
  const laterThanFirst = fy !== undefined && cy > fy;
  if (laterThanFirst && startYear(p) >= YG_ERA && startYear(p) < 2005 && cy >= 2001) {
    // 1999-2004 rookie whose verified Young Guns is later than the first card year: owner decides
    report.laterYoungGuns.push({ playerId: p.playerId, name: p.name, rookieSeason: p.rookieSeason, firstCardSeason: seasonLabel(fy), youngGuns: label(card), verified: true });
    const rest = [...(rec.chosen ? [{ ...rec.chosen, why: rec.chosen.why ?? `${rec.chosen.set} #${rec.chosen.cardNumber}`, confidence: rec.confidence }] : []), ...rec.candidates].filter((c) => !same(c)).slice(0, 2);
    return { ...recNoTags, status: 'needs-review', rule: 'verified-young-guns-later', confidence: 'medium', chosen: null, candidates: [{ ...card, why: card.why + `; LATER than the first card year ${seasonLabel(fy)}: owner decides`, confidence: 'medium' }, ...rest], reviewed: false, verifiedYoungGuns: true, pendingRelease: undefined, recheckAfter: undefined,
      reason: `Owner-verified Young Guns ${card.set} #${card.cardNumber} falls in a later year than the player's first card (${seasonLabel(fy)}); first-year rule says it is not a flagship option, kept as the owner-decides case.`, ...tagsOut };
  }
  if (cy >= 2001 && startYear(p) >= YG_ERA) {
    if (laterThanFirst) report.laterYoungGuns.push({ playerId: p.playerId, name: p.name, rookieSeason: p.rookieSeason, firstCardSeason: seasonLabel(fy), youngGuns: label(card), verified: true, leads: true });
    const rest = priorU.map((c) => ({ ...c, confidence: 'low' })).slice(0, 2);
    return { ...recNoTags, status: 'chosen', rule: 'verified-young-guns', confidence: 'high', chosen: stripCard(card), candidates: [card, ...rest], reviewed: true, verifiedYoungGuns: true, pendingRelease: undefined, recheckAfter: undefined,
      reason: `Owner-verified Young Guns from collection records (2026-10-19): ${card.set} #${card.cardNumber}.` + (row ? '' : ' No SCP row found for it.'), ...tagsOut };
  }
  // before 1999-00: the hobby-regarded first flagship card keeps the lead; the verified Young Guns is a high-confidence alternate (only if it is in the first card year)
  if (laterThanFirst) {
    report.laterYoungGuns.push({ playerId: p.playerId, name: p.name, rookieSeason: p.rookieSeason, firstCardSeason: seasonLabel(fy), youngGuns: label(card), verified: true, notOption: true });
    return { ...rec, verifiedYoungGuns: true, reason: ((rec.reason ? rec.reason + ' ' : '') + `Owner-verified Young Guns ${card.set} #${card.cardNumber} is later than the first card year (${seasonLabel(fy)}), so it is not a flagship option.`).trim() };
  }
  const lead = priorU[0] ? [priorU[0]] : [];
  const out = { ...recNoTags, candidates: [...lead, card, ...priorU.slice(1)].slice(0, 3), verifiedYoungGuns: true, ...tagsOut };
  if (!lead.length) { out.status = 'chosen'; out.rule = 'verified-young-guns'; out.chosen = stripCard(card); out.confidence = 'high'; out.reviewed = false; out.reason = 'Owner-verified Young Guns from collection records (2026-10-19); no other card found.'; }
  else out.reason = ((rec.reason ? rec.reason + ' ' : '') + `Owner-verified Young Guns ${card.set} #${card.cardNumber} listed as a high-confidence alternate.`).trim();
  return out;
}
/**
 * Team-set rule (owner proposal, not yet confirmed): a team-issue base set that mirrors the main set (e.g. 1999-00 Topps Toronto
 * Maple Leafs TOR-NA) is added as a labelled, low-ranked "Team set" option from the first card year, after every main-set option
 * and never on its own as the lead when a main-set card exists. It does not take part in the first-year rule and is skipped when
 * the player already has a high-confidence option. It may be a 4th option on top of the three-option ladder.
 */
function addTeamSet(p, r) {
  const cm = comcAll.get(p.playerId);
  if (!cm?.teamRows?.length || !r.firstCardSeason || !r.candidates.length || r.candidates.some((c) => c.confidence === 'high')) return r;
  const fy = +r.firstCardSeason.slice(0, 4);
  const t = cm.teamRows.find((x) => x.cy === fy);
  const row = t && prep(t);
  if (!row) return r;
  CAP = 'low';
  const card = toCard(row, `${label(row)}, ${seasonLabel(fy)}; team-issue base set mirroring the main set design, low-ranked option`, 'low');
  card.variant = 'Team set'; card.teamSet = true;
  teamSetAdded.push(p.name);
  return { ...r, candidates: [...r.candidates, card] };
}
const teamSetAdded = [];
const LOCKED = (p) => /^(Hull|Selanne),/.test(p.name) && pilotById.has(p.playerId);
const records = targets.map((p) => {
  if (LOCKED(p)) return applyVerified(p, pilotRecord(p));
  let r = addTeamSet(p, farCheck(p, decide(p)));
  const old = pilotById.get(p.playerId);
  if (old && !r.candidates.length && old.candidates?.length) r = pilotRecord(p); // keep the pilot's hand-checked reason when nothing better is found
  return applyVerified(p, r);
});
for (const id of verified.keys()) if (!targets.some((p) => p.playerId === id)) console.log('verified decision for a non-target player', id);
console.log('verified applied:', verified.size, 'SCP-matched:', verifiedUsed.matchedScp, 'no SCP row:', verifiedUsed.noScpRow.length, verifiedUsed.noScpRow.join('; '));
await writeFile(resolve(ROOT, 'temp/reference/cards-baseline.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), checkedOn: CHECKED_ON, source: 'sportscardspro.com',
  notes: 'Baseline first pass for every player with NHL or WHA Jets GP. scpYear is the SCP set-year label (start year of the season). Hull and Selanne are locked owner-confirmed pilot records; everything else is rebuilt from the name searches plus the wide set crawl. Candidate confidence is per option (high/medium/low); the ladder stops at the first high option (max 3).',
  count: records.length, records,
}, null, 1));
await writeFile(resolve(ROOT, 'temp/reference/cards-first-year-report.json'), JSON.stringify(report, null, 1));
const by = {};
console.log('team-set options added:', teamSetAdded.join('; '));
console.log('wide rows indexed:', wideRowCount, 'sets:', wideIndex.length);
records.forEach((r) => { const k = `${r.status}/${r.confidence}`; by[k] = (by[k] || 0) + 1; });
console.log(records.length, by);
