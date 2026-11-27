import type {
  AgentProfile,
  ClaimDetails,
  Earnings,
  EvidenceKind,
  Hunt,
  MyClaim,
  TaxProfile,
} from './core';
import { currentLocale, languageSwitcher } from './i18n';

/**
 * Server-rendered pages, for phones first. Every dynamic value goes through `esc`, and data
 * (plates, addresses, amounts) is marked translate="no" so the language engine leaves it alone.
 * The only script is /app.js, which fills in the location when an agent reports a sighting.
 */

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const data = (value: string) => `<span translate="no">${esc(value)}</span>`;
const attr = (value: string) => esc(value);

const MARK =
  '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
  '<path fill="#F15A24" d="M0 0 50 50V100L0 50Z"/>' +
  '<path fill="#F7931E" d="M100 0 50 50V100L100 50Z"/>' +
  '<path fill="#ED1C24" d="M0 50 50 100H15A15 15 0 0 1 0 85Z"/>' +
  '<path fill="#FBB03B" d="M100 50V85A15 15 0 0 1 85 100H50Z"/>' +
  '</svg>';

export type Section = 'hunts' | 'claims' | 'earnings' | 'account';

export interface Nav {
  signedIn: boolean;
  active?: boolean;
  current?: Section;
}

export function plate(value: string | null, size: '' | 'large' = ''): string {
  if (!value) return '—';
  const m = /^(\d{2})([A-Z]{1,3})(\d{2,4})$/.exec(value);
  const text = m ? `${m[1] ?? ''} ${m[2] ?? ''} ${m[3] ?? ''}` : value;
  return `<span class="plate${size ? ` ${size}` : ''}" translate="no"><span>${esc(text)}</span></span>`;
}

/** Turkish lira in the page's language: ₺10,000.00 in English, ₺10.000,00 in Turkish. */
export const lira = (kurus: number) =>
  `<span translate="no">₺${(kurus / 100).toLocaleString(currentLocale() === 'tr' ? 'tr-TR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;

/** A time in Turkey, where agents work: 14:05, 27.11. */
export const clock = (unix: number) =>
  `<time translate="no">${esc(
    new Date(unix * 1000).toLocaleString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    }),
  )}</time>`;

function layout(title: string, nav: Nav, body: string, options: { script?: boolean } = {}): string {
  const link = (key: Section, href: string, label: string) =>
    `<a href="${href}"${nav.current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const sections = nav.active
    ? `<nav aria-label="Sections">
        ${link('hunts', '/hunts', 'Vehicles')}
        ${link('claims', '/claims', 'My work')}
        ${link('earnings', '/earnings', 'Earnings')}
        ${link('account', '/account', 'Account')}
      </nav>`
    : '';
  const who = nav.signedIn
    ? `<div class="who"><form method="post" action="/signout"><button class="link" type="submit">Sign out</button></form></div>`
    : `<div class="who"><a class="button" href="/signin">Sign in</a></div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#1f2328">
<title>${esc(title)} · Emanet Saha</title>
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
${options.script ? '<script src="/app.js" defer></script>' : ''}
</head>
<body>
<header class="bar">
  <a class="brand" href="/">${MARK}<span translate="no">Emanet Saha</span></a>
  ${who}
  ${sections}
</header>
<main>
${body}
</main>
<footer>
  <span>Emanet finds vehicles and tells the police. Agents never touch, tow or follow anyone.</span>
  <a href="/terms">Rules for agents</a>
  ${languageSwitcher()}
</footer>
</body>
</html>`;
}

const notice = (text: string | null) => (text ? `<p class="notice">${esc(text)}</p>` : '');
const error = (text: string | null) =>
  text ? `<p class="error" role="alert">${esc(text)}</p>` : '';

export function problem(nav: Nav, title: string, text: string): string {
  return layout(
    title,
    nav,
    `<h1>${esc(title)}</h1><p class="lede">${esc(text)}</p><p><a href="/">Back to the start</a></p>`,
  );
}

