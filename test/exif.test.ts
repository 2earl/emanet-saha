import { describe, expect, it } from 'vitest';
import { photoType } from '../src/evidence';
import { readExif } from '../src/exif';
import { jpegWithExif } from './jpeg';

describe('photo facts', () => {
  it('reads when and where a photo was taken', () => {
    const facts = readExif(
      jpegWithExif({ taken: '2026:11:27 14:05:00', lat: [38, 27, 36, 'N'], lng: [27, 8, 24, 'E'] }),
    );
    expect(facts).toEqual({
      takenAt: Date.parse('2026-11-27T14:05:00+03:00') / 1000,
      lat: 38.46,
      lng: 27.14,
    });
  });

  it('uses the offset in the file, and south and west', () => {
    const facts = readExif(
      jpegWithExif({
        taken: '2026:11:27 11:05:00',
        offset: '+00:00',
        lat: [33, 52, 0, 'S'],
        lng: [151, 12, 36, 'W'],
      }),
    );
    expect(facts.takenAt).toBe(Date.parse('2026-11-27T11:05:00Z') / 1000);
    expect(facts.lat).toBeCloseTo(-33.866667, 5);
    expect(facts.lng).toBeCloseTo(-151.21, 5);
  });

  it('gives nothing for files without EXIF, or that are not JPEGs', () => {
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toEqual({});
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({});
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]))).toEqual({});
  });
});

describe('photoType', () => {
  it('knows a photo by its bytes, not its name', () => {
    const bytes = (...b: number[]) => new Uint8Array(b);
    const text = (t: string) => new TextEncoder().encode(t);
    expect(photoType(bytes(0xff, 0xd8, 0xff, 0xe1))).toBe('image/jpeg');
    expect(photoType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(photoType(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(photoType(text('\0\0\0\x18ftypheic'))).toBe('image/heic');
    expect(photoType(text('<html><script>alert(1)</script>'))).toBeNull();
    expect(photoType(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});
