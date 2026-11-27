const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { calculate } = require('./dist/scoring.js');
const { openDatabase } = require('./server/local-db.cjs');
const pause = () => new Promise(resolve => setImmediate(resolve));
function makeReport(id) {
 const records = Array.from({ length: 30 }, (_, i) => ({ round: i < 10 ? 1 : 2, trial: i < 10 ? i + 1 : i - 9, kind: i >= 24 ? 'no-go' : 'go', outcome: i >= 24 ? 'correctReject' : 'hit', rt: i >= 24 ? null : 300 }));
 return { id, mode: 'keyboard', version: 1, records, result: calculate(records), timestamp: Date.now() };
}
async function run() {
 const { createApi } = await import('./server/api.mjs');
 const db = openDatabase(), api = createApi(calculate), nodes = new Map(), memory = new Map();
 let loseResponse = false, posts = 0;
 class Node {
  constructor(id) { this.id = id; this.listeners = {}; this.disabled = false; this.hidden = false; this.value = ''; this.textContent = ''; this._html = ''; this.classList = { add() {}, toggle() {} }; }
  set innerHTML(value) { this._html = value; for (const match of value.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1], new Node(match[1])); }
  get innerHTML() { return this._html; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async dispatch(name) { for (const fn of this.listeners[name] || []) await fn({ preventDefault() {} }); }
  showModal() { this.open = true; }
  setAttribute() {}
 }
 const $ = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
 $('inputMode').value = 'keyboard';
 const window = { dispatchEvent() {} };
 const context = vm.createContext({
  window, document: { getElementById: $, querySelectorAll: () => [] },
  localStorage: { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) },
  crypto, location: { protocol: 'https:' }, AbortController, Event, setTimeout, clearTimeout, Intl, Date, console,
  fetch: async (path, options) => { if (options.method === 'POST') posts++; const response = await api(new Request('https://game.test' + path, options), { DB: db }); if (loseResponse && options.method === 'POST') { loseResponse = false; throw Error('模拟响应丢失'); } return response; }
 });
 vm.runInContext(fs.readFileSync(__dirname + '/dist/cloud.js', 'utf8'), context);
 await pause(); await pause();
 assert.equal($('homePlayers').textContent, '0');
 const first = makeReport('cloud-report-001');
 memory.set('space-crew-flights-v1', JSON.stringify([first]));
 window.SpaceCrewOnline.onResult(first);
 $('playerNickname').value = '星星同学';
 await $('nicknameForm').dispatch('submit');
 assert.equal(first.nickname, '星星同学'); assert.equal(first.cloudStatus, 'submitted');
 assert.equal($('resultPlayerName').textContent, '星星同学');
 assert.equal($('homePlayers').textContent, '1'); assert.equal($('homeGames').textContent, '1');
 assert.match($('submissionStatus').textContent, /96 分/);
 const before = posts; await $('nicknameForm').dispatch('submit'); assert.equal(posts, before);
 const firstProfile = JSON.parse(memory.get('space-crew-players-v1'))[0];
 const second = makeReport('cloud-report-002');
 memory.set('space-crew-flights-v1', JSON.stringify([second, { ...first, nickname: '星星同学' }]));
 window.SpaceCrewOnline.onResult(second); $('playerNickname').value = '星星同学'; loseResponse = true;
 await $('nicknameForm').dispatch('submit');
 assert.equal(second.cloudStatus, 'pending'); assert.equal($('submitScoreButton').disabled, false);
 assert.equal($('playerNickname').disabled, true); // Freeze payload for safe idempotent retry.
 await $('nicknameForm').dispatch('submit');
 assert.equal(second.cloudStatus, 'submitted'); assert.equal($('homeGames').textContent, '2'); assert.equal($('homePlayers').textContent, '1');
 assert.equal(JSON.parse(memory.get('space-crew-players-v1')).length, 1);
 assert.equal(JSON.parse(memory.get('space-crew-players-v1'))[0].token, firstProfile.token);
 assert.match($('resultImprovement').textContent, /与上次同分/);
 const third = makeReport('cloud-report-003');
 window.SpaceCrewOnline.onResult(third); $('playerNickname').value = '新队员'; await $('nicknameForm').dispatch('submit');
 assert.equal($('homePlayers').textContent, '2'); assert.equal($('homeGames').textContent, '3');
 window.SpaceCrewOnline.open(); await pause(); await pause();
 assert.match($('leaderboardContent').innerHTML, /星星同学/); assert.match($('leaderboardContent').innerHTML, /新队员/);
 window.SpaceCrewOnline.onResult(makeReport('cloud-report-004')); $('playerNickname').value = '<script>'; const previousPosts = posts;
 await $('nicknameForm').dispatch('submit'); assert.equal(posts, previousPosts); assert.match($('submissionStatus').textContent, /请输入/);
 const data = JSON.parse(memory.get('space-crew-flights-v1'));
 assert.equal(data[0].cloudStatus, 'submitted'); assert.equal(data[0].nickname, '星星同学');
 db.close(); console.log('PASS: nickname submission, retained nickname on results/export source, same-nickname identity, distinct players, board rendering, input validation and lost-response retry without duplicate counts.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
