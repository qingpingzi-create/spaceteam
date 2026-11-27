/* Deterministic integration checks of the actual app script with a virtual DOM
 * and clock. This supplements, and does not replace, browser visual checks. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const scoring = require('./dist/scoring.js');

function harness(options = {}) {
 let now = 10000, taskId = 0;
 const tasks = new Map(), nodes = new Map(), listeners = {}, windowListeners = {}, storage = new Map();
 class Node {
  constructor(id) { this.id = id; this.hidden = false; this.value = ''; this.style = {}; this.dataset = {}; this.attributes = {}; this.listeners = {}; this._html = ''; this.className = ''; this.disabled = false; this.textContent = ''; this.classList = { toggle() {} }; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatch(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ preventDefault() {}, ...event }); }
  click() { this.dispatch('click'); }
  focus() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
   this._html = html;
   for (const match of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1], new Node(match[1]));
  }
 }
 const $ = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
 const html = fs.readFileSync(__dirname + '/dist/index.html', 'utf8');
 for (const match of html.matchAll(/\bid="([^"]+)"/g)) $(match[1]);
 $('playerNickname').value = '测试飞行员';
 const doc = {
  getElementById: $, hidden: false, fullscreenElement: null,
  querySelector: sel => sel === '.brand' ? $('brand') : sel === 'dialog[open]' ? [...nodes.values()].find(n => n.open) : null,
  querySelectorAll: () => [],
  addEventListener: (name, fn) => (listeners[name] ||= []).push(fn)
 };
 const setTimeout = (fn, delay) => { tasks.set(++taskId, { fn, at: now + delay }); return taskId; };
 const clearTimeout = id => tasks.delete(id);
 const localStorage = {
  getItem: key => { if (options.brokenStorage) throw Error('unavailable'); return storage.get(key) || null; },
  setItem: (key, value) => { if (options.brokenStorage) throw Error('unavailable'); storage.set(key, value); }
 };
 const context = vm.createContext({
  document: doc, window: { scrollTo() {}, addEventListener: (name, fn) => (windowListeners[name] ||= []).push(fn) },
  localStorage, performance: { now: () => now },
  setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 16), cancelAnimationFrame: clearTimeout,
  ReactionScore: scoring, matchMedia: () => ({ matches: false }), Date, Math, Intl, console, URL, Blob
 });
 vm.runInContext(fs.readFileSync(__dirname + '/dist/app.js', 'utf8'), context, { filename: 'app.js' });
 function tick(ms) {
  const target = now + ms;
  let guard = 0;
  while (true) {
   const next = [...tasks].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
   if (!next) break;
   if (++guard > 10000) throw Error('Clock loop');
   tasks.delete(next[0]); now = next[1].at; next[1].fn();
  }
  now = target;
 }
 function until(predicate, max = 15000) {
  const start = now;
  while (!predicate()) {
   const next = [...tasks.values()].sort((a, b) => a.at - b.at)[0];
   if (!next || next.at - start > max) throw Error('Expected condition was not reached: ' + $('arenaContent').innerHTML);
   tick(Math.max(0, next.at - now));
  }
 }
 const event = (name, payload) => { for (const fn of listeners[name] || []) fn({ preventDefault() {}, ...payload }); };
 const press = (repeat = false) => event('keydown', { code: 'Space', repeat });
 function pointer(type = 'mouse') { $('arena').dispatch('pointerdown', { button: 0, pointerType: type }); }
 function oneTrial(action = 'correct', input = 'keyboard') {
  until(() => /arena (go|intercept|no-go)$/.test($('arena').className));
  const friend = $('arena').className.endsWith('no-go');
  if (action === 'correct' && !friend) { tick(300); input === 'keyboard' ? press() : pointer(input); }
  else if (action === 'wrong' && friend) { tick(300); input === 'keyboard' ? press() : pointer(input); }
  else tick(friend ? 1400 : 1800);
  assert.match($('arena').className, /feedback$/);
  tick(1400);
 }
 return { $, tick, until, press, pointer, oneTrial, doc, storage, event, windowListeners };
}

// A full, correctly completed 30-trial challenge, including result/history.
{
 const h = harness();
 h.$('startButton').click(); h.$('readyButton').click();
 for (let i = 0; i < 10; i++) h.oneTrial();
 assert.match(h.$('arenaOverlay').innerHTML, /开始保护飞船/);
 h.$('readyButton').click();
 for (let i = 0; i < 20; i++) h.oneTrial();
 assert.equal(h.$('resultScreen').hidden, false);
 const stored = JSON.parse(h.storage.get('space-crew-flights-v1'));
 assert.equal(stored.length, 1);
 assert.equal(stored[0].records.length, 30);
 assert.equal(stored[0].records.filter(r => r.kind === 'no-go').length, 6);
 assert.equal(stored[0].result.total, 96);
 assert.equal(stored[0].result.accuracy, 100);
 assert.equal(stored[0].result.median, 300);
 assert.equal(stored[0].nickname, '测试飞行员');
 assert.equal(h.$('gameNickname').textContent, '测试飞行员');
 assert.equal(h.$('liveScore').textContent, '96');
 assert.equal(h.$('liveCompleted').textContent, '30 / 30');
 h.$('historyButton').click();
 assert.match(h.$('historyContent').innerHTML, /300 ms · 正确率 100%/);
 assert.match(h.$('historyContent').innerHTML, /96/);
}
// Practice runs every round but writes no score/history.
{
 const h = harness(); h.$('practiceButton').click(); h.$('readyButton').click();
 for (let i = 0; i < 3; i++) h.oneTrial();
 h.$('readyButton').click(); for (let i = 0; i < 5; i++) h.oneTrial();
 assert.match(h.$('arenaOverlay').innerHTML, /本次答对 8 \/ 8 次/);
 assert.equal(h.storage.size, 0);
 h.$('startAfterPractice').click();
 assert.equal(h.$('trialCounter').textContent, '1 / 10');
 assert.equal(h.$('practiceBadge').hidden, true);
}
// Pausing during a signal cancels old deadlines and replays just that trial.
{
 const h = harness(); h.$('startButton').click(); h.$('readyButton').click();
 h.until(() => h.$('arena').className === 'arena go'); h.tick(200); h.$('pauseButton').click();
 h.tick(20000); assert.equal(h.$('liveAccuracy').textContent, '—');
 h.$('resumeButton').click(); h.oneTrial();
 assert.match(h.$('lastReaction').innerHTML, /300/); assert.equal(h.$('liveAccuracy').textContent, '100%');
 h.$('exitButton').click(); h.$('keepPlayingButton').click();
 h.oneTrial(); assert.equal(h.$('liveAccuracy').textContent, '100%');
 h.$('exitButton').click(); h.$('confirmExitButton').click();
 assert.equal(h.$('homeScreen').hidden, false); assert.equal(h.storage.size, 0);
}
// Inputs are exclusive; repeated keys do not count; early inputs are errors.
{
 const h = harness(); h.$('startButton').click(); h.$('readyButton').click();
 h.until(() => h.$('arena').className === 'arena waiting'); h.pointer();
 assert.equal(h.$('liveAccuracy').textContent, '—'); h.press(true);
 assert.equal(h.$('liveAccuracy').textContent, '—'); h.press();
 assert.match(h.$('arenaContent').innerHTML, /抢跑啦/);
 assert.match(h.$('liveMistakes').innerHTML, /1/);
}
// Visibility interruption and missing storage never prevent completion.
{
 const h = harness({ brokenStorage: true }); h.$('inputMode').value = 'touch';
 h.$('startButton').click(); h.$('readyButton').click();
 h.until(() => h.$('arena').className === 'arena waiting');
 h.doc.hidden = true; h.event('visibilitychange');
 assert.match(h.$('arenaOverlay').innerHTML, /页面已切换/);
 h.doc.hidden = false; h.$('resumeButton').click();
 for (let i = 0; i < 10; i++) h.oneTrial('correct', 'touch');
 h.$('readyButton').click(); for (let i = 0; i < 20; i++) h.oneTrial('correct', 'touch');
 assert.equal(h.$('resultScreen').hidden, false);
 assert.match(h.$('resultScreen').innerHTML, /无法保存记录/);
}
console.log('PASS: full 30-trial challenge, 8-trial practice, exact target mix, result/history, pause/resume, early and exclusive input, visibility pause, touch input and unavailable storage.');
{
 const h = harness(); h.$('playerNickname').value = '  ';
 h.$('startButton').click();
 assert.match(h.$('nicknameError').textContent, /开始前请填写/);
 assert.equal(h.$('playerNickname').attributes['aria-invalid'], 'true');
 assert.equal(h.$('arenaOverlay').innerHTML, '');
 h.$('playerNickname').value = '<script>'; h.$('practiceButton').click();
 assert.equal(h.$('arenaOverlay').innerHTML, '');
 h.$('playerNickname').value = '  星星 同学  '; h.$('startButton').click();
 assert.equal(h.$('gameNickname').textContent, '星星 同学');
 assert.equal(h.$('playerNickname').disabled, true);
 assert.equal(h.$('liveScore').textContent, '0');
 h.$('readyButton').click(); h.until(() => h.$('arena').className === 'arena go'); h.tick(300); h.press();
 assert.equal(h.$('liveScore').textContent, '3');
 assert.match(h.$('liveScoreDelta').textContent, /\+3/);
 h.$('exitButton').click(); h.$('confirmExitButton').click();
 assert.equal(h.$('playerNickname').disabled, false);
}
console.log('PASS: nickname required before every game, nickname lock during play, live score and final-score consistency.');
