import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'volt.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    balance REAL NOT NULL DEFAULT 0,
    mined_unclaimed REAL NOT NULL DEFAULT 0,
    mining_started_at INTEGER,
    total_claimed REAL NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    streak INTEGER NOT NULL DEFAULT 0,
    last_checkin_date TEXT,
    referrer_id INTEGER,
    referral_paid INTEGER NOT NULL DEFAULT 0,
    ton_wallet TEXT,
    captcha_passed INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    gram_amount REAL NOT NULL,
    volt_amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_completions (
    telegram_id INTEGER NOT NULL,
    task_key TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (telegram_id, task_key)
  );

  CREATE TABLE IF NOT EXISTS link_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    reward REAL NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channel_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    reward REAL NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS link_task_clicks (
    telegram_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    clicked INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (telegram_id, task_id)
  );

  CREATE TABLE IF NOT EXISTS pending_captcha (
    telegram_id INTEGER PRIMARY KEY,
    question TEXT NOT NULL,
    answer INTEGER NOT NULL
  );
`);

export function getOrCreateUser(telegramId, profile = {}) {
  const row = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (row) {
    if (profile.username !== undefined) {
      db.prepare(
        'UPDATE users SET username = ?, first_name = ? WHERE telegram_id = ?'
      ).run(profile.username ?? row.username, profile.first_name ?? row.first_name, telegramId);
    }
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (telegram_id, username, first_name, mining_started_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(telegramId, profile.username ?? null, profile.first_name ?? 'Player', now, now);
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

export function setReferrer(telegramId, referrerId) {
  if (telegramId === referrerId) return;
  const user = getOrCreateUser(telegramId);
  if (user.referrer_id) return;
  getOrCreateUser(referrerId);
  db.prepare('UPDATE users SET referrer_id = ? WHERE telegram_id = ?').run(referrerId, telegramId);
}

export { db };
