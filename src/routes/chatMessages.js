import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { modelFor as ChatMessageModelFor } from '../models/ChatMessage.js';
import { modelFor as UserModelFor } from '../models/User.js';
import { requireAuth, requireFeature, requireRoleOrPerm } from '../middleware/auth.js';
import { publishChatEvent, subscribeToChatEvents } from '../utils/chatEvents.js';

const r = Router();

const CAN_CHAT = ['view_chat', 'send_chat_messages'];

function normalizeName(value) {
  return String(value || '').trim();
}

function tenantKey(req) {
  return String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
}

function serializeMessage(row) {
  return {
    id: String(row._id || row.id || ''),
    senderName: row.senderName,
    senderRole: row.senderRole || '',
    recipientName: row.recipientName,
    text: row.text || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    readAt: row.readAt || null
  };
}

function buildConversationKey(a, b) {
  return [normalizeName(a), normalizeName(b)].filter(Boolean).sort().join('::');
}

function issueStreamToken(req) {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    const err = new Error('Server config error');
    err.statusCode = 500;
    throw err;
  }
  return jwt.sign({
    type: 'chat_stream',
    tenantId: tenantKey(req),
    name: normalizeName(req.user?.name),
    role: String(req.user?.role || '')
  }, secret, { expiresIn: '12h' });
}

function readStreamIdentity(streamToken) {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    const err = new Error('Server config error');
    err.statusCode = 500;
    throw err;
  }
  try {
    const decoded = jwt.verify(String(streamToken || ''), secret);
    if (decoded?.type !== 'chat_stream' || !decoded?.name) {
      const err = new Error('Invalid stream token');
      err.statusCode = 401;
      throw err;
    }
    return decoded;
  } catch {
    const err = new Error('Invalid stream token');
    err.statusCode = 401;
    throw err;
  }
}

r.get('/users', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], CAN_CHAT), async (req, res) => {
  const User = UserModelFor(req.db);
  const ChatMessage = ChatMessageModelFor(req.db);
  const currentUser = normalizeName(req.user?.name);
  const rows = await User.find({ active: { $ne: false } }).sort({ name: 1 }).lean();
  const unreadRows = await ChatMessage.aggregate([
    { $match: { recipientName: currentUser, readAt: null } },
    { $group: { _id: '$senderName', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } }
  ]);
  const unreadBySender = new Map((Array.isArray(unreadRows) ? unreadRows : []).map((row) => [normalizeName(row._id), Number(row.count) || 0]));
  const users = rows
    .map((row) => ({
      id: String(row._id),
      name: row.name,
      role: row.role || '',
      branchId: row.branchId || '',
      unreadCount: unreadBySender.get(normalizeName(row.name)) || 0
    }))
    .filter((row) => normalizeName(row.name) && normalizeName(row.name) !== currentUser);
  res.json(users);
});

r.post('/stream-token', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], CAN_CHAT), async (req, res) => {
  res.json({ token: issueStreamToken(req) });
});

r.get('/stream', async (req, res) => {
  try {
    const identity = readStreamIdentity(req.query?.streamToken);
    const currentUser = normalizeName(identity?.name);
    const currentTenantId = String(identity?.tenantId || 'master').trim() || 'master';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send({
      type: 'connected',
      live: true,
      user: currentUser,
      at: new Date().toISOString()
    });

    const unsubscribe = subscribeToChatEvents(currentTenantId, (event) => {
      const participants = Array.isArray(event?.participants) ? event.participants.map(normalizeName) : [];
      if (!participants.includes(currentUser)) return;
      send(event);
    });

    const heartbeat = setInterval(() => {
      send({ type: 'heartbeat', at: new Date().toISOString() });
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      try { res.end(); } catch {}
    });
  } catch (err) {
    res.status(Number(err?.statusCode || 401)).json({ error: String(err?.message || 'Unauthorized') });
  }
});

r.get('/conversation/:userName', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['view_chat', 'send_chat_messages']), async (req, res) => {
  const ChatMessage = ChatMessageModelFor(req.db);
  const currentUser = normalizeName(req.user?.name);
  const otherUser = normalizeName(req.params.userName);
  if (!otherUser) return res.status(400).json({ error: 'Recipient is required' });
  const limit = Math.min(300, Math.max(20, Number(req.query.limit) || 120));
  const rows = await ChatMessage.find({
    $or: [
      { senderName: currentUser, recipientName: otherUser },
      { senderName: otherUser, recipientName: currentUser }
    ]
  }).sort({ createdAt: 1 }).limit(limit).lean();
  res.json(rows.map(serializeMessage));
});

r.post('/', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['send_chat_messages', 'view_chat']), async (req, res) => {
  const User = UserModelFor(req.db);
  const ChatMessage = ChatMessageModelFor(req.db);
  const senderName = normalizeName(req.user?.name);
  const recipientName = normalizeName(req.body?.recipientName);
  const text = String(req.body?.text || '').trim();
  if (!recipientName) return res.status(400).json({ error: 'Recipient is required' });
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' });
  if (text.length > 4000) return res.status(400).json({ error: 'Message is too long' });
  const recipient = await User.findOne({ name: recipientName, active: { $ne: false } }).lean();
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });
  const doc = await ChatMessage.create({
    senderName,
    senderRole: String(req.user?.role || ''),
    recipientName,
    text
  });
  const payload = serializeMessage(doc);
  publishChatEvent(tenantKey(req), {
    type: 'message.created',
    conversationKey: buildConversationKey(senderName, recipientName),
    participants: [senderName, recipientName],
    senderName,
    recipientName,
    message: payload
  });
  res.json(payload);
});

r.post('/mark-read', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['view_chat', 'send_chat_messages']), async (req, res) => {
  const ChatMessage = ChatMessageModelFor(req.db);
  const currentUser = normalizeName(req.user?.name);
  const senderName = normalizeName(req.body?.senderName);
  if (!senderName) return res.status(400).json({ error: 'Sender is required' });
  const now = new Date();
  const result = await ChatMessage.updateMany(
    { senderName, recipientName: currentUser, readAt: null },
    { $set: { readAt: now } }
  );
  const updated = Number(result?.modifiedCount || result?.nModified || 0);
  if (updated > 0) {
    publishChatEvent(tenantKey(req), {
      type: 'conversation.read',
      conversationKey: buildConversationKey(senderName, currentUser),
      participants: [senderName, currentUser],
      senderName,
      recipientName: currentUser,
      readAt: now.toISOString()
    });
  }
  res.json({ ok: true, updated });
});

export default r;
