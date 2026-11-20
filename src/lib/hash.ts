/** File hashing helpers. SHA-256 when available, deterministic fallback for older runtimes. */
export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', buf as BufferSource);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // fall through
    }
  }
  return fnvHex(new Uint8Array(buf));
}

function fnvHex(bytes: Uint8Array): string {
  // Two independent FNV-1a streams concatenated to 64 bits of hex, only used as a fallback.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < bytes.length; i += 1) {
    a ^= bytes[i];
    a = Math.imul(a, 0x01000193) >>> 0;
    b ^= bytes[bytes.length - 1 - i] ^ (i & 0xff);
    b = Math.imul(b, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`.repeat(4);
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

/** Stable 32-bit digest of a JSON-able value, used for mapping / assertion versioning. */
export function digestOf(value: unknown): string {
  const text = stableStringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
