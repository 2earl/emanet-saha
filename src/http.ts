import type { Context } from 'hono';
import type { AgentProfile } from './core';
import type { Locale } from './i18n';

/** Request plumbing (patterns from 2earl/login src/http.ts and 2earl/promptshare). */

export interface WebSession {
  idHash: string;
  uid: string;
  /** When login last verified the second factor for this sign-in, or null. */
  aal2At: number | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { session: WebSession | null; now: number; locale: Locale; agent: AgentProfile };
};
export type AppContext = Context<AppEnv>;

export const SESSION_COOKIE = '__Host-session';
export const SIGNIN_COOKIE = '__Host-signin';

export function setCookie(c: AppContext, name: string, value: string, maxAge: number): void {
  c.header(
    'Set-Cookie',
    `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}`,
    { append: true },
  );
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/**
 * Requests that change state must come from our own pages: the Origin must match, and if the
 * browser reports Sec-Fetch-Site it must say same-origin.
 */
export function isSameOrigin(c: AppContext): boolean {
  const fetchSite = c.req.header('Sec-Fetch-Site');
  if (fetchSite !== undefined && fetchSite !== 'same-origin') return false;
  return c.req.header('Origin') === c.env.SITE_ORIGIN;
}

export async function underRateLimit(c: AppContext, route: string): Promise<boolean> {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { success } = await c.env.FORM_RATE_LIMITER.limit({ key: `${route}:${ip}` });
  return success;
}

/** Only paths on this site, never another origin or a protocol-relative URL. */
export function safeReturnTo(value: string | undefined | null): string | null {
  if (!value || value.length > 512 || !value.startsWith('/') || value.startsWith('//')) return null;
  // Browsers drop tabs and newlines from a URL, so "/\t/evil.example" would become
  // "//evil.example": no backslash, whitespace or control character in a local path.
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  const base = 'https://return-to.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  return url.origin === base ? `${url.pathname}${url.search}` : null;
}

/**
 * Strict CSP: one script of our own (it fills in the device's location when the agent reports a
 * sighting), no framing, forms post only to this origin.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "manifest-src 'self'",
  "form-action 'self' https://login.2earl.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // The location of a sighting, and the camera for in-app photos.
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()',
  'Content-Security-Policy': CSP,
  // Only 2earl.com is for search engines.
  'X-Robots-Tag': 'noindex, nofollow',
};

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hmac(key: string, value: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(
    new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value))),
  );
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
