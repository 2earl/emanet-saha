import { hmac, randomToken, base64url, timingSafeEqual, type WebSession } from './http';
import { DEFAULT_LOCALE, currentLocale } from './i18n';

/**
 * Signing in with login.2earl.com: authorization code with PKCE, the client identified by its
 * metadata document (CIMD) at /oauth/client.json, the code exchanged and the token validated over
 * the Service Binding to login. The token is discarded; this app keeps its own session.
 */

export const SIGNIN_TTL_SECONDS = 600;
/** Agents work from their phones in the street: a week idle, 30 days at most. */
export const SESSION_IDLE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;
/** How recent a second factor must be for a change (login DESIGN §4.6). */
export const SECOND_FACTOR_MAX_AGE = 15 * 60;
const TOUCH_INTERVAL_SECONDS = 5 * 60;
export const SCOPE = 'emanet:field';
/** `acr_values` asking login for a fresh second factor (2earl/login GATEWAY_INTEGRATION §4.1). */
export const ACR_AAL2 = 'urn:2earl:aal2';

const encoder = new TextEncoder();

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
}

export const clientId = (env: Env) => `${env.SITE_ORIGIN}/oauth/client.json`;
export const redirectUri = (env: Env) => `${env.SITE_ORIGIN}/callback`;

/** The client metadata document login fetches to learn who this client is (CIMD). */
export function clientMetadata(env: Env) {
  return {
    client_id: clientId(env),
    client_name: 'Emanet Saha',
    client_uri: env.SITE_ORIGIN,
    redirect_uris: [redirectUri(env)],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: SCOPE,
  };
}

/** Starts a sign-in: returns the cookie value to set and the URL to send the browser to. */
export async function startSignIn(
  env: Env,
  now: number,
  returnTo: string | null,
  options: { secondFactor?: boolean } = {},
): Promise<{ cookieValue: string; location: string }> {
  const cookieValue = randomToken();
  const state = randomToken();
  const verifier = randomToken(48);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM signin_tx WHERE expires_at < ?').bind(now),
    env.DB.prepare(
      `INSERT INTO signin_tx (id_hash, state, pkce_verifier, return_to, second_factor, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      await hmac(env.SESSION_PEPPER, `signin:${cookieValue}`),
      state,
      verifier,
      returnTo,
      options.secondFactor === true ? 1 : 0,
      now + SIGNIN_TTL_SECONDS,
    ),
  ]);
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(env),
    redirect_uri: redirectUri(env),
    scope: SCOPE,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    resource: env.SITE_ORIGIN,
    ...(options.secondFactor === true ? { acr_values: ACR_AAL2 } : {}),
    // login.2earl.com shows its pages in the same language (OpenID Connect ui_locales).
    ...(currentLocale() !== DEFAULT_LOCALE ? { ui_locales: currentLocale() } : {}),
  });
  return { cookieValue, location: `${env.AUTHORIZATION_SERVER}/authorize?${query.toString()}` };
}

/** What login's validateToken returns (2earl/login src/index.ts). */
interface Validated {
  audience: string | string[];
  scope: string[];
  props: { uid: string; aal2At?: number | null };
}
interface AuthServer {
  fetch(request: Request): Promise<Response>;
  validateToken(resource: string, token: string): Promise<Validated | null>;
}

export class SignInError extends Error {
  override name = 'SignInError';
}

/**
 * Finishes a sign-in. The transaction is used up whether or not the checks pass, so a callback
 * can't be replayed. Returns the user's 2earl ID and where to go next.
 */
export async function finishSignIn(
  env: Env,
  now: number,
  input: {
    cookieValue: string | undefined;
    state: string | null;
    code: string | null;
    iss: string | null;
  },
): Promise<{ uid: string; aal2At: number | null; returnTo: string | null }> {
  if (!input.cookieValue || !input.state || !input.code) throw new SignInError('incomplete');
  // RFC 9207: the response says which server issued it.
  if (input.iss !== null && input.iss !== env.AUTHORIZATION_SERVER) throw new SignInError('issuer');
  const tx = await env.DB.prepare(
    'DELETE FROM signin_tx WHERE id_hash = ? RETURNING state, pkce_verifier, return_to, expires_at',
  )
    .bind(await hmac(env.SESSION_PEPPER, `signin:${input.cookieValue}`))
    .first<{
      state: string;
      pkce_verifier: string;
      return_to: string | null;
      expires_at: number;
    }>();
  if (!tx || tx.expires_at < now || !timingSafeEqual(tx.state, input.state)) {
    throw new SignInError('transaction');
  }

  const login = env.AUTH_SERVER as unknown as AuthServer;
  const response = await login.fetch(
    new Request(`${env.AUTHORIZATION_SERVER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: redirectUri(env),
        client_id: clientId(env),
        code_verifier: tx.pkce_verifier,
        resource: env.SITE_ORIGIN,
      }),
    }),
  );
  if (!response.ok) throw new SignInError(`token ${String(response.status)}`);
  const { access_token: token } = await response.json<{ access_token?: string }>();
  if (!token) throw new SignInError('no token');
  const validated = await login.validateToken(env.SITE_ORIGIN, token);
  const audience = validated ? [validated.audience].flat() : [];
  if (!validated || !audience.includes(env.SITE_ORIGIN) || !validated.scope.includes(SCOPE)) {
    throw new SignInError('validation');
  }
  return {
    uid: validated.props.uid,
    aal2At: validated.props.aal2At ?? null,
    returnTo: tx.return_to,
  };
}

export async function createWebSession(
  env: Env,
  now: number,
  uid: string,
  aal2At: number | null,
): Promise<string> {
  const cookieValue = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM web_sessions WHERE expires_at < ? OR last_seen_at < ?').bind(
      now,
      now - SESSION_IDLE_SECONDS,
    ),
    env.DB.prepare(
      `INSERT INTO web_sessions (id_hash, uid, created_at, last_seen_at, expires_at, aal2_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      await hmac(env.SESSION_PEPPER, `session:${cookieValue}`),
      uid,
      now,
      now,
      now + SESSION_ABSOLUTE_SECONDS,
      aal2At,
    ),
  ]);
  return cookieValue;
}

export async function currentSession(
  env: Env,
  now: number,
  cookieValue: string | undefined,
): Promise<WebSession | null> {
  if (!cookieValue) return null;
  const idHash = await hmac(env.SESSION_PEPPER, `session:${cookieValue}`);
  const row = await env.DB.prepare(
    'SELECT uid, last_seen_at, expires_at, aal2_at FROM web_sessions WHERE id_hash = ?',
  )
    .bind(idHash)
    .first<{ uid: string; last_seen_at: number; expires_at: number; aal2_at: number | null }>();
  if (!row || row.expires_at < now || row.last_seen_at < now - SESSION_IDLE_SECONDS) return null;
  if (now - row.last_seen_at > TOUCH_INTERVAL_SECONDS) {
    await env.DB.prepare('UPDATE web_sessions SET last_seen_at = ? WHERE id_hash = ?')
      .bind(now, idHash)
      .run();
  }
  return { idHash, uid: row.uid, aal2At: row.aal2_at };
}

export async function endWebSession(env: Env, session: WebSession): Promise<void> {
  await env.DB.prepare('DELETE FROM web_sessions WHERE id_hash = ?').bind(session.idHash).run();
}

/** Whether the session's second factor is recent enough for a change. */
export const hasFreshSecondFactor = (session: WebSession, now: number): boolean =>
  session.aal2At !== null && now - session.aal2At <= SECOND_FACTOR_MAX_AGE;
