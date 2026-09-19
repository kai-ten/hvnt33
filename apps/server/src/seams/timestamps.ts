import { randomBytes } from 'node:crypto';

/**
 * Trusted timestamps (RFC 3161). A timestamp authority signs "this SHA-256
 * existed at this time"; anyone can later check the signed token with
 * `openssl ts -verify`. We request a token for each snapshot's manifest from
 * every configured authority, and accept a token only if it covers our digest
 * and echoes our nonce.
 */

export interface TimestampToken {
  /** The authority's URL. */
  tsa: string;
  /** Time the authority attests, ISO 8601. */
  genTime: string;
  /** The DER-encoded TimeStampResp, as returned by the authority. */
  token: Buffer;
}

// ── Minimal DER ──────────────────────────────────────────────────────────────

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, content: Buffer) => Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
/** A non-negative INTEGER from big-endian bytes. */
function integer(bytes: Buffer): Buffer {
  let b = bytes;
  while (b.length > 1 && b[0] === 0 && b[1] < 0x80) b = b.subarray(1);
  if (b[0] >= 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
// id-sha256: 2.16.840.1.101.3.4.2.1
const SHA256_OID = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

/** TimeStampReq { version 1, messageImprint (sha256), nonce, certReq TRUE }. */
export function buildRequest(sha256: Buffer, nonce: Buffer): Buffer {
  if (sha256.length !== 32) throw Error('Expected a SHA-256 digest');
  const algorithm = seq(SHA256_OID, Buffer.from([0x05, 0x00]));
  return seq(integer(Buffer.from([1])), seq(algorithm, tlv(0x04, sha256)), integer(nonce), Buffer.from([0x01, 0x01, 0xff]));
}

interface Node { tag: number; start: number; header: number; length: number; bytes: Buffer }

function read(buf: Buffer, offset: number): Node {
  if (offset + 2 > buf.length) throw Error('Truncated DER');
  const tag = buf[offset];
  let length = buf[offset + 1], header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw Error('Unsupported DER length');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + buf[offset + 2 + i];
    header += count;
  }
  if (offset + header + length > buf.length) throw Error('Truncated DER');
  return { tag, start: offset, header, length, bytes: buf.subarray(offset + header, offset + header + length) };
}

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (let offset = 0; offset < node.bytes.length;) { const child = read(node.bytes, offset); out.push(child); offset += child.header + child.length; }
  return out;
}

const OID_SIGNED_DATA = '2a864886f70d010702';
const OID_TST_INFO = '2a864886f70d0109100104';

/** GeneralizedTime (YYYYMMDDhhmmss[.fff]Z) → ISO 8601. */
function generalizedTime(bytes: Buffer): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(bytes.toString('ascii'));
  if (!m) throw Error('Unexpected time format in timestamp');
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}Z`).toISOString();
}

/**
 * Parse a TimeStampResp: status must be granted, and the TSTInfo inside the
 * signed token must cover `sha256` and echo `nonce`. Returns the attested time.
 * (Signature verification is left to `openssl ts -verify`; see evidence exports.)
 */
export function parseResponse(resp: Buffer, sha256: Buffer, nonce: Buffer): { genTime: string } {
  const top = children(read(resp, 0));
  const status = children(top[0])[0];
  const code = status.bytes.readUIntBE(0, status.bytes.length);
  if (code !== 0 && code !== 1) throw Error(`Timestamp request refused (status ${code})`);
  if (!top[1]) throw Error('Timestamp response has no token');
  const [contentType, explicit] = children(top[1]);
  if (contentType.bytes.toString('hex') !== OID_SIGNED_DATA) throw Error('Timestamp token is not CMS signed data');
  const signedData = children(children(explicit)[0]);
  const encap = children(signedData.find(n => n.tag === 0x30 && children(n)[0]?.tag === 0x06)!);
  if (encap[0].bytes.toString('hex') !== OID_TST_INFO) throw Error('Timestamp token does not contain TSTInfo');
  const octets = children(encap[1])[0];
  const tst = children(read(octets.bytes, 0));
  // TSTInfo: version, policy, messageImprint, serialNumber, genTime, [accuracy], [ordering], [nonce], …
  const imprint = children(tst[2]);
  if (!children(imprint[0])[0].bytes.equals(SHA256_OID.subarray(2))) throw Error('Timestamp uses an unexpected hash algorithm');
  if (!imprint[1].bytes.equals(sha256)) throw Error('Timestamp does not cover this digest');
  const genTime = generalizedTime(tst[4].bytes);
  const nonceNode = tst.slice(5).find(n => n.tag === 0x02);
  const strip = (b: Buffer) => { let x = b; while (x.length > 1 && x[0] === 0) x = x.subarray(1); return x; };
  if (!nonceNode || !strip(nonceNode.bytes).equals(strip(nonce))) throw Error('Timestamp nonce does not match the request');
  return { genTime };
}

/** Ask each authority for a token; failures are skipped (and reported by the caller). */
export async function timestamp(sha256: Buffer, authorities: string[], fetcher: typeof fetch = fetch): Promise<{ tokens: TimestampToken[]; errors: { tsa: string; error: string }[] }> {
  const tokens: TimestampToken[] = [], errors: { tsa: string; error: string }[] = [];
  for (const tsa of authorities) {
    try {
      const nonce = randomBytes(8);
      const res = await fetcher(tsa, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body: new Uint8Array(buildRequest(sha256, nonce)), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      const token = Buffer.from(await res.arrayBuffer());
      tokens.push({ tsa, token, ...parseResponse(token, sha256, nonce) });
    } catch (error) {
      errors.push({ tsa, error: (error as Error).message });
    }
  }
  return { tokens, errors };
}
