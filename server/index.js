import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Bot, GrammyError } from 'grammy';
import { db, getOrCreateUser, setReferrer } from './db.js';
import { validateInitData, parseUserFromInitData, isAdmin } from './auth.js';
import {
  syncMining,
  claimMining,
  checkinReward,
  todayUtc,
} from './game.js';
import { E, premiumLine } from './premiumEmoji.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const adminIds = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
const adminUsernames = (process.env.ADMIN_USERNAMES || 'maznyso')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DEMO_USER_ID = 900001;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public')));

function requireUser(req, res) {
  const initData = req.headers['x-telegram-init'] || req.body?.initData;
  const dev = req.headers['x-dev-user'];
  if (dev && !BOT_TOKEN) {
    const id = Number(dev) || DEMO_USER_ID;
    return getOrCreateUser(id, { username: 'preview', first_name: 'Preview' });
  }
  if (BOT_TOKEN && initData && validateInitData(initData, BOT_TOKEN)) {
    const u = parseUserFromInitData(initData);
    if (!u?.id) {
      res.status(401).json({ error: 'Invalid user' });
      return null;
    }
    return getOrCreateUser(u.id, { username: u.username, first_name: u.first_name });
  }
  if (!BOT_TOKEN) {
    return getOrCreateUser(DEMO_USER_ID, { username: 'preview', first_name: 'Preview' });
  }
  res.status(401).json({ error: 'Invalid initData' });
  return null;
}

function publicUser(u) {
  const synced = syncMining(u);
  return {
    telegramId: synced.telegram_id,
    username: synced.username,
    firstName: synced.first_name,
    balance: Math.round(synced.balance * 100) / 100,
    minedUnclaimed: Math.round(synced.mined_unclaimed * 100) / 100,
    miningActive: synced.mined_unclaimed > 0 && !synced.banned,
    level: synced.level,
    streak: synced.streak,
    tonWallet: synced.ton_wallet,
    captchaPassed: !!synced.captcha_passed,
    banned: !!synced.banned,
    isAdmin: isAdmin(
      { id: synced.telegram_id, username: synced.username },
      adminIds,
      adminUsernames
    ),
  };
}

function saveUser(user) {
  db.prepare(
    `UPDATE users SET balance = ?, mined_unclaimed = ?, mining_started_at = ?,
     total_claimed = ?, level = ?, streak = ?, last_checkin_date = ?,
     ton_wallet = ?, captcha_passed = ?, banned = ?, referral_paid = ?,
     username = ?, first_name = ? WHERE telegram_id = ?`
  ).run(
    user.balance,
    user.mined_unclaimed,
    user.mining_started_at,
    user.total_claimed,
    user.level,
    user.streak,
    user.last_checkin_date,
    user.ton_wallet,
    user.captcha_passed,
    user.banned,
    user.referral_paid,
    user.username,
    user.first_name,
    user.telegram_id
  );
}

app.get('/api/me', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  let u = syncMining(user);
  saveUser(u);
  res.json(publicUser(u));
});

app.post('/api/claim', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (user.banned) return res.status(403).json({ error: 'Banned' });
  if (!user.captcha_passed) return res.status(403).json({ error: 'Complete captcha first' });
  const { user: next, claimed } = claimMining(syncMining(user));
  saveUser(next);
  payReferralShare(next, claimed);
  res.json({ ...publicUser(next), claimed });
});

function payReferralShare(miner, claimed) {
  if (claimed <= 0 || !miner.referrer_id) return;
  const ref = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(miner.referrer_id);
  if (!ref || ref.banned) return;
  const bonus = claimed * 0.08;
  ref.balance += bonus;
  saveUser(ref);
}

