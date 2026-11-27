import { beforeAll, describe, expect, it } from 'vitest';
import { collectMissing } from '../src/i18n';
import { callback, coreHooks, post, request, signIn, upload } from './helpers';
import { jpegWithExif } from './jpeg';

/** Every page in Turkish, and nothing left in English (src/locales/tr.ts). */

const tr = { 'Accept-Language': 'tr-TR,tr;q=0.9' };
const photo = (salt: number) => ({ bytes: jpegWithExif({ salt }), type: 'image/jpeg' });

describe('Turkish', () => {
  beforeAll(async () => {
    await coreHooks().testReset();
  });

  it('serves every page without an untranslated sentence', async () => {
    const missing = collectMissing();
    const get = async (path: string, cookie = '') => {
      const response = await request(path, {
        headers: { ...tr, ...(cookie ? { Cookie: cookie } : {}) },
      });
      expect(response.headers.get('Content-Language'), path).toBe('tr');
      return response.text();
    };
    const send = async (path: string, cookie: string, form: Record<string, string> = {}) =>
      (await post(path, cookie, form, tr)).text();
    const sendFile = async (
      path: string,
      cookie: string,
      fields: Record<string, string>,
      salt: number,
    ) => (await upload(path, cookie, fields, { photo: photo(salt) }, tr)).text();

    await get('/');
    await get('/terms');
    await get('/nope');
    await (await callback('x')).text();

    const fresh = await signIn('new-1');
    await get('/apply', fresh);
    const details = {
      legal_name: 'Ayşe Yılmaz',
      city: 'İzmir',
      phone: '05321234567',
      iban: 'TR330006100519786457841326',
      tax_profile: 'individual',
      birth_year: '1990',
    };
    await send('/apply/profile', fresh, { ...details, iban: 'TR12', tckn: '10000000078' });
    await send('/apply/profile', fresh, details);
    await send('/apply/profile', fresh, { ...details, tckn: '10000000146' });
    await send('/apply/profile', fresh, { ...details, tckn: '10000000078' });
    await get('/apply', fresh);
    await send('/apply/submit', fresh, { terms: '2026-11-27', accept: '1' });
    await send('/apply/email', fresh, { email: 'nope' });
    await send('/apply/email', fresh, { email: 'taken@example.com' });
    await send('/apply/email', fresh, { email: 'ayse@example.com' });
    await get('/apply?done=code_sent&code=1&email=ayse%40example.com', fresh);
    await send('/apply/email/confirm', fresh, { code: '000000', email: 'ayse@example.com' });
    await send('/apply/email/confirm', fresh, { code: '123456' });
    await get('/apply?done=email_confirmed', fresh);
    await get('/apply', fresh);
    await get('/apply?done=saved', fresh);
    await send('/apply/submit', fresh, { terms: '2026-11-27' });
    await send('/apply/submit', fresh, { terms: 'old', accept: '1' });
    await send('/apply/submit', fresh, { terms: '2026-11-27', accept: '1' });
    await get('/status?done=submitted', fresh);
    await get('/account', fresh);

    const pending = await signIn('pending-1');
    await get('/status', pending);

    const agent = await signIn('active-1');
    await get('/hunts', agent);
    await get('/hunts?city=Ankara', agent);
    const claim = await post('/hunts/v-1/claim', agent, {}, tr);
    const id = (claim.headers.get('Location') ?? '').replace('/claims/', '');
    await send('/hunts/v-1/claim', agent);
    await get(`/claims/${id}`, agent);
    await get(`/claims/${id}/found`, agent);
    await sendFile(`/claims/${id}/found`, agent, {}, 1);
    await coreHooks().testRefuseNextPhoto();
    await sendFile(`/claims/${id}/found`, agent, { lat: '38.4', lng: '27.1' }, 9);
    await get(`/claims/${id}`, agent);
    await sendFile(`/claims/${id}/evidence`, agent, { kind: 'scene' }, 8);
    await sendFile(`/claims/${id}/found`, agent, { lat: '38.4', lng: '27.1' }, 2);
    await get(`/claims/${id}/call`, agent);
    await get(`/claims/${id}`, agent);
    await sendFile(`/claims/${id}/evidence`, agent, { kind: 'tow_report' }, 3);
    await sendFile(`/claims/${id}/evidence`, agent, { kind: 'tow_report' }, 3);
    await sendFile(`/claims/${id}/evidence`, agent, { kind: 'yediemin_receipt' }, 4);
    await get(`/claims/${id}?done=uploaded`, agent);
    await get('/claims', agent);
    await get('/earnings', agent);
    await get('/account', agent);
    await send('/account', agent, {
      legal_name: 'Başka Biri',
      city: 'İzmir',
      phone: '05321234567',
      iban: 'TR330006100519786457841326',
      tax_profile: 'individual',
    });
    await get('/account?done=saved', agent);

    const other = await signIn('active-2');
    await coreHooks().testReject(id, 'Plaka farklı');
    await get('/claims', agent);
    await get('/claims', other);
    await get('/earnings', other);
    await coreHooks().testReset();
    const id2 = (
      (await post('/hunts/v-1/claim', other, {}, tr)).headers.get('Location') ?? ''
    ).replace('/claims/', '');
    await send(`/claims/${id2}/release`, other);
    await get('/claims?done=released', other);
    await get('/hunts', other);
    await post('/hunts/v-1/claim', other, {}, { ...tr, Origin: 'https://evil.example' }).then((r) =>
      r.text(),
    );

    expect([...missing].sort()).toEqual([]);
  });
});
