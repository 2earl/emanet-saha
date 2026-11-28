import type {
  Acceptance,
  AgentDocument,
  AgentRequest,
  AgreementBundle,
  AgreementText,
  DocumentKind,
  ErasureView,
  InfoSubject,
} from './core';
import { BARCODED, DOCUMENT_KINDS } from './core';
import type {
  AgentProfile,
  ClaimDetails,
  Earnings,
  EvidenceKind,
  Hunt,
  MyClaim,
  TaxProfile,
  TicketThread,
  Ticket,
} from './core';
import { currentLocale, languageSwitcher } from './i18n';
import { icon, scene, type IconName } from './icons';

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
  // Emanet: the 2earl hands holding something entrusted to them.
  '<path fill="#ED1C24" d="M50 7 66 23 50 39 34 23Z"/>' +
  '</svg>';

export type Section = 'hunts' | 'claims' | 'earnings' | 'account' | 'support';

export interface Nav {
  signedIn: boolean;
  active?: boolean;
  current?: Section;
  /** Things staff asked for that wait for this agent: shown on every page until answered. */
  requests?: number;
  /** The page that lists them doesn't announce itself. */
  quiet?: boolean;
  /** Support messages 2earl answered; shown on every page except the support pages. */
  answers?: number;
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
  const link = (key: Section, href: string, label: string, glyph: IconName) =>
    `<a href="${href}"${nav.current === key ? ' aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`;
  const sections = nav.active
    ? `<nav aria-label="Sections">
        ${link('hunts', '/hunts', 'Vehicles', 'car')}
        ${link('claims', '/claims', 'My work', 'reviews')}
        ${link('earnings', '/earnings', 'Earnings', 'wallet')}
        ${link('support', '/support', 'Help', 'mail')}
        ${link('account', '/account', 'Account', 'user')}
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
<a class="skip" href="#main">Skip to content</a>
<header class="bar">
  <a class="brand" href="/">${MARK}<span translate="no">Emanet Saha</span></a>
  ${who}
  ${sections}
</header>
<main id="main">
${
  nav.requests && !nav.quiet
    ? `<a class="ask-banner" href="/requests" translate="no">${icon('info')}<span><strong>${esc(L(nav.requests === 1 ? 'We need one thing from you' : `We need ${String(nav.requests)} things from you`, nav.requests === 1 ? 'Sizden bir şey bekliyoruz' : `Sizden ${String(nav.requests)} şey bekliyoruz`))}</strong> ${esc(L('See what and answer', 'Ne olduğunu görün ve yanıtlayın'))}</span></a>`
    : ''
}
${
  nav.answers && nav.current !== 'support'
    ? `<a class="ask-banner" href="/support" translate="no">${icon('mail')}<span><strong>${esc(L(nav.answers === 1 ? '2earl answered your message' : `2earl answered ${String(nav.answers)} of your messages`, nav.answers === 1 ? '2earl mesajınızı yanıtladı' : `2earl ${String(nav.answers)} mesajınızı yanıtladı`))}</strong> ${esc(L('Read the answer', 'Yanıtı okuyun'))}</span></a>`
    : ''
}
${body}
</main>
<footer>
  <span>Emanet finds vehicles and tells the police. Agents never touch, tow or follow anyone.</span>
  <span><a href="/terms">Rules for agents</a> · <a href="/agreement" translate="no">${esc(L('Agreement', 'Sözleşme'))}</a> · ${nav.signedIn ? `<a href="/support" translate="no">${esc(L('Support', 'Destek'))}</a> · <a href="/privacy" translate="no">${esc(L('My data', 'Verilerim'))}</a> · ` : ''}<a href="https://emanet.dev/gizlilik">Privacy notice</a> · <a href="https://emanet.dev/kullanim-sartlari">Terms of use</a> · <a href="mailto:iletisim@emanet.dev">Contact</a></span>
  ${languageSwitcher()}
</footer>
</body>
</html>`;
}

/** Text written in both languages where it is used; whatever shows it marks it translate="no". */
const L = (en: string, tr: string) => (currentLocale() === 'tr' ? tr : en);

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
      ${scene('road')}
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
    ${
      locked
        ? ''
        : `<div class="grid2">
             <label>T.C. kimlik no <input name="tckn" inputmode="numeric" pattern="[0-9 ]{11,13}" maxlength="13" autocomplete="off" value="${attr(values.tckn ?? '')}"${values.id_given === '1' ? '' : ' required'}>
               <span class="hint" translate="no">${esc(values.id_given === '1' ? L('On record. Leave empty unless it has to change.', 'Kayıtlı. Değişmesi gerekmiyorsa boş bırakın.') : L('Checked against the population registry. Kept encrypted, only for the tax document of a payment to you, and as a fingerprint that stops a second account.', 'Nüfus kayıtlarıyla karşılaştırılır. Şifreli olarak ve yalnızca size yapılan ödemenin vergi belgesi için saklanır; ayrıca ikinci bir hesabı önleyen bir özet tutulur.'))}</span></label>
             <label>Year of birth <input name="birth_year" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="bday-year" required value="${attr(values.birth_year ?? '')}"></label>
           </div>`
    }
    <label><span translate="no">${esc(L('Home address', 'İkamet adresi'))}</span> <input name="address" required minlength="10" maxlength="300" autocomplete="street-address" value="${attr(values.address ?? '')}">
      <span class="hint" translate="no">${esc(L('As on your population register extract. Tax law wants it on the document for a payment to you.', 'Nüfus kayıt örneğinizdeki gibi. Vergi mevzuatı, size yapılan ödemenin belgesinde yer almasını ister.'))}</span></label>
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
  address: p.address ?? '',
  birth_year: p.birth_year ? String(p.birth_year) : '',
  id_given: p.id_given ? '1' : '',
});

/** An element shown in the reader's language without the catalogue. */
const both = (en: string, tr: string) => `<span translate="no">${esc(L(en, tr))}</span>`;

const DOCUMENT_TEXT: Record<
  (typeof DOCUMENT_KINDS)[number],
  { en: string; tr: string; how: [string, string] }
> = {
  criminal_record: {
    en: 'Criminal record (adli sicil kaydı)',
    tr: 'Adli sicil kaydı',
    how: [
      'e-Devlet → “Adli Sicil Kaydı Sorgulama” → where it will be given: “Özel kurum” → download the barcoded PDF.',
      'e-Devlet → “Adli Sicil Kaydı Sorgulama” → belgenin verileceği yer: “Özel kurum” → barkodlu PDF’i indirin.',
    ],
  },
  population_record: {
    en: 'Population register extract (nüfus kayıt örneği)',
    tr: 'Nüfus kayıt örneği',
    how: [
      'e-Devlet → “Nüfus Kayıt Örneği Belgesi Sorgulama” → download the barcoded PDF.',
      'e-Devlet → “Nüfus Kayıt Örneği Belgesi Sorgulama” → barkodlu PDF’i indirin.',
    ],
  },
};

