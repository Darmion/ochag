import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db.ts';
import { clientAddress } from './network.ts';
import { tokenHash } from './security.ts';

const SESSION_CACHE_MS = 60_000;
const SESSION_CACHE_LIMIT = 5000;

// One IPv6 subscriber usually holds a whole /64: counting single addresses would let one client rotate through them.
export function addressKey(address: string): string {
  if (isIP(address) !== 6) return address;
  const [head = '', tail] = address.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export const addressOf = (request: FastifyRequest) => addressKey(clientAddress(request));

// A session gets its own allowance only once its token is found in the database: a made-up token counts against the address.
export function sessionKeys(db: Queryable) {
  const verified = new Map<string, number>();
  const valid = async (hash: string) => {
    const now = Date.now();
    if ((verified.get(hash) ?? 0) > now) return true;
    const { rows } = await db.query('SELECT 1 FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()', [hash]);
    if (!rows[0]) return false;
    if (verified.size >= SESSION_CACHE_LIMIT) verified.clear();
    verified.set(hash, now + SESSION_CACHE_MS);
    return true;
  };
  return async (request: FastifyRequest) => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
    if (token) {
      const hash = tokenHash(token);
      if (await valid(hash)) return `session:${hash.slice(0, 32)}`;
    }
    return addressOf(request);
  };
}
