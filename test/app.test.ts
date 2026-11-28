import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, callsOf, coreHooks, post, request, signIn, upload } from './helpers';
import { jpegWithExif } from './jpeg';

beforeEach(async () => {
  await coreHooks().testReset();
});

const photo = (salt = 1, gps = false) => ({
  bytes: jpegWithExif({
    taken: new Date(Date.now() + 3 * 3600 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')
      .replace(/-/g, ':'),
    salt,
    ...(gps ? { lat: [38, 27, 36, 'N'] as const, lng: [27, 8, 24, 'E'] as const } : {}),
  }),
  type: 'image/jpeg',
});

async function claimed(cookie: string): Promise<string> {
  const response = await post('/hunts/v-1/claim', cookie);
  expect(response.status).toBe(303);
  return (response.headers.get('Location') ?? '').replace('/claims/', '');
}

describe('public pages', () => {
  it('serves the start page, the rules, the manifest and the client metadata', async () => {
    const home = await request('/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Sign in with 2earl');
    expect(home.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(await (await request('/terms')).text()).toContain('TCK 123/A');
    expect((await request('/manifest.webmanifest')).status).toBe(200);
    const client = await (await request('/oauth/client.json')).json<Record<string, unknown>>();
    expect(client).toMatchObject({ client_name: 'Emanet Saha', scope: 'emanet:field' });
  });

  it('signs in without asking for a second factor', async () => {
    const start = await request('/signin');
    const location = new URL(start.headers.get('Location') ?? '');
    expect(location.searchParams.get('acr_values')).toBeNull();
    expect(location.searchParams.get('resource')).toBe(ORIGIN);
  });
});

describe('joining', () => {
  it('shows an application sent back what to correct, and a waiting one where it stands', async () => {
    const returned = await signIn('returned-1');
    const page = await (await request('/apply', { headers: { Cookie: returned } })).text();
    expect(page).toContain('We need one thing corrected');
    expect(page).toContain('The IBAN is not in your own name.');
    const pending = await signIn('pending-7');
    const home = await request('/', { headers: { Cookie: pending } });
    const waiting =
      home.status === 200
        ? await home.text()
        : await (
            await request(home.headers.get('Location') ?? '/', { headers: { Cookie: pending } })
          ).text();
    expect(waiting).toContain('class="tracker"');
    expect(waiting).toContain('Have ready for the call');
  });

  it('registers a new agent, saves the profile and sends the application', async () => {
    const cookie = await signIn('new-1');
    const home = await request('/', { headers: { Cookie: cookie } });
    expect(home.headers.get('Location')).toBe('/apply');
    expect(await callsOf('register')).toEqual([['new-1']]);
    // Not active: no vehicles.
    expect((await request('/hunts', { headers: { Cookie: cookie } })).headers.get('Location')).toBe(
      '/apply',
    );
    const page = await (await request('/apply', { headers: { Cookie: cookie } })).text();
    expect(page).toContain('Confirm your email address and save your details first.');
    // Step 1: the email address, proved with a code.
    expect((await post('/apply/email', cookie, { email: 'nope' })).status).toBe(422);
    const taken = await post('/apply/email', cookie, { email: 'taken@example.com' });
    expect(await taken.text()).toContain('belongs to another agent');
    const asked = await post('/apply/email', cookie, { email: 'Ayse@Example.com' });
    expect(asked.headers.get('Location')).toBe(
      '/apply?done=code_sent&code=1&email=ayse%40example.com',
    );
    expect((await callsOf('requestEmailCode')).at(-1)).toEqual([
      'new-1',
      { email: 'Ayse@Example.com', locale: 'en' },
    ]);
    const codePage = await (
      await request(asked.headers.get('Location') ?? '', { headers: { Cookie: cookie } })
    ).text();
    expect(codePage).toContain('autocomplete="one-time-code"');
    const wrong = await post('/apply/email/confirm', cookie, {
      code: '000000',
      email: 'ayse@example.com',
    });
    expect(wrong.status).toBe(422);
    expect(await wrong.text()).toContain('isn’t the code we sent');
    const confirmed = await post('/apply/email/confirm', cookie, { code: '123456' });
    expect(confirmed.headers.get('Location')).toBe('/apply?done=email_confirmed');
    // Step 2: details, with the ID number.
    const details = {
      legal_name: 'Ayşe Yılmaz',
      city: 'İzmir',
      phone: '05321234567',
      iban: 'TR33 0006 1005 1978 6457 8413 26',
      tax_profile: 'individual',
      birth_year: '1990',
      address: 'Örnek Mah. Deneme Sk. No:1 D:2 Karşıyaka İzmir',
    };
    const bad = await post('/apply/profile', cookie, {
      ...details,
      iban: 'TR12',
      tckn: '10000000078',
    });
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain('IBAN isn’t valid');
    const noId = await post('/apply/profile', cookie, details);
    expect(await noId.text()).toContain('T.C. kimlik no');
    const second = await post('/apply/profile', cookie, { ...details, tckn: '10000000146' });
    expect(await second.text()).toContain('One person, one account');
    const saved = await post('/apply/profile', cookie, { ...details, tckn: '10000000078' });
    expect(saved.headers.get('Location')).toBe('/apply?done=saved');
    expect((await callsOf('updateProfile')).at(-1)?.[1]).toMatchObject({
      tckn: '10000000078',
      birthYear: 1990,
    });
    // The number is never shown again.
    const after = await (await request('/apply', { headers: { Cookie: cookie } })).text();
    expect(after).not.toContain('10000000078');
    expect(after).toContain('On record');
    // Step 3: the two e-Devlet documents, each with its barcode number.
    expect(after).toContain('Upload both documents first.');
    const pdf = {
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
      type: 'application/pdf',
      name: 'a.pdf',
    };
    const junk = { bytes: new Uint8Array([1, 2, 3, 4]), type: 'application/pdf', name: 'a.pdf' };
    const send = (kind: string, file: typeof pdf, barcode: string) =>
      upload('/apply/documents', cookie, { kind, barcode }, { file });
    expect((await send('criminal_record', junk, 'ABC-123456')).status).toBe(422);
    expect((await send('passport', pdf, 'ABC-123456')).status).toBe(422);
    expect((await send('criminal_record', pdf, '!')).status).toBe(422);
    expect((await send('criminal_record', pdf, 'ABC-123456')).headers.get('Location')).toBe(
      '/apply?done=document',
    );
    expect((await send('population_record', pdf, 'NVI-987654')).status).toBe(303);
    expect((await callsOf('addDocument')).at(-1)).toEqual([
      'new-1',
      'population_record',
      'NVI-987654',
      null,
    ]);
    const ready = await (await request('/apply', { headers: { Cookie: cookie } })).text();
    expect(ready).toContain('Uploaded, waiting to be checked');
    expect(ready).toContain('name="consent"');
    // Step 5: three separate acceptances, or nothing.
    expect((await post('/apply/submit', cookie, { terms: '2026-11-27' })).status).toBe(422);
    const partly = await post('/apply/submit', cookie, {
      terms: '2026-11-27',
      accept: '1',
      notice: '1',
    });
    expect(partly.status).toBe(422);
    expect(await partly.text()).toContain('Tick all three boxes');
    const sent = await post('/apply/submit', cookie, {
      terms: '2026-11-27',
      accept: '1',
      notice: '1',
      consent: '1',
    });
    expect(sent.headers.get('Location')).toBe('/status?done=submitted');
    expect((await callsOf('submit')).at(-1)).toEqual([
      'new-1',
      '2026-11-27',
      { agreement: true, notice: true, consent: true },
      'en',
    ]);
    // What was accepted can be read again, with when.
    const agreement = await (await request('/agreement', { headers: { Cookie: cookie } })).text();
    expect(agreement).toContain('Emanet Field Agent Agreement');
    expect(agreement).toContain('You accepted this version on');
    expect((await request('/agreement')).status).toBe(200);
    const status = await (await request('/status', { headers: { Cookie: cookie } })).text();
    expect(status).toContain('We’ll call you');
    expect(status).toContain('05321234567');
  });
});

describe('finding a vehicle', () => {
  it('lists vehicles in the agent’s city and claims one', async () => {
    const cookie = await signIn('active-1');
    const list = await (await request('/hunts', { headers: { Cookie: cookie } })).text();
    expect(list).toContain('35 KL 789');
    expect(list).toContain('Karşıyaka, İzmir');
    expect(list).not.toContain('Gizli Sk.');
    expect(await callsOf('hunts')).toEqual([['active-1', { city: 'İzmir' }]]);
    const id = await claimed(cookie);
    const page = await (await request(`/claims/${id}`, { headers: { Cookie: cookie } })).text();
    expect(page).toContain('Gizli Sk. No:7 D:3');
    expect(page).toContain('class="watermark"');
    expect(page).toContain('active-1');
    // Someone else can't take it now.
    const other = await signIn('active-2');
    const taken = await post('/hunts/v-1/claim', other);
    expect(taken.status).toBe(409);
    expect(await taken.text()).toContain('Another agent took this vehicle');
    // Nor see its places.
    expect((await request(`/claims/${id}`, { headers: { Cookie: other } })).status).toBe(404);
  });

  it('reports a sighting with the browser’s location, then shows how to call 112', async () => {
    const cookie = await signIn('active-1');
    const id = await claimed(cookie);
    const found = await request(`/claims/${id}/found`, { headers: { Cookie: cookie } });
    expect(await found.text()).toContain('<script src="/app.js" defer></script>');
    const response = await upload(
      `/claims/${id}/found`,
      cookie,
      { lat: '38.461234', lng: '27.140001', accuracy: '9', taken_at: String(Date.now()) },
      { photo: photo(1) },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(`/claims/${id}/call`);
    const [sighting] = await callsOf('sighting');
    expect(sighting?.[2]).toMatchObject({ lat: 38.461234, lng: 27.140001, accuracy_m: 9 });
    const [evidence] = await callsOf('evidence');
    const record = evidence?.[2] as {
      kind: string;
      file_ref: string;
      sha256: string;
      exif_time: number;
    };
    expect(record.kind).toBe('scene');
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof record.exif_time).toBe('number');
    const stored = await env.EVIDENCE.get(record.file_ref);
    expect(stored?.httpMetadata?.contentType).toBe('image/jpeg');
    const call = await (
      await request(`/claims/${id}/call`, { headers: { Cookie: cookie } })
    ).text();
    expect(call).toContain('href="tel:112"');
  });

  it('falls back to the photo’s GPS, and needs one of the two', async () => {
    const cookie = await signIn('active-1');
    const id = await claimed(cookie);
    const none = await upload(`/claims/${id}/found`, cookie, {}, { photo: photo(2) });
    expect(none.status).toBe(422);
    expect(await none.text()).toContain('Your location is needed');
    const withGps = await upload(`/claims/${id}/found`, cookie, {}, { photo: photo(3, true) });
    expect(withGps.status).toBe(303);
    expect((await callsOf('sighting'))[0]?.[2]).toMatchObject({ lat: 38.46, lng: 27.14 });
  });

  it('takes the reports after the police, refuses a reused photo, and removes its copy', async () => {
    const cookie = await signIn('active-1');
    const id = await claimed(cookie);
    await upload(`/claims/${id}/found`, cookie, { lat: '38.4', lng: '27.1' }, { photo: photo(4) });
    const page = await (await request(`/claims/${id}`, { headers: { Cookie: cookie } })).text();
    expect(page).toContain('Tow truck report');
    const tow = await upload(
      `/claims/${id}/evidence`,
      cookie,
      { kind: 'tow_report' },
      { photo: photo(5) },
    );
    expect(tow.headers.get('Location')).toBe(`/claims/${id}?done=uploaded`);
    const before = (await env.EVIDENCE.list({ prefix: `claims/${id}/` })).objects.length;
    const again = await upload(
      `/claims/${id}/evidence`,
      cookie,
      { kind: 'police_report' },
      { photo: photo(5) },
    );
    expect(again.status).toBe(409);
    expect(await again.text()).toContain('This photo was used before');
    // The refused copy is gone again.
    expect((await env.EVIDENCE.list({ prefix: `claims/${id}/` })).objects).toHaveLength(before);
    const receipt = await upload(
      `/claims/${id}/evidence`,
      cookie,
      { kind: 'yediemin_receipt' },
      { photo: photo(6) },
    );
    expect(receipt.status).toBe(303);
    const after = await (await request(`/claims/${id}`, { headers: { Cookie: cookie } })).text();
    expect(after).toContain('Staff are checking your evidence');
    // Not a photo, and not a kind an agent uploads here.
    const text = await upload(
      `/claims/${id}/evidence`,
      cookie,
      { kind: 'tow_report' },
      {
        photo: { bytes: new TextEncoder().encode('hi'), type: 'text/plain' },
      },
    );
    expect(await text.text()).toContain('Upload a photo');
    expect(
      (await upload(`/claims/${id}/evidence`, cookie, { kind: 'scene' }, { photo: photo(7) }))
        .status,
    ).toBe(422);
  });

  it('asks again for the scene photo when the sighting’s own wasn’t stored', async () => {
    const cookie = await signIn('active-1');
    const id = await claimed(cookie);
    await coreHooks().testRefuseNextPhoto();
    const refused = await upload(
      `/claims/${id}/found`,
      cookie,
      { lat: '38.4', lng: '27.1' },
      { photo: photo(20) },
    );
    expect(refused.status).toBe(422);
    // The sighting stands, so the claim is reporting, without a scene photo.
    const page = await (await request(`/claims/${id}`, { headers: { Cookie: cookie } })).text();
    expect(page).toContain('The photo of the vehicle where you found it is missing');
    expect(page).toContain('name="kind" value="scene"');
    const scene = await upload(
      `/claims/${id}/evidence`,
      cookie,
      { kind: 'scene' },
      { photo: photo(21) },
    );
    expect(scene.headers.get('Location')).toBe(`/claims/${id}?done=uploaded`);
    const after = await (await request(`/claims/${id}`, { headers: { Cookie: cookie } })).text();
    expect(after).not.toContain('is missing');
    // Once it is there, a second one is refused.
    expect(
      (await upload(`/claims/${id}/evidence`, cookie, { kind: 'scene' }, { photo: photo(22) }))
        .status,
    ).toBe(422);
  });

  it('tells the agent why a delivery wasn’t accepted', async () => {
    const cookie = await signIn('active-1');
    const id = await claimed(cookie);
    await coreHooks().testReject(id, 'The receipt shows another plate');
    const list = await (await request('/claims', { headers: { Cookie: cookie } })).text();
    expect(list).toContain('Not accepted');
    expect(list).toContain('The receipt shows another plate');
  });

  it('gives a vehicle up', async () => {
    const cookie = await signIn('active-1');
    const id = await claimed(cookie);
    const response = await post(`/claims/${id}/release`, cookie);
    expect(response.headers.get('Location')).toBe('/claims?done=released');
    const mine = await (await request('/claims', { headers: { Cookie: cookie } })).text();
    expect(mine).toContain('Given up');
  });

  it('shows earnings and the account', async () => {
    const cookie = await signIn('active-1');
    const money = await (await request('/earnings', { headers: { Cookie: cookie } })).text();
    expect(money).toContain('₺5,000.00');
    expect(money).toContain('Paid');
    const account = await (await request('/account', { headers: { Cookie: cookie } })).text();
    expect(account).toContain('readonly');
    const locked = await post('/account', cookie, {
      legal_name: 'Başka Biri',
      city: 'İzmir',
      phone: '05321234567',
      iban: 'TR330006100519786457841326',
      tax_profile: 'individual',
    });
    expect(locked.status).toBe(422);
  });

  it('shows the payment flow, a statement and a CSV of all payments', async () => {
    const cookie = await signIn('active-1');
    const page = await (await request('/earnings', { headers: { Cookie: cookie } })).text();
    expect(page).toContain('Withheld');
    expect(page).toContain('/earnings/po-1');
    expect(page).toContain('/earnings.csv');
    const statement = await (
      await request('/earnings/po-1', { headers: { Cookie: cookie } })
    ).text();
    expect(statement).toContain('Payment statement');
    expect(statement).toContain('not an invoice or a tax document');
    expect(statement).toContain('1326');
    expect(statement).not.toContain('TR330006100519786457841326');
    expect((await request('/earnings/other', { headers: { Cookie: cookie } })).status).toBe(404);
    const csv = await request('/earnings.csv', { headers: { Cookie: cookie } });
    expect(csv.headers.get('Content-Type')).toContain('text/csv');
    expect(csv.headers.get('Content-Disposition')).toContain('attachment');
    const body = await csv.text();
    expect(body).toContain('"po-1";"06AB123";5000,00;0,00;5000,00;"sent"');
    expect((await request('/earnings.csv')).status).toBe(302);
  });

  it('lets an agent write to support and read the answer', async () => {
    const cookie = await signIn('active-1');
    expect(await (await request('/support', { headers: { Cookie: cookie } })).text()).toContain(
      'No messages yet.',
    );
    const bad = await post('/support/new', cookie, {
      subject: 'x',
      category: 'payment',
      message: 'Hello',
    });
    expect(bad.status).toBe(422);
    const sent = await post('/support/new', cookie, {
      subject: 'Payment missing',
      category: 'payment',
      message: 'Where is my money?',
    });
    expect(sent.status).toBe(303);
    const where = sent.headers.get('Location') ?? '';
    expect(where).toMatch(/^\/support\/tk-\d+\?done=ticket_sent$/);
    const id = where.split('?')[0] ?? '';
    await coreHooks().testStaffReply(id.replace('/support/', ''), 'We are on it.');
    const thread = await (await request(id, { headers: { Cookie: cookie } })).text();
    expect(thread).toContain('We are on it.');
    expect(thread).toContain('2earl answered');
    const reply = await post(`${id}/reply`, cookie, { message: 'Thank you' });
    expect(reply.headers.get('Location')).toBe(`${id}?done=ticket_replied`);
    const closed = await post(`${id}/close`, cookie);
    expect(closed.headers.get('Location')).toBe('/support?done=ticket_closed');
    const other = await signIn('active-2');
    expect((await request(id, { headers: { Cookie: other } })).status).toBe(404);
  });

  it('lets an applicant reach support too', async () => {
    const cookie = await signIn('pending-7');
    expect((await request('/support', { headers: { Cookie: cookie } })).status).toBe(200);
  });

  it('refuses forms from other sites and visitors who are not signed in', async () => {
    expect((await request('/hunts')).headers.get('Location')).toBe('/signin?return=%2Fhunts');
    const cookie = await signIn('active-1');
    const response = await post('/hunts/v-1/claim', cookie, {}, { Origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(await callsOf('claim')).toEqual([]);
  });
});

describe('what staff asked for', () => {
  const pdf = {
    bytes: new TextEncoder().encode('%PDF-1.7 test'),
    type: 'application/pdf',
    name: 'belge.pdf',
  };

  it('shows a banner everywhere and lists each request with its way to answer', async () => {
    await coreHooks().testReset();
    const cookie = await signIn('asked-1');
    const apply = await (await request('/apply', { headers: { Cookie: cookie } })).text();
    expect(apply).toContain('class="ask-banner"');
    expect(apply).toContain('We need 4 things from you');
    expect(apply).toContain('Answer what we asked for first.');
    expect(apply).not.toContain('action="/apply/submit"');
    const page = await (await request('/requests', { headers: { Cookie: cookie } })).text();
    expect(page).not.toContain('class="ask-banner"');
    expect(page).toContain('Adresinizde daire numarası eksik.');
    expect(page).toContain('action="/requests/r-bank/document"');
    expect(page).toContain('action="/requests/r-address/answer"');
    // Only an e-Devlet document asks for a barcode.
    const bank = page.slice(
      page.indexOf('/requests/r-bank/document'),
      page.indexOf('/requests/r-residence/document'),
    );
    expect(bank).not.toContain('name="barcode"');
    expect(page.slice(page.indexOf('/requests/r-residence/document'))).toContain('name="barcode"');
    expect(page).toContain('Earlier requests');
  });

  it('answers a question, uploads a requested document, and takes the kind from the request', async () => {
    await coreHooks().testReset();
    const cookie = await signIn('asked-2');
    expect((await post('/requests/r-question/answer', cookie, { answer: '' })).status).toBe(422);
    expect((await post('/requests/r-bank/answer', cookie, { answer: 'x' })).status).toBe(422);
    const answered = await post('/requests/r-question/answer', cookie, { answer: 'Bornova' });
    expect(answered.headers.get('Location')).toBe('/requests?done=answered');
    // The form can't choose another kind: it comes from the request.
    const sent = await upload(
      '/requests/r-bank/document',
      cookie,
      { kind: 'criminal_record' },
      { file: pdf },
    );
    expect(sent.headers.get('Location')).toBe('/requests?done=document');
    expect(await callsOf('addDocument')).toEqual([['asked-2', 'bank_proof', '', 'r-bank']]);
    expect(
      (await upload('/requests/r-residence/document', cookie, { barcode: '' }, { file: pdf }))
        .status,
    ).toBe(422);
    expect((await upload('/requests/r-bank/document', cookie, {}, { file: pdf })).status).toBe(422);
    expect((await upload('/requests/nope/document', cookie, {}, { file: pdf })).status).toBe(422);
    const page = await (await request('/requests', { headers: { Cookie: cookie } })).text();
    expect(page).toContain('Sent, waiting for 2earl');
    expect((await request('/requests')).status).toBe(302);
  });
});

describe('my data', () => {
  it('asks for erasure only with the box ticked, shows the request, and lets it be withdrawn', async () => {
    await coreHooks().testReset();
    const cookie = await signIn('pending-3');
    const page = await (await request('/privacy', { headers: { Cookie: cookie } })).text();
    expect(page).toContain('Ask for your data to be erased');
    expect(page).toContain('at most 10 years');
    expect((await post('/privacy/erase', cookie, { note: 'x' })).status).toBe(422);
    expect(await callsOf('requestErasure')).toEqual([]);
    const sent = await post('/privacy/erase', cookie, { confirm: '1', note: 'Bırakıyorum' });
    expect(sent.headers.get('Location')).toBe('/privacy?done=erasure_requested');
    expect(await callsOf('requestErasure')).toEqual([['pending-3', 'Bırakıyorum']]);
    const open = await (await request('/privacy', { headers: { Cookie: cookie } })).text();
    expect(open).toContain('Being decided');
    expect(open).not.toContain('action="/privacy/erase"');
    expect((await post('/privacy/erase', cookie, { confirm: '1' })).status).toBe(422);
    expect((await post('/privacy/withdraw', cookie)).headers.get('Location')).toBe(
      '/privacy?done=erasure_withdrawn',
    );
    expect((await post('/privacy/withdraw', cookie)).status).toBe(422);
  });

  it('warns an agent with payments waiting, and closes an erased account to everything', async () => {
    await coreHooks().testReset();
    const active = await (
      await request('/privacy', { headers: { Cookie: await signIn('active-5') } })
    ).text();
    expect(active).toContain('2 payment(s) not yet sent');
    const erased = await signIn('erased-1');
    for (const path of ['/hunts', '/account', '/privacy', '/requests', '/apply']) {
      const response = await request(path, { headers: { Cookie: erased } });
      expect(await response.text(), path).toContain('Your data was erased');
    }
    expect((await post('/privacy/erase', erased, { confirm: '1' })).status).toBe(200);
    expect(await callsOf('requestErasure')).toEqual([]);
  });
});
