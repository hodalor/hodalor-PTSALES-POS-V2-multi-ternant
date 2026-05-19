import crypto from 'crypto';
import { Storage } from '@google-cloud/storage';

let storageClient = null;

function trimString(value = '') {
  return String(value || '').trim();
}

function normalizeBucketName(value = '') {
  return trimString(value).replace(/^gs:\/\//i, '').replace(/^\/+|\/+$/g, '');
}

function escapeFileSegment(value = '') {
  return trimString(value)
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isHttpUrl(value = '') {
  return /^https?:\/\//i.test(trimString(value));
}

function isSignedMediaUrl(value = '') {
  return /[?&](x-goog-algorithm|googleaccessid|signature)=/i.test(trimString(value));
}

export function isDataUrl(value = '') {
  return /^data:[^;,]+;base64,/i.test(trimString(value));
}

function getMimeExtension(mimeType = '') {
  const mime = trimString(mimeType).toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf'
  };
  if (map[mime]) return map[mime];
  const parts = mime.split('/');
  return escapeFileSegment(parts[1] || 'bin') || 'bin';
}

function parseDataUrl(dataUrl = '') {
  const raw = trimString(dataUrl);
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    throw new Error('Unsupported media format');
  }
  const mimeType = trimString(match[1]).toLowerCase() || 'application/octet-stream';
  const base64 = trimString(match[2]);
  return {
    mimeType,
    buffer: Buffer.from(base64, 'base64')
  };
}

function getProjectId() {
  return trimString(process.env.GCS_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '');
}

function getBucketName() {
  const envBucket = normalizeBucketName(process.env.GCS_BUCKET_NAME || process.env.GOOGLE_CLOUD_STORAGE_BUCKET || '');
  if (envBucket) return envBucket;
  const projectId = getProjectId();
  return projectId ? `${projectId}.firebasestorage.app` : '';
}

function getCredentials() {
  const clientEmail = trimString(process.env.GCS_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || '');
  const privateKey = String(process.env.GCS_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  return {
    client_email: clientEmail,
    private_key: privateKey
  };
}

export function isMediaStorageConfigured() {
  const projectId = getProjectId();
  const bucketName = getBucketName();
  const credentials = getCredentials();
  return !!(projectId && bucketName && credentials.client_email && credentials.private_key);
}

function getStorageClient() {
  if (storageClient) return storageClient;
  if (!isMediaStorageConfigured()) {
    throw new Error('Google Cloud Storage is not fully configured');
  }
  storageClient = new Storage({
    projectId: getProjectId(),
    credentials: getCredentials()
  });
  return storageClient;
}

function getPublicBaseUrl() {
  const explicit = trimString(process.env.GCS_PUBLIC_BASE_URL || '');
  if (explicit) return explicit.replace(/\/+$/g, '');
  return `https://storage.googleapis.com/${getBucketName()}`;
}

function getSignedUrlExpiry() {
  const ttlDays = Number(process.env.GCS_SIGNED_URL_TTL_DAYS || 3650);
  const safeDays = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 3650;
  return Date.now() + (safeDays * 24 * 60 * 60 * 1000);
}

function extractObjectPathFromUrl(value = '') {
  const raw = trimString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const bucketName = getBucketName();
    const host = trimString(parsed.hostname).toLowerCase();
    const pathname = trimString(parsed.pathname).replace(/^\/+/, '');
    if (host === 'storage.googleapis.com') {
      const parts = pathname.split('/');
      if (parts[0] !== bucketName) return '';
      return decodeURIComponent(parts.slice(1).join('/'));
    }
    if (host === `${bucketName}.storage.googleapis.com`) {
      return decodeURIComponent(pathname);
    }
    return '';
  } catch {
    return '';
  }
}

function buildObjectPath({
  tenantId = '',
  folder = 'media',
  originalName = '',
  mimeType = ''
} = {}) {
  const safeTenant = escapeFileSegment(tenantId) || 'shared';
  const safeFolder = escapeFileSegment(folder) || 'media';
  const safeBase = escapeFileSegment(originalName) || 'file';
  const extension = getMimeExtension(mimeType);
  const stamp = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  return `${safeTenant}/${safeFolder}/${safeBase}-${stamp}.${extension}`;
}

function buildPublicUrl(objectPath = '') {
  const safePath = String(objectPath || '').split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${getPublicBaseUrl()}/${safePath}`;
}

async function buildSignedReadUrl(objectPath = '') {
  const safeObjectPath = trimString(objectPath);
  if (!safeObjectPath) return '';
  const bucket = getStorageClient().bucket(getBucketName());
  const file = bucket.file(safeObjectPath);
  const [signedUrl] = await file.getSignedUrl({
    version: 'v2',
    action: 'read',
    expires: getSignedUrlExpiry()
  });
  return signedUrl;
}

export async function signMediaUrl(value) {
  const raw = trimString(value);
  if (!raw || !isHttpUrl(raw) || isSignedMediaUrl(raw)) return raw;
  const objectPath = extractObjectPathFromUrl(raw);
  if (!objectPath) return raw;
  if (!isMediaStorageConfigured()) {
    throw new Error('Media storage is not configured. Add Google Cloud Storage environment values.');
  }
  return buildSignedReadUrl(objectPath);
}

export async function uploadMediaString(value, options = {}) {
  const raw = trimString(value);
  if (!raw) return '';
  if (isHttpUrl(raw)) return signMediaUrl(raw);
  if (!isDataUrl(raw)) return raw;
  if (!isMediaStorageConfigured()) {
    throw new Error('Media storage is not configured. Add Google Cloud Storage environment values.');
  }
  const { mimeType, buffer } = parseDataUrl(raw);
  const objectPath = buildObjectPath({
    tenantId: options.tenantId,
    folder: options.folder,
    originalName: options.originalName,
    mimeType
  });
  const bucket = getStorageClient().bucket(getBucketName());
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000, immutable'
    }
  });
  return buildSignedReadUrl(objectPath);
}

export async function uploadMediaArray(values, buildOptions) {
  const items = Array.isArray(values) ? values : [];
  return Promise.all(items.map((value, index) => uploadMediaString(
    value,
    typeof buildOptions === 'function' ? (buildOptions(value, index) || {}) : (buildOptions || {})
  )));
}

export function sanitizeMediaForLogs(value) {
  if (typeof value === 'string') {
    const raw = trimString(value);
    if (isDataUrl(raw)) return '[media-data-url]';
    return raw.length > 4000 ? `${raw.slice(0, 4000)}...[truncated]` : raw;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeMediaForLogs(item));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      out[key] = sanitizeMediaForLogs(item);
    });
    return out;
  }
  return value;
}
