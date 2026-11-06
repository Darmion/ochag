import {createServer, type IncomingMessage, type Server} from 'node:http';
import {isIP} from 'node:net';
import os from 'node:os';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {cleanAddress, isLoopback} from './presence.ts';

export const VIA_TUNNEL = Symbol.for('ochag.viaTunnel');

type RequestLike = Pick<FastifyRequest, 'raw' | 'socket' | 'headers'>;

export function viaTunnel(req: RequestLike): boolean {
  return (req.raw as unknown as Record<symbol, unknown>)[VIA_TUNNEL] === true;
}

export function clientAddress(req: RequestLike): string {
  if (viaTunnel(req)) {
    const header = req.headers['cf-connecting-ip'];
    const value = (typeof header === 'string' ? header : '').trim();
    return isIP(value) ? cleanAddress(value) : 'туннель';
  }
  return cleanAddress(req.socket.remoteAddress);
}

export type Peer = {remoteAddress: string; localAddress: string; localPort: number | null; network?: string};

export function peerOf(req: RequestLike): Peer {
  if (viaTunnel(req)) return {remoteAddress: clientAddress(req), localAddress: 'tunnel', localPort: null, network: 'Туннель Cloudflare'};
  return {remoteAddress: cleanAddress(req.socket.remoteAddress), localAddress: cleanAddress(req.socket.localAddress), localPort: req.socket.localPort ?? null};
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

export function isPublicAddress(address: string): boolean {
  const value = cleanAddress(address).toLowerCase();
  const v4 = ipv4Parts(value);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0 || a === 25 || a === 26) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (isIP(value) === 6) {
    if (value === '::1' || value === '::') return false;
    if (/^fe[89ab]/.test(value)) return false;
    if (/^f[cd]/.test(value)) return false;
    return true;
  }
  return true;
}

export function fromInternet(req: RequestLike): boolean {
  return viaTunnel(req) || isPublicAddress(clientAddress(req));
}

function hostnameOf(header: string | undefined): string {
  const value = String(header ?? '').trim().toLowerCase();
  const name = value.startsWith('[') ? value.slice(1, value.indexOf(']')) : value.split(':')[0] ?? '';
  return name.replace(/\.$/, '');
}

// DNS rebinding: a web page in the GM's browser reaches 127.0.0.1 under its own domain name and would pass as the GM's computer.
export function foreignHostOnThisComputer(req: RequestLike): boolean {
  if (viaTunnel(req) || !isLoopback(cleanAddress(req.socket.remoteAddress))) return false;
  const host = hostnameOf(req.headers.host);
  if (!host || isIP(host) || host === 'localhost' || host.endsWith('.localhost')) return false;
  const own = os.hostname().toLowerCase();
  return host !== own && host !== `${own}.local`;
}

export async function createTunnelListener(app: FastifyInstance, port: number, host = '127.0.0.1'): Promise<Server> {
  const mark = (req: IncomingMessage) => {
    (req as unknown as Record<symbol, unknown>)[VIA_TUNNEL] = true;
  };
  const server = createServer((req, res) => {
    mark(req);
    app.routing(req, res);
  });
  server.on('upgrade', (req, socket, head) => {
    mark(req);
    app.server.emit('upgrade', req, socket, head);
  });
  server.requestTimeout = 10 * 60_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

export function closeTunnelListener(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise(resolve => server.close(() => resolve()));
}
