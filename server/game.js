const DAILY_VOLT = 410;
const RATE_PER_MS = DAILY_VOLT / (24 * 60 * 60 * 1000);
const CAP_MS = 4 * 60 * 60 * 1000;
const BASE_CAP = CAP_MS * RATE_PER_MS;
const STREAK_REWARDS = [10, 20, 30, 40, 50, 60, 70];
export const BOOST_MS = 30 * 60 * 1000;

function multiplier(user, now) {
  return user.boost_until && Number(user.boost_until) > now ? 2 : 1;
}

export function syncMining(user, now = Date.now()) {
  if (user.banned) return user;
  const started = user.mining_started_at || now;
  const mult = multiplier(user, now);
  if (!user.last_tick_at) {
    const elapsed = Math.min(Math.max(now - started, 0), CAP_MS);
    const mined = Math.min(elapsed * RATE_PER_MS * mult, BASE_CAP * mult);
    return {
      ...user,
      mined_unclaimed: mined,
      mining_started_at: started,
      last_tick_at: started + elapsed,
    };
  }
  const windowEnd = started + CAP_MS;
  const from = Math.min(Math.max(user.last_tick_at, started), windowEnd);
  const to = Math.min(now, windowEnd);
  const delta = Math.max(0, to - from);
  const stored = user.mined_unclaimed || 0;
  let mined = stored + delta * RATE_PER_MS * mult;
  const ceiling = mult > 1 ? BASE_CAP * 2 : Math.max(stored, BASE_CAP);
  mined = Math.min(mined, ceiling);
  return { ...user, mined_unclaimed: mined, mining_started_at: started, last_tick_at: to };
}

export function claimMining(user, now = Date.now()) {
  const synced = syncMining(user, now);
  const amount = synced.mined_unclaimed;
  if (amount <= 0) return { user: synced, claimed: 0 };
  const newBalance = synced.balance + amount;
  const totalClaimed = synced.total_claimed + amount;
  const level = Math.max(1, Math.floor(totalClaimed / 200) + 1);
  return {
    user: {
      ...synced,
      balance: newBalance,
      total_claimed: totalClaimed,
      level,
      mined_unclaimed: 0,
      mining_started_at: now,
      last_tick_at: now,
    },
    claimed: amount,
  };
}

export function checkinReward(streak) {
  if (streak >= STREAK_REWARDS.length) return STREAK_REWARDS[STREAK_REWARDS.length - 1];
  return STREAK_REWARDS[streak] ?? 10;
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

const RANKS = ['Spark', 'Charge', 'Arc', 'Bolt', 'Storm', 'Crown'];

export function rankTitle(level) {
  const idx = Math.min(RANKS.length - 1, Math.max(0, Math.floor((Number(level) || 1) - 1) / 2));
  return RANKS[idx];
}

export function spinPrize(roll) {
  const n = Number(roll) || 0;
  if (n < 40) return 5;
  if (n < 70) return 12;
  if (n < 88) return 25;
  if (n < 97) return 40;
  return 80;
}

export function perHour(user, now = Date.now()) {
  return Math.round((DAILY_VOLT / 24) * multiplier(user, now));
}
