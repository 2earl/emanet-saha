/**
 * The two things a photo's EXIF tells staff checking a delivery: when it was taken and where.
 * JPEG only (phones' camera default); anything unreadable is simply absent, never an error.
 */

export interface PhotoFacts {
  /** Unix seconds. Without an offset in the file, Turkey's time (UTC+3, all year since 2016). */
  takenAt?: number;
  lat?: number;
  lng?: number;
}

const TURKEY_OFFSET = '+03:00';

export function readExif(bytes: Uint8Array): PhotoFacts {
  try {
    return parse(bytes);
  } catch {
    return {};
  }
}

function parse(bytes: Uint8Array): PhotoFacts {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return {};
    const marker = bytes[offset + 1] ?? 0;
    // Start of scan: the image data follows; there is no metadata after it.
    if (marker === 0xda) return {};
    const length = view.getUint16(offset + 2);
    if (
      marker === 0xe1 &&
      String.fromCharCode(...bytes.subarray(offset + 4, offset + 10)) === 'Exif\0\0'
    ) {
      return tiff(view, offset + 10, length - 8);
    }
    offset += 2 + length;
  }
  return {};
}

function tiff(view: DataView, start: number, size: number): PhotoFacts {
  const end = start + size;
  const little = view.getUint16(start) === 0x4949; // "II"
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(start + 2) !== 42) return {};

  /** The entries of one IFD as tag → offset of its 12-byte entry. */
  const entries = (ifd: number): Map<number, number> => {
    const found = new Map<number, number>();
    const at = start + ifd;
    if (at + 2 > end) return found;
    const count = u16(at);
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if (entry + 12 > end) break;
      found.set(u16(entry), entry);
    }
    return found;
  };
  const valueOffset = (entry: number, bytes: number) =>
    bytes <= 4 ? entry + 8 : start + u32(entry + 8);
  const ascii = (entry: number): string => {
    const count = u32(entry + 4);
    const at = valueOffset(entry, count);
    let text = '';
    for (let i = 0; i < count && at + i < end; i++) {
      const code = view.getUint8(at + i);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  };
  const rationals = (entry: number): number[] => {
    const count = u32(entry + 4);
    const at = valueOffset(entry, count * 8);
    const out: number[] = [];
    for (let i = 0; i < count && at + i * 8 + 8 <= end; i++) {
      const denominator = u32(at + i * 8 + 4);
      out.push(denominator === 0 ? NaN : u32(at + i * 8) / denominator);
    }
    return out;
  };

  const facts: PhotoFacts = {};
  const ifd0 = entries(u32(start + 4));

  const exifPointer = ifd0.get(0x8769);
  if (exifPointer !== undefined) {
    const exif = entries(u32(exifPointer + 8));
    const original = exif.get(0x9003);
    if (original !== undefined) {
      const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(ascii(original));
      if (m) {
        const offsetEntry = exif.get(0x9011);
        const zone = offsetEntry !== undefined ? ascii(offsetEntry) : '';
        const iso = `${m[1] ?? ''}-${m[2] ?? ''}-${m[3] ?? ''}T${m[4] ?? ''}:${m[5] ?? ''}:${m[6] ?? ''}${/^[+-]\d{2}:\d{2}$/.test(zone) ? zone : TURKEY_OFFSET}`;
        const ms = Date.parse(iso);
        if (Number.isFinite(ms)) facts.takenAt = Math.floor(ms / 1000);
      }
    }
  }

  const gpsPointer = ifd0.get(0x8825);
  if (gpsPointer !== undefined) {
    const gps = entries(u32(gpsPointer + 8));
    const coordinate = (refTag: number, valueTag: number, negative: string): number | undefined => {
      const ref = gps.get(refTag);
      const value = gps.get(valueTag);
      if (ref === undefined || value === undefined) return undefined;
      const [d = NaN, m = 0, s = 0] = rationals(value);
      const degrees = d + m / 60 + s / 3600;
      if (!Number.isFinite(degrees)) return undefined;
      return ascii(ref) === negative ? -degrees : degrees;
    };
    const lat = coordinate(1, 2, 'S');
    const lng = coordinate(3, 4, 'W');
    if (lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      facts.lat = Math.round(lat * 1e6) / 1e6;
      facts.lng = Math.round(lng * 1e6) / 1e6;
    }
  }
  return facts;
}
