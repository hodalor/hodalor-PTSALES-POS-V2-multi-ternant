import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { createChatStream, listChatUsers } from '../api/chatMessages';
import { useToast } from './ToastProvider';
import { playChatSound, unlockChatSound } from '../utils/chatSound';

const ChatNotificationsContext = createContext({
  enabled: false,
  unreadCount: 0,
  unreadUsers: [],
  liveStatus: 'offline',
  refreshUsers: async () => []
});

function hasGrant(grants, grant) {
  const list = Array.isArray(grants) ? grants : [];
  if (list.includes(grant)) return true;
  if (String(grant || '').startsWith('view_')) return list.includes(`see_${String(grant).slice(5)}`);
  if (String(grant || '').startsWith('see_')) return list.includes(`view_${String(grant).slice(4)}`);
  return false;
}

function canUseCommunication(auth, settings) {
  const role = String(auth?.role || '').toLowerCase();
  const roleOk = ['admin', 'manager', 'cashier', 'inventory staff', 'superadmin'].includes(role);
  const grantOk = hasGrant(auth?.grants, 'view_chat') || hasGrant(auth?.grants, 'send_chat_messages');
  return !!auth?.isAuthenticated
    && settings?.featureFlags?.['modules.communication'] !== false
    && settings?.featureFlags?.['pages.communication.chat'] !== false
    && (roleOk || grantOk);
}

export function useChatNotifications() {
  return useContext(ChatNotificationsContext);
}

function ChatNotificationsProvider({ children }) {
  const auth = useSelector((s) => s.auth);
  const settings = useSelector((s) => s.settings);
  const toast = useToast();
  const location = useLocation();
  const [users, setUsers] = useState([]);
  const [liveStatus, setLiveStatus] = useState('offline');
  const enabled = canUseCommunication(auth, settings);
  const notificationSound = String(settings?.chatNotificationSound || 'classic').toLowerCase();
  const currentUserName = String(auth?.user?.name || '').trim();
  const seenMessageIdsRef = useRef(new Set());
  const streamRef = useRef(null);
  const retryRef = useRef(null);

  const refreshUsers = useCallback(async () => {
    if (!enabled) {
      setUsers([]);
      return [];
    }
    const rows = await listChatUsers().catch(() => []);
    const nextUsers = Array.isArray(rows) ? rows : [];
    setUsers(nextUsers);
    return nextUsers;
  }, [enabled]);

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

    const showIncomingNotice = (event) => {
      const incomingId = String(event?.message?.id || '');
      if (incomingId) {
        if (seenMessageIdsRef.current.has(incomingId)) return;
        seenMessageIdsRef.current.add(incomingId);
        if (seenMessageIdsRef.current.size > 200) {
          const next = Array.from(seenMessageIdsRef.current).slice(-120);
          seenMessageIdsRef.current = new Set(next);
        }
      }
      if (String(location.pathname || '').startsWith('/communication/chat')) return;
      const senderName = String(event?.senderName || 'New message').trim() || 'New message';
      const preview = String(event?.message?.text || '').trim();
      playChatSound(notificationSound).catch(() => {});
      toast.show(`New message from ${senderName}`, {
        message: preview.length > 90 ? `${preview.slice(0, 90)}...` : preview,
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
    connectStream().catch(() => {});
    const intervalId = setInterval(() => {
      refreshUsers().catch(() => {});
    }, 45000);

    return () => {
      alive = false;
      clearInterval(intervalId);
      clearStream();
    };
  }, [currentUserName, enabled, location.pathname, notificationSound, refreshUsers, toast]);

  const value = useMemo(() => {
    const unreadUsers = (Array.isArray(users) ? users : []).filter((row) => Number(row?.unreadCount || 0) > 0);
    const unreadCount = unreadUsers.reduce((sum, row) => sum + (Number(row?.unreadCount || 0) || 0), 0);
    return {
      enabled,
      unreadCount,
      unreadUsers,
      liveStatus,
      refreshUsers
    };
  }, [enabled, liveStatus, refreshUsers, users]);

  return (
    <ChatNotificationsContext.Provider value={value}>
      {children}
    </ChatNotificationsContext.Provider>
  );
}

export default ChatNotificationsProvider;
