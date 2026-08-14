import type { AppConfig } from '../config';
import { assertSafeKey, type ObjectStorage } from './index';

/**
 * S3-compatible driver, validated against the request shape Cloudflare R2 accepts:
 * a custom endpoint, `auto` as region, and path-style addressing.
 *
 * The AWS SDK is loaded on first use rather than at import time. It is by far the
 * heaviest dependency in the tree, and a deployment running STORAGE_DRIVER=fs must not
 * pay for a client it never constructs.
 */
async function loadSdk() {
  const [client, presigner] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/s3-request-presigner')
  ]);
  return { ...client, getSignedUrl: presigner.getSignedUrl };
}

export function createS3Storage(config: AppConfig['storage']): ObjectStorage {
  if (!config.bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
  if (!config.accessKeyId || !config.secretAccessKey) throw new Error('STORAGE_DRIVER=s3 requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');

  // Memoized so the SDK is imported and the client built at most once per process.
  let pending: Promise<{ sdk: Awaited<ReturnType<typeof loadSdk>>; client: InstanceType<Awaited<ReturnType<typeof loadSdk>>['S3Client']> }> | null = null;
  const connect = () => pending ??= loadSdk().then((sdk) => ({
    sdk,
    client: new sdk.S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    })
  }));

  return {
    driver: 's3',
    async put(key, bytes, mimeType) {
      const { sdk, client } = await connect();
      await client.send(new sdk.PutObjectCommand({
        Bucket: config.bucket,
        Key: assertSafeKey(key),
        Body: bytes,
        ContentType: mimeType
      }));
    },
    async get(key) {
      const { sdk, client } = await connect();
      const response = await client.send(new sdk.GetObjectCommand({ Bucket: config.bucket, Key: assertSafeKey(key) }));
      if (!response.Body) throw new Error(`Artifact ${key} has no body`);
      // Copied into a fresh buffer so the result is a plain ArrayBuffer view, which is
      // what Blob and Response accept.
      return Uint8Array.from(await response.Body.transformToByteArray());
    },
    async signedUrl(key) {
      const { sdk, client } = await connect();
      return sdk.getSignedUrl(
        client,
        new sdk.GetObjectCommand({ Bucket: config.bucket, Key: assertSafeKey(key) }),
        { expiresIn: config.signedUrlTtlSeconds }
      );
    },
    async removePrefix(prefix) {
      const { sdk, client } = await connect();
      let continuationToken: string | undefined;
      do {
        const listed = await client.send(new sdk.ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: `${assertSafeKey(prefix)}/`,
          ContinuationToken: continuationToken
        }));
        const keys = (listed.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key));
        if (keys.length) {
          await client.send(new sdk.DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) }
          }));
        }
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
    }
  };
}