export function home(): string {
  return layout(
    'Field agents',
    { signedIn: false },
    `<section class="hero">
      <h1>Find vehicles with seizure orders. Get paid when they reach custody.</h1>
      <p class="lede">Creditors list vehicles that a court office has ordered to be taken. You look for them, and when you see one, you call the police. You are paid once the vehicle is in a custodian car park.</p>
      <p><a class="button" href="/signin">Sign in with 2earl</a></p>
      <ul>
        <li>Identity checked before you start: your ID card, your phone, an IBAN in your own name.</li>
        <li>You never touch a vehicle, never tow it, never follow a person.</li>
        <li>Addresses are shown only while you hold a vehicle, and every view is recorded.</li>
      </ul>
    </section>`,
  );
}

// ---- Rules -----------------------------------------------------------------------------------------

/** The rules of conduct an agent accepts (core TERMS_VERSION). The agreement adds the legal terms. */
export const RULES: readonly string[] = [
  'Look for vehicles, never for people. Don’t follow, watch or wait for anyone: persistent following is a crime in Turkey (TCK 123/A).',
  'Never touch, open, block, tow or move a vehicle. Only the police take it.',
  'When you find a vehicle, call 112 and say a vehicle with a seizure order is here. Then do what the police say.',
  'Never speak to the owner about the debt, and leave at once if anyone becomes angry or threatening.',
  'Take photos only in this app, of the vehicle, its plate and documents. Never photograph people’s faces.',
  'Addresses are confidential. Never write them down, share them or use them for anything else. You see them only while you hold the vehicle.',
  'Never ask for or take money from anyone. You are paid only by Emanet, to your own IBAN.',
  'False reports, reused photos or breaking these rules mean strikes, then the end of your account, and may be reported to the police.',
];

function rulesList(): string {
  return `<ol class="rules">${RULES.map((rule) => `<li>${esc(rule)}</li>`).join('')}</ol>`;
}

export function terms(nav: Nav): string {
  return layout(
    'Rules for agents',
    nav,
    `<h1>Rules for agents</h1>
     <p class="lede">Emanet is a private service of 2earl, not a public authority. Agents are independent and work under these rules and the agent agreement.</p>
     ${rulesList()}
     <h2>Your data</h2>
     <p>We keep your name, city, phone number, IBAN and tax details to check who you are and to pay you, and a record of what you do in the app to protect the people whose vehicles are listed. Photos you upload go to the creditors and the courts as evidence. You can download or delete your data from your 2earl account.</p>`,
  );
}

// ---- Joining ---------------------------------------------------------------------------------------

const TAX_LABEL: Record<TaxProfile, string> = {
  individual: 'Individual',
  sole_trader: 'Sole trader (self-employed)',
  company: 'Company',
};

function profileFields(values: Record<string, string>, locked: boolean): string {
  const lockedAttr = locked ? ' readonly' : '';
  return `<label>Full name, as on your ID card <input name="legal_name" required maxlength="120" autocomplete="name" value="${attr(values.legal_name ?? '')}"${lockedAttr}></label>
    <label>City you work in <input name="city" required maxlength="40" autocomplete="address-level1" value="${attr(values.city ?? '')}"${lockedAttr}></label>
    <label>Mobile number <input name="phone" type="tel" required maxlength="20" autocomplete="tel" inputmode="tel" value="${attr(values.phone ?? '')}"></label>
    <label>IBAN in your own name <input name="iban" required maxlength="40" autocomplete="off" spellcheck="false" value="${attr(values.iban ?? '')}"></label>
    <fieldset${locked ? ' disabled' : ''}><legend>How you are paid</legend>
      ${(['individual', 'sole_trader', 'company'] as const)
        .map(
          (t) =>
            `<label class="check"><input type="radio" name="tax_profile" value="${t}"${(values.tax_profile ?? 'individual') === t ? ' checked' : ''}> ${TAX_LABEL[t]}</label>`,
        )
        .join('')}
      <label>Tax number (VKN), if not an individual <input name="vkn" inputmode="numeric" maxlength="11" value="${attr(values.vkn ?? '')}"></label>
    </fieldset>
    ${locked ? `<input type="hidden" name="tax_profile" value="${attr(values.tax_profile ?? 'individual')}"><input type="hidden" name="vkn" value="${attr(values.vkn ?? '')}">` : ''}`;
}

