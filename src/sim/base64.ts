// Typed arrays travel in saves as base64 of their raw bytes (native byte order: every browser
// the game runs in is little-endian).

const CHUNK = 0x8000;

/** The first `byteLength` bytes of a typed array, as base64. */
export function encodeBytes(v: ArrayBufferView, byteLength: number = v.byteLength): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

/** Writes decoded base64 over the start of a typed array; returns how many bytes it wrote. */
export function decodeBytesInto(v: ArrayBufferView, b64: string): number {
  const s = atob(b64);
  if (s.length > v.byteLength) throw new Error("Save data does not fit");
  const bytes = new Uint8Array(v.buffer, v.byteOffset, s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return s.length;
}
