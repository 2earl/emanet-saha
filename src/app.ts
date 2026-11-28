import { Hono } from 'hono';
import { routePath } from 'hono/route';
import {
  SESSION_ABSOLUTE_SECONDS,
  SIGNIN_TTL_SECONDS,
  SignInError,
  clientMetadata,
  createWebSession,
  currentSession,
  endWebSession,
  finishSignIn,
  startSignIn,
} from './auth';
import {
  DOCUMENT_KINDS,
  TAX_PROFILES,
  core,
  type AgentProfile,
  type EvidenceKind,
  type TaxProfile,
} from './core';
import { readDocument, readPhoto, storeDocument, storeEvidence } from './evidence';
import {
  SECURITY_HEADERS,
  SESSION_COOKIE,
  SIGNIN_COOKIE,
  isSameOrigin,
  readCookie,
  safeReturnTo,
  setCookie,
  underRateLimit,
  type AppContext,
  type AppEnv,
} from './http';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  localizeHtml,
  pickLocale,
  withLocale,
} from './i18n';
import * as pages from './pages';

/** Emanet Saha: the field agents' app (emanet-core docs/DESIGN.md §6). */

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** What an agent reads for each core error code. */
const ERROR_TEXT: Record<string, string> = {
  not_found: 'This vehicle isn’t yours any more: the time ran out or it was given up.',
  agent_not_active: 'Your account can’t do this now.',
  invalid_name: 'Enter your first and last name, as on your ID card.',
  invalid_city: 'Enter the city you work in.',
  invalid_phone: 'Enter a Turkish mobile number, like 0532 123 45 67.',
  invalid_iban: 'That IBAN isn’t valid. It starts with TR and has 26 characters.',
  invalid_tax_profile: 'Choose how you are paid.',
  invalid_vkn: 'Enter your tax number (VKN): 10 digits, or 11 for a person.',
  profile_locked: 'Your name, city and tax details were checked. Contact 2earl to change them.',
  profile_incomplete: 'Fill in and save your details first.',
  consents_missing:
    'Tick all three boxes to continue: the agreement, the privacy notice and the consent.',
  documents_missing: 'Upload both e-Devlet documents first.',
  requests_open: 'Answer what we asked for first.',
  request_not_open: 'This request is already answered or was withdrawn.',
  document_needed: 'This request needs a document. Upload it.',
  answer_needed: 'Write your answer first.',
  already_requested: 'You already have a request being decided.',
  confirm_needed: 'Tick the box to confirm you understand.',
  invalid_address: 'Enter your home address (at least 10 characters).',
  invalid_document: 'Choose which document this is.',
  invalid_barcode: 'Enter the barcode number printed on the document.',
  no_document: 'Choose the document’s file.',
  document_too_large: 'The file is larger than 10 MB.',
  not_a_document: 'Upload the PDF from e-Devlet, or a photo of it.',
  invalid_tckn: 'Enter your T.C. kimlik no: 11 digits, as on your ID card.',
  invalid_birth_year: 'Enter the year you were born. Agents are 18 or older.',
  tckn_taken: 'This ID number already has an Emanet Saha account. One person, one account.',
  phone_taken: 'This mobile number belongs to another agent’s account.',
  identity_not_confirmed:
    'The population registry doesn’t know this ID number with this name and birth year. Check all three: the name exactly as on your ID card.',
  invalid_email: 'That isn’t an email address.',
  email_taken: 'This email address belongs to another agent’s account.',
  sent_recently: 'We sent a code less than a minute ago. Check your inbox, then try again.',
  email_not_sent: 'The email didn’t go out. Try again in a moment.',
  wrong_code: 'That isn’t the code we sent. Check it and try again.',
  code_expired: 'This code is no longer valid. Ask for a new one.',
  email_not_verified: 'Confirm your email address first.',
  already_submitted: 'Your application is already sent.',
  terms_changed: 'The rules have changed. Read them again and accept them.',
  no_payout_rule: 'Vehicles can’t be shown right now. Try again later.',
  not_huntable: 'This vehicle can’t be looked for any more.',
  already_claimed: 'Another agent took this vehicle a moment ago.',
  cooldown: 'You gave this vehicle up recently. You can take it again later.',
  too_many_claims: 'You already hold as many vehicles as you can. Finish or give one up first.',
  invalid_location: 'Your location couldn’t be read. Turn on location and try again.',
  invalid_time: 'Your phone’s clock is wrong. Set it to automatic and try again.',
  no_sighting: 'Report the sighting first.',
  invalid_hash: 'The photo couldn’t be read. Take it again.',
  duplicate_photo: 'This photo was used before. Take a new one.',
  no_photo: 'Take a photo first.',
  photo_too_large: 'The photo is too large. Take it again at a lower resolution.',
  not_a_photo: 'Upload a photo (JPEG, PNG, WebP or HEIC).',
  too_much_evidence: 'This vehicle already has as many photos as it can hold.',
  invalid_kind: 'Choose which document the photo shows.',
  invalid_subject: 'Give your message a title of at least 3 characters.',
  invalid_message: 'Write your message first.',
  invalid_category: 'Choose what your message is about.',
  too_many_open: 'You have five open messages. Wait for an answer or close one first.',
  closed_long: 'This message was closed a while ago. Write a new one.',
  no_location:
    'Your location is needed. Allow location for this site, or take the photo with location on.',
};
const errorText = (error: string) => ERROR_TEXT[error] ?? 'That didn’t work. Try again.';

