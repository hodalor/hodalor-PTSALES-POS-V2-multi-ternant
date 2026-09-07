import pino from 'pino';
import pinoHttp from 'pino-http';

function shouldSkipRequestLog(req) {
  const url = String(req?.url || '');
  return url.includes('/api/auth/me') || url.includes('/api/server-logs');
}

export const logger = pino({
  level: String(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie'
    ],
    remove: true
  }
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: shouldSkipRequestLog
  },
  customProps(req) {
    return {
      tenantId: String(req?.tenantId || req?.user?.tenantId || 'master'),
      actor: String(req?.user?.name || 'anonymous')
    };
  }
});
