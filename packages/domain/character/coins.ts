export const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
export type Coin = typeof COINS[number];
export type Wallet = Record<Coin, number>;

export const COIN_VALUE: Record<Coin, number> = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
export const COIN_LABEL: Record<Coin, string> = { cp: 'мм', sp: 'см', ep: 'эм', gp: 'зм', pp: 'пм' };

export const EMPTY_WALLET: Wallet = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

export function walletTotal(wallet: Wallet): number {
  return COINS.reduce((sum, coin) => sum + Math.max(0, Math.trunc(wallet[coin] ?? 0)) * COIN_VALUE[coin], 0);
}

function change(amount: number): Wallet {
  let left = Math.max(0, Math.trunc(amount));
  const result = { ...EMPTY_WALLET };
  for (const coin of ['gp', 'sp', 'cp'] as const) {
    result[coin] = Math.floor(left / COIN_VALUE[coin]);
    left -= result[coin] * COIN_VALUE[coin];
  }
  return result;
}

export function payFromWallet(wallet: Wallet, price: number): Wallet | null {
  const cost = Math.max(0, Math.trunc(price));
  if (walletTotal(wallet) < cost) return null;
  const result: Wallet = { ...EMPTY_WALLET, ...wallet };
  let remaining = cost;
  for (const coin of COINS) {
    const take = Math.min(result[coin], Math.floor(remaining / COIN_VALUE[coin]));
    result[coin] -= take;
    remaining -= take * COIN_VALUE[coin];
  }
  if (remaining > 0) {
    const coin = COINS.find(entry => result[entry] > 0)!;
    result[coin] -= 1;
    const back = change(COIN_VALUE[coin] - remaining);
    for (const entry of COINS) result[entry] += back[entry];
  }
  return result;
}

export function addToWallet(wallet: Wallet, amount: number): Wallet {
  const income = change(amount);
  const result: Wallet = { ...EMPTY_WALLET, ...wallet };
  for (const coin of COINS) result[coin] += income[coin];
  return result;
}

export function walletText(wallet: Wallet): string {
  return COINS.slice().reverse()
    .filter(coin => (wallet[coin] ?? 0) > 0)
    .map(coin => `${wallet[coin]} ${COIN_LABEL[coin]}`)
    .join(' ');
}

export function priceText(amount: number): string {
  const parts = COINS.slice().reverse()
    .filter(coin => coin !== 'ep' && coin !== 'pp')
    .map(coin => [coin, 0] as [Coin, number]);
  let left = Math.max(0, Math.trunc(amount));
  for (const part of parts) {
    part[1] = Math.floor(left / COIN_VALUE[part[0]]);
    left -= part[1] * COIN_VALUE[part[0]];
  }
  const text = parts.filter(([, count]) => count > 0).map(([coin, count]) => `${count} ${COIN_LABEL[coin]}`).join(' ');
  return text || '0 мм';
}

export function splitWallet(wallet: Wallet, count: number): Wallet[] {
  const parts = Math.max(1, Math.trunc(count));
  return Array.from({ length: parts }, (_, index) => Object.fromEntries(COINS.map(coin => {
    const total = Math.max(0, Math.trunc(wallet[coin] ?? 0));
    const share = Math.floor(total / parts);
    return [coin, share + (index === 0 ? total - share * parts : 0)];
  })) as Wallet);
}