const DONE: Record<string, string> = {
  saved: 'Saved.',
  code_sent: 'We sent a six-digit code. It is valid for 15 minutes.',
  email_confirmed: 'Email address confirmed.',
  submitted: 'Sent. We’ll call you for the identity check.',
  released: 'Given up. Someone else can look for it now.',
  uploaded: 'Uploaded.',
  document: 'Document uploaded.',
  answered: 'Sent. We’ll look at it.',
  erasure_requested: 'We have your request. We’ll email you our decision.',
  erasure_withdrawn: 'Your request is withdrawn. Nothing was erased.',
  ticket_sent: 'Sent. We answer here and email you when we do.',
  ticket_replied: 'Sent.',
  ticket_closed: 'Closed.',
};
const done = (c: AppContext) => DONE[c.req.query('done') ?? ''] ?? null;

/** `scene` here only if the sighting's own photo didn't get stored (pages.claim shows that step). */
const EVIDENCE_KINDS: EvidenceKind[] = [
  'scene',
  'tow_report',
  'police_report',
  'yediemin_receipt',
  'yediemin_vehicle',
];

/** Where an agent belongs, by status. */
const homeFor = (agent: AgentProfile) =>
  agent.status === 'active' ? '/hunts' : agent.status === 'applied' ? '/apply' : '/status';

