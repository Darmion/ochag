import { gunzipSync, gzipSync } from 'node:zlib';

export type ContainerProblem = 'not-gzip' | 'wrong-signature' | 'truncated' | 'bad-header';

// gzip( signature, 32-bit header length, JSON header, blobs one after another ): the header says where each blob starts.
export function packContainer(signature: Buffer, header: unknown, blobs: Buffer[]): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return gzipSync(Buffer.concat([signature, length, json, ...blobs]));
}

export function unpackContainer<T>(signature: Buffer, compressed: Buffer, maxUnpackedBytes: number): { header: T; body: Buffer } | ContainerProblem {
  let raw: Buffer;
  try {
    raw = gunzipSync(compressed, { maxOutputLength: maxUnpackedBytes });
  } catch {
    return 'not-gzip';
  }
  if (raw.length < signature.length + 4 || !raw.subarray(0, signature.length).equals(signature)) return 'wrong-signature';
  const headerLength = raw.readUInt32BE(signature.length);
  const start = signature.length + 4;
  if (start + headerLength > raw.length) return 'truncated';
  try {
    return { header: JSON.parse(raw.subarray(start, start + headerLength).toString('utf8')) as T, body: raw.subarray(start + headerLength) };
  } catch {
    return 'bad-header';
  }
}
