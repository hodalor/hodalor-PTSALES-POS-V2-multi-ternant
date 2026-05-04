import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { modelFor as ChatMessageModelFor } from '../models/ChatMessage.js';
import { modelFor as ChatCallLogModelFor } from '../models/ChatCallLog.js';
import { modelFor as ChatCallSignalModelFor } from '../models/ChatCallSignal.js';
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
    replyTo: row.replyTo?.messageId ? {
      messageId: String(row.replyTo.messageId || ''),
      senderName: row.replyTo.senderName || '',
      text: row.replyTo.text || ''
    } : null,
    reactions: Array.isArray(row.reactions)
      ? row.reactions
        .filter((item) => item?.emoji && Array.isArray(item?.users) && item.users.length > 0)
        .map((item) => ({
          emoji: String(item.emoji || ''),
          users: item.users.map((user) => normalizeName(user)).filter(Boolean),
          count: Array.isArray(item.users) ? item.users.length : 0
        }))
      : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    readAt: row.readAt || null
  };
}

function buildConversationKey(a, b) {
  return [normalizeName(a), normalizeName(b)].filter(Boolean).sort().join('::');
}

function serializeCallLog(row, currentUser = '') {
  const callerName = normalizeName(row?.callerName);
  const calleeName = normalizeName(row?.calleeName);
  const mine = normalizeName(currentUser);
  const peerName = mine === callerName ? calleeName : callerName;
  const direction = mine === callerName ? 'outgoing' : 'incoming';
  return {
    id: String(row?._id || row?.id || ''),
    callId: String(row?.callId || ''),
    callerName,
    calleeName,
    peerName,
    direction,
    status: String(row?.status || 'ended'),
    startedAt: row?.startedAt || null,
    answeredAt: row?.answeredAt || null,
    endedAt: row?.endedAt || null,
    durationSec: Number(row?.durationSec || 0),
    endedBy: normalizeName(row?.endedBy || ''),
    endReason: String(row?.endReason || '')
  };
}

function serializeIncomingCall(row) {
  return {
    id: String(row?._id || row?.id || ''),
    callId: String(row?.callId || ''),
    callerName: normalizeName(row?.callerName),
    calleeName: normalizeName(row?.calleeName),
    status: String(row?.status || 'ringing'),
    startedAt: row?.startedAt || null
  };
}

function serializeCallSignal(row) {
  return {
    id: String(row?._id || row?.id || ''),
    callId: String(row?.callId || ''),
    senderName: normalizeName(row?.senderName),
    recipientName: normalizeName(row?.recipientName),
    signalType: String(row?.signalType || ''),
    payload: row?.payload && typeof row.payload === 'object' ? row.payload : {},
    createdAt: row?.createdAt || null
  };
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
  const currentRole = String(req.user?.role || '').trim().toLowerCase();
  const userQuery = { active: { $ne: false } };
  if (currentRole !== 'superadmin') {
    userQuery.role = { $ne: 'SuperAdmin' };
  }
  const rows = await User.find(userQuery).sort({ name: 1 }).lean();
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

r.get('/call-history/:userName', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], CAN_CHAT), async (req, res) => {
  const ChatCallLog = ChatCallLogModelFor(req.db);
  const currentUser = normalizeName(req.user?.name);
  const otherUser = normalizeName(req.params.userName);
  if (!otherUser) return res.status(400).json({ error: 'User is required' });
  const limit = Math.min(50, Math.max(5, Number(req.query.limit) || 12));
  const rows = await ChatCallLog.find({
    $or: [
      { callerName: currentUser, calleeName: otherUser },
      { callerName: otherUser, calleeName: currentUser }
    ]
  }).sort({ startedAt: -1, createdAt: -1 }).limit(limit).lean();
  res.json(rows.map((row) => serializeCallLog(row, currentUser)));
});

