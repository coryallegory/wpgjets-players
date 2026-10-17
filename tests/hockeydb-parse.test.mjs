import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  parsePlayerList,
  parseTeamSeason,
  parsePlayerPage,
  parseName,
  countryFromBirthplace,
  nhlStylePosition,
  seasonLabel,
} from '../scripts/get-hockeydb-wha.mjs';

const LIST = `<table class="sortable"><thead><tr class="c_sort_head">
<th class="l d_nm">Player Name</th><th>GP</th><th>G</th><th>A.</th><th>Pts</th><th>PIM</th><th>Seasons</th><th>Yrs.</th><th>Pos.</th><th>Birthdate</th><th class="l d_bp">Birthplace</th><th>Highest Level</th></tr></thead>
<tbody><tr><td class="l d_nm"><a href="pdisplay.php?pid=10541">Freeman "Duke" Asmundson</a></td><td>258</td><td>16</td><td>54</td><td>70</td><td>211</td><td>1972-1976</td><td>4</td><td>R</td><td>1943-08-17</td><td class="l d_bp">Vita, MAN</td><td>Major League</td></tr>
<tr><td class="l d_nm"><a href="pdisplay.php?pid=99">Bill Holden</a></td><td>3</td><td>0</td><td>0</td><td>0</td><td>0</td><td>1973-1974</td><td>1</td><td>D</td><td>&nbsp;</td><td class="l d_bp">&nbsp;</td><td>Major League</td></tr>
<tr><td class="l d_nm"><a href="pdisplay.php?pid=5">Frank Blum</a></td><td></td><td></td><td></td><td></td><td></td><td>1975-1976</td><td>1</td><td>F</td><td>1950-01-02</td><td class="l d_bp">Falun, Sweden</td><td>Major League</td></tr>
</tbody></table>`;

const SEASON = `<table><thead><tr><th></th><th class="c_sec_head" colspan="5">Regular Season</th></tr>
<tr class="c_sort_head"><th>#</th><th class="l">Player Name</th><th>Pos.</th><th>GP</th><th>G</th><th>A</th><th>Pts</th><th>PIM</th><th>GP</th><th>G</th><th>A</th><th>Pts</th><th>PIM</th><th>Birthplace</th><th>Age</th></tr></thead>
<tbody>
<tr><td>9</td><td class="l"><a href="/ihdb/stats/pdisplay.php?pid=2409">Bobby Hull</a></td><td>L</td><td class="stat">80</td><td>53</td><td>70</td><td>123</td><td>30</td><td class="stat hidemob">13</td><td>12</td><td>8</td><td>20</td><td>4</td><td>ONT: Point Anne</td><td>36</td></tr>
<tr><td>2</td><td class="l"><a href="/ihdb/stats/pdisplay.php?pid=5">Frank Blum</a></td><td>D</td><td class="stat">--</td><td>--</td><td>--</td><td>--</td><td>--</td><td>2</td><td>0</td><td>0</td><td>0</td><td>0</td><td>Sweden: Falun</td><td>25</td></tr>
</tbody><tfoot><tr class="c_sec_foot"><td></td><td colspan="3">Totals</td><td>345</td></tr></tfoot></table>
<table class="goalietab"><thead><tr><th class="c_sec_head" colspan="12">Goalies</th></tr><tr class="c_sort_head"><th class="l">Player Name</th><th>GP</th><th>Min</th></tr></thead>
<tbody><tr class="shade4"><td><a href="/ihdb/stats/pdisplay.php?pid=1234">Joe Daley</a></td><td>62</td><td>3612</td></tr></tbody></table>`;

const PLAYER = `<h1>Joe Daley</h1><span class="bdate">Born Feb 20 1943 -- </span><span class="hometown" itemprop="homeLocation">East Kildonan, MAN</span>
<table><tr><th class="c_sec_head" colspan="3">RS Scoring</th></tr><tr class="c_sort_head"><th>Season</th><th>Team</th><th>Lge</th><th>GP</th><th>A</th></tr>
<tr><td>1975-76</td><td><a href="/ihdb/stats/leagues/seasons/teams/0001681976.html">Winnipeg Jets</a></td><td>WHA</td><td>62</td><td>1</td></tr>
<tr><td>1975-76</td><td><a href="/ihdb/stats/leagues/seasons/teams/0031681976.html">Other Team</a></td><td>X</td><td>9</td><td>1</td></tr></table>
<table><tr><th class="c_sec_head" colspan="3">PO Scoring</th></tr><tr class="c_sort_head"><th>Season</th><th>Team</th><th>Lge</th><th>GP</th></tr>
<tr><td>1975-76</td><td><a href="/ihdb/stats/leagues/seasons/teams/0001681976.html">Winnipeg Jets</a></td><td>WHA</td><td>12</td></tr></table>`;