const DOCUMENT_STATE: Record<AgentDocument['status'], [string, string, string]> = {
  uploaded: ['Uploaded, waiting to be checked', 'Yüklendi, inceleme bekliyor', 'pending'],
  verified: ['Checked', 'İncelendi', 'active'],
  rejected: ['Not accepted: upload a new one', 'Kabul edilmedi: yenisini yükleyin', 'rejected'],
};

/** Step 3: the two documents from e-Devlet, each with its barcode number. */
function documentsStep(documents: AgentDocument[], ready: boolean): string {
  if (!ready) {
    return `<p class="panel" translate="no">${esc(L('Save your details first.', 'Önce bilgilerinizi kaydedin.'))}</p>`;
  }
  const one = (kind: (typeof DOCUMENT_KINDS)[number]) => {
    const text = DOCUMENT_TEXT[kind];
    const have = documents.find((d) => d.kind === kind);
    const state = have ? DOCUMENT_STATE[have.status] : null;
    const form =
      have?.status === 'verified'
        ? ''
        : `<form method="post" action="/apply/documents" enctype="multipart/form-data" class="stack">
             <input type="hidden" name="kind" value="${kind}">
             <label>${esc(L('The document (PDF from e-Devlet)', 'Belge (e-Devlet’ten alınan PDF)'))} <input type="file" name="file" accept="application/pdf,image/*" required></label>
             <label>${esc(L('Barcode number on the document', 'Belgedeki barkod numarası'))} <input name="barcode" required maxlength="40" autocomplete="off" spellcheck="false" value="${attr(have?.barcode ?? '')}">
               <span class="hint">${esc(L('Printed beside the barcode, at the bottom of the page. We use it to verify the document at e-Devlet.', 'Sayfanın altında, barkodun yanında yazar. Belgeyi e-Devlet’te doğrulamak için kullanırız.'))}</span></label>
             <div><button class="secondary" type="submit">${esc(have ? L('Replace', 'Değiştir') : L('Upload', 'Yükle'))}</button></div>
           </form>`;
    return `<div class="doc-upload">
        <h3>${icon('file')}<span>${esc(L(text.en, text.tr))}</span>${state ? ` <span class="status ${state[2]}">${esc(L(state[0], state[1]))}</span>` : ''}</h3>
        <p class="hint">${esc(L(text.how[0], text.how[1]))}</p>
        ${have?.status === 'rejected' && have.note ? `<p class="error">${esc(have.note)}</p>` : ''}
        ${form}
      </div>`;
  };
  return `<div translate="no">
      <p>${esc(L('Get both documents from e-Devlet today or in the last 30 days, as barcoded PDFs. We verify each at e-Devlet and then delete the file; only the result is kept.', 'İki belgeyi de e-Devlet’ten, bugün ya da son 30 gün içinde, barkodlu PDF olarak alın. Her birini e-Devlet’te doğrular ve ardından dosyayı sileriz; yalnızca sonuç saklanır.'))}</p>
      ${DOCUMENT_KINDS.map(one).join('')}
    </div>`;
}

function agreementPart(id: string, text: AgreementText): string {
  return `<section id="${id}" class="legal"><h2>${esc(text.title)}</h2><p>${esc(text.intro)}</p>${text.sections
    .map(
      (section) =>
        `<h3>${esc(section.title)}</h3>${section.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}`,
    )
    .join('')}</section>`;
}

/** The agent agreement, the privacy notice and the consent text, with what this agent accepted. */
export function agreementPage(
  nav: Nav,
  bundle: AgreementBundle,
  accepted: Acceptance | null,
): string {
  const l = currentLocale() === 'tr' ? 'tr' : 'en';
  const record = accepted
    ? `<p class="${accepted.current ? 'notice' : 'error'}">${esc(
        accepted.current
          ? L(
              `You accepted this version on ${stamp(accepted.accepted_at)}.`,
              `Bu sürümü ${stamp(accepted.accepted_at)} tarihinde onayladınız.`,
            )
          : L(
              `You accepted an earlier version (${accepted.version}) on ${stamp(accepted.accepted_at)}. The text has changed since.`,
              `Daha önceki bir sürümü (${accepted.version}) ${stamp(accepted.accepted_at)} tarihinde onayladınız. Metin o tarihten sonra değişti.`,
            ),
      )}</p>`
    : '';
  return layout(
    'Agreement',
    nav,
    `<div translate="no" lang="${l}" class="prose">
       <p class="eyebrow">${esc(L('Version', 'Sürüm'))} ${esc(bundle.version)}</p>
       <h1>${esc(L('What you agree to', 'Neyi kabul ediyorsunuz'))}</h1>
       <p class="lede">${esc(L('Three texts: the agreement you accept, the privacy notice you read, and the consent you give for one check. The Turkish text is the binding one.', 'Üç metin: onayladığınız sözleşme, okuduğunuz aydınlatma metni ve tek bir inceleme için verdiğiniz açık rıza. Bağlayıcı olan Türkçe metindir.'))}</p>
       ${record}
       <nav class="toc inline-toc"><a href="#agreement">${esc(bundle.agreement.title)}</a><a href="#notice">${esc(bundle.notice.title)}</a><a href="#consent">${esc(L('Explicit consent', 'Açık rıza'))}</a></nav>
       ${agreementPart('agreement', bundle.agreement)}
       ${agreementPart('notice', bundle.notice)}
       <section id="consent" class="legal"><h2>${esc(L('Explicit consent: criminal record', 'Açık rıza: adli sicil kaydı'))}</h2><p>${esc(bundle.consent)}</p></section>
       <p class="hint">${esc(L('Digest of the binding text (SHA-256):', 'Bağlayıcı metnin özeti (SHA-256):'))} <code>${esc(bundle.sha256)}</code></p>
     </div>`,
  );
}