export const profileValues = (p: AgentProfile): Record<string, string> => ({
  legal_name: p.legal_name ?? '',
  city: p.city ?? '',
  phone: p.phone ?? '',
  iban: p.iban ?? '',
  tax_profile: p.tax_profile,
  vkn: p.vkn ?? '',
});

export function apply(
  nav: Nav,
  profile: AgentProfile,
  values: Record<string, string>,
  errorText: string | null,
  noticeText: string | null,
): string {
  const complete = Boolean(profile.legal_name && profile.city && profile.phone && profile.iban);
  return layout(
    'Join',
    nav,
    `${notice(noticeText)}<h1>Become an agent</h1>
     <p class="lede">Three steps: tell us who you are, accept the rules, and we check your identity in a short video call.</p>
     ${error(errorText)}
     <h2>1. About you</h2>
     <form method="post" action="/apply/profile" class="stack">
       ${profileFields(values, false)}
       <div><button type="submit">Save</button></div>
     </form>
     <h2>2. The rules</h2>
     ${rulesList()}
     <h2>3. Ask for the identity check</h2>
     ${
       complete
         ? `<form method="post" action="/apply/submit" class="stack">
             <input type="hidden" name="terms" value="${attr(profile.current_terms)}">
             <label class="check"><input type="checkbox" name="accept" value="1" required> I have read the rules for agents and accept them, and the agent agreement.</label>
             <div><button type="submit">Send my application</button></div>
           </form>`
         : '<p class="panel">Save your details first.</p>'
     }`,
  );
}

const STATUS_TEXT: Record<AgentProfile['status'], string> = {
  applied: 'Not sent yet',
  kyc_pending: 'Waiting for the identity check',
  active: 'Active',
  suspended: 'Suspended',
  banned: 'Closed',
};

export function waiting(nav: Nav, profile: AgentProfile): string {
  const body =
    profile.status === 'kyc_pending'
      ? `<h1>We’ll call you</h1>
         <p class="lede">Someone from 2earl will call ${data(profile.phone ?? '')} within two working days for a short video call. Have your Turkish ID card ready. We check that the IBAN is in your name, then you can start.</p>
         <p><a href="/account">Change your phone number or IBAN</a></p>`
      : profile.status === 'suspended'
        ? `<h1>Your account is suspended</h1><p class="lede">You can’t hold vehicles at the moment. 2earl will contact you.</p>`
        : `<h1>Your account is closed</h1><p class="lede">You can no longer work as an agent.</p>`;
  return layout(STATUS_TEXT[profile.status], nav, body);
}

// ---- Hunts -----------------------------------------------------------------------------------------

export function hunts(
  nav: Nav,
  list: Hunt[],
  city: string | null,
  profile: AgentProfile,
  errorText: string | null,
  noticeText: string | null,
): string {
  const cards =
    list.length === 0
      ? '<p class="panel">No vehicles to look for here right now. Try another city, or come back later.</p>'
      : `<ul class="cards">${list
          .map(
            (h) => `<li class="card">
              <div class="card-head">${plate(h.plate, 'large')}<strong class="earn">${lira(h.earn_kurus)}</strong></div>
              <p>${data([h.make, h.model, h.year === null ? '' : String(h.year), h.colour ?? ''].filter(Boolean).join(' · '))}</p>
              <p class="hint">${h.areas.map((a) => data(`${a.district}, ${a.city}`)).join('<br>')}</p>
              <form method="post" action="/hunts/${attr(h.vehicle_id)}/claim">
                <button type="submit">Look for this vehicle</button>
              </form>
            </li>`,
          )
          .join('')}</ul>`;
  return layout(
    'Vehicles',
    { ...nav, current: 'hunts' },
    `${notice(noticeText)}<h1>Vehicles to find</h1>
     ${error(errorText)}
     <form method="get" action="/hunts" class="inline">
       <label>City <input name="city" maxlength="40" value="${attr(city ?? profile.city ?? '')}"></label>
       <button class="secondary" type="submit">Show</button>
     </form>
     <p class="hint">You earn the amount shown when the vehicle reaches a custodian car park. When you choose a vehicle, you see where to look for a limited time; nobody else can take it then.</p>
     ${cards}`,
  );
}

