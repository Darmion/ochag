import { branding } from '../ui/branding';

export class ApiError extends Error {
  status: number;
  hints: string[];
  network: boolean;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, hints: string[] = [], network = false) {
    super(message);
    this.status = status;
    this.hints = hints;
    this.network = network;
  }
}

export function errorHints(cause: unknown): string[] {
  return cause instanceof ApiError ? cause.hints : [];
}

const CODE_PATTERN = /(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;
const ADDRESS_PATTERN = /\bhttps?:\/\/[^\s/«»"']+/i;

const CERTIFICATE_PATTERN = /Код сертификата:\s*([0-9A-F]{4}(?:-[0-9A-F]{4}){3})/i;
const CAMPAIGN_PATTERN = /кампания «([^»]{1,200})»/i;

export function parseInvite(text: string): { address: string | null; code: string | null; certificate: string | null; campaign: string | null } {
  const address = ADDRESS_PATTERN.exec(text)?.[0] ?? null;
  const withoutAddress = address ? text.replace(address, ' ') : text;
  const code = CODE_PATTERN.exec(withoutAddress)?.[1] ?? null;
  const certificate = CERTIFICATE_PATTERN.exec(text)?.[1]?.toUpperCase() ?? null;
  const campaign = CAMPAIGN_PATTERN.exec(text)?.[1]?.trim() ?? null;

  return { address: address ? address.replace(/\/+$/, '') : null, code, certificate, campaign };
}

export function formatInvite(input: {
  campaignName: string;
  address: string | null;
  code: string;
  expiresAt: string;
  certificate?: string | null;
}): string {
  return [
    `Приглашение в «${branding.appName}» — кампания «${input.campaignName}»`,
    input.address ? `Адрес сервера: ${input.address}` : null,
    input.certificate ? `Код сертификата: ${input.certificate}` : null,
    `Код приглашения: ${input.code}`,
    `Действует до ${input.expiresAt}, только для одного игрока.`,
    `Вставьте этот текст целиком в поле «Приглашение» в приложении «${branding.appName}».`,
  ].filter(Boolean).join('\n');
}

export function isLoopbackAddress(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '[::1]' || hostname.startsWith('127.');
  } catch {
    return false;
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
}

export function sameServer(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return sameOrigin(a, b);
  }
}

export function timeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));

  if (seconds < 5) return 'только что';
  if (seconds < 60) return `${seconds} с назад`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
  return `${Math.floor(seconds / 3600)} ч назад`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