/** A date and time in Turkey's time, as text. */
const stamp = (unix: number) =>
  new Date((unix + 3 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');

export function apply(
  nav: Nav,
  profile: AgentProfile,
  values: Record<string, string>,
  errorText: string | null,
  noticeText: string | null,
  /** The address a code was just mailed to, while the agent types the code. */
  pendingEmail: string | null = null,
  documents: AgentDocument[] = [],
): string {
  const hasEmail = Boolean(profile.email);
  const hasDetails = Boolean(
    profile.legal_name &&
    profile.city &&
    profile.phone &&
    profile.iban &&
    profile.id_given &&
    profile.address,
  );
  const hasDocuments = DOCUMENT_KINDS.every((kind) =>
    documents.some((d) => d.kind === kind && d.status !== 'rejected'),
  );
  // The step's number is drawn by the stylesheet (a counter), so the heading is only its words.
  const step = (title: string, done: boolean, body: string) =>
    `<section class="step${done ? ' done' : ''}">
       <h2>${title}</h2>
       ${done ? '<p><span class="status active">Done</span></p>' : ''}
       ${body}
     </section>`;
  const email = hasEmail
    ? `<p>${data(profile.email ?? '')}</p>`
    : pendingEmail
      ? `<p>We sent a six-digit code to ${data(pendingEmail)}.</p>
         <form method="post" action="/apply/email/confirm" class="stack">
           <input type="hidden" name="email" value="${attr(pendingEmail)}">
           <label>Code <input name="code" required inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" autocomplete="one-time-code" autofocus></label>
           <div><button type="submit">Confirm</button></div>
         </form>
         <form method="post" action="/apply/email" class="actions">
           <input type="hidden" name="email" value="${attr(pendingEmail)}">
           <button class="link" type="submit">Send a new code</button>
           <a href="/apply">Use another address</a>
         </form>`
      : `<p class="hint">We write to you here about your application and your payments.</p>
         <form method="post" action="/apply/email" class="stack">
           <label>Email address <input name="email" type="email" required maxlength="254" autocomplete="email"></label>
           <div><button type="submit">Send me a code</button></div>
         </form>`;
  return layout(
    'Join',
    nav,
    `${notice(noticeText)}<h1>Become an agent</h1>
     ${
       profile.review_note
         ? `<div class="callout returned" translate="no">${icon('info')}<div><strong>${esc(L('We need one thing corrected', 'Bir düzeltme gerekiyor'))}</strong><p>${esc(profile.review_note)}</p><p class="hint">${esc(L('Correct your details below and send the application again. Nothing you entered is lost.', 'Bilgilerinizi aşağıda düzeltip başvurunuzu yeniden gönderin. Girdiğiniz hiçbir şey kaybolmadı.'))}</p>${profile.requests_open ? `<p><a class="button secondary" href="/requests">${esc(L('See what we asked for', 'Sizden istenenleri görün'))}</a></p>` : ''}</div></div>`
         : ''
     }
     <p class="lede" translate="no">${esc(L('Five steps here, then a short video call with your ID card. One person, one account.', 'Burada beş adım, ardından kimlik kartınızla kısa bir görüntülü görüşme. Bir kişi, bir hesap.'))}</p>
     ${error(errorText)}
     ${step('Your email address', hasEmail, email)}
     ${step(
       'About you',
       hasDetails,
       `<form method="post" action="/apply/profile" class="stack">
          ${profileFields(values, false)}
          <div><button type="submit"${hasDetails ? ' class="secondary"' : ''}>Save</button></div>
        </form>`,
     )}
     ${step(both('Your e-Devlet documents', 'e-Devlet belgeleriniz'), hasDocuments, documentsStep(documents, hasDetails))}
     ${step('The rules', false, `${rulesList()}<p translate="no"><a href="/agreement">${esc(L('Read the full agent agreement, the privacy notice and the consent text', 'Saha görevlisi sözleşmesinin, aydınlatma metninin ve açık rıza metninin tamamını okuyun'))}</a></p>`)}
     ${step(
       'Send your application',
       false,
       profile.requests_open
         ? `<p class="panel" translate="no">${esc(L('Answer what we asked for first.', 'Önce sizden istenenleri yanıtlayın.'))} <a href="/requests">${esc(L('See the list', 'Listeyi görün'))}</a></p>`
         : hasEmail && hasDetails && hasDocuments
           ? `<form method="post" action="/apply/submit" class="stack">
             <input type="hidden" name="terms" value="${attr(profile.current_terms)}">
             <div translate="no" class="consents">
               <label class="check"><input type="checkbox" name="accept" value="1" required> <span>${L('I have read and accept the <a href="/agreement#agreement">Field Agent Agreement</a> and the rules above. I work independently, I never touch a vehicle or speak to its owner, and I am responsible for my own acts.', '<a href="/agreement#agreement">Saha Görevlisi Sözleşmesi</a>’ni ve yukarıdaki kuralları okudum, kabul ediyorum. Bağımsız çalışırım, araca asla dokunmam, sahibiyle konuşmam ve kendi eylemlerimden sorumluyum.')}</span></label>
               <label class="check"><input type="checkbox" name="notice" value="1" required> <span>${L('I have read the <a href="/agreement#notice">Privacy Notice for Field Agents</a>.', '<a href="/agreement#notice">Saha Görevlisi Aydınlatma Metni</a>’ni okudum.')}</span></label>
               <label class="check"><input type="checkbox" name="consent" value="1" required> <span>${L('I give my <a href="/agreement#consent">explicit consent</a> to my criminal record being examined to assess my application. The document is deleted once checked.', 'Adli sicil kaydımın başvurumun değerlendirilmesi amacıyla incelenmesine <a href="/agreement#consent">açık rıza</a> veriyorum. Belge incelendikten sonra silinir.')}</span></label>
               <p class="hint">${esc(L(`Agreement version ${profile.current_terms}. The date and time of your acceptance and a digest of the text are recorded.`, `Sözleşme sürümü ${profile.current_terms}. Onayınızın tarihi, saati ve metnin özeti kaydedilir.`))}</p>
             </div>
             <div><button type="submit">Send my application</button></div>
           </form>`
           : `<p class="panel" translate="no">${esc(!hasEmail ? L('Confirm your email address and save your details first.', 'Önce e-posta adresinizi doğrulayın ve bilgilerinizi kaydedin.') : !hasDetails ? L('Save your details, with your address, first.', 'Önce bilgilerinizi adresinizle birlikte kaydedin.') : L('Upload both documents first.', 'Önce iki belgeyi de yükleyin.'))}</p>`,
     )}
     <h2>What happens next</h2>
     <ol class="rules">
       <li>We call you on a video call. Have your Turkish ID card with you: we compare it with what you entered. We keep no picture of it.</li>
       <li>We check that the IBAN is in your own name.</li>
       <li>Then your account is active and you can look for vehicles.</li>
     </ol>`,
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
  const tracker = `<div translate="no">
      <ol class="tracker">
        <li class="done">${icon('check')}<div><strong>${esc(L('Application sent', 'Başvuru gönderildi'))}</strong><span>${esc(L('We have your details and the rules you accepted.', 'Bilgileriniz ve kabul ettiğiniz kurallar bize ulaştı.'))}</span></div></li>
        <li class="now">${icon('phone')}<div><strong>${esc(L('Video call', 'Görüntülü görüşme'))}</strong><span>${esc(L('We call you, you show your ID card, and we check that the IBAN is in your name. The email we sent says by when.', 'Sizi ararız, kimlik kartınızı gösterirsiniz ve IBAN’ın sizin adınıza olduğunu kontrol ederiz. Ne zamana kadar arayacağımız gönderdiğimiz e-postada yazıyor.'))}</span></div></li>
        <li>${icon('car')}<div><strong>${esc(L('You start', 'Başlarsınız'))}</strong><span>${esc(L('Once approved you get an email and can see the vehicles in your city.', 'Onaylandığında e-posta alırsınız ve şehrinizdeki araçları görebilirsiniz.'))}</span></div></li>
      </ol>
      <div class="panel"><h2>${esc(L('Have ready for the call', 'Görüşme için hazır bulundurun'))}</h2>
        <ul>
          <li>${esc(L('Your Turkish ID card.', 'T.C. kimlik kartınız.'))}</li>
          <li>${esc(L('A quiet, well-lit place and a working camera.', 'Sessiz, aydınlık bir ortam ve çalışan bir kamera.'))}</li>
          <li>${esc(L('Your bank’s app, to show the IBAN is in your own name.', 'IBAN’ın kendi adınıza olduğunu göstermek için bankanızın uygulaması.'))}</li>
        </ul>
      </div>
    </div>`;
  const body =
    profile.status === 'kyc_pending'
      ? `<h1>We’ll call you</h1>
         <p class="lede">Someone from 2earl will call ${data(profile.phone ?? '')} for a short video call. Have your Turkish ID card ready. We check that the IBAN is in your name, then you can start.</p>
         ${tracker}
         <p><a href="/account">Change your phone number or IBAN</a></p>`
      : profile.status === 'suspended'
        ? `<h1>Your account is suspended</h1><p class="lede">You can’t hold vehicles at the moment. 2earl will contact you.</p>
           <p class="panel" translate="no">${esc(L('The reason was sent to your email address. Payment for deliveries already confirmed is not affected. To object, reply to that email.', 'Gerekçe e-posta adresinize gönderildi. Onaylanmış teslimlerinizin ödemesi bundan etkilenmez. İtiraz etmek için o e-postayı yanıtlayın.'))}</p>`
        : profile.erased
          ? `<div translate="no"><h1>${esc(L('Your data was erased', 'Verileriniz silindi'))}</h1><p class="lede">${esc(L('This Emanet Saha account is closed and your personal data was removed from it. Records the law requires us to keep stay until their period ends.', 'Bu Emanet Saha hesabı kapatıldı ve kişisel verileriniz hesaptan kaldırıldı. Mevzuat gereği saklanması zorunlu kayıtlar süresi dolana kadar tutulur.'))}</p><p><a href="/agreement#notice">${esc(L('Privacy notice', 'Aydınlatma metni'))}</a></p></div>`
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
      ? `<div class="panel empty">${scene('road')}<p>No vehicles to look for here right now. Try another city, or come back later.</p></div>`
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

/**
 * The camera button: the browser's own file control reads "Choose File" in English on most
 * phones, so it hides behind a button in the page's language; app.js shows the chosen photo's
 * name.
 */
function photoInput(label: string): string {
  return `<div class="photo-field"><span class="label">${label}</span>
    <label class="camera"><input type="file" name="photo" accept="image/*" capture="environment" required data-photo><span class="button secondary">Take a photo</span></label>
    <span class="hint" data-photo-name hidden></span></div>`;
}

function uploadForm(claimId: string, kind: EvidenceKind, label: string): string {
  return `<form method="post" action="/claims/${attr(claimId)}/evidence" enctype="multipart/form-data" class="stack upload">
    <input type="hidden" name="kind" value="${kind}">
    ${photoInput(label)}
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
  // The sighting was recorded but its photo wasn't stored (a lost connection, a photo used
  // before): without it staff can't confirm the delivery, so it is asked for again first.
  const scene =
    c.state === 'reporting' && mine !== undefined && !have.has('scene')
      ? `<div class="panel"><p class="error" role="alert">The photo of the vehicle where you found it is missing. Take it now, with the plate in view.</p>${uploadForm(c.id, 'scene', 'Photo of the vehicle')}</div>`
      : '';
  const steps =
    c.state === 'reporting'
      ? `${scene}<h2>After the police</h2>
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
       ${photoInput('Photo of the vehicle')}
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
      ${!open && c.close_reason === 'rejected' && c.close_note ? `<p class="hint">Why it wasn’t accepted: ${data(c.close_note)}</p>` : ''}
      ${open ? `<p><a href="/claims/${attr(c.id)}">Open</a></p>` : ''}
    </li>`;
  };
  return layout(
    'My work',
    { ...nav, current: 'claims' },
    `${notice(noticeText)}<h1>My work</h1>
     ${list.length === 0 ? `<div class="panel empty">${scene('plate')}<p>Nothing yet. <a href="/hunts">Find a vehicle</a>.</p></div>` : `<ul class="cards">${list.map(row).join('')}</ul>`}`,
  );
}

const STATEMENT_NOTE = () =>
  L(
    'A summary of the payment for your own records. It is not an invoice or a tax document.',
    'Ödemenin kendi kayıtlarınız için özeti. Fatura ya da vergi belgesi değildir.',
  );

export function earnings(nav: Nav, e: Earnings, profile: AgentProfile): string {
  const steps = `<ol class="tracker" translate="no">
      <li>${icon('car')}<div><strong>${esc(L('You deliver', 'Teslim edersiniz'))}</strong><span>${esc(L('2earl checks your photos and the custodian’s receipt.', '2earl fotoğraflarınızı ve yediemin makbuzunu kontrol eder.'))}</span></div></li>
      <li>${icon('clock')}<div><strong>${esc(L('The creditor pays', 'Alacaklı öder'))}</strong><span>${esc(L('Your payment is released once the creditor has paid for the vehicle.', 'Araç için alacaklı ödeme yapınca ödemeniz serbest kalır.'))}</span></div></li>
      <li>${icon('wallet')}<div><strong>${esc(L('We pay your IBAN', 'IBAN’ınıza öderiz'))}</strong><span>${esc(L('Net of any withholding tax. Open a payment for its statement.', 'Varsa stopaj düşülmüş net tutar. Özeti için ödemeyi açın.'))}</span></div></li>
    </ol>`;
  return layout(
    'Earnings',
    { ...nav, current: 'earnings' },
    `<h1>Earnings</h1>
     <div class="counts">
       <div><strong>${lira(e.pending_kurus)}</strong><span>On its way</span></div>
       <div><strong>${lira(e.paid_kurus)}</strong><span>Paid</span></div>
     </div>
     ${profile.iban_verified ? '' : '<p class="error">Your IBAN hasn’t been checked yet. Payments wait until 2earl has checked it is in your name.</p>'}
     ${
       e.payouts.length === 0
         ? `<div class="panel empty">${scene('inbox')}<p>No payments yet.</p></div>${steps}`
         : `<p class="actions"><a class="button secondary" href="/earnings.csv" translate="no">${icon('download')} ${esc(L('Download all (CSV)', 'Tümünü indir (CSV)'))}</a></p>
            <table class="payments"><thead><tr><th>Vehicle</th><th class="num">Gross</th><th class="num">Withheld</th><th class="num">Net</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${e.payouts
              .map(
                (
                  p,
                ) => `<tr><td>${plate(p.plate)}</td><td class="num">${lira(p.gross_kurus)}</td><td class="num">${lira(p.withholding_kurus)}</td><td class="num">${lira(p.net_kurus)}</td>
                 <td>${PAYOUT_TEXT[p.status] ?? data(p.status)}</td><td>${clock(p.updated_at)}</td>
                 <td><a href="/earnings/${attr(p.id)}" translate="no">${esc(L('Statement', 'Özet'))}</a></td></tr>`,
              )
              .join('')}</tbody></table>
            <p class="hint" translate="no">${esc(STATEMENT_NOTE())}</p>
            ${steps}`
     }`,
  );
}

export function statement(nav: Nav, p: Earnings['payouts'][number], profile: AgentProfile): string {
  const day = (unix: number) =>
    new Date(unix * 1000).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const iban = profile.iban ? `TR•• •••• •••• •••• •••• ${profile.iban.slice(-4)}` : '—';
  const row = (label: string, value: string) =>
    `<dt translate="no">${esc(label)}</dt><dd>${value}</dd>`;
  return layout(
    'Payment statement',
    { ...nav, current: 'earnings' },
    `<p class="noprint"><a href="/earnings" translate="no">${esc(L('All payments', 'Tüm ödemeler'))}</a></p>
     <h1 translate="no">${esc(L('Payment statement', 'Ödeme özeti'))}</h1>
     <div class="panel"><dl class="facts">
       ${row(L('Paid to', 'Alıcı'), data(profile.legal_name ?? '—'))}
       ${row('IBAN', data(iban))}
       ${row(L('Vehicle', 'Araç'), plate(p.plate))}
       ${row(L('Gross', 'Brüt'), lira(p.gross_kurus))}
       ${row(L('Withholding tax', 'Stopaj'), lira(p.withholding_kurus))}
       ${row(L('Net to you', 'Size net'), `<strong>${lira(p.net_kurus)}</strong>`)}
       ${row(L('Status', 'Durum'), PAYOUT_TEXT[p.status] ?? data(p.status))}
       ${row(L('Created', 'Oluşturuldu'), data(day(p.created_at)))}
       ${row(L('Last change', 'Son değişiklik'), data(day(p.updated_at)))}
       ${row(L('Reference', 'Referans'), data(p.id))}
     </dl></div>
     <p class="hint" translate="no">${esc(STATEMENT_NOTE())}</p>
     <p class="hint noprint" translate="no">${esc(L('To keep a copy, use your browser’s Print and choose Save as PDF.', 'Kopyasını saklamak için tarayıcınızın Yazdır seçeneğinde PDF olarak kaydet’i seçin.'))}</p>
     <p class="noprint"><a href="/support/new?category=payment&amp;about=${encodeURIComponent(`${p.plate ?? ''} ${p.id}`.trim())}" translate="no">${esc(L('Question about this payment?', 'Bu ödemeyle ilgili sorunuz mu var?'))}</a></p>`,
  );
}

/** Quoted for a spreadsheet: a cell that starts like a formula is made harmless. */
const cell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};
const money = (kurus: number) => (kurus / 100).toFixed(2).replace('.', ',');

/** All payments as a CSV Turkish Excel opens as is: semicolons, decimal commas, UTF-8 mark. */
export function earningsCsv(e: Earnings): string {
  const day = (unix: number) =>
    new Date(unix * 1000).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const head = [
    'Reference',
    'Vehicle',
    'Gross TRY',
    'Withholding TRY',
    'Net TRY',
    'Status',
    'Created',
    'Updated',
  ];
  const lines = e.payouts.map((p) =>
    [
      cell(p.id),
      cell(p.plate ?? ''),
      money(p.gross_kurus),
      money(p.withholding_kurus),
      money(p.net_kurus),
      cell(p.status),
      day(p.created_at),
      day(p.updated_at),
    ].join(';'),
  );
  return `\uFEFF${[head.map(cell).join(';'), ...lines].join('\r\n')}\r\n`;
}

// ---- Support ---------------------------------------------------------------------------------

const CATEGORY_TEXT: Record<string, [string, string]> = {
  payment: ['A payment', 'Bir ödeme'],
  delivery: ['A delivery or a vehicle', 'Bir teslim ya da araç'],
  account: ['My account', 'Hesabım'],
  technical: ['Something doesn’t work', 'Bir şey çalışmıyor'],
  other: ['Something else', 'Başka bir konu'],
};
const categoryName = (key: string) => {
  const pair = CATEGORY_TEXT[key];
  return pair ? L(pair[0], pair[1]) : key;
};
const TICKET_STATUS: Record<Ticket['status'], [string, string]> = {
  open: ['Waiting for 2earl', '2earl’den yanıt bekleniyor'],
  answered: ['2earl answered', '2earl yanıtladı'],
  closed: ['Closed', 'Kapandı'],
};
const ticketStatus = (status: Ticket['status']) => L(...TICKET_STATUS[status]);

export function supportList(nav: Nav, list: Ticket[], noticeText: string | null): string {
  const row = (t: Ticket) =>
    `<li class="card"><div class="card-head"><a href="/support/${attr(t.id)}">${data(t.subject)}</a>
       <span class="status${t.status === 'answered' ? ' active' : ''}" translate="no">${esc(ticketStatus(t.status))}</span></div>
       <p class="hint" translate="no">${esc(categoryName(t.category))} · ${clock(t.updated_at)}</p></li>`;
  return layout(
    'Support',
    { ...nav, current: 'support' },
    `${notice(noticeText)}<div translate="no"><h1>${esc(L('Support', 'Destek'))}</h1>
     <p class="lede">${esc(L('Ask 2earl about a payment, a vehicle or your account. We answer here and send you an email to say so.', '2earl’e bir ödeme, araç ya da hesabınızla ilgili soru sorun. Yanıtı burada veririz ve e-postayla haber veririz.'))}</p>
     <p><a class="button" href="/support/new">${icon('plus')} ${esc(L('New message', 'Yeni mesaj'))}</a></p></div>
     ${list.length === 0 ? `<div class="panel empty" translate="no">${scene('inbox')}<p>${esc(L('No messages yet.', 'Henüz mesaj yok.'))}</p></div>` : `<ul class="cards">${list.map(row).join('')}</ul>`}
     <p class="hint" translate="no">${esc(L('Never write your password or a code in a message. For something urgent about a vehicle you hold, call the police first.', 'Mesaja parola ya da kod yazmayın. Elinizdeki bir araçla ilgili acil bir durumda önce polisi arayın.'))}</p>`,
  );
}

export function supportNew(
  nav: Nav,
  values: Record<string, string>,
  errorText: string | null,
): string {
  const options = Object.keys(CATEGORY_TEXT)
    .map(
      (k) =>
        `<option value="${attr(k)}"${values.category === k ? ' selected' : ''}>${esc(categoryName(k))}</option>`,
    )
    .join('');
  return layout(
    'New message',
    { ...nav, current: 'support' },
    `<p><a href="/support" translate="no">${esc(L('Support', 'Destek'))}</a></p>
     <h1 translate="no">${esc(L('New message', 'Yeni mesaj'))}</h1>
     ${error(errorText)}
     <form method="post" action="/support/new" class="stack" translate="no">
       <label><span>${esc(L('What is it about?', 'Konu nedir?'))}</span> <select name="category">${options}</select></label>
       <label><span>${esc(L('Subject', 'Başlık'))}</span> <input name="subject" required minlength="3" maxlength="120" value="${attr(values.subject ?? '')}"></label>
       <label><span>${esc(L('Message', 'Mesaj'))}</span> <textarea name="message" required minlength="3" maxlength="4000" rows="6">${esc(values.message ?? '')}</textarea></label>
       <button type="submit">${esc(L('Send', 'Gönder'))}</button>
     </form>`,
  );
}

export function supportThread(
  nav: Nav,
  t: TicketThread,
  errorText: string | null,
  noticeText: string | null,
): string {
  const bubble = (m: TicketThread['messages'][number]) =>
    `<li class="card${m.author_kind === 'staff' ? ' staff' : ''}"><p class="hint" translate="no">${esc(m.author_kind === 'staff' ? L('2earl', '2earl') : L('You', 'Siz'))} · ${clock(m.created_at)}</p>
       <p style="white-space:pre-wrap">${data(m.body)}</p></li>`;
  const closed = t.ticket.status === 'closed';
  return layout(
    t.ticket.subject,
    { ...nav, current: 'support' },
    `${notice(noticeText)}<p><a href="/support" translate="no">${esc(L('Support', 'Destek'))}</a></p>
     <h1>${data(t.ticket.subject)}</h1>
     <p class="hint" translate="no">${esc(categoryName(t.ticket.category))} · ${esc(ticketStatus(t.ticket.status))}</p>
     <ul class="cards">${t.messages.map(bubble).join('')}</ul>
     ${error(errorText)}
     <form method="post" action="/support/${attr(t.ticket.id)}/reply" class="stack" translate="no">
       <label><span>${esc(closed ? L('Write again to reopen this', 'Yeniden açmak için yazın') : L('Your reply', 'Yanıtınız'))}</span> <textarea name="message" required minlength="2" maxlength="4000" rows="4"></textarea></label>
       <button type="submit">${esc(L('Send', 'Gönder'))}</button>
     </form>
     ${closed ? '' : `<form method="post" action="/support/${attr(t.ticket.id)}/close" translate="no"><button class="link" type="submit">${esc(L('Close this message, it is solved', 'Bu mesajı kapat, çözüldü'))}</button></form>`}`,
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
       <dt>Email</dt><dd>${profile.email ? data(profile.email) : '—'}</dd>
       <dt>IBAN</dt><dd>${profile.iban_verified ? 'Checked' : 'Not checked yet'}</dd>
       <dt>Strikes</dt><dd translate="no">${String(profile.strikes)}</dd>
     </dl></div>
     ${error(errorText)}
     <form method="post" action="/account" class="stack">
       ${profileFields(values, locked)}
       ${locked ? '<p class="hint">Your name, city and tax details were checked; to change them, contact 2earl. A new IBAN has to be checked again before you are paid.</p>' : ''}
       <div><button type="submit">Save</button></div>
     </form>
     <p translate="no"><a href="/privacy">${esc(L('My data', 'Verilerim'))}</a>: ${esc(L('what Emanet holds about you, and asking for it to be erased.', 'Emanet’in hakkınızda tuttukları ve silinmesini isteme.'))}</p>
     <p><a href="https://login.2earl.com/account">Your 2earl account</a>: sign-in, your data, deleting your account.</p>`,
  );
}

// ---- What staff asked for --------------------------------------------------------------------------

const DOCUMENT_NAME: Record<DocumentKind, [string, string]> = {
  criminal_record: ['Criminal record (adli sicil kaydı)', 'Adli sicil kaydı'],
  population_record: ['Population register extract (nüfus kayıt örneği)', 'Nüfus kayıt örneği'],
  residence_record: [
    'Residence record (yerleşim yeri belgesi)',
    'Yerleşim yeri (ikametgâh) belgesi',
  ],
  driving_licence: ['Driving licence', 'Sürücü belgesi'],
  tax_certificate: ['Tax certificate (vergi levhası)', 'Vergi levhası'],
  bank_proof: ['Proof that the IBAN is yours', 'IBAN’ın size ait olduğunu gösteren belge'],
  other: ['Another document', 'Başka bir belge'],
};

const DOCUMENT_HOW: Record<DocumentKind, [string, string]> = {
  criminal_record: DOCUMENT_TEXT.criminal_record.how,
  population_record: DOCUMENT_TEXT.population_record.how,
  residence_record: [
    'e-Devlet → “Yerleşim Yeri (İkametgâh) ve Diğer Adres Belgesi Sorgulama” → download the barcoded PDF.',
    'e-Devlet → “Yerleşim Yeri (İkametgâh) ve Diğer Adres Belgesi Sorgulama” → barkodlu PDF’i indirin.',
  ],
  driving_licence: [
    'A clear photo of the front of your licence, all four corners visible.',
    'Sürücü belgenizin ön yüzünün, dört köşesi de görünen net bir fotoğrafı.',
  ],
  tax_certificate: [
    'Download it as a PDF from the tax office’s online service (İnteraktif Vergi Dairesi → e-Vergi Levhası).',
    'İnteraktif Vergi Dairesi → e-Vergi Levhası bölümünden PDF olarak indirin.',
  ],
  bank_proof: [
    'A statement or receipt from your bank’s app that shows your name and the IBAN together.',
    'Bankanızın uygulamasından, adınızı ve IBAN’ı birlikte gösteren bir hesap cüzdanı ya da dekont.',
  ],
  other: ['A PDF or a clear photo.', 'PDF ya da net bir fotoğraf.'],
};

const INFO_NAME: Record<InfoSubject, [string, string]> = {
  legal_name: ['Your name', 'Adınız ve soyadınız'],
  id_number: ['Your T.C. kimlik no', 'T.C. kimlik numaranız'],
  phone: ['Your mobile number', 'Cep telefonu numaranız'],
  email: ['Your email address', 'E-posta adresiniz'],
  address: ['Your home address', 'İkamet adresiniz'],
  city: ['The city you work in', 'Çalıştığınız şehir'],
  iban: ['Your IBAN', 'IBAN’ınız'],
  tax: ['How you are paid (tax details)', 'Ödeme şekliniz (vergi bilgileri)'],
  other: ['A question', 'Bir soru'],
};

const day = (unix: number) => new Date((unix + 3 * 3600) * 1000).toISOString().slice(0, 10);

const subjectName = (r: AgentRequest) =>
  r.kind === 'document'
    ? DOCUMENT_NAME[r.subject as DocumentKind]
    : INFO_NAME[r.subject as InfoSubject];

/** Everything staff asked this agent for: what waits for them first, each with the way to answer. */
export function requestsPage(
  nav: Nav,
  profile: AgentProfile,
  list: AgentRequest[],
  errorText: string | null,
  noticeText: string | null,
): string {
  const edit = profile.status === 'applied' ? '/apply' : '/account';
  const open = list.filter((r) => r.status === 'open');
  const waiting = list.filter((r) => r.status === 'answered');
  const settled = list.filter((r) => r.status === 'accepted' || r.status === 'cancelled');
  const head = (r: AgentRequest, state: [string, string, string]) => {
    const [en, tr] = subjectName(r);
    return `<h2>${icon(r.kind === 'document' ? 'file' : 'user')}<span>${esc(L(en, tr))}</span> <span class="status ${state[2]}">${esc(L(state[0], state[1]))}</span></h2>
       <blockquote class="asked"><span class="hint">${esc(L('2earl wrote:', '2earl’ün notu:'))}</span> ${esc(r.note)}</blockquote>`;
  };
  const documentForm = (r: AgentRequest) => {
    const [en, tr] = DOCUMENT_HOW[r.subject as DocumentKind];
    const barcoded = BARCODED.includes(r.subject);
    return `<p class="hint">${esc(L(en, tr))}</p>
      <form method="post" action="/requests/${attr(r.id)}/document" enctype="multipart/form-data" class="stack">
        <label>${esc(L('The document (PDF or photo, at most 10 MB)', 'Belge (PDF ya da fotoğraf, en çok 10 MB)'))} <input type="file" name="file" accept="application/pdf,image/*" required></label>
        ${
          barcoded
            ? `<label>${esc(L('Barcode number on the document', 'Belgedeki barkod numarası'))} <input name="barcode" required maxlength="40" autocomplete="off" spellcheck="false">
                 <span class="hint">${esc(L('Printed beside the barcode, at the bottom of the page.', 'Sayfanın altında, barkodun yanında yazar.'))}</span></label>`
            : ''
        }
        <div><button type="submit">${esc(L('Upload', 'Yükle'))}</button></div>
      </form>`;
  };
  const infoForm = (r: AgentRequest) => {
    const question = r.subject === 'other';
    return `${
      question
        ? ''
        : `<p>${esc(L('Correct it in your details, then tell us it is done.', 'Bilgilerinizde düzeltin, ardından bize tamamlandığını bildirin.'))} <a class="button secondary" href="${edit}">${esc(L('Open my details', 'Bilgilerimi aç'))}</a></p>`
    }
      <form method="post" action="/requests/${attr(r.id)}/answer" class="stack">
        <label>${esc(question ? L('Your answer', 'Yanıtınız') : L('A note for us (optional)', 'Bize notunuz (isteğe bağlı)'))}
          <textarea name="answer" rows="3" maxlength="500"${question ? ' required' : ''}></textarea></label>
        <div><button type="submit">${esc(question ? L('Send my answer', 'Yanıtımı gönder') : L('I corrected it', 'Düzelttim'))}</button></div>
      </form>`;
  };
  const card = (r: AgentRequest) =>
    `<section class="panel ask">
       ${head(r, ['Waiting for you', 'Sizi bekliyor', 'pending'])}
       <p class="hint">${esc(L(`Please answer by ${day(r.due_at)}.`, `Lütfen ${day(r.due_at)} tarihine kadar yanıtlayın.`))}</p>
       ${r.kind === 'document' ? documentForm(r) : infoForm(r)}
     </section>`;
  const quiet = (r: AgentRequest, state: [string, string, string]) =>
    `<section class="panel ask">${head(r, state)}${r.answer ? `<p><span class="hint">${esc(L('You wrote:', 'Yazdığınız:'))}</span> ${esc(r.answer)}</p>` : ''}</section>`;
  const resend =
    profile.status === 'applied' && open.length === 0 && list.length > 0
      ? `<div class="callout">${icon('check')}<div><strong>${esc(L('Everything is answered', 'Her şey yanıtlandı'))}</strong><p>${esc(L('Send your application again so we can go on.', 'Devam edebilmemiz için başvurunuzu yeniden gönderin.'))}</p><p><a class="button" href="/apply">${esc(L('Go to my application', 'Başvuruma git'))}</a></p></div></div>`
      : '';
  return layout(
    L('What we need from you', 'Sizden beklenenler'),
    { ...nav, quiet: true },
    `${notice(noticeText)}<div translate="no">
       <h1>${esc(L('What we need from you', 'Sizden beklenenler'))}</h1>
       <p class="lede">${esc(L('To go on with your account, 2earl asked for the things below. Answer each one here; don’t send documents by email.', 'Hesabınızla ilgili işleme devam edebilmek için 2earl aşağıdakileri istedi. Her birini buradan yanıtlayın; belgeleri e-postayla göndermeyin.'))}</p>
     </div>
     ${error(errorText)}
     <div translate="no">
       ${resend}
       ${open.length === 0 && waiting.length === 0 && settled.length === 0 ? `<p class="panel">${esc(L('Nothing is asked of you right now.', 'Şu an sizden bir şey beklenmiyor.'))}</p>` : ''}
       ${open.map(card).join('')}
       ${waiting.length > 0 ? `<h2 class="group">${esc(L('Sent, waiting for 2earl', 'Gönderildi, 2earl’ün incelemesini bekliyor'))}</h2>${waiting.map((r) => quiet(r, ['Being checked', 'İnceleniyor', 'pending'])).join('')}` : ''}
       ${settled.length > 0 ? `<details class="history"><summary>${esc(L('Earlier requests', 'Önceki talepler'))} (${String(settled.length)})</summary>${settled.map((r) => quiet(r, r.status === 'accepted' ? ['Accepted', 'Kabul edildi', 'active'] : ['Withdrawn by 2earl', '2earl geri çekti', 'cancelled'])).join('')}</details>` : ''}
       <p class="hint">${esc(L('Documents are checked and then deleted; only the result is kept.', 'Belgeler incelenir ve ardından silinir; yalnızca sonuç saklanır.'))} <a href="/agreement#notice">${esc(L('Privacy notice', 'Aydınlatma metni'))}</a></p>
     </div>`,
  );
}

// ---- My data ---------------------------------------------------------------------------------------

/** What Emanet holds about the agent, and asking for it to be erased. */
export function myData(
  nav: Nav,
  profile: AgentProfile,
  view: ErasureView,
  errorText: string | null,
  noticeText: string | null,
): string {
  const r = view.request;
  const b = view.blockers;
  const held = `<div class="panel"><h2>${esc(L('What Emanet holds about you', 'Emanet’in hakkınızda tuttukları'))}</h2>
      <ul>
        <li>${esc(L('Your details: name, ID number (encrypted), birth year, phone, email, address, city, IBAN, tax details.', 'Bilgileriniz: ad soyad, T.C. kimlik no (şifreli), doğum yılı, telefon, e-posta, adres, şehir, IBAN, vergi bilgileri.'))}</li>
        <li>${esc(L('Your application: what you accepted and when, the result of the identity check, the result of each document check (never the document itself after it is checked).', 'Başvurunuz: neyi ne zaman kabul ettiğiniz, kimlik doğrulamasının sonucu, her belge incelemesinin sonucu (inceleme sonrası belgenin kendisi tutulmaz).'))}</li>
        <li>${esc(L('Your work: the vehicles you claimed, where you reported them, the photos you took.', 'Çalışmanız: üstlendiğiniz araçlar, bildirdiğiniz konumlar, çektiğiniz fotoğraflar.'))}</li>
        <li>${esc(L('Your payments, and the accounting records the law requires for them.', 'Ödemeleriniz ve mevzuatın bunlar için zorunlu kıldığı muhasebe kayıtları.'))}</li>
      </ul>
      <p><a href="https://login.2earl.com/account">${esc(L('Download a copy of your data from your 2earl account', 'Verilerinizin bir kopyasını 2earl hesabınızdan indirin'))}</a> · <a href="/agreement#notice">${esc(L('Privacy notice', 'Aydınlatma metni'))}</a></p>
    </div>`;
  const what = `<ul>
      <li>${esc(L('Your account is closed for good. Vehicles you hold are released.', 'Hesabınız kalıcı olarak kapatılır. Üstlendiğiniz araçlar bırakılır.'))}</li>
      <li>${esc(L('Your details, documents and identity-check records are removed from our working systems.', 'Bilgileriniz, belgeleriniz ve kimlik doğrulama kayıtlarınız çalışan sistemlerimizden kaldırılır.'))}</li>
      <li>${esc(L('Payment and accounting records stay as long as the law requires (ten years).', 'Ödeme ve muhasebe kayıtları mevzuatın gerektirdiği süre (on yıl) boyunca tutulur.'))}</li>
      <li>${esc(L(`A sealed (encrypted) copy of what was removed is kept in a separate, restricted archive for at most ${String(view.archive_years)} years, only for legal obligations and possible disputes. Only an authorised administrator can open it, with a written reason, and each opening is recorded. It is destroyed when the period ends. The file of a criminal record is never kept.`, `Kaldırılan verilerin şifreli bir kopyası, yalnızca hukuki yükümlülükler ve olası uyuşmazlıklar için, ayrı ve erişimi kısıtlı bir arşivde en çok ${String(view.archive_years)} yıl saklanır. Bu arşivi yalnızca yetkili bir yönetici, gerekçe yazarak açabilir ve her erişim kaydedilir. Süre sonunda yok edilir. Adli sicil kaydı dosyası hiçbir şekilde saklanmaz.`))}</li>
    </ul>`;
  const warnings = [
    b.payouts_pending > 0
      ? L(
          `You have ${String(b.payouts_pending)} payment(s) not yet sent. Erasing removes the IBAN they would be paid to, so we carry out the request after they are sent.`,
          `Henüz gönderilmemiş ${String(b.payouts_pending)} ödemeniz var. Silme işlemi ödemenin yapılacağı IBAN’ı da kaldıracağından, talebiniz ödemeler gönderildikten sonra yerine getirilir.`,
        )
      : '',
    b.open_claims > 0
      ? L(
          `You hold ${String(b.open_claims)} vehicle(s). They are released when your data is erased.`,
          `Üstlendiğiniz ${String(b.open_claims)} araç var. Verileriniz silindiğinde bırakılır.`,
        )
      : '',
  ].filter(Boolean);
  const form = `<section class="panel danger-zone"><h2>${esc(L('Ask for your data to be erased', 'Verilerinizin silinmesini isteyin'))}</h2>
      <p>${esc(L('What happens when we carry it out:', 'Talebiniz yerine getirildiğinde:'))}</p>
      ${what}
      ${warnings.map((w) => `<p class="callout returned">${icon('info')}<span>${esc(w)}</span></p>`).join('')}
      <form method="post" action="/privacy/erase" class="stack">
        <label>${esc(L('Anything you want to tell us (optional)', 'Bize iletmek istediğiniz bir not (isteğe bağlı)'))} <textarea name="note" rows="3" maxlength="1000"></textarea></label>
        <label class="check"><input type="checkbox" name="confirm" value="1" required> <span>${esc(L('I understand that my account will be closed and that this can’t be undone.', 'Hesabımın kapatılacağını ve bunun geri alınamayacağını anlıyorum.'))}</span></label>
        <div><button class="danger" type="submit">${esc(L('Send the request', 'Talebi gönder'))}</button></div>
      </form>
      <p class="hint">${esc(L(`We decide within ${String(view.answer_days)} days at the latest and tell you by email. You can withdraw the request until then.`, `En geç ${String(view.answer_days)} gün içinde karar verir ve size e-postayla bildiririz. O zamana kadar talebinizi geri alabilirsiniz.`))}</p>
    </section>`;
  const status =
    r?.status === 'open'
      ? `<section class="panel"><h2>${esc(L('Your request to be erased', 'Silme talebiniz'))} <span class="status pending">${esc(L('Being decided', 'Değerlendiriliyor'))}</span></h2>
           <dl class="facts"><dt>${esc(L('Received', 'Alındı'))}</dt><dd>${day(r.received_at)}</dd><dt>${esc(L('Answer at the latest', 'En geç yanıt'))}</dt><dd>${day(r.due_at)}</dd></dl>
           ${what}
           ${warnings.map((w) => `<p class="callout returned">${icon('info')}<span>${esc(w)}</span></p>`).join('')}
           <form method="post" action="/privacy/withdraw"><button class="secondary" type="submit">${esc(L('Withdraw the request', 'Talebi geri al'))}</button></form>
         </section>`
      : r?.status === 'refused'
        ? `<section class="panel"><h2>${esc(L('Your last request', 'Son talebiniz'))} <span class="status rejected">${esc(L('Not carried out', 'Yerine getirilmedi'))}</span></h2>
             <p><span class="hint">${esc(L('Reason:', 'Gerekçe:'))}</span> ${esc(r.outcome ?? '')}</p>
             <p class="hint">${esc(L('To object, write to iletisim@emanet.dev; you can also complain to the Personal Data Protection Board (KVKK).', 'İtiraz için iletisim@emanet.dev adresine yazabilir, ayrıca Kişisel Verileri Koruma Kurulu’na şikâyette bulunabilirsiniz.'))}</p>
           </section>`
        : '';
  return layout(
    L('My data', 'Verilerim'),
    nav,
    `${notice(noticeText)}<div translate="no"><h1>${esc(L('My data', 'Verilerim'))}</h1>
       <p class="lede">${esc(L('What Emanet holds about you, how to get a copy, and how to have it erased.', 'Emanet’in hakkınızda tuttukları, bir kopyasını nasıl alacağınız ve nasıl sildireceğiniz.'))}</p></div>
     ${error(errorText)}
     <div translate="no">
       ${held}
       ${status}
       ${r?.status === 'open' ? '' : form}
       <p class="hint">${esc(L('To correct a detail, use your account page. For any other request under KVKK art. 11, write to iletisim@emanet.dev.', 'Bir bilgiyi düzeltmek için hesap sayfanızı kullanın. KVKK m.11 kapsamındaki diğer talepleriniz için iletisim@emanet.dev adresine yazın.'))}</p>
     </div>`,
  );
}