// ---- One claim -------------------------------------------------------------------------------------

const PLACE_KIND: Record<string, string> = {
  owner_home: 'Home address',
  work: 'Work address',
  last_seen: 'Last seen',
  other: 'Other',
};

/** The steps after the police have come, in order; the police report is optional. */
export const STEPS: readonly {
  kind: EvidenceKind;
  label: string;
  hint: string;
  optional?: boolean;
}[] = [
  {
    kind: 'tow_report',
    label: 'Tow truck report',
    hint: 'The report the tow truck driver gives when the vehicle is loaded.',
  },
  {
    kind: 'police_report',
    label: 'Police report',
    hint: 'If the police gave you one.',
    optional: true,
  },
  {
    kind: 'yediemin_receipt',
    label: 'Custodian’s receipt',
    hint: 'The custodian car park’s receipt with the plate and chassis number. Staff check it before you are paid.',
  },
  {
    kind: 'yediemin_vehicle',
    label: 'The vehicle in the car park',
    hint: 'A photo of the vehicle inside the custodian car park, with its plate visible.',
  },
];

function uploadForm(claimId: string, kind: EvidenceKind, label: string): string {
  return `<form method="post" action="/claims/${attr(claimId)}/evidence" enctype="multipart/form-data" class="stack upload">
    <input type="hidden" name="kind" value="${kind}">
    <label>${label} <input type="file" name="photo" accept="image/*" capture="environment" required></label>
    <div><button type="submit">Upload</button></div>
  </form>`;
}

export function claim(
  nav: Nav,
  d: ClaimDetails,
  mine: MyClaim | undefined,
  agentId: string,
  now: number,
  errorText: string | null,
  noticeText: string | null,
): string {
  const c = d.claim;
  // Who was shown these addresses, and when: on every screenshot.
  const stamp = esc(`${agentId.slice(0, 8)} ${new Date(now * 1000).toISOString().slice(0, 16)} `);
  const watermark = `<div class="watermark" aria-hidden="true" translate="no">${stamp.repeat(40)}</div>`;
  const places = d.places
    .map((p) => {
      const query =
        p.lat !== null && p.lng !== null
          ? `${String(p.lat)},${String(p.lng)}`
          : `${p.address}, ${p.district}, ${p.city}`;
      const q = encodeURIComponent(query);
      return `<li class="place">
        <strong>${PLACE_KIND[p.kind] ?? data(p.kind)}</strong>
        <p translate="no">${esc(p.address)}<br>${esc(`${p.district}, ${p.city}`)}</p>
        ${p.note ? `<p class="hint">${data(p.note)}</p>` : ''}
        <p class="links"><a href="https://www.google.com/maps/search/?api=1&amp;query=${q}" rel="noreferrer" target="_blank">Google Maps</a> · <a href="https://maps.apple.com/?q=${q}" rel="noreferrer" target="_blank">Apple Maps</a></p>
      </li>`;
    })
    .join('');
  const have = new Set(mine?.evidence ?? []);
  const steps =
    c.state === 'reporting'
      ? `<h2>After the police</h2>
         <ol class="steps">${STEPS.map((s) => {
           const done = have.has(s.kind);
           return `<li class="${done ? 'done' : ''}">
             <strong>${s.label}</strong>${s.optional ? ' <span class="hint">(if you have one)</span>' : ''}
             ${done ? ' <span class="status active">Uploaded</span>' : `<p class="hint">${s.hint}</p>${uploadForm(c.id, s.kind, 'Photo')}`}
           </li>`;
         }).join('')}</ol>
         ${mine?.under_review ? '<p class="notice">Staff are checking your evidence. You’ll see the result under My work.</p>' : ''}`
      : `<h2>Found it?</h2>
         <p><a class="button" href="/claims/${attr(c.id)}/found">I see the vehicle</a></p>`;
  return layout(
    'Vehicle',
    { ...nav, current: 'claims' },
    `${notice(noticeText)}
     <p>${plate(d.plate, 'large')}</p>
     <h1>${data([d.make, d.model, d.year === null ? '' : String(d.year), d.colour ?? ''].filter(Boolean).join(' · '))}</h1>
     <p class="lede">Yours until ${clock(c.expires_at)}. ${c.state === 'reporting' ? 'The police have been called.' : 'Look for it at these places.'}</p>
     ${error(errorText)}
     <section class="confidential">
       ${watermark}
       <h2>Where to look</h2>
       <p class="hint">Confidential. Don’t write these down or share them.</p>
       <ul class="places">${places}</ul>
     </section>
     ${steps}
     ${
       c.state === 'searching'
         ? `<form method="post" action="/claims/${attr(c.id)}/release" class="actions">
             <button class="secondary" type="submit">Give this vehicle up</button>
           </form>
           <p class="hint">Someone else can then look for it. You can’t take it again for a while.</p>`
         : ''
     }`,
  );
}

