// Telegram custom emoji entity IDs (premium); plain emoji fallback when unsupported.
export const E = {
  bolt: { custom: '5368324170671202289', fallback: '⚡' },
  coin: { custom: '5368324170671202288', fallback: '🪙' },
  spark: { custom: '5406154565496036350', fallback: '✨' },
};

export function premiumLine(parts) {
  return parts
    .map((p) =>
      typeof p === 'string'
        ? p
        : `<tg-emoji emoji-id="${p.custom}">${p.fallback}</tg-emoji>`
    )
    .join('');
}