r.get('/incoming-calls', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], CAN_CHAT), async (req, res) => {
  const ChatCallLog = ChatCallLogModelFor(req.db);
  const currentUser = normalizeName(req.user?.name);
  const rows = await ChatCallLog.find({
    calleeName: currentUser,
    status: 'ringing',
    endedAt: null,
    startedAt: { $gte: new Date(Date.now() - 45 * 1000) }
  }).sort({ startedAt: -1, createdAt: -1 }).limit(5).lean();
  res.json(rows.map(serializeIncomingCall));
});

r.get('/call-signals/pending', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], CAN_CHAT), async (req, res) => {
  const ChatCallSignal = ChatCallSignalModelFor(req.db);
  const currentUser = normalizeName(req.user?.name);
  const callId = String(req.query?.callId || '').trim();
  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 80));
  const query = {
    recipientName: currentUser,
    deliveredAt: null,
    createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
  };
  if (callId) query.callId = callId;
  const rows = await ChatCallSignal.find(query).sort({ createdAt: 1, _id: 1 }).limit(limit).lean();
  if (rows.length) {
    await ChatCallSignal.updateMany(
      { _id: { $in: rows.map((row) => row._id) } },
      { $set: { deliveredAt: new Date() } }
    );
  }
  res.json(rows.map(serializeCallSignal));
});

