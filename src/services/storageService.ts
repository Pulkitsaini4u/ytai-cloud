/**
 * Cloud Storage Service
 * Supports: Cloudflare R2 (S3-compatible), Backblaze B2, local /tmp
 * Free tiers: R2=10GB, B2=10GB, both free with no egress fees
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// ── R2 / S3-compatible client ─────────────────────────────
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  if (config.storage.provider === 'r2') {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.storage.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.storage.r2.accessKey,
        secretAccessKey: config.storage.r2.secretKey,
      },
    });
  } else if (config.storage.provider === 'b2') {
    // B2 is S3-compatible
    s3Client = new S3Client({
      region: 'us-west-004',
      endpoint: `https://s3.us-west-004.backblazeb2.com`,
      credentials: {
        accessKeyId: config.storage.b2.keyId,
        secretAccessKey: config.storage.b2.appKey,
      },
    });
  }

  return s3Client!;
}

function getBucket(): string {
  if (config.storage.provider === 'r2') return config.storage.r2.bucket;
  if (config.storage.provider === 'b2') return config.storage.b2.bucket;
  return 'local';
}

// ── Upload file to cloud ──────────────────────────────────
export async function uploadFile(
  localPath: string,
  storageKey: string,
  contentType = 'application/octet-stream'
): Promise<string> {
  if (config.storage.provider === 'local') {
    const destDir = path.join(config.storage.localDir, path.dirname(storageKey));
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(config.storage.localDir, storageKey);
    fs.copyFileSync(localPath, dest);
    return dest;
  }

  const fileBuffer = fs.readFileSync(localPath);
  const client = getS3Client();

  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: storageKey,
    Body: fileBuffer,
    ContentType: contentType,
  }));

  const publicUrl = config.storage.provider === 'r2'
    ? `${config.storage.r2.publicUrl}/${storageKey}`
    : `https://f004.backblazeb2.com/file/${getBucket()}/${storageKey}`;

  logger.info(`☁️  Uploaded ${storageKey} → ${publicUrl}`);
  return publicUrl;
}

// ── Upload buffer directly ────────────────────────────────
export async function uploadBuffer(
  buffer: Buffer,
  storageKey: string,
  contentType = 'application/octet-stream'
): Promise<string> {
  if (config.storage.provider === 'local') {
    const dest = path.join(config.storage.localDir, storageKey);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    return dest;
  }

  const client = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: storageKey,
    Body: buffer,
    ContentType: contentType,
  }));

  return config.storage.provider === 'r2'
    ? `${config.storage.r2.publicUrl}/${storageKey}`
    : `https://f004.backblazeb2.com/file/${getBucket()}/${storageKey}`;
}

// ── Download file from cloud to /tmp ─────────────────────
export async function downloadFile(storageKey: string, localDest: string): Promise<void> {
  if (config.storage.provider === 'local') {
    const src = path.join(config.storage.localDir, storageKey);
    fs.mkdirSync(path.dirname(localDest), { recursive: true });
    fs.copyFileSync(src, localDest);
    return;
  }

  const client = getS3Client();
  const response = await client.send(new GetObjectCommand({
    Bucket: getBucket(),
    Key: storageKey,
  }));

  fs.mkdirSync(path.dirname(localDest), { recursive: true });
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(Buffer.from(chunk));
  }
  fs.writeFileSync(localDest, Buffer.concat(chunks));
}

// ── Get signed URL for private files ─────────────────────
export async function getPresignedUrl(storageKey: string, expiresIn = 3600): Promise<string> {
  if (config.storage.provider === 'local') {
    return path.join(config.storage.localDir, storageKey);
  }

  const client = getS3Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: getBucket(), Key: storageKey }),
    { expiresIn }
  );
}

// ── Storage key helpers ───────────────────────────────────
export function videoKey(videoId: string, filename: string): string {
  return `videos/${videoId}/${filename}`;
}

export function tmpPath(filename: string): string {
  const dir = '/tmp/ytai';
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

// ── Cleanup local /tmp files ──────────────────────────────
export function cleanupTmp(videoId: string): void {
  const dir = `/tmp/ytai`;
  try {
    const files = fs.readdirSync(dir).filter(f => f.includes(videoId));
    files.forEach(f => fs.unlinkSync(path.join(dir, f)));
  } catch {}
}
