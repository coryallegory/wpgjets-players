#!/usr/bin/env node
// Looks up candidate rookie cards on SportsCardsPro (server-rendered HTML, polite scraping:
// 2s+ between requests, browser UA, every response cached under temp/cache/scp/).
// Usage: node scripts/get-cards-scp.mjs <query...>   -> prints parsed rows as JSON
// Library: searchScp(query, {rookiesOnly}) -> { rows, truncated, cached }
// Output for the pilot is assembled into temp/reference/cards-pilot.json (reference data).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = resolve(ROOT, 'temp', 'cache', 'scp');
const BASE = 'https://www.sportscardspro.com';
const DELAY_MS = 2500;
const RETRIES = 3;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const run = promisify(execFile);
let lastRequest = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET a URL as text, cached on disk by URL hash; sequential with a polite delay. */
export async function getHtml(url, postBody = null) {
  const file = resolve(CACHE, createHash('sha1').update(url + '|' + (postBody ?? '')).digest('hex').slice(0, 16) + '.html');
  try {
    return { html: await readFile(file, 'utf8'), cached: true };
  } catch {}
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const wait = DELAY_MS - (Date.now() - lastRequest);
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      // Cloudflare answers 403 to Node's fetch (TLS fingerprint) but not to curl, so shell out to curl.
      const { stdout: html } = await run('curl', ['-sS', '--fail', '--max-time', '30', '--compressed', '-A', USER_AGENT, '-H', 'Accept: text/html', ...(postBody ? ['--data', postBody] : []), url], { maxBuffer: 64 * 1024 * 1024 });
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, `<!-- ${url} -->\n` + html);
      return { html, cached: false };
    } catch (err) {
      lastError = err;
      await sleep(3000 * attempt);
    }
  }
  throw new Error(`Request failed: ${url} (${lastError.message})`);
}

const decode = (s) =>
  s.replace(/&#43;/g, '+').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const strip = (s) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Parses product rows (search results or a console/set page). */
export function parseRows(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr id="product-(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const body = m[2];
    const link = body.match(/<td class="title"[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/td>/);
    if (!link) continue;
    const title = strip(link[2]);
    const extra = strip(link[3]);
    const set = strip((body.match(/<td class="console[^"]*">([\s\S]*?)<\/td>/) || [, ''])[1]);
    const num = title.match(/#(\S+)$/);
    const price = (body.match(/used_price">\s*<span class="js-price">([^<]*)</) || [, ''])[1].trim();
    rows.push({
      id: m[1],
      url: new URL(decode(link[1]), BASE).href,
      title,
      player: num ? title.slice(0, num.index).trim() : title,
      cardNumber: num ? num[1] : null,
      set: set.replace(/\s*\(Hockey\)$/, ''),
      rc: /\[RC\]/.test(extra) || /class="rookie"/.test(link[3]),
      serial: (title + ' ' + extra).match(/\/\d+\b/)?.[0] ?? null,
      ungradedPrice: price || null,
    });
  }
  return rows;
}

export async function searchScp(query, { rookiesOnly = false, excludeVariants = false } = {}) {
  const p = new URLSearchParams({ q: query, type: 'prices' });
  if (rookiesOnly) p.set('rookies-only', 'true');
  if (excludeVariants) p.set('exclude-variants', 'true');
  const url = `${BASE}/search-products?${p}`;
  const { html, cached } = await getHtml(url);
  return { url, rows: parseRows(html), truncated: /Showing <b>only 100 cards/.test(html), cached };
}

/**
 * One page (150 rows) of a set via /console/<slug>. Pages are fetched by POSTing the form's
 * hidden fields (cursor = row offset, release-date = today); the response also names the set in the h1.
 */
export async function consolePage(slug, cursor = 0, releaseDate = new Date().toISOString().slice(0, 10)) {
  const url = `${BASE}/console/${slug}`;
  const body = cursor ? `sort=&when=none&release-date=${releaseDate}&cursor=${cursor}` : null;
  const { html, cached } = await getHtml(url, body);
  const setName = strip((html.match(/<h1>([\s\S]*?)<\/h1>/) || [, ''])[1]).replace(/^Prices for /, '').replace(/ Hockey Cards$/, '');
  const rows = parseRows(html).map((r) => ({ ...r, set: r.set || setName }));
  return { url, setName, rows, cached, hasMore: /class="next_page/.test(html) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const query = process.argv.slice(2).join(' ');
  if (!query) { console.error('usage: get-cards-scp.mjs <query>'); process.exit(1); }
  searchScp(query).then((r) => console.log(JSON.stringify(r, null, 1))).catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
