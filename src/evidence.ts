import { core, type EvidenceKind, type Result } from './core';
import { readExif, type PhotoFacts } from './exif';

/**
 * A photo from the agent's phone: checked, hashed, stored in R2 under the claim, then recorded in
 * the core, which refuses a file used before (by its SHA-256). If the core refuses, the stored
 * copy is removed again.
 */

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export type Photo = { bytes: Uint8Array; type: string; facts: PhotoFacts };

/** The uploaded file, or why it can't be used. */
export async function readPhoto(value: unknown): Promise<Result<Photo>> {
  if (!(value instanceof File) || value.size === 0) return { ok: false, error: 'no_photo' };
  if (value.size > MAX_PHOTO_BYTES) return { ok: false, error: 'photo_too_large' };
  const type = value.type.toLowerCase();
  if (!PHOTO_TYPES.has(type)) return { ok: false, error: 'not_a_photo' };
  const bytes = new Uint8Array(await value.arrayBuffer());
  return { ok: true, value: { bytes, type, facts: readExif(bytes) } };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function storeEvidence(
  env: Env,
  agentId: string,
  claimId: string,
  kind: EvidenceKind,
  photo: Photo,
): Promise<Result<{ id: string }>> {
  const key = `claims/${claimId}/${crypto.randomUUID()}`;
  const hash = await sha256(photo.bytes);
  await env.EVIDENCE.put(key, photo.bytes, {
    httpMetadata: { contentType: photo.type },
    customMetadata: { agent: agentId, kind },
    sha256: hash,
  });
  const result = await core(env).evidence(agentId, claimId, {
    kind,
    file_ref: key,
    sha256: hash,
    ...(photo.facts.takenAt === undefined ? {} : { exif_time: photo.facts.takenAt }),
    ...(photo.facts.lat === undefined ? {} : { exif_lat: photo.facts.lat }),
    ...(photo.facts.lng === undefined ? {} : { exif_lng: photo.facts.lng }),
  });
  if (!result.ok) await env.EVIDENCE.delete(key);
  return result;
}