app.post('/api/checkin', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (user.banned) return res.status(403).json({ error: 'Banned' });
  if (!user.captcha_passed) return res.status(403).json({ error: 'Complete captcha first' });
  const today = todayUtc();
  if (user.last_checkin_date === today) {
    return res.status(400).json({ error: 'Already checked in today' });
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let streak = user.streak;
  if (user.last_checkin_date === yesterday) streak += 1;
  else streak = 0;
  const reward = checkinReward(streak);
  user.streak = streak + 1;
  user.last_checkin_date = today;
  user.balance += reward;
  saveUser(user);
  db.prepare(
    'INSERT OR IGNORE INTO task_completions (telegram_id, task_key, completed_at) VALUES (?, ?, ?)'
  ).run(user.telegram_id, 'daily_checkin', Date.now());
  res.json({ ...publicUser(syncMining(user)), reward });
});

app.get('/api/tasks', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const done = db
    .prepare('SELECT task_key FROM task_completions WHERE telegram_id = ?')
    .all(user.telegram_id)
    .map((r) => r.task_key);
  const links = db
    .prepare('SELECT * FROM link_tasks WHERE active = 1 ORDER BY pinned DESC, id DESC')
    .all();
  const channels = db
    .prepare('SELECT * FROM channel_tasks WHERE active = 1 ORDER BY pinned DESC, id DESC')
    .all();
  const clicks = db
    .prepare('SELECT task_id, clicked FROM link_task_clicks WHERE telegram_id = ?')
    .all(user.telegram_id);
  const clickMap = Object.fromEntries(clicks.map((c) => [c.task_id, c.clicked]));
  res.json({
    completed: done,
    staticTasks: [
      { key: 'first_claim', title: 'First claim', reward: 25 },
      { key: 'reach_level_2', title: 'Reach level 2', reward: 40 },
      { key: 'invite_friend', title: 'Invite a friend', reward: 50 },
    ],
    linkTasks: links.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      reward: t.reward,
      pinned: !!t.pinned,
      clicked: !!clickMap[t.id],
      done: done.includes(`link_${t.id}`),
    })),
    channelTasks: channels.map((t) => ({
      id: t.id,
      title: t.title,
      chatId: t.chat_id,
      reward: t.reward,
      pinned: !!t.pinned,
      done: done.includes(`channel_${t.id}`),
    })),
  });
});

app.post('/api/tasks/link/:id/open', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  db.prepare(
    'INSERT INTO link_task_clicks (telegram_id, task_id, clicked) VALUES (?, ?, 1) ON CONFLICT(telegram_id, task_id) DO UPDATE SET clicked = 1'
  ).run(user.telegram_id, id);
  res.json({ ok: true });
});

app.post('/api/tasks/link/:id/collect', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (user.banned) return res.status(403).json({ error: 'Banned' });
  if (!user.captcha_passed) return res.status(403).json({ error: 'Captcha required' });
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM link_tasks WHERE id = ? AND active = 1').get(id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const click = db
    .prepare('SELECT clicked FROM link_task_clicks WHERE telegram_id = ? AND task_id = ?')
    .get(user.telegram_id, id);
  if (!click?.clicked) return res.status(400).json({ error: 'Open the link first' });
  const key = `link_${id}`;
  const exists = db
    .prepare('SELECT 1 FROM task_completions WHERE telegram_id = ? AND task_key = ?')
    .get(user.telegram_id, key);
  if (exists) return res.status(400).json({ error: 'Already collected' });
  user.balance += task.reward;
  saveUser(user);
  db.prepare(
    'INSERT INTO task_completions (telegram_id, task_key, completed_at) VALUES (?, ?, ?)'
  ).run(user.telegram_id, key, Date.now());
  res.json({ ...publicUser(syncMining(user)), reward: task.reward });
});

app.post('/api/wallet', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { address } = req.body || {};
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Invalid address' });
  }
  user.ton_wallet = address.slice(0, 128);
  saveUser(user);
  res.json(publicUser(syncMining(user)));
});

