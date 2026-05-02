import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import * as chatApi from '../api/chatMessages';

const QUICK_EMOJIS = ['😀', '😂', '😍', '🙏', '👍', '🔥', '🎉', '❤️', '✅', '🤝', '😊', '😎', '😢', '😡', '📦', '💰'];
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '🙏', '😮'];

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
  const [replyTarget, setReplyTarget] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState('');
  const [reactionPickerFor, setReactionPickerFor] = useState('');
  const [actionMenu, setActionMenu] = useState({ open: false, x: 0, y: 0, messageId: '' });
  const bottomRef = useRef(null);
  const composerRef = useRef(null);
  const selectedUserNameRef = useRef('');
  const streamRef = useRef(null);
  const messageRefs = useRef({});
  const longPressTimerRef = useRef(null);
  const currentUserName = String(auth.user?.name || '').trim();

  const appendUniqueMessage = useCallback((incoming) => {
    setMessages((prev) => {
      const incomingId = String(incoming?.id || '');
      if (!incomingId) return [...prev, incoming];
      if (prev.some((row) => String(row?.id || '') === incomingId)) return prev;
      return [...prev, incoming];
    });
  }, []);

  const replaceMessage = useCallback((incoming) => {
    const incomingId = String(incoming?.id || '');
    if (!incomingId) return;
    setMessages((prev) => prev.map((row) => (String(row?.id || '') === incomingId ? { ...row, ...incoming } : row)));
  }, []);

  useEffect(() => {
    selectedUserNameRef.current = selectedUserName;
  }, [selectedUserName]);

  useEffect(() => {
    setReplyTarget(null);
    setEmojiOpen(false);
    setReactionPickerFor('');
    setActionMenu({ open: false, x: 0, y: 0, messageId: '' });
  }, [selectedUserName]);

  useEffect(() => {
    if (!actionMenu.open) return undefined;
    function closeMenu() {
      setActionMenu({ open: false, x: 0, y: 0, messageId: '' });
    }
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [actionMenu.open]);

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
            return;
          }
          if (event.type === 'message.reaction') {
            if (String(event.conversationKey || '') === [currentUserName, String(selectedUserNameRef.current || '')].filter(Boolean).sort().join('::')) {
              replaceMessage(event.message);
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
  }, [appendUniqueMessage, currentUserName, loadUsers, replaceMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 44), 96);
    textarea.style.height = `${nextHeight}px`;
  }, [draft]);

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
      const sent = await chatApi.sendChatMessage({
        recipientName: selectedUserName,
        text,
        replyToMessageId: replyTarget?.id || ''
      });
      appendUniqueMessage(sent);
      setDraft('');
      setReplyTarget(null);
      setEmojiOpen(false);
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
  const actionMessage = useMemo(
    () => messages.find((row) => String(row.id || '') === String(actionMenu.messageId || '')) || null,
    [actionMenu.messageId, messages]
  );

  function addEmoji(emoji) {
    setDraft((prev) => `${prev || ''}${emoji}`);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function startReply(message) {
    setReplyTarget({
      id: String(message?.id || ''),
      senderName: String(message?.senderName || ''),
      text: String(message?.text || '')
    });
    setEmojiOpen(false);
    setActionMenu({ open: false, x: 0, y: 0, messageId: '' });
  }

  async function toggleReaction(messageId, emoji) {
    const cleanMessageId = String(messageId || '').trim();
    const cleanEmoji = String(emoji || '').trim();
    if (!cleanMessageId || !cleanEmoji) return;
    try {
      const updated = await chatApi.reactToMessage({ messageId: cleanMessageId, emoji: cleanEmoji });
      replaceMessage(updated);
      setReactionPickerFor('');
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update reaction'), { type: 'error' });
    }
  }

  function registerMessageRef(messageId, node) {
    const cleanId = String(messageId || '');
    if (!cleanId) return;
    if (node) {
      messageRefs.current[cleanId] = node;
    } else {
      delete messageRefs.current[cleanId];
    }
  }

  function jumpToMessage(messageId) {
    const cleanId = String(messageId || '').trim();
    if (!cleanId) return;
    const node = messageRefs.current[cleanId];
    if (!node) {
      toast.show('The original replied message is not visible in this chat window yet.', { type: 'warning' });
      return;
    }
    try {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {}
    setHighlightedMessageId(cleanId);
    window.setTimeout(() => {
      setHighlightedMessageId((prev) => (prev === cleanId ? '' : prev));
    }, 2200);
  }

  function openActionMenuAt(x, y, message) {
    setActionMenu({
      open: true,
      x: Math.max(12, Number(x || 0)),
      y: Math.max(12, Number(y || 0)),
      messageId: String(message?.id || '')
    });
  }

  function handleMessageContextMenu(event, message) {
    event.preventDefault();
    openActionMenuAt(event.clientX, event.clientY, message);
  }

  function clearLongPress() {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handleMessageTouchStart(event, message) {
    clearLongPress();
    const touch = event.touches?.[0];
    if (!touch) return;
    longPressTimerRef.current = window.setTimeout(() => {
      openActionMenuAt(touch.clientX, touch.clientY, message);
      longPressTimerRef.current = null;
    }, 520);
  }

  async function copyMessageText(message) {
    try {
      await navigator.clipboard.writeText(String(message?.text || ''));
      toast.show('Message copied', { type: 'success' });
      setActionMenu({ open: false, x: 0, y: 0, messageId: '' });
    } catch {
      toast.show('Copy failed on this device', { type: 'error' });
    }
  }

  function formatMessageTime(value) {
    if (!value) return '';
    try {
      return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  return (
    <div className="page-shell chat-page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Chat</h1>
          <div className="page-subtitle-compact">Send internal messages to active users inside this tenant only. Messages stay isolated to the current company.</div>
        </div>
        <div className="page-header-actions">
          <span className="status-pill status-pill-neutral">Contacts {users.length}</span>
          <span className="status-pill status-pill-pending">Unread {unreadThreads}</span>
          <span className={`status-pill ${liveStatus === 'live' ? 'status-pill-approved' : liveStatus === 'connecting' ? 'status-pill-pending' : 'status-pill-rejected'}`}>
            {liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : liveStatus === 'reconnecting' ? 'Reconnecting' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="chat-layout">
        <div className="card chat-people-card">
          <div className="chat-people-top">
            <div className="section-header">
              <div>
                <h2 className="section-title" style={{ margin: 0 }}>People</h2>
                <span className="table-meta">{loadingUsers ? 'Refreshing...' : `${filteredUsers.length} shown`}</span>
              </div>
              <span className={`status-pill ${liveStatus === 'live' ? 'status-pill-approved' : liveStatus === 'connecting' ? 'status-pill-pending' : 'status-pill-rejected'}`}>{liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : liveStatus === 'reconnecting' ? 'Reconnecting' : 'Offline'}</span>
            </div>
            <input
              className="input"
              placeholder="Search user, role, branch"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
            />
          </div>
          <div className="chat-people-list">
            {filteredUsers.map((row) => {
              const active = String(row.name || '') === selectedUserName;
              return (
                <button
                  key={row.id || row.name}
                  type="button"
                  className={`surface-panel chat-person-item${active ? ' chat-person-item-active' : ''}`}
                  onClick={() => setSelectedUserName(String(row.name || ''))}
                  style={{ textAlign: 'left', cursor: 'pointer' }}
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

        <div className="card chat-room-card">
          <div className="section-header chat-room-header">
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>{selectedUser?.name || 'Select a user'}</h2>
              <div className="section-note">{selectedUser ? `${selectedUser.role || 'User'}${selectedUser.branchId ? ` • ${selectedUser.branchId}` : ''}` : 'Choose someone from the left side to start chatting.'}</div>
            </div>
            <button className="btn" onClick={() => loadMessages(selectedUserName)} disabled={!selectedUserName || loadingMessages}>Refresh</button>
          </div>

          <div className="surface-panel-muted chat-thread">
            {!selectedUser ? <div className="table-meta">No conversation selected yet.</div> : null}
            {selectedUser && !messages.length && !loadingMessages ? <div className="table-meta">No messages yet. Start the conversation below.</div> : null}
            {messages.map((message) => {
              const mine = String(message.senderName || '') === currentUserName;
              const reactions = Array.isArray(message.reactions) ? message.reactions : [];
              return (
                <div
                  key={message.id || `${message.senderName}-${message.createdAt}`}
                  ref={(node) => registerMessageRef(message.id, node)}
                  className={`chat-message-row${mine ? ' chat-message-row-mine' : ''}`}
                >
                  <div
                    className={`chat-message-bubble${mine ? ' chat-message-bubble-mine' : ''}${highlightedMessageId && String(message.id || '') === highlightedMessageId ? ' chat-message-bubble-highlight' : ''}`}
                    onContextMenu={(event) => handleMessageContextMenu(event, message)}
                    onTouchStart={(event) => handleMessageTouchStart(event, message)}
                    onTouchEnd={clearLongPress}
                    onTouchCancel={clearLongPress}
                  >
                    <div className="chat-message-meta-top">
                      <div className="chat-message-author">{mine ? 'You' : message.senderName}</div>
                      <button
                        type="button"
                        className={`chat-message-more${mine ? ' chat-message-more-mine' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          openActionMenuAt(rect.right - 8, rect.bottom + 6, message);
                        }}
                      >
                        ...
                      </button>
                    </div>
                    {message.replyTo ? (
                      <button
                        type="button"
                        onClick={() => jumpToMessage(message.replyTo?.messageId)}
                        className={`chat-quoted-block${mine ? ' chat-quoted-block-mine' : ''}`}
                      >
                        <div className="chat-quoted-author">
                          {String(message.replyTo.senderName || '') === currentUserName ? 'You' : message.replyTo.senderName}
                        </div>
                        <div className="chat-quoted-text">{message.replyTo.text}</div>
                      </button>
                    ) : null}
                    {reactionPickerFor && String(message.id || '') === reactionPickerFor ? (
                      <div className="chat-reaction-picker">
                        {REACTION_EMOJIS.map((emoji) => (
                          <button
                            key={`${message.id}-${emoji}`}
                            type="button"
                            onClick={() => toggleReaction(message.id, emoji)}
                            className={`chat-reaction-picker-btn${mine ? ' chat-reaction-picker-btn-mine' : ''}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="chat-message-text">{message.text}</div>
                    {reactions.length ? (
                      <div className="chat-reactions-row">
                        {reactions.map((reaction) => {
                          const reactedUsers = Array.isArray(reaction.users) ? reaction.users : [];
                          const mineReaction = reactedUsers.includes(currentUserName);
                          return (
                            <button
                              key={`${message.id}-${reaction.emoji}`}
                              type="button"
                              onClick={() => toggleReaction(message.id, reaction.emoji)}
                              className={`chat-reaction-chip${mine ? ' chat-reaction-chip-mine' : ''}${mineReaction ? ' chat-reaction-chip-active' : ''}`}
                              title={reactedUsers.join(', ')}
                            >
                              <span style={{ fontSize: 16, lineHeight: 1 }}>{reaction.emoji}</span>
                              <span style={{ fontSize: 12, fontWeight: 800 }}>{Number(reaction.count || reactedUsers.length || 0)}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className={`chat-message-footer${mine ? ' chat-message-footer-mine' : ''}`}>
                      <span>{formatMessageTime(message.createdAt)}</span>
                      {mine ? (
                        <span className={`chat-message-status${message.readAt ? ' chat-message-status-read' : ' chat-message-status-delivered'}`} title={message.readAt ? 'Read' : 'Delivered'}>
                          ✓✓
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="surface-panel chat-composer">
            {replyTarget ? (
              <div className="chat-reply-banner">
                <div style={{ minWidth: 0 }}>
                  <div className="chat-reply-banner-title">
                    Replying to {String(replyTarget.senderName || '') === currentUserName ? 'yourself' : replyTarget.senderName}
                  </div>
                  <div className="chat-reply-banner-text">
                    {String(replyTarget.text || '').slice(0, 180)}
                  </div>
                </div>
                <button type="button" className="btn" onClick={() => setReplyTarget(null)}>Cancel</button>
              </div>
            ) : null}
            <div className="field-label">Message</div>
            <div className="chat-compose-row">
              <button
                type="button"
                className="btn chat-compose-emoji-btn"
                onClick={() => setEmojiOpen((prev) => !prev)}
                disabled={!selectedUserName || sending}
                aria-label={emojiOpen ? 'Hide emoji picker' : 'Open emoji picker'}
                title={emojiOpen ? 'Hide emoji picker' : 'Open emoji picker'}
              >
                {emojiOpen ? '×' : '☺'}
              </button>
              <textarea
                ref={composerRef}
                className="input chat-compose-input"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your message..."
                disabled={!selectedUserName || sending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
              />
              <button
                className="btn btn-primary chat-compose-send-btn"
                onClick={onSend}
                disabled={!selectedUserName || sending}
                aria-label={sending ? 'Sending message' : 'Send message'}
                title={sending ? 'Sending message' : 'Send message'}
              >
                {sending ? '...' : '➤'}
              </button>
            </div>
            {emojiOpen ? (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 14,
                  background: '#f8fafc',
                  border: '1px solid #dbe4ef'
                }}
              >
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="btn"
                    onClick={() => addEmoji(emoji)}
                    style={{ minWidth: 42, padding: '8px 10px', fontSize: 20, lineHeight: 1 }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="approval-row-actions" style={{ justifyContent: 'space-between' }}>
              <span className="table-meta">Only users inside this tenant can see this chat. Live updates are {liveStatus === 'live' ? 'active' : 'reconnecting'}.</span>
            </div>
          </div>
        </div>
      </div>
      {actionMenu.open && actionMessage ? (
        <div
          className="chat-action-menu"
          style={{ left: Math.min(actionMenu.x, window.innerWidth - 188), top: Math.min(actionMenu.y, window.innerHeight - 180) }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="chat-action-menu-item" onClick={() => startReply(actionMessage)}>Reply</button>
          <button type="button" className="chat-action-menu-item" onClick={() => {
            setReactionPickerFor(String(actionMessage.id || ''));
            setActionMenu({ open: false, x: 0, y: 0, messageId: '' });
          }}>React</button>
          <button type="button" className="chat-action-menu-item" onClick={() => copyMessageText(actionMessage)}>Copy</button>
        </div>
      ) : null}
    </div>
  );
}

export default CommunicationChatPage;
