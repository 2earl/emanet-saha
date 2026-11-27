import { env, exports } from 'cloudflare:workers';

export const ORIGIN = 'https://saha.emanet.dev';
const ip = () => `198.51.100.${String(Math.floor(Math.random() * 250))}`;

export function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {},
): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'CF-Connecting-IP': ip(), ...(init.headers ?? {}) },
      ...(init.body === undefined ? {} : { body: init.body }),
      redirect: 'manual',
    }),
  );
}

/** A form post from our own pages. */
export function post(
  path: string,
  cookie: string,
  form: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  return request(path, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(form),
  });
}

const cookieFrom = (response: Response, name: string) => {
  for (const header of response.headers.getSetCookie()) {
    const [pair = ''] = header.split(';');
    if (pair.startsWith(`${name}=`)) return pair;
  }
  throw new Error(`no ${name} cookie`);
};

/** The sign-in round trip up to login's answer. */
export async function callback(uid: string, path = '/signin'): Promise<Response> {
  const start = await request(path);
  const signinCookie = cookieFrom(start, '__Host-signin');
  const location = new URL(start.headers.get('Location') ?? '');
  const state = location.searchParams.get('state') ?? '';
  const challenge = location.searchParams.get('code_challenge') ?? '';
  return request(
    `/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(`${uid}.${challenge}`)}&iss=${encodeURIComponent('https://login.2earl.com')}`,
    { headers: { Cookie: signinCookie } },
  );
}

/** Signs in through the whole flow. */
export async function signIn(uid: string): Promise<string> {
  const response = await callback(uid);
  if (response.status !== 302) throw new Error(`callback ${String(response.status)}`);
  return cookieFrom(response, '__Host-session');
}

/** A form with files, as a phone sends it. */
export function upload(
  path: string,
  cookie: string,
  fields: Record<string, string>,
  files: Record<string, { bytes: Uint8Array; type: string; name?: string }>,
  headers: Record<string, string> = {},
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const [key, file] of Object.entries(files)) {
    form.set(key, new File([file.bytes], file.name ?? 'photo.jpg', { type: file.type }));
  }
  return request(path, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ORIGIN, ...headers },
    body: form,
  });
}

interface CoreTestHooks {
  testCalls(): Promise<unknown[][]>;
  testReset(): Promise<void>;
}
export const coreHooks = () => env.CORE as unknown as CoreTestHooks;

/** The core calls of one method, without the method name. */
export async function callsOf(method: string): Promise<unknown[][]> {
  const calls = await coreHooks().testCalls();
  return calls.filter((c) => c[0] === method).map((c) => c.slice(1));
}
