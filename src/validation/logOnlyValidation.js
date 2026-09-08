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

export function validateEnforced(schema, payload, context = {}) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = flattenZodIssues(result.error);
    logger.warn({
      event: 'validation_rejected',
      validationMode: 'enforced',
      scope: String(context.scope || ''),
      route: String(context.route || ''),
      method: String(context.method || ''),
      tenantId: String(context.tenantId || ''),
      userName: String(context.userName || ''),
      issues
    }, 'Request payload failed validation');
    const err = new Error(String(issues[0]?.message || 'Invalid request payload'));
    err.status = 400;
    err.validationIssues = issues;
    throw err;
  }
  return result.data;
}

export function formatValidationError(err) {
  const issues = Array.isArray(err?.validationIssues) ? err.validationIssues : [];
  if (issues.length > 0) {
    return {
      error: String(err?.message || issues[0]?.message || 'Invalid request payload')
    };
  }
  return {
    error: String(err?.message || 'Invalid request payload')
  };
}

export const zStringId = z.union([z.string(), z.number()]).transform((value) => String(value || '').trim());
export const zLooseNumber = z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((value) => Number(value || 0));
export const zLooseBoolean = z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()]).transform((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
});
