import {randomBytes, scrypt, timingSafeEqual, createHash} from 'node:crypto';
const N = 16384, r = 8, p = 1;
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve,reject) => scrypt(password,salt,64,{N,r,p},(error,key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password,salt);
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [version,salt,hex] = stored.split('$');
  if (version !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(hex ?? '')) return false;
  return timingSafeEqual(await derive(password,salt!),Buffer.from(hex!,'hex'));
}
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