test('decodeEntities', () => {
  assert.equal(decodeEntities('Se&#39;an &amp; Ren&eacute; &#x41;'), "Se'an & René A");
});

test('parsePlayerList', () => {
  const rows = parsePlayerList(LIST);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    { pid: rows[0].pid, rawName: rows[0].rawName, gp: rows[0].gp, pos: rows[0].position, bd: rows[0].birthDate, bp: rows[0].birthplace },
    { pid: '10541', rawName: 'Freeman "Duke" Asmundson', gp: 258, pos: 'R', bd: '1943-08-17', bp: 'Vita, MAN' },
  );
  assert.equal(rows[1].birthDate, null);
  assert.equal(rows[1].birthplace, null);
  assert.equal(rows[2].gp, 0);
});

test('parseTeamSeason handles -- as zero and goalie table', () => {
  const rows = parseTeamSeason(SEASON);
  assert.equal(rows.length, 3);
  const hull = rows.find((r) => r.pid === '2409');
  assert.deepEqual([hull.regularGP, hull.playoffGP, hull.position, hull.birthplace], [80, 13, 'L', 'ONT: Point Anne']);
  const blum = rows.find((r) => r.pid === '5');
  assert.deepEqual([blum.regularGP, blum.playoffGP], [0, 2]);
  const daley = rows.find((r) => r.pid === '1234');
  assert.deepEqual([daley.regularGP, daley.playoffGP, daley.position], [62, null, 'G']);
});

test('parsePlayerPage', () => {
  const p = parsePlayerPage(PLAYER);
  assert.equal(p.birthDate, '1943-02-20');
  assert.equal(p.birthplace, 'East Kildonan, MAN');
  assert.deepEqual(p.seasons, { 1976: { regularGP: 62, playoffGP: 12 } });
});

test('countryFromBirthplace', () => {
  assert.equal(countryFromBirthplace('Sweden: Falun'), 'SWE');
  assert.equal(countryFromBirthplace('Falun, Sweden'), 'SWE');
  assert.equal(countryFromBirthplace('ONT: Toronto'), 'CAN');
  assert.equal(countryFromBirthplace('Toronto, ONT'), 'CAN');
  assert.equal(countryFromBirthplace('Hibbing, MN'), 'USA');
  assert.equal(countryFromBirthplace('Finland'), 'FIN');
  assert.equal(countryFromBirthplace(''), null);
  assert.equal(countryFromBirthplace(null), null);
  assert.equal(countryFromBirthplace('Nowhere, ZZ'), null);
});

test('parseName', () => {
  const d = parseName('Freeman "Duke" Asmundson');
  assert.equal(d.name, 'Freeman Asmundson');
  assert.equal(d.nickname, 'Duke');
  assert.deepEqual(d.aliases, ['Duke Asmundson']);
  assert.deepEqual([d.firstName, d.lastName, d.nameNeedsReview], ['Freeman', 'Asmundson', false]);
  const m = parseName('Pierre van Boxmeer');
  assert.equal(m.nameNeedsReview, true);
  assert.equal(parseName('Bobby Hull').nameNeedsReview, false);
  assert.equal(parseName('Bob Smith Jr.').nameNeedsReview, true);
});

test('nhlStylePosition and seasonLabel', () => {
  assert.equal(nhlStylePosition('C').positionNhlStyle, 'C');
  assert.equal(nhlStylePosition('F').positionNhlStyle, null);
  assert.ok(nhlStylePosition('F').positionNote);
  assert.equal(nhlStylePosition(null).positionNhlStyle, null);
  assert.equal(seasonLabel(1973), '1972-73');
  assert.equal(seasonLabel(1979), '1978-79');
});
