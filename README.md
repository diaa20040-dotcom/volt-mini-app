# vølt — Telegram Mini App

English mining mini app with tasks, leaderboard, wallet withdrawals (manual GRAM payout), captcha, SQLite storage, and admin **Desk** for link tasks, points, and ban/unban.

## Run locally

```bash
cd volt
npm install
export BOT_TOKEN=your_token_from_botfather
export WEBAPP_URL=https://your-public-https-url
npm start
```

`BOT_TOKEN` is never committed. Preview mode works without a token (shared demo user).

## Admin

Set `ADMIN_USERNAMES=maznyso` or `ADMIN_IDS=123456789`. Open **Desk** in the mini app.

## Bot commands

- `/start` — captcha then **Open vølt** button
- `/balance` — balance with premium emoji when supported

---

Built with [BrainDaemon](https://braindaemon.com)
