import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config';
import { assertSafeKey, type ObjectStorage } from './index';

/**
 * S3-compatible driver, validated against the request shape Cloudflare R2 accepts:
 * a custom endpoint, `auto` as region, and path-style addressing.
 */
export function createS3Storage(config: AppConfig['storage']): ObjectStorage {
  if (!config.bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
  if (!config.accessKeyId || !config.secretAccessKey) throw new Error('STORAGE_DRIVER=s3 requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  });

  return {
    driver: 's3',
    async put(key, bytes, mimeType) {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: assertSafeKey(key),
        Body: bytes,
        ContentType: mimeType
      }));
    },
    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: assertSafeKey(key) }));
      if (!response.Body) throw new Error(`Artifact ${key} has no body`);
      // Copied into a fresh buffer so the result is a plain ArrayBuffer view, which is
      // what Blob and Response accept.
      return Uint8Array.from(await response.Body.transformToByteArray());
    },
    async signedUrl(key) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: config.bucket, Key: assertSafeKey(key) }),
        { expiresIn: config.signedUrlTtlSeconds }
      );
    },
    async removePrefix(prefix) {
      let continuationToken: string | undefined;
      do {
        const listed = await client.send(new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: `${assertSafeKey(prefix)}/`,
          ContinuationToken: continuationToken
        }));
        const keys = (listed.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key));
        if (keys.length) {
          await client.send(new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) }
          }));
        }
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
    }
  };
}
