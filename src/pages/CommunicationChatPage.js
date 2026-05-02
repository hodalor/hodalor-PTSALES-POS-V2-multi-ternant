import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import * as chatApi from '../api/chatMessages';

function CommunicationChatPage() {
  const auth = useSelector((s) => s.auth);
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [userQuery, setUserQuery] = useState('');
  const [selectedUserName, setSelectedUserName] = useState('');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [liveStatus, setLiveStatus] = useState('connecting');
  const bottomRef = useRef(null);
  const selectedUserNameRef = useRef('');
  const streamRef = useRef(null);
  const currentUserName = String(auth.user?.name || '').trim();

  const appendUniqueMessage = useCallback((incoming) => {
    setMessages((prev) => {
      const incomingId = String(incoming?.id || '');
      if (!incomingId) return [...prev, incoming];
      if (prev.some((row) => String(row?.id || '') === incomingId)) return prev;
      return [...prev, incoming];
    });
  }, []);

  useEffect(() => {
    selectedUserNameRef.current = selectedUserName;
  }, [selectedUserName]);

  const loadUsers = useCallback(async (preferredName = '') => {
    setLoadingUsers(true);
    try {
      const rows = await chatApi.listChatUsers();
      const nextUsers = Array.isArray(rows) ? rows : [];
      setUsers(nextUsers);
      const currentSelected = String(selectedUserNameRef.current || '').trim();
      const preferred = String(preferredName || currentSelected || '').trim();
      if (preferred && nextUsers.some((row) => String(row.name || '') === preferred)) {
        setSelectedUserName(preferred);
      } else if (!currentSelected && nextUsers[0]?.name) {
        setSelectedUserName(String(nextUsers[0].name));
      } else if (currentSelected && !nextUsers.some((row) => String(row.name || '') === currentSelected)) {
        setSelectedUserName(String(nextUsers[0]?.name || ''));
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load chat users'), { type: 'error' });
    } finally {
      setLoadingUsers(false);
    }
  }, [toast]);

  const loadMessages = useCallback(async (targetUser = selectedUserNameRef.current) => {
    const target = String(targetUser || '').trim();
    if (!target) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    try {
      const rows = await chatApi.listConversation(target, { limit: 200 });
      const nextMessages = Array.isArray(rows) ? rows : [];
      setMessages(nextMessages);
      const hasUnreadFromTarget = nextMessages.some((row) => String(row.senderName || '') === target && !row.readAt);
      if (hasUnreadFromTarget) {
        await chatApi.markConversationRead(target).catch(() => {});
        await loadUsers(target);
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load conversation'), { type: 'error' });
    } finally {
      setLoadingMessages(false);
    }
  }, [loadUsers, toast]);

  useEffect(() => {
    loadUsers();
    const tid = setInterval(() => {
      loadUsers();
    }, 45000);
    return () => clearInterval(tid);
  }, [loadUsers]);

  useEffect(() => {
    loadMessages(selectedUserName);
    if (!selectedUserName) return undefined;
    const tid = setInterval(() => {
      loadMessages(selectedUserName);
    }, 30000);
    return () => clearInterval(tid);
  }, [selectedUserName, loadMessages]);

  useEffect(() => {
    let alive = true;
    let retryId = null;

    function cleanupStream() {
      if (retryId) clearTimeout(retryId);
      retryId = null;
      if (streamRef.current) {
        try { streamRef.current.close(); } catch {}
        streamRef.current = null;
      }
    }

    async function connectStream() {
      cleanupStream();
      setLiveStatus('connecting');
      try {
        const stream = await chatApi.createChatStream(async (event) => {
          if (!alive || !event || !event.type) return;
          if (event.type === 'connected') {
            setLiveStatus('live');
            return;
          }
          if (event.type === 'heartbeat') {
            setLiveStatus('live');
            return;
          }
          if (event.type === 'message.created') {
            const otherUser = String(event.senderName || '') === currentUserName
              ? String(event.recipientName || '')
              : String(event.senderName || '');
            loadUsers(otherUser).catch(() => {});
            if (String(event.conversationKey || '') === [currentUserName, String(selectedUserNameRef.current || '')].filter(Boolean).sort().join('::')) {
              appendUniqueMessage(event.message);
              if (String(event.senderName || '') === String(selectedUserNameRef.current || '') && String(event.recipientName || '') === currentUserName) {
                await chatApi.markConversationRead(String(event.senderName || '')).catch(() => {});
                loadUsers(String(event.senderName || '')).catch(() => {});
              }
            }
            return;
          }
          if (event.type === 'conversation.read') {
            if (String(event.senderName || '') === currentUserName && String(event.recipientName || '') === String(selectedUserNameRef.current || '')) {
              setMessages((prev) => prev.map((row) => (
                String(row.senderName || '') === currentUserName && !row.readAt
                  ? { ...row, readAt: event.readAt }
                  : row
              )));
            }
            loadUsers(String(event.recipientName || event.senderName || '')).catch(() => {});
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
          cleanupStream();
          retryId = setTimeout(() => {
            connectStream().catch(() => {});
          }, 3000);
        };
      } catch {
        if (!alive) return;
        setLiveStatus('offline');
        retryId = setTimeout(() => {
          connectStream().catch(() => {});
        }, 5000);
      }
    }

    connectStream().catch(() => {});

    return () => {
      alive = false;
      cleanupStream();
    };
  }, [appendUniqueMessage, currentUserName, loadUsers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  async function onSend() {
    const text = String(draft || '').trim();
    if (!selectedUserName) {
      toast.show('Select a user to start chatting', { type: 'error' });
      return;
    }
    if (!text) {
      toast.show('Type a message first', { type: 'error' });
      return;
    }
    setSending(true);
    try {
      const sent = await chatApi.sendChatMessage({ recipientName: selectedUserName, text });
      appendUniqueMessage(sent);
      setDraft('');
      await loadUsers(selectedUserName);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to send message'), { type: 'error' });
    } finally {
      setSending(false);
    }
  }

  const filteredUsers = useMemo(() => {
    const q = String(userQuery || '').trim().toLowerCase();
    if (!q) return users;
    return users.filter((row) => `${row.name || ''} ${row.role || ''} ${row.branchId || ''}`.toLowerCase().includes(q));
  }, [users, userQuery]);

  const selectedUser = users.find((row) => String(row.name || '') === selectedUserName) || null;
  const unreadThreads = users.filter((row) => Number(row.unreadCount || 0) > 0).length;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Chat</h1>
          <div className="page-subtitle-compact">Send internal messages to active users inside this tenant only. Messages stay isolated to the current company.</div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-label">Active Contacts</div><div className="stat-value">{users.length}</div></div>
        <div className="card stat-card"><div className="stat-label">Unread Threads</div><div className="stat-value">{unreadThreads}</div></div>
        <div className="card stat-card"><div className="stat-label">Current Chat Messages</div><div className="stat-value">{messages.length}</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 16 }}>
        <div className="card" style={{ display: 'grid', gap: 12, alignSelf: 'start' }}>
          <div className="section-header">
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>People</h2>
              <span className="table-meta">{loadingUsers ? 'Refreshing...' : `${filteredUsers.length} shown`}</span>
            </div>
            <span className={`status-pill ${liveStatus === 'live' ? 'status-pill-approved' : liveStatus === 'connecting' ? 'status-pill-pending' : 'status-pill-rejected'}`}>
              {liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : liveStatus === 'reconnecting' ? 'Reconnecting' : 'Offline'}
            </span>
          </div>
          <input
            className="input"
            placeholder="Search user, role, branch"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
          />
          <div style={{ display: 'grid', gap: 8, maxHeight: '62vh', overflow: 'auto' }}>
            {filteredUsers.map((row) => {
              const active = String(row.name || '') === selectedUserName;
              return (
                <button
                  key={row.id || row.name}
                  type="button"
                  className="surface-panel"
                  onClick={() => setSelectedUserName(String(row.name || ''))}
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    background: active ? 'linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)' : undefined,
                    borderColor: active ? '#93c5fd' : undefined
                  }}
                >
                  <div className="section-header" style={{ marginBottom: 4 }}>
                    <strong>{row.name}</strong>
                    {Number(row.unreadCount || 0) > 0 ? <span className="status-pill status-pill-rejected">{row.unreadCount}</span> : null}
                  </div>
                  <div className="mini-record-meta">{row.role || 'User'}{row.branchId ? ` • ${row.branchId}` : ''}</div>
                </button>
              );
            })}
            {!filteredUsers.length ? <div className="surface-panel-muted">No users found.</div> : null}
          </div>
        </div>

        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="section-header">
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>{selectedUser?.name || 'Select a user'}</h2>
              <div className="section-note">{selectedUser ? `${selectedUser.role || 'User'}${selectedUser.branchId ? ` • ${selectedUser.branchId}` : ''}` : 'Choose someone from the left side to start chatting.'}</div>
            </div>
            <button className="btn" onClick={() => loadMessages(selectedUserName)} disabled={!selectedUserName || loadingMessages}>Refresh</button>
          </div>

          <div className="surface-panel-muted" style={{ display: 'grid', gap: 10, minHeight: 280, maxHeight: '60vh', overflow: 'auto' }}>
            {!selectedUser ? <div className="table-meta">No conversation selected yet.</div> : null}
            {selectedUser && !messages.length && !loadingMessages ? <div className="table-meta">No messages yet. Start the conversation below.</div> : null}
            {messages.map((message) => {
              const mine = String(message.senderName || '') === currentUserName;
              return (
                <div
                  key={message.id || `${message.senderName}-${message.createdAt}`}
                  style={{
                    display: 'flex',
                    justifyContent: mine ? 'flex-end' : 'flex-start'
                  }}
                >
                  <div
                    style={{
                      maxWidth: '78%',
                      padding: '12px 14px',
                      borderRadius: 16,
                      background: mine ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' : '#ffffff',
                      color: mine ? '#ffffff' : '#0f172a',
                      border: mine ? 'none' : '1px solid #dbe4ef',
                      boxShadow: '0 8px 18px rgba(15, 23, 42, 0.08)'
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>{mine ? 'You' : message.senderName}</div>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{message.text}</div>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: mine ? 0.9 : 0.6 }}>
                      {message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="surface-panel" style={{ display: 'grid', gap: 10 }}>
            <div className="field-label">Message</div>
            <textarea
              className="input"
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your message..."
              disabled={!selectedUserName || sending}
            />
            <div className="approval-row-actions" style={{ justifyContent: 'space-between' }}>
              <span className="table-meta">Only users inside this tenant can see this chat. Live updates are {liveStatus === 'live' ? 'active' : 'reconnecting'}.</span>
              <button className="btn btn-primary" onClick={onSend} disabled={!selectedUserName || sending}>
                {sending ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CommunicationChatPage;
