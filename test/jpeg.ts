/** A tiny JPEG with an EXIF block: when it was taken and, if given, where. For tests. */
export function jpegWithExif(options: {
  taken?: string; // "YYYY:MM:DD HH:MM:SS"
  offset?: string; // "+03:00"
  lat?: [number, number, number, 'N' | 'S'];
  lng?: [number, number, number, 'E' | 'W'];
  salt?: number;
}): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0)).concat([0]);

  // Layout: header (8) | IFD0 | Exif IFD | GPS IFD | data
  const ifd0Entries = 2;
  const exifEntries = options.offset ? 2 : 1;
  const gpsEntries = options.lat && options.lng ? 4 : 0;
  const ifd0 = 8;
  const exifIfd = ifd0 + 2 + ifd0Entries * 12 + 4;
  const gpsIfd = exifIfd + 2 + exifEntries * 12 + 4;
  const dataAt = gpsIfd + 2 + gpsEntries * 12 + 4;
  const data: number[] = [];
  const put = (bytes: number[]) => {
    const at = dataAt + data.length;
    data.push(...bytes);
    return at;
  };

  tiff.push(0x49, 0x49, ...u16(42), ...u32(ifd0));
  tiff.push(...u16(ifd0Entries));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfd));
  tiff.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsIfd));
  tiff.push(...u32(0));

  const taken = ascii(options.taken ?? '2026:11:27 14:05:00');
  tiff.push(...u16(exifEntries));
  tiff.push(...u16(0x9003), ...u16(2), ...u32(taken.length), ...u32(put(taken)));
  if (options.offset) {
    const zone = ascii(options.offset);
    tiff.push(...u16(0x9011), ...u16(2), ...u32(zone.length), ...u32(put(zone)));
  }
  tiff.push(...u32(0));

  tiff.push(...u16(gpsEntries));
  if (options.lat && options.lng) {
    const rational = ([d, m, s]: [number, number, number, string]) =>
      put([...u32(d), ...u32(1), ...u32(m), ...u32(1), ...u32(Math.round(s * 100)), ...u32(100)]);
    tiff.push(...u16(1), ...u16(2), ...u32(2), options.lat[3].charCodeAt(0), 0, 0, 0);
    tiff.push(...u16(2), ...u16(5), ...u32(3), ...u32(rational(options.lat)));
    tiff.push(...u16(3), ...u16(2), ...u32(2), options.lng[3].charCodeAt(0), 0, 0, 0);
    tiff.push(...u16(4), ...u16(5), ...u32(3), ...u32(rational(options.lng)));
  }
  tiff.push(...u32(0));
  const body = [...tiff, ...data];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...body];
  const length = app1.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (length >> 8) & 0xff,
    length & 0xff,
    ...app1,
    0xff,
    0xda,
    0x00,
    0x02,
    options.salt ?? 0,
    0xff,
    0xd9,
  ]);
}
