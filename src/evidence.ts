import { core, type EvidenceKind, type Result } from './core';
import { readExif, type PhotoFacts } from './exif';

/**
 * A photo from the agent's phone: checked, hashed, stored in R2 under the claim, then recorded in
 * the core, which refuses a file used before (by its SHA-256). If the core refuses, the stored
 * copy is removed again.
 */

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * What a photo is, from its first bytes: the browser's word for it is only a hint, and staff open
 * these files in Emanet Merkez.
 */
export function photoType(bytes: Uint8Array): string | null {
  const at = (offset: number, ...sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  const ascii = (offset: number, text: string) =>
    Array.from(text).every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  // ISO BMFF: "ftyp" at 4, then the brand.
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (['heic', 'heix', 'hevc', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return null;
}

export type Photo = { bytes: Uint8Array; type: string; facts: PhotoFacts };

/** The uploaded file, or why it can't be used. */
export async function readPhoto(value: unknown): Promise<Result<Photo>> {
  if (!(value instanceof File) || value.size === 0) return { ok: false, error: 'no_photo' };
  if (value.size > MAX_PHOTO_BYTES) return { ok: false, error: 'photo_too_large' };
  const bytes = new Uint8Array(await value.arrayBuffer());
  const type = photoType(bytes);
  if (!type) return { ok: false, error: 'not_a_photo' };
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
