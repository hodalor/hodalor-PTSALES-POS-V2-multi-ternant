import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import * as chatApi from '../api/chatMessages';
import { startIncomingRingtone, startOutgoingCallTone, stopIncomingRingtone, unlockChatSound } from '../utils/chatSound';

const QUICK_EMOJIS = ['😀', '😂', '😍', '🙏', '👍', '🔥', '🎉', '❤️', '✅', '🤝', '😊', '😎', '😢', '😡', '📦', '💰'];
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '🙏', '😮'];
const CALL_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const PENDING_INCOMING_CALL_KEY = 'ptSales:pendingIncomingCall';
const AUTO_ANSWER_INCOMING_CALL_KEY = 'ptSales:autoAnswerIncomingCall';
const INCOMING_CALL_EVENT = 'ptSales:incoming-call';
const CLEAR_INCOMING_CALL_EVENT = 'ptSales:incoming-call-cleared';

function readStoredIncomingCall(key = PENDING_INCOMING_CALL_KEY) {
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

function clearStoredIncomingCall() {
  try {
    localStorage.removeItem(PENDING_INCOMING_CALL_KEY);
    localStorage.removeItem(AUTO_ANSWER_INCOMING_CALL_KEY);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(CLEAR_INCOMING_CALL_EVENT));
  } catch {}
}

