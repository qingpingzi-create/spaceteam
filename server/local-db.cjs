const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
function openDatabase(filename = ':memory:') {
 const sqlite = new DatabaseSync(filename);
 sqlite.exec('PRAGMA journal_mode=WAL;');
 sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
 const directory = path.join(__dirname, '../drizzle');
 for (const name of fs.readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) {
  if (sqlite.prepare('SELECT name FROM local_migrations WHERE name = ?').get(name)) continue;
  sqlite.exec('BEGIN');
  try { sqlite.exec(fs.readFileSync(path.join(directory, name), 'utf8')); sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(name); sqlite.exec('COMMIT'); }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
 }
 return {
  close: () => sqlite.close(),
  prepare(sql) {
   return { bind(...args) { return { first: async () => sqlite.prepare(sql).get(...args) || null, all: async () => ({ results: sqlite.prepare(sql).all(...args) }), run: async () => sqlite.prepare(sql).run(...args) }; }, first: async () => sqlite.prepare(sql).get() || null, all: async () => ({ results: sqlite.prepare(sql).all() }) };
  }
 };
}
module.exports = { openDatabase };
