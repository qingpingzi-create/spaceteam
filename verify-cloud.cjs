const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { calculate } = require('./dist/scoring.js');
const { openDatabase } = require('./server/local-db.cjs');
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function makeReport(id, rt = 300, nickname = '星星同学') {
 const records = Array.from({ length: 30 }, (_, i) => ({ round: i < 10 ? 1 : 2, trial: i < 10 ? i + 1 : i - 9, kind: i >= 24 ? 'no-go' : 'go', outcome: i >= 24 ? 'correctReject' : 'hit', rt: i >= 24 ? null : rt }));
 return { id, nickname, mode: 'keyboard', version: 1, records, result: calculate(records), timestamp: Date.now() };
}
async function run() {
 const { createApi } = await import('./server/api.mjs');
 const db = openDatabase(), api = createApi(calculate), nodes = new Map(), memory = new Map(), timers = new Map();
 let loseResponse = false, posts = 0, previews = 0, clock = 0, timerId = 0;
 class Node {
  constructor(id) { this.id = id; this.listeners = {}; this.disabled = false; this.hidden = false; this.value = ''; this.textContent = ''; this._html = ''; this.classList = { add() {}, toggle() {} }; }
  set innerHTML(value) { this._html = value; for (const match of value.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1], new Node(match[1])); }
  get innerHTML() { return this._html; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async dispatch(name) { for (const fn of this.listeners[name] || []) await fn({ preventDefault() {} }); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  setAttribute() {}
 }
 const $ = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
 $('inputMode').value = 'keyboard'; $('playerNickname').value = '星星同学';
 const window = { dispatchEvent() {} };
 const context = vm.createContext({
  window, document: { getElementById: $, querySelectorAll: () => [], hidden: false },
  localStorage: { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) },
  crypto, location: { protocol: 'https:' }, AbortController, Event, Intl, Date, console,
  setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: clock + delay }); return timerId; }, clearTimeout: id => timers.delete(id),
  fetch: async (path, options) => {
   if (path === '/api/scores') posts++; if (path === '/api/live-position') previews++;
   const response = await api(new Request('https://game.test' + path, options), { DB: db });
   if (loseResponse && path === '/api/scores') { loseResponse = false; throw Error('模拟响应丢失'); }
   return response;
  }
 });
 const advance = async ms => {
  const target = clock + ms;
  while (true) { const next = [...timers].filter(([,t]) => t.at <= target).sort((a,b) => a[1].at - b[1].at)[0]; if (!next) break; timers.delete(next[0]); clock = next[1].at; next[1].fn(); await flush(); }
  clock = target; await flush();
 };
 const saveOther = async (id, nickname, token, rt) => {
  const source = makeReport(id, rt, nickname);
  const response = await api(new Request('https://game.test/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...source, playerToken: token }) }), { DB: db });
  assert.equal(response.status, 200);
 };
 vm.runInContext(fs.readFileSync(__dirname + '/dist/cloud.js', 'utf8'), context);
 await flush(); assert.equal($('homePlayers').textContent, '0');
 await saveOther('other-a-run01', '月球队长', 'a'.repeat(64), 300);
 await saveOther('other-b-run01', '银河队长', 'b'.repeat(64), 250);
 const first = makeReport('cloud-report-001', 200);
 await window.SpaceCrewOnline.onStart({ id: first.id, nickname: first.nickname, mode: first.mode, isPractice: false });
 assert.equal($('liveRank').textContent, '第 3 名'); assert.match($('liveRankRows').innerHTML, /你 · 预计/);
 await window.SpaceCrewOnline.onProgress({ ...first, records: first.records.slice(0, 29), state: 'waiting' });
 assert.equal($('liveRank').textContent, '第 3 名'); // No rank repaint while waiting for a signal.
 window.SpaceCrewOnline.onPhase('feedback');
 assert.equal($('liveRank').textContent, '第 2 名'); assert.equal($('liveRankDelta').textContent, '上升 1 位');
 await saveOther('other-d-run01', '新星队长', 'd'.repeat(64), 150);
 await advance(5000);
 assert.equal($('liveRank').textContent, '第 3 名'); assert.equal($('liveRankDelta').textContent, '下降 1 位');
 await window.SpaceCrewOnline.onProgress({ ...first, state: 'feedback' });
 assert.equal($('liveRank').textContent, '第 2 名'); assert.equal($('liveRankDelta').textContent, '上升 1 位');
 assert.equal(posts, 0); // Provisional ranks never write an official score.
 const statsBefore = await api(new Request('https://game.test/api/stats'), { DB: db });
 assert.equal((await statsBefore.json()).totalGames, 3);
 memory.set('space-crew-flights-v1', JSON.stringify([first]));
 await window.SpaceCrewOnline.onResult(first);
 assert.equal(first.cloudStatus, 'submitted'); assert.equal($('resultPlayerName').textContent, '星星同学');
 assert.equal($('homePlayers').textContent, '4'); assert.equal($('homeGames').textContent, '4');
 assert.match($('submissionStatus').textContent, /100 分/);
 assert.ok(!$('onlineResult').innerHTML.includes('id="playerNickname"')); // No second nickname entry after completion.
 const before = posts; await $('submitScoreButton').dispatch('click'); assert.equal(posts, before);
 const firstProfile = JSON.parse(memory.get('space-crew-players-v1'))[0];
 const second = makeReport('cloud-report-002');
 memory.set('space-crew-flights-v1', JSON.stringify([second, first])); loseResponse = true;
 await window.SpaceCrewOnline.onResult(second);
 assert.equal(second.cloudStatus, 'pending'); assert.equal($('submitScoreButton').disabled, false);
 await $('submitScoreButton').dispatch('click');
 assert.equal(second.cloudStatus, 'submitted'); assert.equal($('homeGames').textContent, '5'); assert.equal($('homePlayers').textContent, '4');
 assert.equal(JSON.parse(memory.get('space-crew-players-v1')).length, 1);
 assert.equal(JSON.parse(memory.get('space-crew-players-v1'))[0].token, firstProfile.token);
 const third = makeReport('cloud-report-003', 300, '新队员');
 await window.SpaceCrewOnline.onResult(third);
 assert.equal($('homePlayers').textContent, '5'); assert.equal($('homeGames').textContent, '6');
 await window.SpaceCrewOnline.open();
 assert.match($('leaderboardContent').innerHTML, /星星同学/); assert.match($('leaderboardContent').innerHTML, /新队员/);
 await saveOther('other-a-run02', '月球队长', 'a'.repeat(64), 100);
 await advance(5000);
 assert.match($('leaderboardContent').innerHTML, /上升 [1-9] 位/);
 assert.match($('boardStatus').textContent, /已自动更新/);
 $('leaderboardDialog').close();
 const beforePractice = previews;
 await window.SpaceCrewOnline.onStart({ id: 'practice-run-001', nickname: '新队员', mode: 'keyboard', isPractice: true });
 await advance(5000); assert.equal(previews, beforePractice); assert.match($('liveRankRows').innerHTML, /练习模式/);
 window.SpaceCrewOnline.onStop(); db.close();
 console.log('PASS: preflight identity reuse, live rank rise/fall, read-only previews, quiet signal phase, 5-second board refresh and movement, automatic final save, loss-safe retry, participant deduplication and practice exclusion.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
