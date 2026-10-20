// Which SportsCardsPro hockey sets ("consoles") count as rookie-card-bearing families for the wide search, and how to
// classify them. Slug list: temp/cache/scp-wide/slugs-all.txt = every hockey set on the SCP brand pages (upper-deck,
// topps, fleer, score, panini, other-cards) plus set slugs seen in cached search results (OPC, Parkhurst, Pinnacle,
// Pro Set ... have no brand page of their own; they sit under "other cards").
// Audited 2026-10-19 against the full slug list: base/main sets of every brand 1968-2026 are covered; pure insert,
// parallel, sticker, reprint, minor-league/junior (CHL, AHL, ITG Heroes & Prospects, Classic, Bowman CHL, ...) and
// oddball (Post, Esso, Kraft, McDonald's, Tim Hortons, ...) sets are deliberately left out.
export const BASE_FAMILIES = [
  // [regex on the slug after "hockey-cards-YYYY-", kind, tier]  tier: 'base' | 'premium'
  // ---- O-Pee-Chee family (OPC base, WHA, Premier, Chrome, Platinum, Update, Retro, Topps/OPC; SCP lists the 1999-00 OPC Chrome set as "1999 Topps Chrome" and the 2000-02 Chrome sets as Topps Chrome, so Topps Chrome is treated as OPC Chrome) ----
  [/^o-pee-chee(-wha)?$/, 'opc', 'base'],
  [/^(o-pee-chee|topps)-premier$|^topps-opc-premier$/, 'opcp', 'base'],
  [/^o-pee-chee-(chrome|platinum|update|retro)$|^topps-opc$|^topps-chrome$/, 'opcx', 'base'],
  // ---- Topps family ----
  [/^topps$/, 'topps', 'base'],
  [/^topps-(premier-plus|gold-label|heritage|total|pristine|stars|reserve|traded|finest)$|^finest$/, 'toppsp', 'base'],
  // ---- Parkhurst ----
  [/^parkhurst(-rookie|-international|-se|-vintage|-champions|-prominent-prospects)?$/, 'parkhurst', 'base'],
  // ---- Upper Deck base, rookie and update sets ----
  [/^upper-deck(-series-(one|two|1|2)|-extended-series|-update|-choice|-pros-&-prospects|-special-edition)?$/, 'ud', 'base'],
  [/^upper-deck-(rookie-class|rookie-update|rookie-showcase)$/, 'udrookie', 'base'],
  [/^upper-deck-(victory|mvp|bee-?hive|ice|artifacts|be-a-player|black-diamond|sp|trilogy|allure|clear-cut|credentials|engrained|honor-roll|ovation|overtime|stature|power-play|gold-reserve|powerdeck|retro|vintage|champ%27s|champs|parkhurst|collector%27s-choice|victory-mvp|ud-portraits|ud3)$|^ud3$/, 'udother', 'base'],
  [/^upper-deck-(premier|synergy|black|sweet-shot|rookie-threads|ultimate-victory|premier-collection|artistic-impressions)$/, 'premium', 'premium'],
  [/^(sp|sp-authentic|spx|sp-premier|spx-finite|sp-authentic-20\d\d-update)$/, 'sp', 'premium'],
  [/^(sp-game-used|sp-gam-used|upper-deck-spx)$/, 'premium', 'premium'],
  [/^upper-deck-(the-cup|hot-prospects|exclusives|ultimate-collection)$/, 'premium', 'premium'],
  [/^(the-cup|hot-prospects|fleer-hot-prospects|exclusives|ultimate-collection|ultimate-collection-20\d\d-update)$/, 'premium', 'premium'],
  // ---- other mainstream brands ----
  [/^(pinnacle|pinnacle-canadian|pinnacle-be-a-player|pinnacle-beehive|pinnacle-certified|pinnacle-inside|pinnacle-mint|pinnacle-summit|pinnacle-totally-certified|pinnacle-zenith|zenith|be-a-player|score|score-canadian|score-american|score-rookie-traded|pro-set|pro-set-platinum|fleer|ultra|fleer-ultra|fleer-metal|fleer-showcase|fleer-retro|fleer-power-play|donruss|donruss-elite|donruss-canadian-ice|donruss-limited|donruss-preferred|donruss-studio|donruss-priority|leaf|leaf-limited|leaf-preferred|leaf-gold-rookie|leaf-metal|leaf-ultimate|bowman|bowman-young-stars|stadium-club|topps-stadium-club|collector%27s-choice|collector%27s-edge-ice|pacific|pacific-(crown|crown-royale|dynagon|dynagon-ice|invincible|omega|paramount|revolution|aurora|prism|private-stock|private-stock-titanium|private-stock-reserve|vanguard|adrenaline|heads-up|atomic|calder|exclusive|maximum-impact|quest-for-the-cup|complete|exhibit|in-the-crease|supreme)|flair|select|skybox-impact|skybox|skybox-metal-universe|skybox-e-motion|panini-(certified|donruss|donruss-elite|pinnacle|score|zenith|contenders|crown-royale|dominion|elite|limited|rookie-anthology|prizm|select|titanium|totally-certified|playbook|national-treasures))$/, 'mainstream', 'base'],
];
export function classifySlug(slug) {
  const m = slug.match(/^hockey-cards-(\d{4})-(.+)$/);
  if (!m) return null;
  const rest = m[2].replace(/&amp;/g, '&');
  for (const [re, kind, tier] of BASE_FAMILIES) {
    if (!re.test(rest)) continue;
    return { year: +m[1], rest, kind, tier };
  }
  return null;
}
