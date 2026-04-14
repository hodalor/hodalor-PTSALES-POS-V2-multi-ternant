import mongoose from 'mongoose';
import { getMasterConnection } from '../config/tenancy.js';
import { getCurrentDb } from '../config/requestContext.js';

function resolveConnection(conn) {
  return conn || getCurrentDb() || mongoose.connections.find((entry) => entry.readyState === 1) || mongoose.connection || null;
}

function resolveModel(name, schema, conn) {
  const connection = resolveConnection(conn);
  if (!connection || typeof connection.model !== 'function') {
    return mongoose.models[name] || mongoose.model(name, schema);
  }
  return connection.models[name] || connection.model(name, schema);
}

export function createTenantAwareModel(name, schema) {
  const modelFor = (conn) => resolveModel(name, schema, conn);
  const proxy = new Proxy(function tenantAwareModelProxy() {}, {
    get(_target, prop) {
      const model = modelFor();
      const value = model[prop];
      return typeof value === 'function' ? value.bind(model) : value;
    },
    apply(_target, thisArg, args) {
      const model = modelFor();
      return model.apply(thisArg, args);
    },
    construct(_target, args) {
      const Model = modelFor();
      return new Model(...args);
    }
  });
  return { model: proxy, modelFor };
}

export function createMasterModel(name, schema) {
  const modelFor = async () => {
    const conn = await getMasterConnection();
    return resolveModel(name, schema, conn);
  };
  const proxy = new Proxy(function masterModelProxy() {}, {
    get(_target, prop) {
      return async (...args) => {
        const model = await modelFor();
        const value = model[prop];
        if (typeof value === 'function') return value.apply(model, args);
        return value;
      };
    }
  });
  return { model: proxy, modelFor };
}
