import crypto from 'crypto';

export function validateInitData(initData, botToken) {
  if (!initData || !botToken) return false;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');
    return calculatedHash === hash;
  } catch {
    return false;
  }
}

export function parseUserFromInitData(initData) {
  const params = new URLSearchParams(initData);
  const userJson = params.get('user');
  if (!userJson) return null;
  return JSON.parse(userJson);
}

export function isAdmin(user, adminIds, adminUsernames) {
  if (!user) return false;
  if (adminIds.includes(user.id)) return true;
  const un = (user.username || '').toLowerCase();
  return adminUsernames.map((x) => x.toLowerCase()).includes(un);
}
