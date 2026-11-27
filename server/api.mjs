const MODES = new Set(['keyboard', 'mouse', 'touch']);
const TOKEN = /^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/i;
const LIMIT = 20;
export function createApi(calculate) {
 const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
 const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
 function validate(body) {
  if (!body || !TOKEN.test(body.playerToken || '') || !/^[\w-]{8,100}$/.test(body.id || '') || !MODES.has(body.mode)) throw Error('提交信息无效，请重新完成测试后提交。');
  const nickname = typeof body.nickname === 'string' ? body.nickname.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
  if ([...nickname].length < 1 || [...nickname].length > 16 || /[<>\p{C}]/u.test(nickname)) throw Error('昵称需为 1～16 个字符，不能包含控制字符或尖括号。');
  if (!Array.isArray(body.records) || body.records.length !== 30) throw Error('只有完整的 30 次正式挑战可以提交。');
  let friends = 0;
  const records = body.records.map((r, i) => {
   const round = i < 10 ? 1 : 2, trial = i < 10 ? i + 1 : i - 9;
   if (!r || r.round !== round || r.trial !== trial || !['go', 'no-go'].includes(r.kind) || (round === 1 && r.kind !== 'go')) throw Error('题目顺序或类型无效。');
   const allowed = r.kind === 'go' ? ['hit', 'miss', 'early', 'anticipation'] : ['correctReject', 'falseAlarm', 'early'];
   if (!allowed.includes(r.outcome)) throw Error('成绩记录包含无效结果。');
   if (r.kind === 'no-go') friends++;
   if (r.outcome === 'hit') {
    if (!Number.isFinite(r.rt) || r.rt < 100 || r.rt > (round === 1 ? 1800 : 1400)) throw Error('反应时间超出有效范围。');
   } else if (r.rt !== null) throw Error('非有效反应不应包含计时。');
   return { round, trial, kind: r.kind, outcome: r.outcome, rt: r.rt };
  });
  if (friends !== 6) throw Error('正式挑战应包含 6 次友军放行。');
  return { id: body.id, nickname, mode: body.mode, records, playerToken: body.playerToken };
 }
 const summary = async db => {
  const chinaDay = Math.floor((Date.now() + 28800000) / 86400000) * 86400000 - 28800000;
  const row = await db.prepare('SELECT COUNT(*) AS games, COUNT(DISTINCT player_key) AS players, COALESCE(SUM(created_at >= ?), 0) AS today FROM scores').bind(chinaDay).first();
  return { totalPlayers: Number(row.players), totalGames: Number(row.games), todayGames: Number(row.today) };
 };
 function paging(url) {
  const raw = url.searchParams.get('offset') || '0';
  if (!/^\d{1,6}$/.test(raw)) throw Error('分页参数无效。');
  return Number(raw);
 }
 function modeOf(url) { const mode = url.searchParams.get('mode') || 'keyboard'; if (!MODES.has(mode)) throw Error('操作方式无效。'); return mode; }
 return async function api(request, env) {
  const url = new URL(request.url), db = env.DB;
  if (!db) return json({ error: '共享排行榜尚未配置数据库。' }, 503);
  try {
   if (url.pathname === '/api/stats' && request.method === 'GET') return json(await summary(db));
   if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
    const mode = modeOf(url), offset = paging(url);
    const query = `WITH personal AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY player_key ORDER BY score DESC, accuracy DESC, COALESCE(median_ms, 999999) ASC, created_at ASC, id ASC) AS personal_row FROM scores WHERE mode = ?), ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY score DESC, accuracy DESC, COALESCE(median_ms, 999999) ASC, created_at ASC, id ASC) AS rank FROM personal WHERE personal_row = 1) SELECT rank, nickname, score, accuracy, median_ms AS medianMs, created_at AS createdAt FROM ranked ORDER BY rank LIMIT ? OFFSET ?`;
    const [{ results }, scope, stats] = await Promise.all([
     db.prepare(query).bind(mode, LIMIT, offset).all(),
     db.prepare('SELECT COUNT(DISTINCT player_key) AS count FROM scores WHERE mode = ?').bind(mode).first(), summary(db)
    ]);
    return json({ ...stats, mode, items: results, count: Number(scope.count), offset, hasMore: offset + results.length < Number(scope.count) });
   }
   if (url.pathname === '/api/history' && request.method === 'GET') {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!TOKEN.test(token)) return json({ error: '请先选择本机的昵称档案。' }, 401);
    const key = await digest(token), mode = modeOf(url), offset = paging(url);
    const [{ results }, count] = await Promise.all([
     db.prepare('SELECT id, nickname, score, accuracy, median_ms AS medianMs, created_at AS createdAt FROM scores WHERE player_key = ? AND mode = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').bind(key, mode, LIMIT, offset).all(),
     db.prepare('SELECT COUNT(*) AS count FROM scores WHERE player_key = ? AND mode = ?').bind(key, mode).first()
    ]);
    return json({ items: results, count: Number(count.count), offset, hasMore: offset + results.length < Number(count.count) });
   }
   if (url.pathname === '/api/scores' && request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: '请从游戏页面提交成绩。' }, 403);
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ error: '需要 JSON 格式的成绩。' }, 415);
    const text = await request.text();
    if (text.length > 20000) return json({ error: '成绩内容过大。' }, 413);
    let body;
    try { body = validate(JSON.parse(text)); } catch (error) { return json({ error: error instanceof SyntaxError ? '成绩内容格式有误。' : error.message }, 400); }
    const playerKey = await digest(body.playerToken);
    const payloadHash = await digest(JSON.stringify([body.nickname, body.mode, body.records]));
    const result = calculate(body.records), createdAt = Date.now();
    const recent = await db.prepare('SELECT COUNT(*) AS count FROM scores WHERE player_key = ? AND created_at > ? AND id != ?').bind(playerKey, createdAt - 60000, body.id).first();
    if (Number(recent.count) >= 6) return json({ error: '提交过于频繁，请稍等一分钟再试。' }, 429);
    await db.prepare('INSERT INTO scores (id, player_key, nickname, mode, score, accuracy, median_ms, deviation_ms, valid_hits, created_at, records_json, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(body.id, playerKey, body.nickname, body.mode, result.total, result.accuracy, result.median, result.deviation, result.validHits, createdAt, JSON.stringify(body.records), payloadHash).run();
    const saved = await db.prepare('SELECT id, player_key, payload_hash, nickname, score, accuracy, median_ms AS medianMs, created_at AS createdAt FROM scores WHERE id = ?').bind(body.id).first();
    if (!saved || saved.player_key !== playerKey || saved.payload_hash !== payloadHash) return json({ error: '本次成绩已用其他内容提交，请勿重复修改。' }, 409);
    const { player_key, payload_hash, ...publicScore } = saved;
    return json({ saved: publicScore, ...await summary(db) });
   }
   return json({ error: '接口或请求方法不存在。' }, 404);
  } catch (error) {
   if (['分页参数无效。', '操作方式无效。'].includes(error.message)) return json({ error: error.message }, 400);
   console.error('Leaderboard request failed:', error.name);
   return json({ error: '排行榜暂时无法连接，请稍后重试；你的本机成绩仍会保留。' }, 503);
  }
 };
}
