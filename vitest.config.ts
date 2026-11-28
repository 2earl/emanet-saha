import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Tests run the Worker with stand-ins for its two neighbours:
 * - login: a token endpoint that checks PKCE, and validateToken. A code is
 *   "<uid>.<code_challenge>".
 * - emanet-core's FieldApi: an in-memory version of the contract in src/core.ts. Agents named
 *   "active-*" are active with a checked IBAN, "pending-*" wait for the identity check, others are
 *   new. One vehicle can be hunted in İzmir. testReset() puts it back; testCalls() lists calls.
 */

const LOGIN = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
export default class extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/oauth/token') return new Response('no', { status: 404 });
    const form = await request.formData();
    const code = String(form.get('code'));
    const dot = code.lastIndexOf('.');
    const uid = code.slice(0, dot);
    const challenge = code.slice(dot + 1);
    const digest = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(String(form.get('code_verifier'))));
    const ok = form.get('grant_type') === 'authorization_code'
      && form.get('resource') === 'https://saha.emanet.dev'
      && form.get('client_id') === 'https://saha.emanet.dev/oauth/client.json'
      && b64(digest) === challenge;
    if (!ok) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: 'token-' + uid, token_type: 'Bearer' });
  }
  async validateToken(resource, token) {
    if (!token.startsWith('token-')) return null;
    return { audience: resource, scope: ['emanet:field'], props: { uid: token.slice(6), aal2At: null } };
  }
}
`;

const CORE = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const ok = (value) => ({ ok: true, value });
const fail = (error, detail) => (detail === undefined ? { ok: false, error } : { ok: false, error, detail });
const now = () => Math.floor(Date.now() / 1000);
const TERMS = '2026-11-27';
let s;
function seed() {
  s = {
    calls: [],
    agents: new Map(),
    vehicle: { vehicle_id: 'v-1', plate: '35KL789', make: 'Toyota', model: 'Corolla', year: 2021,
      colour: 'Beyaz', areas: [{ district: 'Karşıyaka', city: 'İzmir' }], earn_kurus: 600000 },
    claims: new Map(),
    hashes: new Set(),
    documents: new Map(),
    accepted: new Map(),
    requests: new Map(),
    erasure: new Map(),
    tickets: new Map(),
  };
}
seed();
const log = (method, args) => s.calls.push([method, ...args]);
function agentFor(id) {
  if (!s.agents.has(id)) {
    const status = id.startsWith('active-') ? 'active' : id.startsWith('pending-') ? 'kyc_pending' : id.startsWith('returned-') || id.startsWith('asked-') ? 'applied' : id.startsWith('erased-') ? 'banned' : id.startsWith('activeasked-') ? 'active' : null;
    if (status === null) return null;
    s.agents.set(id, { status, legal_name: 'Ayşe Yılmaz', city: 'İzmir', phone: '+905321234567',
      iban: 'TR330006100519786457841326', iban_verified: status === 'active', tax_profile: 'individual',
      vkn: null, terms_version: TERMS, current_terms: TERMS, submitted_at: now() - 60, strikes: 0, open_claims: 0,
      email: 'ayse@example.com', id_given: true, birth_year: 1990, address: 'Örnek Mah. Deneme Sk. No:1 İzmir',
      review_note: status === 'applied' ? 'The IBAN is not in your own name.' : null });
  }
  return s.agents.get(id);
}
/** Agents named "asked-*" (and "returned-*") were asked for an address, a bank proof, a residence record and a question. */
function requestsFor(id) {
  if (!s.requests.has(id)) {
    const ask = (rid, kind, subject, note, status = 'open') => ({ id: rid, kind, subject, note, status, answer: null,
      created_at: now() - 3600, due_at: now() + 14 * 86400, answered_at: null });
    s.requests.set(id, id.startsWith('asked-') || id.startsWith('activeasked-') ? [
      ask('r-address', 'info', 'address', 'Adresinizde daire numarası eksik.'),
      ask('r-question', 'info', 'other', 'Hangi ilçelerde çalışacaksınız?'),
      ask('r-bank', 'document', 'bank_proof', 'IBAN dekontu yükleyin.'),
      ask('r-residence', 'document', 'residence_record', 'Yerleşim yeri belgesi yükleyin.'),
      ask('r-old', 'info', 'phone', 'Telefon numaranızı doğrulayın.', 'accepted'),
    ] : []);
  }
  return s.requests.get(id);
}
export class FieldApi extends WorkerEntrypoint {
  async register(id) {
    log('register', [id]);
    if (!agentFor(id)) s.agents.set(id, { status: 'applied', legal_name: null, city: null, phone: null, iban: null,
      iban_verified: false, tax_profile: 'individual', vkn: null, terms_version: null, current_terms: TERMS,
      submitted_at: null, strikes: 0, open_claims: 0, email: null, id_given: false, birth_year: null });
    return ok(null);
  }
  async profile(id) {
    const a = agentFor(id);
    if (!a) return fail('not_found');
    if (id.startsWith('erased-')) return ok({ ...a, status: 'banned', erased: true, requests_open: 0 });
    return ok({ ...a, requests_open: requestsFor(id).filter((r) => r.status === 'open').length });
  }
  async requests(id) { return ok(requestsFor(id)); }
  async answerRequest(id, requestId, answer) {
    log('answerRequest', [id, requestId, answer]);
    const r = requestsFor(id).find((x) => x.id === requestId);
    if (!r) return fail('not_found');
    if (r.kind !== 'info') return fail('document_needed');
    if (r.status !== 'open') return fail('request_not_open');
    if (r.subject === 'other' && !answer) return fail('answer_needed');
    r.status = 'answered'; r.answer = answer || null; r.answered_at = now();
    return ok(null);
  }
  async erasure(id) {
    return ok({ request: s.erasure.get(id) ?? null,
      blockers: { open_claims: id.startsWith('active-') ? 1 : 0, payouts_pending: id.startsWith('active-') ? 2 : 0, payouts_sent: 0 },
      answer_days: 30, archive_years: 10 });
  }
  async requestErasure(id, note) {
    log('requestErasure', [id, note]);
    if (s.erasure.get(id)?.status === 'open') return fail('already_requested');
    s.erasure.set(id, { id: 'pr-1', status: 'open', received_at: now(), due_at: now() + 30 * 86400, outcome: null, closed_at: null });
    return ok({ id: 'pr-1', due_at: now() + 30 * 86400 });
  }
  async withdrawErasure(id) {
    log('withdrawErasure', [id]);
    const r = s.erasure.get(id);
    if (!r || r.status !== 'open') return fail('not_found');
    r.status = 'withdrawn';
    return ok(null);
  }
  async testRefuseErasure(id) { const r = s.erasure.get(id); r.status = 'refused'; r.outcome = 'Bekleyen ödemeniz var.'; }
  async updateProfile(id, input) {
    log('updateProfile', [id, input]);
    const a = agentFor(id);
    if (!/^TR\\d{24}$/.test(input.iban.replace(/\\s/g, ''))) return fail('invalid_iban');
    if (a.status === 'active' && input.legalName !== a.legal_name) return fail('profile_locked');
    if (!a.id_given && !input.tckn) return fail('invalid_tckn');
    if (input.tckn === '10000000146') return fail('tckn_taken');
    if (input.tckn) { a.id_given = true; a.birth_year = input.birthYear; }
    Object.assign(a, { legal_name: input.legalName, city: input.city, phone: input.phone,
      iban: input.iban.replace(/\\s/g, ''), tax_profile: input.taxProfile, vkn: input.vkn ?? null,
      address: input.address ?? a.address ?? null });
    return ok(null);
  }
  async requestEmailCode(id, input) {
    log('requestEmailCode', [id, input]);
    if (!input.email.includes('@')) return fail('invalid_email');
    if (input.email === 'taken@example.com') return fail('email_taken');
    s.pending = { id, email: input.email.toLowerCase() };
    return ok({ email: s.pending.email });
  }
  async confirmEmailCode(id, code) {
    log('confirmEmailCode', [id, code]);
    if (!s.pending || s.pending.id !== id) return fail('code_expired');
    if (code !== '123456') return fail('wrong_code');
    agentFor(id).email = s.pending.email;
    return ok({ email: s.pending.email });
  }
  async reportError(event, detail) { log('reportError', [event, detail]); }
  async agreement(locale) {
    const part = (title) => ({ title, intro: 'Intro.', sections: [{ title: '1. Konu', paragraphs: ['Paragraf.'] }] });
    return ok({ version: TERMS, sha256: 'a'.repeat(64), agreement: part(locale === 'tr' ? 'Emanet Saha Görevlisi Sözleşmesi' : 'Emanet Field Agent Agreement'),
      notice: part('Aydınlatma'), consent: 'Açık rıza metni.' });
  }
  async acceptance(id) { return ok(s.accepted.get(id) ?? null); }
  async documents(id) { return ok(s.documents.get(id) ?? []); }
  async addDocument(id, input) {
    log('addDocument', [id, input.kind, input.barcode, input.request_id ?? null]);
    const barcoded = ['criminal_record', 'population_record', 'residence_record'].includes(input.kind);
    if (barcoded && !/^[A-Za-z0-9-]{6,40}$/.test(input.barcode)) return fail('invalid_barcode');
    if (input.request_id) {
      const r = requestsFor(id).find((x) => x.id === input.request_id && x.status === 'open' && x.subject === input.kind);
      if (!r) return fail('request_not_open');
      r.status = 'answered'; r.answered_at = now();
      return ok({ id: 'doc-' + input.kind });
    }
    const list = (s.documents.get(id) ?? []).filter((d) => d.kind !== input.kind);
    list.push({ id: 'doc-' + input.kind, kind: input.kind, barcode: input.barcode, uploaded_at: now(), status: 'uploaded', outcome: null, note: null });
    s.documents.set(id, list);
    return ok({ id: 'doc-' + input.kind });
  }
  async submit(id, terms, consents, locale) {
    log('submit', [id, terms, consents, locale]);
    const a = agentFor(id);
    if (!consents || !consents.agreement || !consents.notice || !consents.consent) return fail('consents_missing');
    if (terms !== TERMS) return fail('terms_changed');
    if (!a.legal_name) return fail('profile_incomplete');
    if (!a.address) return fail('profile_incomplete', 'address');
    if ((s.documents.get(id) ?? []).length < 2) return fail('documents_missing');
    if (requestsFor(id).some((r) => r.status === 'open')) return fail('requests_open');
    s.accepted.set(id, { version: TERMS, sha256: 'a'.repeat(64), locale, accepted_at: now(), current: true });
    if (!a.email) return fail('email_not_verified');
    a.status = 'kyc_pending';
    return ok(null);
  }
  async hunts(id, query) {
    log('hunts', [id, query]);
    const taken = [...s.claims.values()].some((c) => c.closed_at === null);
    return ok(!taken && (!query.city || query.city === 'İzmir') ? [s.vehicle] : []);
  }
  async claim(id, vehicleId) {
    log('claim', [id, vehicleId]);
    if (vehicleId !== 'v-1') return fail('not_huntable');
    if ([...s.claims.values()].some((c) => c.closed_at === null)) return fail('already_claimed');
    const c = { id: 'cl-' + (s.claims.size + 1), vehicle_id: vehicleId, agent: id, state: 'searching',
      claimed_at: now(), expires_at: now() + 86400, closed_at: null, close_reason: null, evidence: [] };
    s.claims.set(c.id, c);
    return ok({ id: c.id, vehicle_id: c.vehicle_id, state: c.state, claimed_at: c.claimed_at, expires_at: c.expires_at });
  }
  async release(id, claimId) {
    log('release', [id, claimId]);
    const c = s.claims.get(claimId);
    if (!c || c.agent !== id || c.closed_at !== null) return fail('not_found');
    c.closed_at = now(); c.close_reason = 'released';
    return ok(null);
  }
  async claimDetails(id, claimId) {
    const c = s.claims.get(claimId);
    if (!c || c.agent !== id || c.closed_at !== null) return fail('not_found');
    return ok({ claim: { id: c.id, vehicle_id: c.vehicle_id, state: c.state, claimed_at: c.claimed_at, expires_at: c.expires_at },
      plate: '35KL789', make: 'Toyota', model: 'Corolla', year: 2021, colour: 'Beyaz',
      places: [{ kind: 'owner_home', address: 'Gizli Sk. No:7 D:3', district: 'Karşıyaka', city: 'İzmir',
        lat: null, lng: null, note: 'Mavi kapı', attributes: {} }] });
  }
  async sighting(id, claimId, sighting) {
    log('sighting', [id, claimId, sighting]);
    const c = s.claims.get(claimId);
    if (!c || c.agent !== id || c.closed_at !== null) return fail('not_found');
    if (sighting.taken_at > now() + 600) return fail('invalid_time');
    c.state = 'reporting';
    return ok({ id: c.id, vehicle_id: c.vehicle_id, state: c.state, claimed_at: c.claimed_at, expires_at: c.expires_at });
  }
  async evidence(id, claimId, e) {
    log('evidence', [id, claimId, e]);
    const c = s.claims.get(claimId);
    if (!c || c.agent !== id || c.closed_at !== null) return fail('not_found');
    if (c.state !== 'reporting') return fail('no_sighting');
    if (s.refuseNext) { s.refuseNext = false; return fail('duplicate_photo'); }
    if (s.hashes.has(e.sha256)) return fail('duplicate_photo');
    s.hashes.add(e.sha256);
    c.evidence.push(e.kind);
    return ok({ id: 'e-' + s.hashes.size });
  }
  async myClaims(id) {
    return ok([...s.claims.values()].filter((c) => c.agent === id).map((c) => ({
      id: c.id, plate: '35KL789', make: 'Toyota', model: 'Corolla', state: c.state, claimed_at: c.claimed_at,
      expires_at: c.expires_at, closed_at: c.closed_at, close_reason: c.close_reason, close_note: c.close_note ?? null, evidence: [...c.evidence],
      under_review: c.evidence.includes('yediemin_receipt'), payout_status: null })));
  }
  async earnings(id) {
    return ok({ payouts: [{ id: 'po-1', plate: '06AB123', gross_kurus: 500000, withholding_kurus: 0,
      net_kurus: 500000, status: 'sent', created_at: now() - 86400, updated_at: now() - 3600 }],
      pending_kurus: 0, paid_kurus: 500000 });
  }
  async openTicket(id, input) {
    log('openTicket', [id, input]);
    if (input.subject.length < 3) return fail('invalid_subject');
    if (input.message.length < 3) return fail('invalid_message');
    if (!['payment', 'delivery', 'account', 'technical', 'other'].includes(input.category)) return fail('invalid_category');
    const tid = 'tk-' + String(s.tickets.size + 1);
    s.tickets.set(tid, { owner: id, ticket: { id: tid, subject: input.subject, category: input.category, status: 'open',
      created_at: now(), updated_at: now(), closed_at: null },
      messages: [{ id: 'm1', author_kind: 'requester', body: input.message, created_at: now() }] });
    return ok({ id: tid });
  }
  async myTickets(id) { return ok([...s.tickets.values()].filter((t) => t.owner === id).map((t) => t.ticket)); }
  async myTicket(id, tid) {
    const t = s.tickets.get(tid);
    return t && t.owner === id ? ok({ ticket: t.ticket, messages: t.messages }) : fail('not_found');
  }
  async replyTicket(id, tid, body) {
    const t = s.tickets.get(tid);
    if (!t || t.owner !== id) return fail('not_found');
    if (body.length < 2) return fail('invalid_message');
    t.messages.push({ id: 'm' + String(t.messages.length + 1), author_kind: 'requester', body, created_at: now() });
    t.ticket.status = 'open';
    return ok(null);
  }
  async closeTicket(id, tid) {
    const t = s.tickets.get(tid);
    if (!t || t.owner !== id) return fail('not_found');
    t.ticket.status = 'closed';
    return ok(null);
  }
  async testStaffReply(tid, body) {
    const t = s.tickets.get(tid);
    t.messages.push({ id: 'm' + String(t.messages.length + 1), author_kind: 'staff', body, created_at: now() });
    t.ticket.status = 'answered';
  }
  async testCalls() { return s.calls; }
  async testReset() { seed(); }
  async testRefuseNextPhoto() { s.refuseNext = true; }
  async testReject(claimId, note) { const c = s.claims.get(claimId); c.closed_at = now(); c.close_reason = 'rejected'; c.close_note = note; }
}
export default { fetch() { return new Response(null, { status: 404 }); } };
`;

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_PEPPER: 'test-session-pepper',
          },
          workers: [
            { name: 'login', modules: true, compatibilityDate: '2026-11-01', script: LOGIN },
            { name: 'emanet-core', modules: true, compatibilityDate: '2026-11-01', script: CORE },
          ],
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
