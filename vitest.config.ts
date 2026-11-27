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
  };
}
seed();
const log = (method, args) => s.calls.push([method, ...args]);
function agentFor(id) {
  if (!s.agents.has(id)) {
    const status = id.startsWith('active-') ? 'active' : id.startsWith('pending-') ? 'kyc_pending' : null;
    if (status === null) return null;
    s.agents.set(id, { status, legal_name: 'Ayşe Yılmaz', city: 'İzmir', phone: '+905321234567',
      iban: 'TR330006100519786457841326', iban_verified: status === 'active', tax_profile: 'individual',
      vkn: null, terms_version: TERMS, current_terms: TERMS, submitted_at: now() - 60, strikes: 0, open_claims: 0 });
  }
  return s.agents.get(id);
}
export class FieldApi extends WorkerEntrypoint {
  async register(id) {
    log('register', [id]);
    if (!agentFor(id)) s.agents.set(id, { status: 'applied', legal_name: null, city: null, phone: null, iban: null,
      iban_verified: false, tax_profile: 'individual', vkn: null, terms_version: null, current_terms: TERMS,
      submitted_at: null, strikes: 0, open_claims: 0 });
    return ok(null);
  }
  async profile(id) { const a = agentFor(id); return a ? ok({ ...a }) : fail('not_found'); }
  async updateProfile(id, input) {
    log('updateProfile', [id, input]);
    const a = agentFor(id);
    if (!/^TR\\d{24}$/.test(input.iban.replace(/\\s/g, ''))) return fail('invalid_iban');
    if (a.status === 'active' && input.legalName !== a.legal_name) return fail('profile_locked');
    Object.assign(a, { legal_name: input.legalName, city: input.city, phone: input.phone,
      iban: input.iban.replace(/\\s/g, ''), tax_profile: input.taxProfile, vkn: input.vkn ?? null });
    return ok(null);
  }
  async submit(id, terms) {
    log('submit', [id, terms]);
    const a = agentFor(id);
    if (terms !== TERMS) return fail('terms_changed');
    if (!a.legal_name) return fail('profile_incomplete');
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