r.post('/', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['send_chat_messages', 'view_chat']), async (req, res) => {
  const User = UserModelFor(req.db);
  const ChatMessage = ChatMessageModelFor(req.db);
  const senderName = normalizeName(req.user?.name);
  const recipientName = normalizeName(req.body?.recipientName);
  const text = String(req.body?.text || '').trim();
  const replyToMessageId = String(req.body?.replyToMessageId || '').trim();
  if (!recipientName) return res.status(400).json({ error: 'Recipient is required' });
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' });
  if (text.length > 4000) return res.status(400).json({ error: 'Message is too long' });
  const recipient = await User.findOne({ name: recipientName, active: { $ne: false } }).lean();
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });
  let replyTo = null;
  if (replyToMessageId) {
    const replyDoc = await ChatMessage.findOne({
      _id: replyToMessageId,
      $or: [
        { senderName, recipientName },
        { senderName: recipientName, recipientName: senderName }
      ]
    }).lean();
    if (!replyDoc) return res.status(404).json({ error: 'Reply message not found' });
    replyTo = {
      messageId: replyDoc._id,
      senderName: replyDoc.senderName || '',
      text: String(replyDoc.text || '').slice(0, 280)
    };
  }
  const doc = await ChatMessage.create({
    senderName,
    senderRole: String(req.user?.role || ''),
    recipientName,
    text,
    replyTo
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

r.post('/react', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['view_chat', 'send_chat_messages']), async (req, res) => {
  const ChatMessage = ChatMessageModelFor(req.db);
  const currentUser = normalizeName(req.user?.name);
  const messageId = String(req.body?.messageId || '').trim();
  const emoji = String(req.body?.emoji || '').trim();
  if (!messageId) return res.status(400).json({ error: 'Message is required' });
  if (!emoji) return res.status(400).json({ error: 'Emoji is required' });

  const doc = await ChatMessage.findById(messageId);
  if (!doc) return res.status(404).json({ error: 'Message not found' });
  const participants = [normalizeName(doc.senderName), normalizeName(doc.recipientName)];
  if (!participants.includes(currentUser)) return res.status(404).json({ error: 'Message not found' });

  const nextReactions = Array.isArray(doc.reactions) ? doc.reactions.map((item) => ({
    emoji: String(item?.emoji || ''),
    users: Array.isArray(item?.users) ? item.users.map(normalizeName).filter(Boolean) : []
  })) : [];
  const existingIndex = nextReactions.findIndex((item) => item.emoji === emoji);
  if (existingIndex >= 0) {
    const exists = nextReactions[existingIndex].users.includes(currentUser);
    nextReactions[existingIndex].users = exists
      ? nextReactions[existingIndex].users.filter((user) => user !== currentUser)
      : [...nextReactions[existingIndex].users, currentUser];
  } else {
    nextReactions.push({ emoji, users: [currentUser] });
  }
  doc.reactions = nextReactions.filter((item) => item.emoji && Array.isArray(item.users) && item.users.length > 0);
  await doc.save();

  const payload = serializeMessage(doc);
  publishChatEvent(tenantKey(req), {
    type: 'message.reaction',
    conversationKey: buildConversationKey(doc.senderName, doc.recipientName),
    participants: [doc.senderName, doc.recipientName],
    senderName: doc.senderName,
    recipientName: doc.recipientName,
    messageId: payload.id,
    reactions: payload.reactions,
    message: payload
  });
  res.json(payload);
});

r.post('/call-signal', requireAuth, requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['view_chat', 'send_chat_messages']), async (req, res) => {
  const User = UserModelFor(req.db);
  const ChatCallLog = ChatCallLogModelFor(req.db);
  const ChatCallSignal = ChatCallSignalModelFor(req.db);
  const senderName = normalizeName(req.user?.name);
  const recipientName = normalizeName(req.body?.recipientName);
  const callId = String(req.body?.callId || '').trim();
  const signalType = String(req.body?.signalType || '').trim();
  const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
  const allowedSignalTypes = new Set(['invite', 'accepted', 'rejected', 'offer', 'answer', 'ice', 'end', 'busy']);
  if (!recipientName) return res.status(400).json({ error: 'Recipient is required' });
  if (!callId) return res.status(400).json({ error: 'Call id is required' });
  if (!allowedSignalTypes.has(signalType)) return res.status(400).json({ error: 'Invalid call signal type' });
  const recipient = await User.findOne({ name: recipientName, active: { $ne: false } }).lean();
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

  if (signalType === 'invite') {
    await ChatCallLog.findOneAndUpdate(
      { callId },
      {
        $setOnInsert: {
          callId,
          callerName: senderName,
          calleeName: recipientName,
          status: 'ringing',
          startedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
  } else if (signalType === 'accepted') {
    await ChatCallLog.findOneAndUpdate(
      { callId },
      { $set: { status: 'accepted', answeredAt: new Date(), endedAt: null, endReason: '' } }
    );
  } else if (signalType === 'rejected') {
    await ChatCallLog.findOneAndUpdate(
      { callId },
      { $set: { status: 'rejected', endedAt: new Date(), endedBy: senderName, endReason: 'rejected', durationSec: 0 } }
    );
  } else if (signalType === 'busy') {
    await ChatCallLog.findOneAndUpdate(
      { callId },
      { $set: { status: 'busy', endedAt: new Date(), endedBy: senderName, endReason: 'busy', durationSec: 0 } }
    );
  } else if (signalType === 'end') {
    const existing = await ChatCallLog.findOne({ callId }).lean();
    const endedAt = new Date();
    const answeredAt = existing?.answeredAt ? new Date(existing.answeredAt) : null;
    const ringingOnly = !answeredAt && String(existing?.status || '') !== 'accepted';
    const endReason = String(payload?.reason || '').trim().toLowerCase();
    const nextStatus = ringingOnly
      ? (endReason === 'timeout' ? 'missed' : 'cancelled')
      : 'ended';
    const baseTime = answeredAt || (existing?.startedAt ? new Date(existing.startedAt) : endedAt);
    const durationSec = ringingOnly ? 0 : Math.max(0, Math.round((endedAt.getTime() - baseTime.getTime()) / 1000));
    await ChatCallLog.findOneAndUpdate(
      { callId },
      {
        $set: {
          status: nextStatus,
          endedAt,
          endedBy: senderName,
          endReason: endReason || nextStatus,
          durationSec
        }
      }
    );
  }

  await ChatCallSignal.create({
    callId,
    senderName,
    recipientName,
    signalType,
    payload,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  });

  const event = {
    type: 'call.signal',
    conversationKey: buildConversationKey(senderName, recipientName),
    participants: [senderName, recipientName],
    senderName,
    recipientName,
    callId,
    signalType,
    payload,
    at: new Date().toISOString()
  };
  publishChatEvent(tenantKey(req), event);
  res.json({ ok: true });
});

export default r;
