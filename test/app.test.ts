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
    expect(page).toContain('Save your details first.');
    const bad = await post('/apply/profile', cookie, {
      legal_name: 'Ayşe Yılmaz',
      city: 'İzmir',
      phone: '05321234567',
      iban: 'TR12',
      tax_profile: 'individual',
    });
    expect(bad.status).toBe(422);
    expect(await bad.text()).toContain('IBAN isn’t valid');
    const saved = await post('/apply/profile', cookie, {
      legal_name: 'Ayşe Yılmaz',
      city: 'İzmir',
      phone: '05321234567',
      iban: 'TR33 0006 1005 1978 6457 8413 26',
      tax_profile: 'individual',
    });
    expect(saved.headers.get('Location')).toBe('/apply?done=saved');
    expect((await post('/apply/submit', cookie, { terms: '2026-11-27' })).status).toBe(422);
    const sent = await post('/apply/submit', cookie, { terms: '2026-11-27', accept: '1' });
    expect(sent.headers.get('Location')).toBe('/status?done=submitted');
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

  it('refuses forms from other sites and visitors who are not signed in', async () => {
    expect((await request('/hunts')).headers.get('Location')).toBe('/signin?return=%2Fhunts');
    const cookie = await signIn('active-1');
    const response = await post('/hunts/v-1/claim', cookie, {}, { Origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(await callsOf('claim')).toEqual([]);
  });
});