export function found(nav: Nav, d: ClaimDetails, errorText: string | null): string {
  return layout(
    'Report a sighting',
    { ...nav, current: 'claims' },
    `<p>${plate(d.plate, 'large')}</p>
     <h1>You see the vehicle</h1>
     <p class="lede">Check the plate. Take one photo of the vehicle with its plate, here in the app. Your location is sent with it.</p>
     ${error(errorText)}
     <form method="post" action="/claims/${attr(d.claim.id)}/found" enctype="multipart/form-data" class="stack" id="sighting">
       <input type="hidden" name="lat"><input type="hidden" name="lng"><input type="hidden" name="accuracy"><input type="hidden" name="taken_at">
       <label>Photo of the vehicle <input type="file" name="photo" accept="image/*" capture="environment" required></label>
       <p class="hint" data-location>Finding your location…</p>
       <div><button type="submit">Send and call the police</button></div>
     </form>
     <p class="hint">Don’t touch the vehicle and don’t wait at the owner’s door.</p>`,
    { script: true },
  );
}

export function call(nav: Nav, d: ClaimDetails): string {
  const vehicle = [d.make, d.model, d.colour ?? ''].filter(Boolean).join(' ');
  return layout(
    'Call the police',
    { ...nav, current: 'claims' },
    `<p>${plate(d.plate, 'large')}</p>
     <h1>Call 112 now</h1>
     <p><a class="button call" href="tel:112">Call 112</a></p>
     <div class="panel script">
       <p>Say:</p>
       <p>“A vehicle with a seizure order (yakalama şerhi) is parked here. Plate ${data(d.plate)}, ${data(vehicle)}. I’m at …” and say where you are.</p>
     </div>
     <h2>While you wait</h2>
     <ul>
       <li>Stay at a distance. Don’t touch the vehicle.</li>
       <li>If the owner comes, don’t talk about the debt. Leave if it gets tense.</li>
       <li>Do what the police tell you, even if they don’t take the vehicle.</li>
     </ul>
     <p><a href="/claims/${attr(d.claim.id)}">Then upload the tow truck report and the custodian’s receipt</a></p>`,
  );
}

// ---- My work and earnings --------------------------------------------------------------------------

const CLOSE_TEXT: Record<string, string> = {
  expired: 'Time ran out',
  released: 'Given up',
  delivered: 'In custody',
  revoked: 'Taken back by 2earl',
  rejected: 'Not accepted',
};

const PAYOUT_TEXT: Record<string, string> = {
  awaiting_receipt: 'Waiting for the creditor’s payment',
  ready: 'Payment being prepared',
  approved: 'Payment ordered',
  sent: 'Paid',
  cancelled: 'Cancelled',
};

