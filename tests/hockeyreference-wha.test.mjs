import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities, extractTable, parseRows, playerRows, phaseGames, parseBirthDate,
  countryFromFlag, positionNhlStyle, splitName, parsePlayerPage, parseTeamSeason, seasonLabel,
} from '../scripts/wha/get-hockeyreference-wha.mjs';

const skaters = `<table id="player_stats"><tr class="over_header"><th data-stat="x">x</th></tr>
<tr><th scope="col" data-stat="name_display">Player</th></tr>
<tr><th data-stat="ranker">1</th><td data-stat="name_display" data-append-csv="hullbo01"><a href="/players/h/hullbo01.html">Bobby Hull</a></td><td data-stat="pos">LW</td><td data-stat="games">80</td></tr>
<tr><td data-stat="name_display" data-append-csv="blumfr01"><a href="/players/b/blumfr01.html">Frank Blum</a></td><td data-stat="pos">D</td><td data-stat="games"></td></tr>
<tr><td data-stat="name_display" data-append-csv="daleyjo01"><a href="/players/d/daleyjo01.html">Joe Daley</a></td><td data-stat="pos">G</td><td data-stat="games">3</td></tr>
<tr><td data-stat="name_display">Team Totals</td><td data-stat="games">81</td></tr></table>`;
const goalies = `<table id="goalie_stats"><tr><td data-stat="name_display"><a href="/players/d/daleyjo01.html">Joe Daley</a></td><td data-stat="goalie_games">41</td></tr>
<tr><td data-stat="name_display">Team Totals</td><td data-stat="goalie_games">80</td></tr></table>`;

test('decodeEntities', () => {
  assert.equal(decodeEntities('a&nbsp;b &amp; c &#233; &#x41;'), 'a b & c é A');
});

test('extractTable finds tables inside HTML comments', () => {
  const html = `<div><!-- <table class="x" id="goalie_stats"><tr><td>hi</td></tr></table> --></div>`;
  assert.match(extractTable(html, 'goalie_stats'), /hi/);
  assert.equal(extractTable(html, 'nope'), null);
});

test('parseRows keys cells by data-stat and skips header rows', () => {
  const rows = parseRows(extractTable(skaters, 'player_stats'));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].games.text, '80');
  assert.equal(rows[0].name_display.id, 'hullbo01');
});

test('playerRows skips Team Totals and takes id from link', () => {
  const ids = playerRows(extractTable(skaters, 'player_stats'), 'name_display').map((p) => p.id);
  assert.deepEqual(ids, ['hullbo01', 'blumfr01', 'daleyjo01']);
});

test('phaseGames uses goalie table for goalies and counts blank GP as 0', () => {
  const gp = phaseGames(extractTable(skaters, 'player_stats'), extractTable(goalies, 'goalie_stats'));
  assert.equal(gp.get('hullbo01').gp, 80);
  assert.equal(gp.get('blumfr01').gp, 0);
  assert.equal(gp.get('daleyjo01').gp, 41);
  assert.equal(gp.get('daleyjo01').pos, 'G');
  assert.equal(gp.size, 3);
});

test('parseBirthDate / countryFromFlag / positions', () => {
  assert.equal(parseBirthDate('August 17, 1943'), '1943-08-17');
  assert.equal(parseBirthDate('January 3, 1939'), '1939-01-03');
  assert.equal(parseBirthDate(''), null);
  assert.equal(countryFromFlag('SE'), 'SWE');
  assert.equal(countryFromFlag('zz'), null);
  assert.equal(positionNhlStyle('LW'), 'L');
  assert.equal(positionNhlStyle('RW'), 'R');
  assert.equal(positionNhlStyle('D'), 'D');
});

test('splitName flags multi-part names for review', () => {
  assert.deepEqual(splitName('Bobby Hull'), { firstName: 'Bobby', lastName: 'Hull', nameNeedsReview: false });
  assert.equal(splitName('Lars-Erik Sjoberg').firstName, 'Lars-Erik');
  assert.equal(splitName('Lars-Erik Sjoberg').nameNeedsReview, false);
  assert.equal(splitName('Peter Van Der Kooi').nameNeedsReview, true);
  assert.equal(splitName('Bill Smith Jr.').nameNeedsReview, true);
  assert.equal(splitName('Cher').nameNeedsReview, true);
});

test('parsePlayerPage reads meta block', () => {
  const html = `<div id="meta"><h1><span>Bobby Hull</span></h1>
<p><strong>Full Name:</strong> Robert Marvin Hull</p>
<p>(The Golden Jet)</p>
<p><strong>Position</strong>: LW&nbsp;&bull;&nbsp; <strong>Shoots</strong>: Left</p>
<p> <strong>Born:</strong> <span id="necro-birth" data-birth="1939-01-03">January 3, 1939</span> <span> in&nbsp;Point&nbsp;Anne,&nbsp;<a href="/x">Ontario</a> </span> <span class="f-i f-ca" style="">ca</span> </p>
</div><ul id="bling"></ul>`;
  assert.deepEqual(parsePlayerPage(html), {
    fullName: 'Robert Marvin Hull', nickname: 'The Golden Jet', birthDate: '1939-01-03',
    birthplace: 'Point Anne, Ontario', flag: 'ca', position: 'LW',
  });
  assert.equal(parsePlayerPage('<html></html>').fullName, null);
});

test('parseTeamSeason merges phases; playoff-only player kept', () => {
  const post = `<table id="player_stats_post"><tr><td data-stat="name_display"><a href="/players/b/blumfr01.html">Frank Blum</a></td><td data-stat="pos">D</td><td data-stat="games">4</td></tr></table>`;
  const roster = `<table id="roster"><tr><td data-stat="player"><a href="/players/h/hullbo01.html">Bobby Hull</a></td><td data-stat="flag" csk="CA">ca CA</td><td data-stat="pos">LW</td><td data-stat="birth_date">January 3, 1939</td></tr></table>`;
  const html = `${roster}<!-- ${skaters} -->${goalies}${post}`;
  const m = parseTeamSeason(html);
  assert.equal(m.get('blumfr01').regularGP, 0);
  assert.equal(m.get('blumfr01').playoffGP, 4);
  assert.equal(m.get('hullbo01').regularGP, 80);
  assert.equal(m.get('hullbo01').flag, 'CA');
  assert.equal(m.get('hullbo01').birthDate, '1939-01-03');
  assert.equal(m.get('daleyjo01').regularGP, 41);
});

test('seasonLabel', () => {
  assert.equal(seasonLabel(1976), '1975-76');
  assert.equal(seasonLabel(1973), '1972-73');
});
