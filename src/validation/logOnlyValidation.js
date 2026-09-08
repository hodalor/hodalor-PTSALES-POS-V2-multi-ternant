import { z } from 'zod';
import { logger } from '../config/logger.js';

function flattenZodIssues(error) {
  return Array.isArray(error?.issues)
    ? error.issues.map((issue) => ({
        path: Array.isArray(issue?.path) ? issue.path.join('.') : '',
        code: String(issue?.code || ''),
        message: String(issue?.message || '')
      }))
    : [];
}

export function validateLogOnly(schema, payload, context = {}) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    logger.warn({
      event: 'validation_warn_only',
      validationMode: 'log_only',
      scope: String(context.scope || ''),
      route: String(context.route || ''),
      method: String(context.method || ''),
      tenantId: String(context.tenantId || ''),
      userName: String(context.userName || ''),
      issues: flattenZodIssues(result.error)
    }, 'Request payload would fail validation');
  }
  return result;
}

export const zStringId = z.union([z.string(), z.number()]).transform((value) => String(value || '').trim());
export const zLooseNumber = z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((value) => Number(value || 0));
export const zLooseBoolean = z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()]).transform((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
});
