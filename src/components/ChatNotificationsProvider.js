import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { createChatStream, listChatUsers, listIncomingCalls, sendCallSignal } from '../api/chatMessages';
import Modal from './Modal';
import { useToast } from './ToastProvider';
import { playChatSound, startIncomingRingtone, stopIncomingRingtone, unlockChatSound } from '../utils/chatSound';

const ChatNotificationsContext = createContext({
  enabled: false,
  unreadCount: 0,
  unreadUsers: [],
  liveStatus: 'offline',
  refreshUsers: async () => [],
  incomingCall: null,
  acceptIncomingCall: async () => {},
  rejectIncomingCall: async () => {}
});

const PENDING_INCOMING_CALL_KEY = 'ptSales:pendingIncomingCall';
const AUTO_ANSWER_INCOMING_CALL_KEY = 'ptSales:autoAnswerIncomingCall';
const INCOMING_CALL_EVENT = 'ptSales:incoming-call';
const CLEAR_INCOMING_CALL_EVENT = 'ptSales:incoming-call-cleared';

function hasGrant(grants, grant) {
  const list = Array.isArray(grants) ? grants : [];
  if (list.includes(grant)) return true;
  if (String(grant || '').startsWith('view_')) return list.includes(`see_${String(grant).slice(5)}`);
  if (String(grant || '').startsWith('see_')) return list.includes(`view_${String(grant).slice(4)}`);
  return false;
}

function canUseCommunication(auth, settings) {
  const role = String(auth?.role || auth?.user?.role || '').toLowerCase();
  const roleOk = ['admin', 'manager', 'cashier', 'inventory staff', 'superadmin'].includes(role);
  const grantOk = hasGrant(auth?.grants, 'view_chat') || hasGrant(auth?.grants, 'send_chat_messages');
  return !!auth?.isAuthenticated
    && settings?.featureFlags?.['modules.communication'] !== false
    && settings?.featureFlags?.['pages.communication.chat'] !== false
    && (roleOk || grantOk);
}

function readIncomingCallStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const callId = String(parsed?.callId || '').trim();
    const senderName = String(parsed?.senderName || '').trim();
    if (!callId || !senderName) return null;
    return {
      callId,
      senderName,
      startedAt: parsed?.startedAt || new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export function useChatNotifications() {
  return useContext(ChatNotificationsContext);
}

function ChatNotificationsProvider({ children }) {
  const auth = useSelector((s) => s.auth);
  const settings = useSelector((s) => s.settings);
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [liveStatus, setLiveStatus] = useState('offline');
  const [incomingCall, setIncomingCall] = useState(null);
  const [actingOnIncomingCall, setActingOnIncomingCall] = useState(false);
  const enabled = canUseCommunication(auth, settings);
  const notificationSound = String(settings?.chatNotificationSound || 'bright').toLowerCase();
  const callSound = String(settings?.callNotificationSound || settings?.chatNotificationSound || 'bright').toLowerCase();
  const currentUserName = String(auth?.user?.name || '').trim();
  const seenMessageIdsRef = useRef(new Set());
  const seenIncomingCallIdsRef = useRef(new Set());
  const unreadBySenderRef = useRef(new Map());
  const recentAlertRef = useRef(new Map());
  const streamRef = useRef(null);
  const retryRef = useRef(null);

  const rememberAlert = useCallback((key) => {
    const now = Date.now();
    recentAlertRef.current.set(key, now);
    if (recentAlertRef.current.size > 120) {
      const next = new Map();
      Array.from(recentAlertRef.current.entries())
        .filter(([, at]) => now - at < 120000)
        .slice(-60)
        .forEach(([itemKey, at]) => next.set(itemKey, at));
      recentAlertRef.current = next;
    }
  }, []);

  const recentlyAlerted = useCallback((key, maxAgeMs = 4000) => {
    const lastAt = Number(recentAlertRef.current.get(key) || 0);
    return lastAt > 0 && (Date.now() - lastAt) < maxAgeMs;
  }, []);

  const clearStoredIncomingCall = useCallback(() => {
    try {
      localStorage.removeItem(PENDING_INCOMING_CALL_KEY);
      localStorage.removeItem(AUTO_ANSWER_INCOMING_CALL_KEY);
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent(CLEAR_INCOMING_CALL_EVENT));
    } catch {}
  }, []);

  const persistIncomingCall = useCallback((call) => {
    if (!call?.callId || !call?.senderName) return;
    const payload = {
      callId: String(call.callId || ''),
      senderName: String(call.senderName || ''),
      startedAt: call.startedAt || new Date().toISOString()
    };
    try {
      localStorage.setItem(PENDING_INCOMING_CALL_KEY, JSON.stringify(payload));
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent(INCOMING_CALL_EVENT, { detail: payload }));
    } catch {}
  }, []);

  const dismissIncomingCall = useCallback(() => {
    stopIncomingRingtone();
    setIncomingCall(null);
    clearStoredIncomingCall();
  }, [clearStoredIncomingCall]);

  const showIncomingNotice = useCallback((event) => {
    const incomingId = String(event?.message?.id || '');
    if (incomingId) {
      if (seenMessageIdsRef.current.has(incomingId)) return;
      seenMessageIdsRef.current.add(incomingId);
      if (seenMessageIdsRef.current.size > 200) {
        seenMessageIdsRef.current = new Set(Array.from(seenMessageIdsRef.current).slice(-120));
      }
    }
    const senderName = String(event?.senderName || 'New message').trim() || 'New message';
    const preview = String(event?.message?.text || '').trim();
    const dedupeKey = incomingId ? `message:${incomingId}` : `message:${senderName}:${preview}`;
    if (recentlyAlerted(dedupeKey)) return;
    rememberAlert(dedupeKey);
    playChatSound(notificationSound).catch(() => {});
    toast.show(`New message from ${senderName}`, {
      message: preview.length > 90 ? `${preview.slice(0, 90)}...` : (preview || 'Open Communication to reply.'),
      type: 'info',
      timeout: 5000
    });
    try {
      if (typeof Notification !== 'undefined') {
        const openNotice = () => {
          const notification = new Notification(`Message from ${senderName}`, {
            body: preview || 'Open Communication to reply.'
          });
          setTimeout(() => {
            try { notification.close(); } catch {}
          }, 5000);
        };
        if (Notification.permission === 'granted') {
          openNotice();
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') openNotice();
          }).catch(() => {});
        }
      }
    } catch {}
  }, [notificationSound, rememberAlert, recentlyAlerted, toast]);

  const queueIncomingCall = useCallback((call) => {
    const callId = String(call?.callId || '').trim();
    const senderName = String(call?.senderName || call?.callerName || '').trim();
    if (!callId || !senderName || senderName === currentUserName) return;
    const payload = {
      callId,
      senderName,
      startedAt: call?.startedAt || new Date().toISOString()
    };
    persistIncomingCall(payload);
    if (!seenIncomingCallIdsRef.current.has(callId)) {
      seenIncomingCallIdsRef.current.add(callId);
      toast.show(`Incoming voice call from ${senderName}`, { type: 'info', timeout: 5000 });
    }
    if (!String(location.pathname || '').startsWith('/communication/chat')) {
      setIncomingCall(payload);
    }
    startIncomingRingtone(callSound).catch(() => {});
  }, [callSound, currentUserName, location.pathname, persistIncomingCall, toast]);

  const refreshUsers = useCallback(async () => {
    if (!enabled) {
      setUsers([]);
      unreadBySenderRef.current = new Map();
      return [];
    }
    const rows = await listChatUsers().catch(() => []);
    const nextUsers = Array.isArray(rows) ? rows : [];
    const nextUnreadMap = new Map();
    nextUsers.forEach((row) => {
      const senderName = String(row?.name || '').trim();
      const nextCount = Number(row?.unreadCount || 0) || 0;
      const prevCount = Number(unreadBySenderRef.current.get(senderName) || 0) || 0;
      if (senderName) nextUnreadMap.set(senderName, nextCount);
      if (senderName && nextCount > prevCount && senderName !== currentUserName) {
        const dedupeKey = `unread:${senderName}:${nextCount}`;
        if (!recentlyAlerted(dedupeKey)) {
          rememberAlert(dedupeKey);
          playChatSound(notificationSound).catch(() => {});
          toast.show(`New message from ${senderName}`, {
            message: 'Open Communication to reply.',
            type: 'info',
            timeout: 5000
          });
        }
      }
    });
    unreadBySenderRef.current = nextUnreadMap;
    setUsers(nextUsers);
    return nextUsers;
  }, [currentUserName, enabled, notificationSound, rememberAlert, recentlyAlerted, toast]);

  const refreshIncomingCalls = useCallback(async () => {
    if (!enabled || !currentUserName) {
      dismissIncomingCall();
      return [];
    }
    const rows = await listIncomingCalls().catch(() => []);
    const nextRows = Array.isArray(rows) ? rows : [];
    const latest = nextRows.find((row) => String(row?.calleeName || '').trim() === currentUserName) || null;
    if (latest?.callId && latest?.callerName) {
      queueIncomingCall({
        callId: latest.callId,
        senderName: latest.callerName,
        startedAt: latest.startedAt
      });
    } else if (incomingCall?.callId) {
      dismissIncomingCall();
    }
    return nextRows;
  }, [currentUserName, dismissIncomingCall, enabled, incomingCall?.callId, queueIncomingCall]);

  const rejectIncomingCall = useCallback(async () => {
    const activeCall = incomingCall || readIncomingCallStorage(PENDING_INCOMING_CALL_KEY);
    if (!activeCall?.callId || !activeCall?.senderName) {
      dismissIncomingCall();
      return;
    }
    try {
      setActingOnIncomingCall(true);
      await sendCallSignal({
        recipientName: activeCall.senderName,
        callId: activeCall.callId,
        signalType: 'rejected',
        payload: {}
      });
    } catch (e) {
      toast.show(String(e?.message || 'Unable to reject the incoming call'), { type: 'error' });
    } finally {
      setActingOnIncomingCall(false);
      dismissIncomingCall();
    }
  }, [dismissIncomingCall, incomingCall, toast]);

  const acceptIncomingCall = useCallback(async () => {
    const activeCall = incomingCall || readIncomingCallStorage(PENDING_INCOMING_CALL_KEY);
    if (!activeCall?.callId || !activeCall?.senderName) {
      dismissIncomingCall();
      return;
    }
    try {
      setActingOnIncomingCall(true);
      try {
        localStorage.setItem(PENDING_INCOMING_CALL_KEY, JSON.stringify(activeCall));
        localStorage.setItem(AUTO_ANSWER_INCOMING_CALL_KEY, JSON.stringify(activeCall));
      } catch {}
      stopIncomingRingtone();
      setIncomingCall(null);
      navigate('/communication/chat');
    } finally {
      setActingOnIncomingCall(false);
    }
  }, [dismissIncomingCall, incomingCall, navigate]);

  useEffect(() => {
    if (!enabled) return undefined;
    const unlockSound = () => {
      unlockChatSound().catch(() => {});
    };
    window.addEventListener('pointerdown', unlockSound, { passive: true });
    window.addEventListener('keydown', unlockSound);
    return () => {
      window.removeEventListener('pointerdown', unlockSound);
      window.removeEventListener('keydown', unlockSound);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      setLiveStatus('offline');
      dismissIncomingCall();
      return undefined;
    }
    let alive = true;

    const clearStream = () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = null;
      if (streamRef.current) {
        try { streamRef.current.close(); } catch {}
        streamRef.current = null;
      }
    };

    const connectStream = async () => {
      clearStream();
      setLiveStatus('connecting');
      try {
        const stream = await createChatStream((event) => {
          if (!alive || !event?.type) return;
          if (event.type === 'connected' || event.type === 'heartbeat') {
            setLiveStatus('live');
            return;
          }
          if (event.type === 'message.created') {
            const isIncoming = String(event.recipientName || '') === currentUserName && String(event.senderName || '') !== currentUserName;
            refreshUsers().catch(() => {});
            if (isIncoming) showIncomingNotice(event);
            return;
          }
          if (event.type === 'conversation.read') {
            refreshUsers().catch(() => {});
            return;
          }
          if (event.type === 'call.signal') {
            const senderName = String(event.senderName || '').trim();
            const recipientName = String(event.recipientName || '').trim();
            const callId = String(event.callId || '').trim();
            const signalType = String(event.signalType || '').trim();
            if (!callId || !signalType) return;
            if (recipientName === currentUserName && signalType === 'invite') {
              queueIncomingCall({ callId, senderName, startedAt: event.at });
              return;
            }
            if (String(incomingCall?.callId || '') === callId && ['rejected', 'busy', 'end'].includes(signalType)) {
              dismissIncomingCall();
            }
          }
        });
        if (!alive) {
          try { stream.close(); } catch {}
          return;
        }
        streamRef.current = stream;
        stream.onopen = () => setLiveStatus('live');
        stream.onerror = () => {
          if (!alive) return;
          setLiveStatus('reconnecting');
          clearStream();
          retryRef.current = setTimeout(() => {
            connectStream().catch(() => {});
          }, 3000);
        };
      } catch {
        if (!alive) return;
        setLiveStatus('reconnecting');
        retryRef.current = setTimeout(() => {
          connectStream().catch(() => {});
        }, 5000);
      }
    };

    refreshUsers().catch(() => {});
    refreshIncomingCalls().catch(() => {});
    connectStream().catch(() => {});
    const usersIntervalId = setInterval(() => {
      refreshUsers().catch(() => {});
    }, 5000);
    const callsIntervalId = setInterval(() => {
      refreshIncomingCalls().catch(() => {});
    }, 2500);

    return () => {
      alive = false;
      clearInterval(usersIntervalId);
      clearInterval(callsIntervalId);
      clearStream();
    };
  }, [currentUserName, dismissIncomingCall, enabled, incomingCall?.callId, refreshIncomingCalls, refreshUsers, showIncomingNotice, queueIncomingCall]);

  useEffect(() => {
    if (!enabled || !currentUserName || String(location.pathname || '').startsWith('/communication/chat')) return undefined;
    const revivePendingIncomingCall = () => {
      const pending = readIncomingCallStorage(PENDING_INCOMING_CALL_KEY);
      if (pending?.callId && pending?.senderName) {
        setIncomingCall(pending);
      }
    };
    revivePendingIncomingCall();
    window.addEventListener('focus', revivePendingIncomingCall);
    return () => {
      window.removeEventListener('focus', revivePendingIncomingCall);
    };
  }, [currentUserName, enabled, location.pathname]);

  const value = useMemo(() => {
    const unreadUsers = (Array.isArray(users) ? users : []).filter((row) => Number(row?.unreadCount || 0) > 0);
    const unreadCount = unreadUsers.reduce((sum, row) => sum + (Number(row?.unreadCount || 0) || 0), 0);
    return {
      enabled,
      unreadCount,
      unreadUsers,
      liveStatus,
      refreshUsers,
      incomingCall,
      acceptIncomingCall,
      rejectIncomingCall
    };
  }, [acceptIncomingCall, enabled, incomingCall, liveStatus, refreshUsers, rejectIncomingCall, users]);

  return (
    <ChatNotificationsContext.Provider value={value}>
      {children}
      {incomingCall && !String(location.pathname || '').startsWith('/communication/chat') ? (
        <Modal
          title="Incoming Voice Call"
          onClose={rejectIncomingCall}
          footer={(
            <>
              <button className="btn" type="button" onClick={rejectIncomingCall} disabled={actingOnIncomingCall}>Reject</button>
              <button className="btn btn-primary" type="button" onClick={acceptIncomingCall} disabled={actingOnIncomingCall}>Answer</button>
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{incomingCall.senderName} is calling you.</div>
            <div style={{ color: '#64748b' }}>Choose Answer to open Chat and connect the call, or Reject to decline it immediately.</div>
          </div>
        </Modal>
      ) : null}
    </ChatNotificationsContext.Provider>
  );
}

export default ChatNotificationsProvider;
