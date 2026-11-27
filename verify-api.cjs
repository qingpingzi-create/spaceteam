const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('./server/local-db.cjs');
const { calculate } = require('./dist/scoring.js');
function records(rt = 300) {
 return Array.from({ length: 30 }, (_, i) => ({ round: i < 10 ? 1 : 2, trial: i < 10 ? i + 1 : i - 9, kind: i >= 24 ? 'no-go' : 'go', outcome: i >= 24 ? 'correctReject' : 'hit', rt: i >= 24 ? null : rt }));
}
async function run() {
 const { createApi } = await import('./server/api.mjs');
 const api = createApi(calculate), filename = path.join(os.tmpdir(), 'space-crew-test-' + crypto.randomUUID() + '.sqlite');
 let db = openDatabase(filename);
 const call = async (url, body, token) => {
  const response = await api(new Request('https://game.test' + url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://game.test' }, body: JSON.stringify(body) } : token ? { headers: { Authorization: 'Bearer ' + token } } : {}), { DB: db });
  return { status: response.status, body: await response.json() };
 };
 const playerA = 'a'.repeat(64), playerB = 'b'.repeat(64);
 const first = { id: 'first-run-001', nickname: '星星同学', playerToken: playerA, mode: 'keyboard', records: records(300), result: { total: 100 } };
 try {
  assert.deepEqual((await call('/api/stats')).body, { totalPlayers: 0, totalGames: 0, todayGames: 0 });
  assert.equal((await call('/api/scores', { ...first, records: records().slice(0, 29) })).status, 400);
  assert.equal((await call('/api/scores', { ...first, nickname: '<script>' })).status, 400);
  assert.equal((await call('/api/scores', { ...first, records: records(99) })).status, 400);
  assert.equal((await call('/api/scores', { ...first, records: records(1500) })).status, 400);
  const saved = await call('/api/scores', first);
  assert.equal(saved.status, 200); assert.equal(saved.body.saved.score, 96); // Ignore forged client score.
  assert.equal(saved.body.totalPlayers, 1); assert.equal(saved.body.totalGames, 1);
  assert.equal((await call('/api/scores', first)).body.totalGames, 1); // Idempotent retry.
  assert.equal((await call('/api/scores', { ...first, nickname: '另一个昵称' })).status, 409);
  assert.equal((await call('/api/scores', { ...first, playerToken: playerB })).status, 409);
  const concurrent = { ...first, id: 'parallel-run-001', records: records(280) };
  const duplicate = await Promise.all([call('/api/scores', concurrent), call('/api/scores', concurrent)]);
  assert.ok(duplicate.every(r => r.status === 200)); assert.equal((await call('/api/stats')).body.totalGames, 2);
  await call('/api/scores', { ...first, id: 'player-b-run-01', playerToken: playerB, nickname: '月球队长', records: records(250) });
  await call('/api/scores', { ...first, id: 'player-a-touch', mode: 'touch' });
  const board = (await call('/api/leaderboard?mode=keyboard')).body;
  assert.equal(board.totalPlayers, 2); assert.equal(board.totalGames, 4);
  assert.equal(board.items.length, 2); assert.equal(board.items[0].nickname, '月球队长'); assert.equal(board.items[0].score, 100);
  assert.equal(board.items[1].score, 98); assert.equal(board.items[1].rank, 2);
  assert.ok(!JSON.stringify(board).includes(playerA)); assert.ok(!JSON.stringify(board).includes('player_key'));
  assert.equal((await call('/api/leaderboard?mode=touch')).body.items.length, 1);
  const history = (await call('/api/history?mode=keyboard', null, playerA)).body;
  assert.equal(history.count, 2); assert.equal(history.items.length, 2);
  assert.equal((await call('/api/history?mode=keyboard', null, 'c'.repeat(64))).body.count, 0);
  assert.equal((await call('/api/history')).status, 401);
  const preview = (recordList, token = 'c'.repeat(64)) => call('/api/live-position', { ...first, id: 'live-preview-001', nickname: '实时挑战者', playerToken: token, records: recordList });
  const startPosition = await preview([]);
  assert.equal(startPosition.status, 200); assert.equal(startPosition.body.rank, 3); assert.equal(startPosition.body.score, 0);
  assert.equal(startPosition.body.items.filter(row => row.isYou).length, 1);
  const winningPosition = await preview(records(200));
  assert.equal(winningPosition.body.rank, 1); assert.equal(winningPosition.body.score, 100);
  const ownBestPosition = await preview(records(300).slice(0, 1), playerA);
  assert.equal(ownBestPosition.body.rankedScore, 98); assert.equal(ownBestPosition.body.score, 3);
  assert.equal(ownBestPosition.body.rank, 2); assert.equal(ownBestPosition.body.items.filter(row => row.isYou).length, 1);
  assert.equal((await preview(records(99).slice(0, 2))).status, 400);
  assert.equal((await call('/api/stats')).body.totalGames, 4); // Live previews are strictly read-only.
  assert.equal((await call('/api/stats')).body.totalPlayers, 2);
  assert.equal((await call('/api/leaderboard?mode=invalid')).status, 400);
  assert.equal((await call('/api/leaderboard?offset=-1')).status, 400);
  const cross = await api(new Request('https://game.test/api/scores', { method: 'POST', headers: { Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: JSON.stringify(first) }), { DB: db });
  assert.equal(cross.status, 403);
  db.close(); db = openDatabase(filename); // Persist through a server restart, without recreating rows.
  assert.equal((await call('/api/stats')).body.totalGames, 4);
  for (let i = 0; i < 25; i++) await call('/api/scores', { ...first, id: 'pagination-run-' + i, nickname: '玩家' + i, playerToken: (i + 10).toString(16).padStart(64, '0') });
  const page1 = (await call('/api/leaderboard?mode=keyboard')).body, page2 = (await call('/api/leaderboard?mode=keyboard&offset=20')).body;
  assert.equal(page1.items.length, 20); assert.equal(page1.hasMore, true); assert.equal(page2.items.length, 7); assert.equal(page2.items[0].rank, 21);
  assert.equal((await call('/api/stats')).body.totalPlayers, 27);
  assert.equal((await call('/api/scores', { ...first, id: 'rate-check-1' })).status, 200);
  assert.equal((await call('/api/scores', { ...first, id: 'rate-check-2' })).status, 200);
  assert.equal((await call('/api/scores', { ...first, id: 'rate-check-3' })).status, 200);
  assert.equal((await call('/api/scores', { ...first, id: 'rate-check-4' })).status, 429);
  console.log('PASS: server score validation, best-score ranking, independent modes, historical records, participant deduplication, duplicate/concurrent retries, ownership, pagination and persistent database.');
 } finally {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) { try { fs.unlinkSync(filename + suffix); } catch {} }
 }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