function createCallId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDuration(totalSeconds) {
  const value = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function CommunicationChatPage() {
  const auth = useSelector((s) => s.auth);
  const settings = useSelector((s) => s.settings);
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
  const [callState, setCallState] = useState('idle');
  const [callPeerName, setCallPeerName] = useState('');
  const [callMuted, setCallMuted] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [callHistory, setCallHistory] = useState([]);
  const bottomRef = useRef(null);
  const composerRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const selectedUserNameRef = useRef('');
  const streamRef = useRef(null);
  const messageRefs = useRef({});
  const longPressTimerRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const activeCallRef = useRef({ callId: '', partner: '', role: '' });
  const callStateRef = useRef('idle');
  const incomingCallRef = useRef(null);
  const callConnectedAtRef = useRef(null);
  const outgoingCallTimeoutRef = useRef(null);
  const currentUserName = String(auth.user?.name || '').trim();
  const callSound = String(settings?.callNotificationSound || settings?.chatNotificationSound || 'bright').toLowerCase();

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
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

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

  const loadCallHistory = useCallback(async (targetUser = selectedUserNameRef.current) => {
    const target = String(targetUser || '').trim();
    if (!target) {
      setCallHistory([]);
      return;
    }
    try {
      const rows = await chatApi.listCallHistory(target, { limit: 10 });
      setCallHistory(Array.isArray(rows) ? rows : []);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load call history'), { type: 'error' });
    }
  }, [toast]);

  useEffect(() => {
    loadUsers();
    const tid = setInterval(() => {
      loadUsers();
    }, 5000);
    return () => clearInterval(tid);
  }, [loadUsers]);

  useEffect(() => {
    loadMessages(selectedUserName);
    if (!selectedUserName) return undefined;
    const tid = setInterval(() => {
      loadMessages(selectedUserName);
    }, 4000);
    return () => clearInterval(tid);
  }, [selectedUserName, loadMessages]);

  useEffect(() => {
    loadCallHistory(selectedUserName);
  }, [selectedUserName, loadCallHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    if (callState !== 'active') {
      setCallDurationSec(0);
      if (callState === 'idle') callConnectedAtRef.current = null;
      return undefined;
    }
    if (!callConnectedAtRef.current) callConnectedAtRef.current = Date.now();
    setCallDurationSec(Math.max(0, Math.floor((Date.now() - callConnectedAtRef.current) / 1000)));
    const tid = window.setInterval(() => {
      if (!callConnectedAtRef.current) return;
      setCallDurationSec(Math.max(0, Math.floor((Date.now() - callConnectedAtRef.current) / 1000)));
    }, 1000);
    return () => window.clearInterval(tid);
  }, [callState]);

  const stopLocalStream = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
    }
    localStreamRef.current = null;
  }, []);

  const clearOutgoingCallTimeout = useCallback(() => {
    if (outgoingCallTimeoutRef.current) {
      window.clearTimeout(outgoingCallTimeoutRef.current);
      outgoingCallTimeoutRef.current = null;
    }
  }, []);

  const closePeerConnection = useCallback(() => {
    const pc = peerConnectionRef.current;
    if (pc) {
      try { pc.onicecandidate = null; } catch {}
      try { pc.ontrack = null; } catch {}
      try { pc.onconnectionstatechange = null; } catch {}
      try { pc.close(); } catch {}
    }
    peerConnectionRef.current = null;
    pendingIceCandidatesRef.current = [];
  }, []);

  const clearCallState = useCallback(() => {
    stopIncomingRingtone();
    clearOutgoingCallTimeout();
    closePeerConnection();
    stopLocalStream();
    clearStoredIncomingCall();
    if (remoteAudioRef.current) {
      try { remoteAudioRef.current.srcObject = null; } catch {}
    }
    callConnectedAtRef.current = null;
    activeCallRef.current = { callId: '', partner: '', role: '' };
    setCallState('idle');
    setCallPeerName('');
    setCallMuted(false);
    setIncomingCall(null);
    setCallDurationSec(0);
  }, [clearOutgoingCallTimeout, closePeerConnection, stopLocalStream]);

  useEffect(() => () => {
    clearCallState();
  }, [clearCallState]);

  useEffect(() => {
    unlockChatSound().catch(() => {});
    return () => {
      stopIncomingRingtone();
    };
  }, []);

  const ensureCallSupport = useCallback(() => {
    if (typeof window === 'undefined' || !window.RTCPeerConnection || !navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Voice calling is not supported in this browser.');
    }
  }, []);

  const ensureLocalStream = useCallback(async () => {
    ensureCallSupport();
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;
    setCallMuted(false);
    return stream;
  }, [ensureCallSupport]);

  const flushPendingIceCandidates = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc || !pc.remoteDescription) return;
    const queued = pendingIceCandidatesRef.current.splice(0, pendingIceCandidatesRef.current.length);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {}
    }
  }, []);

  const sendCallSignal = useCallback(async (recipientName, callId, signalType, payload = {}) => {
    await chatApi.sendCallSignal({ recipientName, callId, signalType, payload });
  }, []);

  const buildPeerConnection = useCallback(async (role, partnerName, callId) => {
    ensureCallSupport();
    closePeerConnection();
    const stream = await ensureLocalStream();
    const pc = new window.RTCPeerConnection(CALL_CONFIG);
    peerConnectionRef.current = pc;
    activeCallRef.current = { callId, partner: partnerName, role };
    stream.getTracks().forEach((track) => {
      try { pc.addTrack(track, stream); } catch {}
    });
    pc.ontrack = (event) => {
      const remoteStream = event.streams?.[0];
      if (remoteAudioRef.current && remoteStream) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.play?.().catch(() => {});
      }
      stopIncomingRingtone();
      clearOutgoingCallTimeout();
      if (!callConnectedAtRef.current) callConnectedAtRef.current = Date.now();
      setCallState('active');
    };
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      sendCallSignal(partnerName, callId, 'ice', { candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate }).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      const state = String(pc.connectionState || '');
      if (state === 'connected') {
        stopIncomingRingtone();
        clearOutgoingCallTimeout();
        if (!callConnectedAtRef.current) callConnectedAtRef.current = Date.now();
        setCallState('active');
        return;
      }
      if (state === 'failed' || state === 'disconnected') {
        toast.show('Voice call ended', { type: 'warning' });
        clearCallState();
      }
    };
    return pc;
  }, [clearCallState, clearOutgoingCallTimeout, closePeerConnection, ensureCallSupport, ensureLocalStream, sendCallSignal, toast]);

  async function startVoiceCall() {
    const partnerName = String(selectedUserName || '').trim();
    if (!partnerName) {
      toast.show('Select a user before starting a voice call', { type: 'error' });
      return;
    }
    if (callState !== 'idle' || incomingCall || activeCallRef.current.callId) {
      toast.show('Finish the current call first', { type: 'warning' });
      return;
    }
    const callId = createCallId();
    try {
      setCallPeerName(partnerName);
      setCallState('calling');
      callConnectedAtRef.current = null;
      await buildPeerConnection('caller', partnerName, callId);
      await sendCallSignal(partnerName, callId, 'invite', {});
      startOutgoingCallTone(callSound).catch(() => {});
      clearOutgoingCallTimeout();
      outgoingCallTimeoutRef.current = window.setTimeout(() => {
        if (activeCallRef.current.callId !== callId || callStateRef.current === 'active') return;
        sendCallSignal(partnerName, callId, 'end', { reason: 'timeout' }).catch(() => {});
        toast.show(`${partnerName} did not answer the call`, { type: 'warning' });
        clearCallState();
      }, 30000);
      toast.show(`Calling ${partnerName}...`, { type: 'info' });
    } catch (e) {
      toast.show(String(e?.message || 'Unable to start voice call'), { type: 'error' });
      clearCallState();
    }
  }

  const answerCallInvite = useCallback(async (callInvite) => {
    if (!callInvite?.callId || !callInvite?.senderName) return;
    try {
      stopIncomingRingtone();
      clearStoredIncomingCall();
      setSelectedUserName(callInvite.senderName);
      setCallPeerName(callInvite.senderName);
      setCallState('connecting');
      callConnectedAtRef.current = null;
      await buildPeerConnection('callee', callInvite.senderName, callInvite.callId);
      await sendCallSignal(callInvite.senderName, callInvite.callId, 'accepted', {});
      setIncomingCall(null);
      await loadCallHistory(callInvite.senderName);
    } catch (e) {
      toast.show(String(e?.message || 'Unable to answer voice call'), { type: 'error' });
      clearCallState();
    }
  }, [buildPeerConnection, clearCallState, loadCallHistory, sendCallSignal, toast]);

  async function answerIncomingCall() {
    if (!incomingCall?.callId || !incomingCall?.senderName) return;
    await answerCallInvite(incomingCall);
  }

  useEffect(() => {
    let cancelled = false;

    const syncIncomingCallFromStorage = async () => {
      const autoAnswerCall = readStoredIncomingCall(AUTO_ANSWER_INCOMING_CALL_KEY);
      if (autoAnswerCall?.callId && autoAnswerCall?.senderName) {
        try { localStorage.removeItem(AUTO_ANSWER_INCOMING_CALL_KEY); } catch {}
        if (!cancelled) await answerCallInvite(autoAnswerCall);
        return;
      }
      const pendingCall = readStoredIncomingCall(PENDING_INCOMING_CALL_KEY);
      if (!pendingCall?.callId || !pendingCall?.senderName) return;
      if (callStateRef.current !== 'idle' || incomingCallRef.current || activeCallRef.current.callId) return;
      setSelectedUserName(pendingCall.senderName);
      setCallPeerName(pendingCall.senderName);
      setIncomingCall({ callId: pendingCall.callId, senderName: pendingCall.senderName });
      startIncomingRingtone(callSound).catch(() => {});
    };

    syncIncomingCallFromStorage().catch(() => {});

    const handleIncomingCallEvent = () => {
      syncIncomingCallFromStorage().catch(() => {});
    };
    const handleClearIncomingCall = () => {
      if (callStateRef.current === 'idle') {
        stopIncomingRingtone();
        setIncomingCall(null);
      }
    };

    window.addEventListener(INCOMING_CALL_EVENT, handleIncomingCallEvent);
    window.addEventListener(CLEAR_INCOMING_CALL_EVENT, handleClearIncomingCall);
    return () => {
      cancelled = true;
      window.removeEventListener(INCOMING_CALL_EVENT, handleIncomingCallEvent);
      window.removeEventListener(CLEAR_INCOMING_CALL_EVENT, handleClearIncomingCall);
    };
  }, [answerCallInvite, callSound]);

  async function rejectIncomingCall() {
    if (!incomingCall?.callId || !incomingCall?.senderName) {
      clearStoredIncomingCall();
      setIncomingCall(null);
      return;
    }
    stopIncomingRingtone();
    await sendCallSignal(incomingCall.senderName, incomingCall.callId, 'rejected', {}).catch(() => {});
    await loadCallHistory(incomingCall.senderName).catch(() => {});
    clearStoredIncomingCall();
    setIncomingCall(null);
    setCallPeerName('');
    setCallState('idle');
  }

  async function endCurrentCall(reason = 'ended') {
    const { callId, partner } = activeCallRef.current;
    if (callId && partner) {
      await sendCallSignal(partner, callId, 'end', { reason }).catch(() => {});
      await loadCallHistory(partner).catch(() => {});
    }
    clearCallState();
  }

  function toggleMuteCall() {
    const nextMuted = !callMuted;
    setCallMuted(nextMuted);
    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }
  }

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
            return;
          }
          if (event.type === 'call.signal') {
            const senderName = String(event.senderName || '').trim();
            const recipientName = String(event.recipientName || '').trim();
            const callId = String(event.callId || '').trim();
            const signalType = String(event.signalType || '').trim();
            const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
            const myCall = activeCallRef.current;
            if (!callId || !signalType) return;
            const otherUser = senderName === currentUserName ? recipientName : senderName;
            if (otherUser && String(selectedUserNameRef.current || '') === otherUser) {
              loadCallHistory(otherUser).catch(() => {});
            }
            if (recipientName === currentUserName && signalType === 'invite') {
              if (callStateRef.current !== 'idle' || incomingCallRef.current || activeCallRef.current.callId) {
                sendCallSignal(senderName, callId, 'busy', {}).catch(() => {});
                return;
              }
              try {
                localStorage.setItem(PENDING_INCOMING_CALL_KEY, JSON.stringify({
                  callId,
                  senderName,
                  startedAt: event.at || new Date().toISOString()
                }));
              } catch {}
              setSelectedUserName(senderName);
              setCallPeerName(senderName);
              setIncomingCall({ callId, senderName });
              startIncomingRingtone(callSound).catch(() => {});
              toast.show(`Incoming voice call from ${senderName}`, { type: 'info', timeout: 5000 });
              return;
            }
            if (!myCall.callId || myCall.callId !== callId) return;
            if (signalType === 'accepted' && myCall.role === 'caller') {
              try {
                clearOutgoingCallTimeout();
                const pc = peerConnectionRef.current || await buildPeerConnection('caller', senderName, callId);
                setCallState('connecting');
                const offer = await pc.createOffer({ offerToReceiveAudio: true });
                await pc.setLocalDescription(offer);
                await sendCallSignal(senderName, callId, 'offer', { sdp: offer });
              } catch (e) {
                toast.show(String(e?.message || 'Failed to start voice call'), { type: 'error' });
                clearCallState();
              }
              return;
            }
            if (signalType === 'rejected') {
              stopIncomingRingtone();
              clearStoredIncomingCall();
              toast.show(`${senderName} rejected the voice call`, { type: 'warning' });
              clearCallState();
              return;
            }
            if (signalType === 'busy') {
              stopIncomingRingtone();
              clearStoredIncomingCall();
              toast.show(`${senderName} is busy on another call`, { type: 'warning' });
              clearCallState();
              return;
            }
            if (signalType === 'end') {
              stopIncomingRingtone();
              clearStoredIncomingCall();
              toast.show(payload?.reason === 'timeout' ? 'Missed voice call' : 'Voice call ended', { type: 'warning' });
              clearCallState();
              return;
            }
            if (signalType === 'offer' && myCall.role === 'callee') {
              try {
                const pc = peerConnectionRef.current || await buildPeerConnection('callee', senderName, callId);
                await pc.setRemoteDescription(new window.RTCSessionDescription(payload.sdp));
                await flushPendingIceCandidates();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                setCallState('connecting');
                await sendCallSignal(senderName, callId, 'answer', { sdp: answer });
              } catch (e) {
                toast.show(String(e?.message || 'Failed to answer voice call'), { type: 'error' });
                clearCallState();
              }
              return;
            }
            if (signalType === 'answer' && myCall.role === 'caller') {
              try {
                const pc = peerConnectionRef.current;
                if (!pc) return;
                await pc.setRemoteDescription(new window.RTCSessionDescription(payload.sdp));
                await flushPendingIceCandidates();
                setCallState('connecting');
              } catch (e) {
                toast.show(String(e?.message || 'Failed to connect voice call'), { type: 'error' });
                clearCallState();
              }
              return;
            }
            if (signalType === 'ice') {
              try {
                const candidate = payload.candidate ? new window.RTCIceCandidate(payload.candidate) : null;
                const pc = peerConnectionRef.current;
                if (!candidate || !pc) return;
                if (pc.remoteDescription) {
                  await pc.addIceCandidate(candidate);
                } else {
                  pendingIceCandidatesRef.current.push(candidate);
                }
              } catch {}
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
  }, [appendUniqueMessage, buildPeerConnection, callSound, clearCallState, clearOutgoingCallTimeout, currentUserName, flushPendingIceCandidates, loadCallHistory, loadUsers, replaceMessage, sendCallSignal, toast]);

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

  function describeCallStatus(entry) {
    const status = String(entry?.status || '').toLowerCase();
    const direction = String(entry?.direction || '').toLowerCase();
    if (status === 'missed') return direction === 'incoming' ? 'Missed call' : 'No answer';
    if (status === 'rejected') return direction === 'incoming' ? 'Declined' : 'Rejected';
    if (status === 'busy') return 'Busy';
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'ended') return `Call ended${entry?.durationSec ? ` • ${formatDuration(entry.durationSec)}` : ''}`;
    if (status === 'accepted') return 'Connected';
    if (status === 'ringing') return 'Ringing';
    return status || 'Call';
  }

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {selectedUser ? (
                <button className="btn btn-primary" onClick={startVoiceCall} disabled={callState !== 'idle' || !selectedUserName}>
                  {callState === 'idle' ? 'Voice Call' : 'Call Busy'}
                </button>
              ) : null}
              {(callState !== 'idle' || incomingCall) ? (
                <button className="btn" onClick={endCurrentCall} disabled={callState === 'idle' && !incomingCall}>
                  End Call
                </button>
              ) : null}
              <button className="btn" onClick={() => loadMessages(selectedUserName)} disabled={!selectedUserName || loadingMessages}>Refresh</button>
            </div>
          </div>

          {(incomingCall || callState !== 'idle') ? (
            <div className="chat-call-banner">
              <div>
                <div className="chat-call-title">
                  {incomingCall
                    ? `Incoming voice call from ${incomingCall.senderName}`
                    : callState === 'calling'
                      ? `Calling ${callPeerName}...`
                      : callState === 'connecting'
                        ? `Connecting voice call with ${callPeerName}...`
                        : `Voice call with ${callPeerName}`}
                </div>
                <div className="chat-call-note">
                  {incomingCall
                    ? 'Answer to start a simple one-to-one audio call.'
                    : callState === 'active'
                      ? `${callMuted ? 'Microphone is muted.' : 'Voice call is active.'} Duration ${formatDuration(callDurationSec)}.`
                      : 'Keep this page open while the call is connecting.'}
                </div>
              </div>
              <div className="chat-call-actions">
                {incomingCall ? (
                  <>
                    <button className="btn btn-primary" onClick={answerIncomingCall}>Answer</button>
                    <button className="btn" onClick={rejectIncomingCall}>Reject</button>
                  </>
                ) : (
                  <>
                    <button className="btn" onClick={toggleMuteCall} disabled={callState === 'calling'}>
                      {callMuted ? 'Unmute' : 'Mute'}
                    </button>
                    <button className="btn" onClick={endCurrentCall}>End</button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {selectedUser && callHistory.length ? (
            <div className="chat-call-history">
              <div className="chat-call-history-title">Recent Calls</div>
              <div className="chat-call-history-list">
                {callHistory.map((entry) => (
                  <div key={entry.id || entry.callId} className="chat-call-history-item">
                    <div className="chat-call-history-main">{describeCallStatus(entry)}</div>
                    <div className="chat-call-history-meta">
                      <span>{entry.direction === 'incoming' ? 'Incoming' : 'Outgoing'}</span>
                      <span>{entry.startedAt ? new Date(entry.startedAt).toLocaleString() : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

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
      <audio ref={remoteAudioRef} autoPlay />
    </div>
  );
}

export default CommunicationChatPage;
