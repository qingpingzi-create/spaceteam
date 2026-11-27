const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const scoring = require('./dist/scoring.js');

const page = readFileSync(join(__dirname, 'index.html'), 'utf8');
const assets = [...page.matchAll(/(?:src|href)="(\.\/dist\/[^"#]+)"/g)].map(match => match[1]);
assert.equal(assets.length, 6);
for (const asset of assets) assert.ok(readFileSync(join(__dirname, asset)).length);
assert.ok(page.indexOf('browser-board.js') < page.indexOf('cloud.js'));
assert.match(page, /本机参与人数/);

const browserCode = readFileSync(join(__dirname, 'dist/browser-board.js'), 'utf8');
const data = new Map();
const localStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
function load() {
 const window = {};
 runInNewContext(browserCode, { window, localStorage, URL, ReactionScore: scoring });
 return window.SpaceCrewBrowserBoard.request;
}

async function verify() {
 const request = load();
 const records = rt => Array.from({ length: 30 }, (_, i) => i < 24 ? { outcome: 'hit', rt } : { outcome: 'correctReject' });
 const first = { id: 'run-1', playerToken: 'pilot-a', nickname: '飞行员甲', mode: 'keyboard', records: records(450) };
 const preview = { ...first, records: first.records.slice(0, 4) };
 const post = (path, body) => request(path, { body: JSON.stringify(body) });
 assert.equal((await post('/api/live-position', preview)).rank, 1);
 assert.equal((await request('/api/stats')).totalGames, 0);
 await assert.rejects(post('/api/scores', preview), /30/);
 await post('/api/scores', first);
 await post('/api/scores', first);
 const faster = { ...first, id: 'run-2', playerToken: 'pilot-b', nickname: '飞行员乙', records: records(250) };
 await post('/api/scores', faster);
 const improvement = { ...first, id: 'run-3', records: records(350) };
 await post('/api/scores', improvement);
 await post('/api/scores', { ...improvement, id: 'run-4', mode: 'touch' });

 const reloaded = load();
 const board = await reloaded('/api/leaderboard?mode=keyboard');
 assert.equal(board.totalGames, 4);
 assert.equal(board.totalPlayers, 2);
 assert.equal(board.items.length, 2);
 assert.equal(board.items[0].nickname, '飞行员乙');
 assert.equal(board.items[1].id, 'run-3');
 assert.equal((await reloaded('/api/leaderboard?mode=touch')).items.length, 1);
 const history = await reloaded('/api/history?mode=keyboard', { headers: { Authorization: 'Bearer pilot-a' } });
 assert.equal(history.count, 2);
 const live = await post('/api/live-position', { ...preview, id: 'next-round' });
 assert.equal(live.rank, 2);
 assert.equal(live.rankedScore, board.items[1].score);
 assert.equal(live.items.filter(row => row.isYou).length, 1);
 console.log('PASS: Pages assets, browser-only standings, nickname and mode history, deduplication, live previews, reload persistence.');
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