export function createApp(now: () => number) {
  const app = new Hono<AppEnv>();

  // One line per request for Cloudflare's logs: the route's pattern (never the address itself,
  // which carries IDs), the status and how long it took.
  app.use('*', async (c: AppContext, next) => {
    const started = Date.now();
    await next();
    console.log(
      JSON.stringify({
        level: c.res.status >= 500 ? 'error' : 'info',
        event: 'request',
        route: `${c.req.method} ${routePath(c)}`,
        status: c.res.status,
        ms: Date.now() - started,
      }),
    );
  });

  // Anything unexpected: the person gets a page that says so, and the core is told the route and
  // the error's name (for the System page in Emanet Merkez and the alert email). Never the data.
  app.onError(async (error, c) => {
    const route = `${c.req.method} ${routePath(c)}`;
    const name = error instanceof Error ? error.name : 'error';
    console.error(JSON.stringify({ level: 'error', event: 'request.failed', route, error: name }));
    try {
      await core(c.env).reportError(route, name);
    } catch {
      // The core itself may be what failed; the log line above stands.
    }
    return c.html(
      pages.problem(
        { signedIn: false },
        'Something went wrong',
        'That didn’t work, and 2earl has been told. Try again in a moment.',
      ),
      500,
    );
  });

  // Language: ?lang= (remembered), the cookie, then the browser's.
  app.use('*', async (c: AppContext, next) => {
    const chosen = c.req.query('lang');
    const locale = pickLocale({
      query: chosen,
      cookie: readCookie(c.req.header('Cookie'), LOCALE_COOKIE),
      acceptLanguage: c.req.header('Accept-Language'),
    });
    c.set('locale', locale);
    await withLocale({ locale, url: new URL(c.req.url) }, () => next());
    if (isLocale(chosen) && c.req.method === 'GET') {
      setCookie(c, LOCALE_COOKIE, chosen, LOCALE_COOKIE_MAX_AGE);
    }
    c.header('Content-Language', locale);
    c.header('Vary', 'Accept-Language, Cookie', { append: true });
    if (locale === DEFAULT_LOCALE) return;
    if (!(c.res.headers.get('Content-Type') ?? '').startsWith('text/html')) return;
    const page = await c.res.text();
    const headers = new Headers(c.res.headers);
    headers.delete('Content-Length');
    c.res = new Response(
      localizeHtml(page, locale).replace('<html lang="en">', `<html lang="${locale}">`),
      { status: c.res.status, headers },
    );
  });

  app.use('*', async (c: AppContext, next) => {
    c.set('now', now());
    c.set(
      'session',
      await currentSession(c.env, c.get('now'), readCookie(c.req.header('Cookie'), SESSION_COOKIE)),
    );
    if (c.req.method === 'POST' && !isSameOrigin(c)) {
      return c.html(
        pages.problem(
          { signedIn: false },
          'Not allowed',
          'This form must be sent from Emanet Saha.',
        ),
        403,
      );
    }
    await next();
    c.res = new Response(c.res.body, c.res);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  });

  const uid = (c: AppContext) => c.get('session')?.uid ?? '';
  const agent = (c: AppContext) => c.get('agent');
  const nav = (c: AppContext): pages.Nav => ({
    signedIn: c.get('session') !== null,
    active: (c.get('agent') as AgentProfile | undefined)?.status === 'active',
    requests: (c.get('agent') as AgentProfile | undefined)?.requests_open ?? 0,
    answers: c.get('answers') ?? 0,
  });
  const notFound = (c: AppContext) =>
    c.html(pages.problem(nav(c), 'Not found', 'This page doesn’t exist.'), 404);
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
    if (!result.ok) throw new Error(`core: ${result.error}`);
    return result.value;
  };
  /**
   * Per agent, not per address: mobile networks put many phones behind one IP. Photos are large
   * and stored before the core has its say; addresses are debtors' homes, and every look is
   * logged. Neither needs to happen more than a few times a minute.
   */
  const tooFast = async (c: AppContext, what: 'upload' | 'places' | 'email') => {
    const { success } = await c.env.FORM_RATE_LIMITER.limit({ key: `${what}:${uid(c)}` });
    return success
      ? null
      : c.html(pages.problem(nav(c), 'Too many attempts', 'Wait a minute and try again.'), 429);
  };

  /** A signed-in agent: registered in the core on first visit, with their profile loaded. */
  const signedIn = async (c: AppContext, next: () => Promise<void>) => {
    const session = c.get('session');
    if (!session) {
      const back = encodeURIComponent(c.req.method === 'GET' ? c.req.path : '/');
      return c.redirect(`/signin?return=${back}`, c.req.method === 'GET' ? 302 : 303);
    }
    let profile = await core(c.env).profile(session.uid);
    if (!profile.ok && profile.error === 'not_found') {
      unwrap(await core(c.env).register(session.uid));
      profile = await core(c.env).profile(session.uid);
    }
    c.set('agent', unwrap(profile));
    // Support messages 2earl has answered: shown on every page until they are read.
    const tickets = await core(c.env).myTickets(session.uid);
    c.set('answers', tickets.ok ? tickets.value.filter((t) => t.status === 'answered').length : 0);
    // An erased account can read what happened and the legal texts, nothing else.
    if (unwrap(profile).erased) return c.html(pages.waiting(nav(c), unwrap(profile)));
    await next();
    return undefined;
  };
  /** Vehicles, claims and earnings: active agents only. */
  const activeOnly = async (c: AppContext, next: () => Promise<void>) => {
    if (agent(c).status !== 'active') return c.redirect(homeFor(agent(c)), 303);
    await next();
    return undefined;
  };
  for (const path of [
    '/apply',
    '/apply/*',
    '/status',
    '/account',
    '/requests',
    '/requests/*',
    '/privacy',
    '/privacy/*',
    '/support',
    '/support/*',
  ]) {
    app.use(path, signedIn);
  }
  for (const path of [
    '/hunts',
    '/hunts/*',
    '/claims',
    '/claims/*',
    '/earnings',
    '/earnings/*',
    '/earnings.csv',
  ]) {
    app.use(path, signedIn, activeOnly);
  }

  // ---- Public ---------------------------------------------------------------------------------

  // The start page: what this is, or for a signed-in agent the page for where they are.
  app.use('/', async (c: AppContext, next) => (c.get('session') ? signedIn(c, next) : next()));
  app.get('/', (c) => {
    if (!c.get('session')) return c.html(pages.home());
    return c.redirect(homeFor(agent(c)), 302);
  });

  app.get('/terms', (c) => c.html(pages.terms(nav(c))));

  // The agent agreement, the privacy notice and the consent text: public, like the rules, so
  // anyone can read what an agent agrees to before signing in.
  app.get('/agreement', async (c) => {
    const locale = c.get('locale') === 'en' ? 'en' : 'tr';
    const bundle = await core(c.env).agreement(locale);
    if (!bundle.ok)
      return c.html(pages.problem(nav(c), 'Not found', 'This page doesn’t exist.'), 404);
    const session = c.get('session');
    const accepted = session ? await core(c.env).acceptance(session.uid) : null;
    return c.html(pages.agreementPage(nav(c), bundle.value, accepted?.ok ? accepted.value : null));
  });

  app.get('/oauth/client.json', (c) => {
    const response = c.json(clientMetadata(c.env));
    response.headers.set('Cache-Control', 'public, max-age=300');
    return response;
  });

  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));

  // ---- Sign-in ----------------------------------------------------------------------------------

  app.get('/signin', async (c) => {
    if (!(await underRateLimit(c, 'signin'))) {
      return c.html(
        pages.problem(nav(c), 'Too many attempts', 'Wait a minute and try again.'),
        429,
      );
    }
    const returnTo = safeReturnTo(c.req.query('return'));
    if (c.get('session')) return c.redirect(returnTo ?? '/', 302);
    const { cookieValue, location } = await startSignIn(c.env, c.get('now'), returnTo);
    setCookie(c, SIGNIN_COOKIE, cookieValue, SIGNIN_TTL_SECONDS);
    return c.redirect(location, 302);
  });

  app.get('/callback', async (c) => {
    setCookie(c, SIGNIN_COOKIE, '', 0);
    if (c.req.query('error')) {
      return c.html(
        pages.problem(nav(c), 'Not signed in', 'Sign-in was cancelled or not allowed.'),
        400,
      );
    }
    try {
      const {
        uid: user,
        aal2At,
        returnTo,
      } = await finishSignIn(c.env, c.get('now'), {
        cookieValue: readCookie(c.req.header('Cookie'), SIGNIN_COOKIE),
        state: c.req.query('state') ?? null,
        code: c.req.query('code') ?? null,
        iss: c.req.query('iss') ?? null,
      });
      const previous = c.get('session');
      if (previous) await endWebSession(c.env, previous);
      setCookie(
        c,
        SESSION_COOKIE,
        await createWebSession(c.env, c.get('now'), user, aal2At),
        SESSION_ABSOLUTE_SECONDS,
      );
      return c.redirect(safeReturnTo(returnTo) ?? '/', 302);
    } catch (error) {
      if (!(error instanceof SignInError)) throw error;
      console.error('sign-in failed', error.message);
      return c.html(
        pages.problem(nav(c), 'Not signed in', 'Sign-in didn’t complete. Start again.'),
        400,
      );
    }
  });

  app.post('/signout', async (c) => {
    const session = c.get('session');
    if (session) await endWebSession(c.env, session);
    setCookie(c, SESSION_COOKIE, '', 0);
    return c.redirect('/', 303);
  });

  // ---- Joining ----------------------------------------------------------------------------------

  const formValues = async (c: AppContext) => {
    const form = await c.req.parseBody();
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(form)) values[key] = text(value);
    return values;
  };
  const profileInput = (v: Record<string, string>) => ({
    legalName: v.legal_name ?? '',
    city: v.city ?? '',
    phone: v.phone ?? '',
    iban: v.iban ?? '',
    taxProfile: (TAX_PROFILES.includes(v.tax_profile as TaxProfile)
      ? v.tax_profile
      : 'individual') as TaxProfile,
    vkn: v.vkn ? v.vkn : null,
    tckn: v.tckn ? v.tckn : null,
    birthYear: /^\d{4}$/.test(v.birth_year ?? '') ? Number(v.birth_year) : null,
    address: v.address ? v.address : null,
  });

  const applyPage = async (
    c: AppContext,
    values: Record<string, string>,
    errorText: string | null,
    pendingEmail: string | null = null,
  ) => {
    const documents = await core(c.env).documents(uid(c));
    return pages.apply(
      nav(c),
      agent(c),
      values,
      errorText,
      done(c),
      pendingEmail ?? (c.req.query('code') === '1' ? text(c.req.query('email')) : null),
      documents.ok ? documents.value : [],
    );
  };

  app.get('/apply', async (c) => {
    if (agent(c).status !== 'applied') return c.redirect(homeFor(agent(c)), 302);
    return c.html(await applyPage(c, pages.profileValues(agent(c)), null));
  });

  // Step 1: an email address, proved with a code we mail to it.
  app.post('/apply/email', async (c) => {
    const limited = await tooFast(c, 'email');
    if (limited) return limited;
    const v = await formValues(c);
    const result = await core(c.env).requestEmailCode(uid(c), {
      email: v.email ?? '',
      locale: c.get('locale') === 'en' ? 'en' : 'tr',
    });
    if (!result.ok) {
      return c.html(
        await applyPage(
          c,
          pages.profileValues(agent(c)),
          errorText(result.error),
          result.error === 'sent_recently' ? (v.email ?? '') : null,
        ),
        422,
      );
    }
    return c.redirect(
      `/apply?done=code_sent&code=1&email=${encodeURIComponent(result.value.email)}`,
      303,
    );
  });

  app.post('/apply/email/confirm', async (c) => {
    const limited = await tooFast(c, 'email');
    if (limited) return limited;
    const v = await formValues(c);
    const result = await core(c.env).confirmEmailCode(uid(c), v.code ?? '');
    if (!result.ok) {
      return c.html(
        await applyPage(
          c,
          pages.profileValues(agent(c)),
          errorText(result.error),
          result.error === 'wrong_code' ? (v.email ?? '') : null,
        ),
        422,
      );
    }
    return c.redirect('/apply?done=email_confirmed', 303);
  });

  app.post('/apply/profile', async (c) => {
    const v = await formValues(c);
    const result = await core(c.env).updateProfile(uid(c), profileInput(v));
    if (!result.ok) return c.html(await applyPage(c, v, errorText(result.error)), 422);
    return c.redirect('/apply?done=saved', 303);
  });

  app.post('/apply/submit', async (c) => {
    const v = await formValues(c);
    if (v.accept !== '1' || v.notice !== '1' || v.consent !== '1') {
      return c.html(
        await applyPage(c, pages.profileValues(agent(c)), errorText('consents_missing')),
        422,
      );
    }
    const result = await core(c.env).submit(
      uid(c),
      v.terms ?? '',
      { agreement: true, notice: true, consent: true },
      c.get('locale'),
    );
    if (!result.ok) {
      return c.html(
        await applyPage(c, pages.profileValues(agent(c)), errorText(result.error)),
        422,
      );
    }
    return c.redirect('/status?done=submitted', 303);
  });

  /** One of the two e-Devlet documents, with its barcode number. */
  app.post('/apply/documents', async (c) => {
    const limited = await tooFast(c, 'upload');
    if (limited) return limited;
    const form = await c.req.parseBody();
    const kind = text(form.kind);
    const barcode = text(form.barcode);
    const values = pages.profileValues(agent(c));
    if (!DOCUMENT_KINDS.includes(kind as (typeof DOCUMENT_KINDS)[number])) {
      return c.html(await applyPage(c, values, errorText('invalid_document')), 422);
    }
    const file = await readDocument(form.file);
    if (!file.ok) return c.html(await applyPage(c, values, errorText(file.error)), 422);
    const stored = await storeDocument(c.env, uid(c), kind, barcode, file.value);
    if (!stored.ok) return c.html(await applyPage(c, values, errorText(stored.error)), 422);
    return c.redirect('/apply?done=document', 303);
  });

  app.get('/status', (c) => {
    if (agent(c).status === 'active' || agent(c).status === 'applied') {
      return c.redirect(homeFor(agent(c)), 302);
    }
    return c.html(pages.waiting(nav(c), agent(c)));
  });

  app.get('/account', (c) =>
    c.html(pages.account(nav(c), agent(c), pages.profileValues(agent(c)), null, done(c))),
  );

  app.post('/account', async (c) => {
    const v = await formValues(c);
    const result = await core(c.env).updateProfile(uid(c), profileInput(v));
    if (!result.ok)
      return c.html(pages.account(nav(c), agent(c), v, errorText(result.error), null), 422);
    return c.redirect('/account?done=saved', 303);
  });

  // ---- What staff asked for ---------------------------------------------------------------------

  const requestsPage = async (c: AppContext, error: string | null, status: 200 | 422 = 200) => {
    const list = await core(c.env).requests(uid(c));
    return c.html(
      pages.requestsPage(nav(c), agent(c), list.ok ? list.value : [], error, done(c)),
      status,
    );
  };

  app.get('/requests', (c) => requestsPage(c, null));

  /** A detail is corrected, or a question answered in words. */
  app.post('/requests/:id/answer', async (c) => {
    const v = await formValues(c);
    const result = await core(c.env).answerRequest(uid(c), c.req.param('id'), v.answer ?? '');
    if (!result.ok) return requestsPage(c, errorText(result.error), 422);
    return c.redirect('/requests?done=answered', 303);
  });

  /** A document staff asked for. Which kind it is comes from the request, never from the form. */
  app.post('/requests/:id/document', async (c) => {
    const limited = await tooFast(c, 'upload');
    if (limited) return limited;
    const form = await c.req.parseBody();
    const list = await core(c.env).requests(uid(c));
    const asked = (list.ok ? list.value : []).find(
      (r) => r.id === c.req.param('id') && r.kind === 'document' && r.status === 'open',
    );
    if (!asked) return requestsPage(c, errorText('request_not_open'), 422);
    const file = await readDocument(form.file);
    if (!file.ok) return requestsPage(c, errorText(file.error), 422);
    const stored = await storeDocument(
      c.env,
      uid(c),
      asked.subject,
      text(form.barcode),
      file.value,
      asked.id,
    );
    if (!stored.ok) return requestsPage(c, errorText(stored.error), 422);
    return c.redirect('/requests?done=document', 303);
  });

  // ---- The agent's own data ---------------------------------------------------------------------

  const myData = async (c: AppContext, error: string | null, status: 200 | 422 = 200) =>
    c.html(
      pages.myData(nav(c), agent(c), unwrap(await core(c.env).erasure(uid(c))), error, done(c)),
      status,
    );

  app.get('/privacy', (c) => myData(c, null));

  app.post('/privacy/erase', async (c) => {
    const v = await formValues(c);
    if (v.confirm !== '1') return myData(c, errorText('confirm_needed'), 422);
    const result = await core(c.env).requestErasure(uid(c), v.note ?? '');
    if (!result.ok) return myData(c, errorText(result.error), 422);
    return c.redirect('/privacy?done=erasure_requested', 303);
  });

  app.post('/privacy/withdraw', async (c) => {
    const result = await core(c.env).withdrawErasure(uid(c));
    if (!result.ok) return myData(c, errorText(result.error), 422);
    return c.redirect('/privacy?done=erasure_withdrawn', 303);
  });

  // ---- Vehicles and claims ----------------------------------------------------------------------

  const showHunts = async (c: AppContext, error: string | null, status: 200 | 409 | 422 = 200) => {
    const city = c.req.query('city')?.trim() || agent(c).city || null;
    const result = await core(c.env).hunts(uid(c), city ? { city } : {});
    const list = result.ok ? result.value : [];
    const message = error ?? (result.ok ? null : errorText(result.error));
    return c.html(pages.hunts(nav(c), list, city, agent(c), message, done(c)), status);
  };

  app.get('/hunts', (c) => showHunts(c, null));

  app.post('/hunts/:vehicle/claim', async (c) => {
    // Per agent, not per address: mobile networks put many phones behind one IP.
    const { success } = await c.env.FORM_RATE_LIMITER.limit({ key: `claim:${uid(c)}` });
    if (!success) {
      return c.html(
        pages.problem(nav(c), 'Too many attempts', 'Wait a minute and try again.'),
        429,
      );
    }
    const result = await core(c.env).claim(uid(c), c.req.param('vehicle'));
    if (!result.ok)
      return showHunts(c, errorText(result.error), result.error === 'already_claimed' ? 409 : 422);
    return c.redirect(`/claims/${result.value.id}`, 303);
  });

  app.get('/claims', async (c) =>
    c.html(pages.claims(nav(c), unwrap(await core(c.env).myClaims(uid(c))), done(c))),
  );

  const showClaim = async (c: AppContext, error: string | null, status: 200 | 409 | 422 = 200) => {
    const id = c.req.param('id') ?? '';
    const limited = await tooFast(c, 'places');
    if (limited) return limited;
    const details = await core(c.env).claimDetails(uid(c), id);
    if (!details.ok) return notFound(c);
    const mine = unwrap(await core(c.env).myClaims(uid(c))).find((m) => m.id === id);
    return c.html(
      pages.claim(nav(c), details.value, mine, uid(c), c.get('now'), error, done(c)),
      status,
    );
  };

  app.get('/claims/:id', (c) => showClaim(c, null));

  app.post('/claims/:id/release', async (c) => {
    const result = await core(c.env).release(uid(c), c.req.param('id'));
    if (!result.ok) return showClaim(c, errorText(result.error), 422);
    return c.redirect('/claims?done=released', 303);
  });

  app.get('/claims/:id/found', async (c) => {
    const details = await core(c.env).claimDetails(uid(c), c.req.param('id'));
    if (!details.ok) return notFound(c);
    if (details.value.claim.state === 'reporting')
      return c.redirect(`/claims/${c.req.param('id')}`, 302);
    return c.html(pages.found(nav(c), details.value, null));
  });

  /**
   * The sighting: where the phone was (from the browser, else the photo's GPS) and when (the
   * photo's own time if it has one), then the photo as the first evidence.
   */
  app.post('/claims/:id/found', async (c) => {
    const id = c.req.param('id');
    const limited = await tooFast(c, 'upload');
    if (limited) return limited;
    const details = await core(c.env).claimDetails(uid(c), id);
    if (!details.ok) return notFound(c);
    const fail = (error: string) =>
      c.html(pages.found(nav(c), details.value, errorText(error)), 422);
    const form = await c.req.parseBody();
    const photo = await readPhoto(form.photo);
    if (!photo.ok) return fail(photo.error);
    const number = (key: string) => {
      const value = Number(text(form[key]));
      return text(form[key]) !== '' && Number.isFinite(value) ? value : undefined;
    };
    const lat = number('lat') ?? photo.value.facts.lat;
    const lng = number('lng') ?? photo.value.facts.lng;
    if (lat === undefined || lng === undefined) return fail('no_location');
    const accuracy = number('accuracy');
    const deviceTime = number('taken_at');
    const takenAt =
      photo.value.facts.takenAt ??
      (deviceTime === undefined ? c.get('now') : Math.floor(deviceTime / 1000));
    const sighting = await core(c.env).sighting(uid(c), id, {
      lat,
      lng,
      taken_at: takenAt,
      ...(accuracy === undefined ? {} : { accuracy_m: accuracy }),
    });
    if (!sighting.ok) return fail(sighting.error);
    const stored = await storeEvidence(c.env, uid(c), id, 'scene', photo.value);
    if (!stored.ok) return fail(stored.error);
    return c.redirect(`/claims/${id}/call`, 303);
  });

  app.get('/claims/:id/call', async (c) => {
    const details = await core(c.env).claimDetails(uid(c), c.req.param('id'));
    if (!details.ok) return notFound(c);
    return c.html(pages.call(nav(c), details.value));
  });

  app.post('/claims/:id/evidence', async (c) => {
    const id = c.req.param('id');
    const limited = await tooFast(c, 'upload');
    if (limited) return limited;
    const form = await c.req.parseBody();
    const kind = text(form.kind) as EvidenceKind;
    if (!EVIDENCE_KINDS.includes(kind)) return showClaim(c, errorText('x'), 422);
    if (kind === 'scene') {
      // Only to make up for a sighting whose own photo wasn't stored.
      const mine = unwrap(await core(c.env).myClaims(uid(c))).find((m) => m.id === id);
      if (!mine || mine.state !== 'reporting' || mine.evidence.includes('scene')) {
        return showClaim(c, errorText('x'), 422);
      }
    }
    const photo = await readPhoto(form.photo);
    if (!photo.ok) return showClaim(c, errorText(photo.error), 422);
    const stored = await storeEvidence(c.env, uid(c), id, kind, photo.value);
    if (!stored.ok) {
      return showClaim(c, errorText(stored.error), stored.error === 'duplicate_photo' ? 409 : 422);
    }
    return c.redirect(`/claims/${id}?done=uploaded`, 303);
  });

  app.get('/earnings', async (c) =>
    c.html(pages.earnings(nav(c), unwrap(await core(c.env).earnings(uid(c))), agent(c))),
  );

  app.get('/earnings.csv', async (c) => {
    const e = unwrap(await core(c.env).earnings(uid(c)));
    return new Response(pages.earningsCsv(e), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="emanet-payments.csv"',
        'Cache-Control': 'no-store',
      },
    });
  });

  app.get('/earnings/:id', async (c) => {
    const e = unwrap(await core(c.env).earnings(uid(c)));
    const payout = e.payouts.find((p) => p.id === c.req.param('id'));
    if (!payout) return notFound(c);
    return c.html(pages.statement(nav(c), payout, agent(c)));
  });

  // ---- Support ----------------------------------------------------------------------------------

  app.get('/support', async (c) => {
    const list = await core(c.env).myTickets(uid(c));
    return c.html(pages.supportList(nav(c), list.ok ? list.value : [], done(c)));
  });

  const newTicket = (
    c: AppContext,
    values: Record<string, string>,
    error: string | null,
    status: 200 | 422 = 200,
  ) => c.html(pages.supportNew(nav(c), values, error), status);

  app.get('/support/new', (c) =>
    // `about` is what the question is about (a payment, a vehicle): it starts the subject.
    newTicket(
      c,
      {
        category: c.req.query('category') ?? 'other',
        subject: (c.req.query('about') ?? '').trim().slice(0, 80),
      },
      null,
    ),
  );

  app.post('/support/new', async (c) => {
    const v = await formValues(c);
    const result = await core(c.env).openTicket(uid(c), {
      subject: v.subject ?? '',
      category: v.category ?? '',
      message: v.message ?? '',
    });
    if (!result.ok) return newTicket(c, v, errorText(result.error), 422);
    return c.redirect(`/support/${result.value.id}?done=ticket_sent`, 303);
  });

  const showTicket = async (c: AppContext, error: string | null, status: 200 | 404 | 422 = 200) => {
    const found = await core(c.env).myTicket(uid(c), c.req.param('id') ?? '');
    if (!found.ok) return notFound(c);
    return c.html(pages.supportThread(nav(c), found.value, error, done(c)), status);
  };

  app.get('/support/:id', (c) => showTicket(c, null));

  app.post('/support/:id/reply', async (c) => {
    const v = await formValues(c);
    const id = c.req.param('id');
    const result = await core(c.env).replyTicket(uid(c), id, v.message ?? '');
    if (!result.ok) {
      return result.error === 'not_found'
        ? notFound(c)
        : showTicket(c, errorText(result.error), 422);
    }
    return c.redirect(`/support/${id}?done=ticket_replied`, 303);
  });

  app.post('/support/:id/close', async (c) => {
    const id = c.req.param('id');
    const result = await core(c.env).closeTicket(uid(c), id);
    if (!result.ok) return notFound(c);
    return c.redirect(`/support?done=ticket_closed`, 303);
  });

  // Static files (styles, script, icon, manifest); anything else is not found.
  app.get('*', async (c) => {
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    if (asset.status !== 404) return asset;
    return notFound(c);
  });

  return app;
}
