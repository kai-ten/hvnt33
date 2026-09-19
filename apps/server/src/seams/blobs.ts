import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * BlobStore seam: evidence originals, stored by content. The key of a blob is
 * `sha256/<hex>`, so identical files are stored once and a blob's integrity
 * can always be re-checked against its key. Locally the vault is a folder; a
 * hosted deployment uses S3-compatible object storage behind the same calls.
 */
export interface StoredBlob { key: string; sha256: string; size: number }

export interface BlobStore {
  /** Move an uploaded temporary file into the store. The temporary file is consumed. */
  putFile(tempPath: string): Promise<StoredBlob>;
  /** Absolute path for streaming (local store). Throws if missing. */
  path(key: string): string;
  exists(key: string): Promise<boolean>;
  /** Where uploads land before they are hashed. */
  readonly uploadDir: string;
}

const CAS = /^sha256\/([a-f0-9]{64})$/;
// Files written before content addressing: multer's random hex names.
const LEGACY = /^[a-f0-9]{16,64}$/;

export function localBlobStore(vaultDir: string): BlobStore {
  const uploadDir = path.join(vaultDir, '.uploads');
  fs.mkdirSync(uploadDir, { recursive: true });

  function resolve(key: string): string {
    const cas = CAS.exec(key);
    if (cas) return path.join(vaultDir, 'sha256', cas[1].slice(0, 2), cas[1].slice(2, 4), cas[1]);
    if (LEGACY.test(key)) return path.join(vaultDir, key);
    throw Error('Invalid evidence key');
  }

  return {
    uploadDir,
    async putFile(tempPath) {
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of fs.createReadStream(tempPath)) { hash.update(chunk as Buffer); size += (chunk as Buffer).length; }
      const sha256 = hash.digest('hex');
      const key = `sha256/${sha256}`;
      const target = resolve(key);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      if (await fsp.stat(target).then(() => true, () => false)) await fsp.unlink(tempPath);
      else { await fsp.rename(tempPath, target); await fsp.chmod(target, 0o444).catch(() => {}); }
      return { key, sha256, size };
    },
    path: resolve,
    async exists(key) { return fsp.stat(resolve(key)).then(() => true, () => false); },
  };
}