app.post('/api/withdraw', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (user.banned) return res.status(403).json({ error: 'Banned' });
  if (!user.captcha_passed) return res.status(403).json({ error: 'Captcha required' });
  const gram = Number(req.body?.gramAmount);
  if (!gram || gram < 1) return res.status(400).json({ error: 'Minimum 1 GRAM' });
  const volt = gram * 10;
  const u = syncMining(user);
  if (volt > u.balance) return res.status(400).json({ error: 'Insufficient balance' });
  if (!u.ton_wallet) return res.status(400).json({ error: 'Connect wallet first' });
  u.balance -= volt;
  saveUser(u);
  db.prepare(
    'INSERT INTO withdrawals (telegram_id, gram_amount, volt_amount, status, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(u.telegram_id, gram, volt, 'pending', Date.now());
  res.json(publicUser(syncMining(u)));
});

app.get('/api/leaderboard', (_req, res) => {
  const rows = db
    .prepare(
      'SELECT telegram_id, username, first_name, balance, level FROM users WHERE banned = 0 ORDER BY balance DESC LIMIT 20'
    )
    .all();
  res.json(
    rows.map((r, i) => ({
      rank: i + 1,
      name: r.first_name || r.username || `User ${r.telegram_id}`,
      balance: Math.round(r.balance),
      level: r.level,
    }))
  );
});

app.get('/api/captcha', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (user.captcha_passed) return res.json({ passed: true });
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 2 + Math.floor(Math.random() * 8);
  db.prepare(
    'INSERT INTO pending_captcha (telegram_id, question, answer) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET question = excluded.question, answer = excluded.answer'
  ).run(user.telegram_id, `${a} + ${b}`, a + b);
  res.json({ passed: false, question: `${a} + ${b}` });
});

app.post('/api/captcha', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const answer = Number(req.body?.answer);
  const row = db.prepare('SELECT * FROM pending_captcha WHERE telegram_id = ?').get(user.telegram_id);
  if (!row || row.answer !== answer) {
    return res.status(400).json({ error: 'Wrong answer' });
  }
  user.captcha_passed = 1;
  saveUser(user);
  db.prepare('DELETE FROM pending_captcha WHERE telegram_id = ?').run(user.telegram_id);
  payReferralSignup(user);
  res.json(publicUser(syncMining(user)));
});

function payReferralSignup(user) {
  if (!user.referrer_id || user.referral_paid) return;
  const ref = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(user.referrer_id);
  if (!ref) return;
  ref.balance += 50;
  user.referral_paid = 1;
  saveUser(ref);
  saveUser(user);
  db.prepare(
    'INSERT OR IGNORE INTO task_completions (telegram_id, task_key, completed_at) VALUES (?, ?, ?)'
  ).run(ref.telegram_id, 'invite_friend', Date.now());
}

app.get('/api/admin/users/search', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isAdmin({ id: user.telegram_id, username: user.username }, adminIds, adminUsernames)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const q = String(req.query.q || '').trim();
  let row;
  if (/^\d+$/.test(q)) {
    row = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(Number(q));
  } else if (q) {
    row = db
      .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
      .get(q.replace(/^@/, ''));
  }
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(publicUser(syncMining(row)));
});

app.post('/api/admin/points', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isAdmin({ id: user.telegram_id, username: user.username }, adminIds, adminUsernames)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const targetId = Number(req.body?.telegramId);
  const amount = Number(req.body?.amount);
  if (!targetId || !amount) return res.status(400).json({ error: 'Invalid' });
  const target = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });
  target.balance += amount;
  saveUser(target);
  res.json(publicUser(syncMining(target)));
});

app.post('/api/admin/ban', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isAdmin({ id: user.telegram_id, username: user.username }, adminIds, adminUsernames)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const targetId = Number(req.body?.telegramId);
  const ban = !!req.body?.ban;
  const target = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (isAdmin({ id: target.telegram_id, username: target.username }, adminIds, adminUsernames)) {
    return res.status(400).json({ error: 'Cannot ban admin' });
  }
  target.banned = ban ? 1 : 0;
  saveUser(target);
  res.json(publicUser(syncMining(target)));
});

