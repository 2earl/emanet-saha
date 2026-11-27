# Emanet Saha

The app for field agents at **saha.emanet.dev**, for phones first. Verified agents look for
vehicles that carry a seizure order (*yakalama şerhi*), call the police when they see one, and
upload the tow and custodian (*yediemin*) documents. They are paid once the vehicle is in custody
and the creditor has paid.

Agents never touch, tow or follow anyone: the rules they accept (`src/pages.ts`, `RULES`) say so,
and the app only ever shows what a rule allows: vehicles at district level until claimed,
street-level places only while the claim lasts (every view recorded by the core), watermarked
with the agent's ID and the time.

Data and rules live in [emanet-core](https://github.com/2earl/emanet-core) (its `FieldApi`
entrypoint, over a Service Binding); photos go to the `emanet-evidence` R2 bucket. This Worker
keeps only sign-in transactions and sessions. Sign-in is [login.2earl.com](https://github.com/2earl/login).

## How an agent works

| Step | Page | What happens |
| --- | --- | --- |
| Join | `/apply` | Name as on the ID card, city, mobile, IBAN in their own name, tax profile; accept the rules; send. |
| Identity | `/status` | 2earl staff call for a short video check with the ID card, check the IBAN, and activate the agent in Emanet Merkez. A vendor NFC + liveness check comes with the native app (core DESIGN §10, P6). |
| Find | `/hunts` | Vehicles in a city, with what the agent earns. Claiming one holds it for the configured hours. |
| Look | `/claims/:id` | Places at street level, with links to Google and Apple Maps. Give it up, or report a sighting. |
| Sighting | `/claims/:id/found` | One photo in the app, with the phone's location (`public/app.js`) or else the photo's GPS. |
| Police | `/claims/:id/call` | Call 112, what to say, how to behave. |
| Custody | `/claims/:id` | Tow report, police report (if any), custodian's receipt, the vehicle in the car park. The receipt puts the delivery in Merkez's review queue. |
| Paid | `/earnings` | Owed and paid amounts, to a checked IBAN. |

Photos: JPEG, PNG, WebP or HEIC up to 15 MB; their SHA-256 is unique across Emanet, so a photo
can't be used twice; EXIF time and GPS (JPEG) are kept for staff. A refused photo's copy is
removed from R2.

## Develop

```sh
pnpm install
pnpm test        # Worker tests with stand-ins for login and emanet-core (vitest.config.ts)
pnpm typecheck
pnpm lint
```

Pages are written in English; `src/locales/tr.ts` translates them, and `test/i18n.test.ts` fails
on any sentence without a translation.

## Deploy

`.github/workflows/deploy.yml` deploys `main` after approval in the `production` environment
(secret `CLOUDFLARE_API_TOKEN`; the account ID is in `wrangler.jsonc`). It makes `SESSION_PEPPER`
once, applies D1 migrations, deploys, and checks the site answers.

The D1 database `emanet-saha` and the custom domain (`saha_live`) are in emanet-core's `infra/`.

Proprietary; see [LICENSE](LICENSE).
