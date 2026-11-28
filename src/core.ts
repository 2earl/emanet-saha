/**
 * The contract with emanet-core's `FieldApi` entrypoint (2earl/emanet-core src/index.ts,
 * src/claims.ts, src/agents.ts), as this app uses it. The core is the source of truth.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; detail?: string };

export type AgentStatus = 'applied' | 'kyc_pending' | 'active' | 'suspended' | 'banned';
export type TaxProfile = 'individual' | 'sole_trader' | 'company';
export const TAX_PROFILES: readonly TaxProfile[] = ['individual', 'sole_trader', 'company'];

export interface AgentProfile {
  status: AgentStatus;
  legal_name: string | null;
  city: string | null;
  phone: string | null;
  iban: string | null;
  iban_verified: boolean;
  /** The address the agent proved with a code, or null. */
  email?: string | null;
  /** Whether an ID number is on record (only a keyed hash of it is kept). */
  id_given?: boolean;
  birth_year?: number | null;
  tax_profile: TaxProfile;
  vkn: string | null;
  terms_version: string | null;
  current_terms: string;
  submitted_at: number | null;
  strikes: number;
  open_claims: number;
  /** What staff asked the applicant to correct, while the application is back with them. */
  review_note?: string | null;
  address?: string | null;
  /** The person's data was erased; the account can't be used. */
  erased?: boolean;
  /** Things staff asked for that wait for the agent. */
  requests_open?: number;
}

export interface ProfileInput {
  legalName: string;
  city: string;
  phone: string;
  iban: string;
  taxProfile: TaxProfile;
  vkn?: string | null;
  /** T.C. kimlik no: given once; empty afterwards to keep the one on record. */
  tckn?: string | null;
  birthYear?: number | null;
  address?: string | null;
}

export interface Hunt {
  vehicle_id: string;
  plate: string;
  make: string;
  model: string;
  year: number | null;
  colour: string | null;
  areas: { district: string; city: string }[];
  earn_kurus: number;
}

export interface Claim {
  id: string;
  vehicle_id: string;
  state: 'searching' | 'reporting';
  claimed_at: number;
  expires_at: number;
}

export interface Place {
  kind: string;
  address: string;
  district: string;
  city: string;
  lat: number | null;
  lng: number | null;
  note: string | null;
  attributes: Record<string, unknown>;
}

export interface ClaimDetails {
  claim: Claim;
  plate: string;
  make: string;
  model: string;
  year: number | null;
  colour: string | null;
  places: Place[];
}

export type EvidenceKind =
  'scene' | 'police_report' | 'tow_report' | 'yediemin_receipt' | 'yediemin_vehicle';

export interface MyClaim {
  id: string;
  plate: string | null;
  make: string;
  model: string;
  state: 'searching' | 'reporting';
  claimed_at: number;
  expires_at: number;
  closed_at: number | null;
  close_reason: string | null;
  /** Staff's reason, when a reported delivery wasn't accepted. */
  close_note?: string | null;
  evidence: EvidenceKind[];
  under_review: boolean;
  payout_status: string | null;
}

export interface Earnings {
  payouts: {
    id: string;
    plate: string | null;
    gross_kurus: number;
    withholding_kurus: number;
    net_kurus: number;
    status: string;
    created_at: number;
    updated_at: number;
  }[];
  pending_kurus: number;
  paid_kurus: number;
}

export interface AgreementText {
  title: string;
  intro: string;
  sections: { title: string; paragraphs: string[] }[];
}
export interface AgreementBundle {
  version: string;
  sha256: string;
  agreement: AgreementText;
  notice: AgreementText;
  consent: string;
}
export interface Acceptance {
  version: string;
  sha256: string;
  locale: string;
  accepted_at: number;
  current: boolean;
}
/** The two every applicant gives. */
export const DOCUMENT_KINDS = ['criminal_record', 'population_record'] as const;
/** Everything staff can ask for. */
export const ALL_DOCUMENT_KINDS = [
  'criminal_record',
  'population_record',
  'residence_record',
  'driving_licence',
  'tax_certificate',
  'bank_proof',
  'other',
] as const;
export type DocumentKind = (typeof ALL_DOCUMENT_KINDS)[number];
/** Documents from e-Devlet carry a barcode number. */
export const BARCODED: readonly string[] = [
  'criminal_record',
  'population_record',
  'residence_record',
];