app.post('/api/admin/link-task', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isAdmin({ id: user.telegram_id, username: user.username }, adminIds, adminUsernames)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { title, url, reward, pinned } = req.body || {};
  if (!title || !url?.startsWith('http') || !reward) {
    return res.status(400).json({ error: 'Invalid task' });
  }
  const r = db
    .prepare(
      'INSERT INTO link_tasks (title, url, reward, pinned, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(title, url, Number(reward), pinned ? 1 : 0, Date.now());
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/admin/withdrawals', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!isAdmin({ id: user.telegram_id, username: user.username }, adminIds, adminUsernames)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = db
    .prepare(
      `SELECT w.*, u.username, u.first_name FROM withdrawals w
       JOIN users u ON u.telegram_id = w.telegram_id
       ORDER BY w.id DESC LIMIT 50`
    )
    .all();
  res.json(rows);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(root, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`vølt listening on ${PORT}`);
});

async function startBot() {
  if (!BOT_TOKEN) {
    console.log('BOT_TOKEN not set — web preview only');
    return;
  }
  const bot = new Bot(BOT_TOKEN);
  const webApp = WEBAPP_URL || `http://127.0.0.1:${PORT}`;

  bot.command('start', async (ctx) => {
    const payload = ctx.match?.trim();
    const userId = ctx.from.id;
    getOrCreateUser(userId, { username: ctx.from.username, first_name: ctx.from.first_name });
    if (payload?.startsWith('ref_')) {
      const refId = Number(payload.slice(4));
      if (refId) setReferrer(userId, refId);
    }
    const row = db.prepare('SELECT captcha_passed FROM users WHERE telegram_id = ?').get(userId);
    if (!row?.captcha_passed) {
      const a = 2 + Math.floor(Math.random() * 8);
      const b = 2 + Math.floor(Math.random() * 8);
      db.prepare(
        'INSERT INTO pending_captcha (telegram_id, question, answer) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET question = excluded.question, answer = excluded.answer'
      ).run(userId, `${a} + ${b}`, a + b);
      await ctx.reply(`Quick check: what is ${a} + ${b}? Reply with the number only.`);
      return;
    }
    const text = premiumLine([
      E.spark,
      ' Welcome to ',
      E.bolt,
      ' vølt — tap below to mine.',
    ]);
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ Open vølt', web_app: { url: webApp } }],
        ],
      },
    });
  });

  bot.on('message:text', async (ctx) => {
    const pending = db.prepare('SELECT * FROM pending_captcha WHERE telegram_id = ?').get(ctx.from.id);
    if (!pending) return;
    const n = Number(ctx.message.text.trim());
    if (n !== pending.answer) {
      await ctx.reply('Wrong — try /start for a new question.');
      return;
    }
    const user = getOrCreateUser(ctx.from.id, {
      username: ctx.from.username,
      first_name: ctx.from.first_name,
    });
    user.captcha_passed = 1;
    saveUser(user);
    db.prepare('DELETE FROM pending_captcha WHERE telegram_id = ?').run(ctx.from.id);
    payReferralSignup(user);
    const text = premiumLine([E.coin, ' Verified! ', E.bolt, ' Open vølt below.']);
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '⚡ Open vølt', web_app: { url: webApp } }]],
      },
    });
  });

  bot.command('balance', async (ctx) => {
    const u = syncMining(getOrCreateUser(ctx.from.id, { username: ctx.from.username }));
    saveUser(u);
    const text = premiumLine([
      E.coin,
      ` Balance: ${Math.round(u.balance * 10) / 10} vølt`,
    ]);
    await ctx.reply(text, { parse_mode: 'HTML' });
  });

  try {
    await bot.start();
    console.log('Telegram bot polling');
  } catch (err) {
    console.error('Bot failed to start', err instanceof GrammyError ? err.description : err);
  }
}

startBot();