export function claims(nav: Nav, list: MyClaim[], noticeText: string | null): string {
  const row = (c: MyClaim) => {
    const status =
      c.closed_at === null
        ? c.under_review
          ? 'Staff are checking the evidence'
          : c.state === 'reporting'
            ? 'Police called'
            : 'Looking'
        : c.close_reason === 'delivered' && c.payout_status
          ? (PAYOUT_TEXT[c.payout_status] ?? data(c.payout_status))
          : (CLOSE_TEXT[c.close_reason ?? ''] ?? '—');
    const open = c.closed_at === null;
    return `<li class="card">
      <div class="card-head">${plate(c.plate)}<span class="status${open ? ' active' : ''}">${status}</span></div>
      <p>${data(`${c.make} ${c.model}`)}</p>
      <p class="hint">${open ? `Until ${clock(c.expires_at)}` : `Since ${clock(c.closed_at ?? c.claimed_at)}`}</p>
      ${open ? `<p><a href="/claims/${attr(c.id)}">Open</a></p>` : ''}
    </li>`;
  };
  return layout(
    'My work',
    { ...nav, current: 'claims' },
    `${notice(noticeText)}<h1>My work</h1>
     ${list.length === 0 ? '<p class="panel">Nothing yet. <a href="/hunts">Find a vehicle</a>.</p>' : `<ul class="cards">${list.map(row).join('')}</ul>`}`,
  );
}

export function earnings(nav: Nav, e: Earnings, profile: AgentProfile): string {
  return layout(
    'Earnings',
    { ...nav, current: 'earnings' },
    `<h1>Earnings</h1>
     <div class="counts">
       <div><strong>${lira(e.pending_kurus)}</strong><span>On its way</span></div>
       <div><strong>${lira(e.paid_kurus)}</strong><span>Paid</span></div>
     </div>
     ${profile.iban_verified ? '' : '<p class="error">Your IBAN hasn’t been checked yet. Payments wait until 2earl has checked it is in your name.</p>'}
     <p class="hint">You are paid after the creditor has paid for the vehicle, to your IBAN, net of any withholding tax.</p>
     ${
       e.payouts.length === 0
         ? '<p class="panel">No payments yet.</p>'
         : `<table><thead><tr><th>Vehicle</th><th class="num">Net</th><th>Status</th><th>Updated</th></tr></thead><tbody>${e.payouts
             .map(
               (p) => `<tr><td>${plate(p.plate)}</td><td class="num">${lira(p.net_kurus)}</td>
                 <td>${PAYOUT_TEXT[p.status] ?? data(p.status)}</td><td>${clock(p.updated_at)}</td></tr>`,
             )
             .join('')}</tbody></table>`
     }`,
  );
}

export function account(
  nav: Nav,
  profile: AgentProfile,
  values: Record<string, string>,
  errorText: string | null,
  noticeText: string | null,
): string {
  const locked = profile.status === 'active';
  return layout(
    'Account',
    { ...nav, current: 'account' },
    `${notice(noticeText)}<h1>Your details</h1>
     <div class="panel"><dl class="facts">
       <dt>Status</dt><dd>${STATUS_TEXT[profile.status]}</dd>
       <dt>IBAN</dt><dd>${profile.iban_verified ? 'Checked' : 'Not checked yet'}</dd>
       <dt>Strikes</dt><dd translate="no">${String(profile.strikes)}</dd>
     </dl></div>
     ${error(errorText)}
     <form method="post" action="/account" class="stack">
       ${profileFields(values, locked)}
       ${locked ? '<p class="hint">Your name, city and tax details were checked; to change them, contact 2earl. A new IBAN has to be checked again before you are paid.</p>' : ''}
       <div><button type="submit">Save</button></div>
     </form>
     <p><a href="https://login.2earl.com/account">Your 2earl account</a>: sign-in, your data, deleting your account.</p>`,
  );
}