export type InfoSubject =
  'legal_name' | 'id_number' | 'phone' | 'email' | 'address' | 'city' | 'iban' | 'tax' | 'other';

/** One thing staff asked this agent for. */
export interface AgentRequest {
  id: string;
  kind: 'info' | 'document';
  subject: InfoSubject | DocumentKind;
  note: string;
  status: 'open' | 'answered' | 'accepted' | 'cancelled';
  answer: string | null;
  created_at: number;
  due_at: number;
  answered_at: number | null;
}

export interface ErasureRequest {
  id: string;
  status: 'open' | 'done' | 'refused' | 'withdrawn';
  received_at: number;
  due_at: number;
  outcome: string | null;
  closed_at: number | null;
}
export interface ErasureView {
  request: ErasureRequest | null;
  blockers: { open_claims: number; payouts_pending: number; payouts_sent: number };
  answer_days: number;
  archive_years: number;
}
export interface AgentDocument {
  id: string;
  kind: DocumentKind;
  barcode: string;
  uploaded_at: number;
  status: 'uploaded' | 'verified' | 'rejected';
  outcome: string | null;
  note: string | null;
}

export interface FieldApi {
  /** An unexpected error: a route pattern and an error's name, for staff's System page. */
  reportError(event: string, detail: string): Promise<void>;
  register(agentId: string): Promise<Result<null>>;
  profile(agentId: string): Promise<Result<AgentProfile>>;
  updateProfile(agentId: string, input: ProfileInput): Promise<Result<null>>;
  requestEmailCode(
    agentId: string,
    input: { email: string; locale: 'tr' | 'en' },
  ): Promise<Result<{ email: string }>>;
  confirmEmailCode(agentId: string, code: string): Promise<Result<{ email: string }>>;
  submit(
    agentId: string,
    termsVersion: string,
    consents?: { agreement: boolean; notice: boolean; consent: boolean },
    locale?: string,
  ): Promise<Result<null>>;
  agreement(locale: 'tr' | 'en'): Promise<Result<AgreementBundle>>;
  acceptance(agentId: string): Promise<Result<Acceptance | null>>;
  documents(agentId: string): Promise<Result<AgentDocument[]>>;
  addDocument(
    agentId: string,
    input: { kind: string; file_ref: string; sha256: string; barcode: string; request_id?: string },
  ): Promise<Result<{ id: string }>>;
  requests(agentId: string): Promise<Result<AgentRequest[]>>;
  answerRequest(agentId: string, requestId: string, answer: string): Promise<Result<null>>;
  erasure(agentId: string): Promise<Result<ErasureView>>;
  requestErasure(agentId: string, note: string): Promise<Result<{ id: string; due_at: number }>>;
  withdrawErasure(agentId: string): Promise<Result<null>>;
  hunts(agentId: string, query: { city?: string; limit?: number }): Promise<Result<Hunt[]>>;
  claim(agentId: string, vehicleId: string): Promise<Result<Claim>>;
  release(agentId: string, claimId: string): Promise<Result<null>>;
  claimDetails(agentId: string, claimId: string): Promise<Result<ClaimDetails>>;
  sighting(
    agentId: string,
    claimId: string,
    sighting: { lat: number; lng: number; accuracy_m?: number; taken_at: number },
  ): Promise<Result<Claim>>;
  evidence(
    agentId: string,
    claimId: string,
    evidence: {
      kind: EvidenceKind;
      file_ref: string;
      sha256: string;
      exif_time?: number;
      exif_lat?: number;
      exif_lng?: number;
    },
  ): Promise<Result<{ id: string }>>;
  myClaims(agentId: string): Promise<Result<MyClaim[]>>;
  earnings(agentId: string): Promise<Result<Earnings>>;
}

export const core = (env: Env): FieldApi => env.CORE as unknown as FieldApi;
