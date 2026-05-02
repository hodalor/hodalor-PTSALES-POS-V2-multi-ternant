import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/ToastProvider';
import { askPtAi as askPtAiApi, transcribePtAi } from '../api/ptAi';
import { findBestPtAiAnswer, PT_AI_TOPICS } from '../utils/ptAiKnowledge';

function normalizeChatText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildSmallTalkAnswer(query) {
  const q = normalizeChatText(query);
  if (!q) return null;
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(q)) {
    return {
      title: 'Hello',
      answer: [
        'Hello, I am PT AI.',
        'How can I help you today with the system?'
      ],
      related: PT_AI_TOPICS.slice(0, 3)
    };
  }
  if (q.includes('how are you')) {
    return {
      title: 'I am ready to help',
      answer: [
        'I am doing well and ready to help you with the system.',
        'How can I help you today?'
      ],
      related: PT_AI_TOPICS.slice(0, 3)
    };
  }
  if (q.includes('who are you') || q.includes('what can you do')) {
    return {
      title: 'About PT AI',
      answer: [
        'I am PT AI, your in-system assistant for this POS, inventory, approvals, finance, and communication platform.',
        'You can ask me how to use features, where to find pages, or how a workflow should work.',
        'What would you like help with today?'
      ],
      related: PT_AI_TOPICS.slice(0, 4)
    };
  }
  if (q.includes('thank you') || q === 'thanks' || q.includes('thanks pt ai')) {
    return {
      title: 'You are welcome',
      answer: [
        'You are welcome.',
        'Is there anything else you want me to help you with?'
      ],
      related: []
    };
  }
  if (q === 'bye' || q === 'goodbye' || q.includes('see you')) {
    return {
      title: 'Goodbye',
      answer: [
        'Goodbye for now.',
        'Come back anytime if you want help with the system.'
      ],
      related: []
    };
  }
  return null;
}

function ensureFollowUp(lines, followUp = 'Is there anything else you want me to help you with?') {
  const next = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (!next.length) return [followUp];
  if (next.some((line) => String(line || '').toLowerCase().includes('anything else'))) return next;
  return [...next, followUp];
}

function buildRelatedTopics(primary = [], fallback = []) {
  const out = [];
  [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(fallback) ? fallback : []), ...PT_AI_TOPICS]
    .forEach((topic) => {
      if (!topic) return;
      const normalized = typeof topic === 'string'
        ? (PT_AI_TOPICS.find((item) => item.id === topic || item.title.toLowerCase() === topic.toLowerCase()) || null)
        : topic;
      if (!normalized?.title) return;
      if (out.some((item) => item.id === normalized.id || item.title.toLowerCase() === normalized.title.toLowerCase())) return;
      out.push(normalized);
    });
  return out.slice(0, 4);
}

function buildOffTopicAnswer() {
  return {
    title: 'I focus on this POS system',
    answer: [
      'I can give a brief general idea, but I was built mainly to help employees use this POS, inventory, approvals, finance, and communication system.',
      'Please ask me about a workflow in this system, such as POS sales, purchases, transfers, adjustments, expenses, cash reconciliation, invoices, customers, users, or reports.',
      'Is there anything else you want me to help you with inside the system?'
    ],
    related: PT_AI_TOPICS.slice(0, 4)
  };
}

function buildProhibitedAnswer() {
  return {
    title: 'I cannot help with that',
    answer: [
      'I was not built to help with hacking, privacy abuse, sexual content, breaches of security, or other harmful activity.',
      'If you need help, I can assist with safe and lawful use of this POS system, such as sales, stock, approvals, reports, finance, customers, users, or communication workflows.',
      'Is there anything else you want me to help you with inside the system?'
    ],
    related: PT_AI_TOPICS.slice(0, 4)
  };
}

function isProhibitedQuestion(query) {
  const q = normalizeChatText(query);
  return [
    /hack/,
    /bypass/,
    /crack/,
    /exploit/,
    /steal password/,
    /keylog/,
    /spy|stalk/,
    /privacy breach|breach privacy/,
    /nude|porn|sex/,
    /ddos|malware|ransomware/,
    /phish|phishing/
  ].some((pattern) => pattern.test(q));
}

function isLikelySystemQuestion(query, localMatch) {
  const q = normalizeChatText(query);
  if (!q) return false;
  if (buildSmallTalkAnswer(query)) return true;
  if (looksLikeHowToQuestion(query)) return true;
  if (localMatch && String(localMatch.title || '').trim() !== 'I need a clearer question') return true;
  const broadSystemTerms = [
    'pos', 'sale', 'sales', 'receipt', 'invoice', 'product', 'stock', 'inventory', 'purchase', 'transfer',
    'adjustment', 'expense', 'finance', 'cash', 'reconciliation', 'branch', 'customer', 'supplier', 'user',
    'report', 'dashboard', 'approval', 'refund', 'backup', 'sync', 'serial', 'imei', 'communication', 'chat',
    'tenant', 'godhand', 'config', 'settings', 'label'
  ];
  return broadSystemTerms.some((term) => q.includes(term));
}

function looksLikeHowToQuestion(query) {
  const q = normalizeChatText(query);
  return q.includes('how do i')
    || q.includes('how can i')
    || q.includes('where can i')
    || q.includes('where do i')
    || q.includes('how to')
    || q.includes('access')
    || q.includes('find')
    || q.includes('open')
    || q.includes('print')
    || q.includes('reprint')
    || q.includes('download');
}

function formatTutorialLines(lines) {
  const clean = Array.isArray(lines) ? lines.map((line) => String(line || '').trim()).filter(Boolean) : [];
  return clean.map((line, index) => {
    if (/^\d+\.\s/.test(line)) return line;
    return `${index + 1}. ${line}`;
  });
}

function buildConversationalAnswer(query, result, fallbackTitle = 'PT AI Answer') {
  const smallTalk = buildSmallTalkAnswer(query);
  if (smallTalk) return smallTalk;

  const localMatch = findBestPtAiAnswer(query);
  const title = String(result?.title || fallbackTitle).trim() || fallbackTitle;
  const rawAnswerLines = Array.isArray(result?.answer)
    ? result.answer.map((line) => String(line || '').trim()).filter(Boolean)
    : String(result?.answer || result?.text || '').split(/\n{2,}|\r\n\r\n/).map((line) => line.trim()).filter(Boolean);
  const normalizedResult = title.toLowerCase();
  const tutorialMode = looksLikeHowToQuestion(query);
  const answerLines = tutorialMode ? formatTutorialLines(rawAnswerLines) : rawAnswerLines;
  const intro = normalizedResult.includes('clearer question')
    ? 'I can help with that, but I need a little more detail.'
    : tutorialMode
      ? `Sure. Follow these steps for "${String(query || '').trim()}".`
      : `Sure, here is the best help I found for "${String(query || '').trim()}".`;
  const followUp = tutorialMode
    ? 'If you want, I can also show the exact menu path or button names for another task. Is there anything else you want me to help you with?'
    : 'Is there anything else you want me to help you with?';
  const related = buildRelatedTopics(
    Array.isArray(result?.related) && result.related.length ? result.related : [],
    Array.isArray(localMatch?.related) ? localMatch.related : []
  );

  return {
    ...result,
    title,
    answer: ensureFollowUp([intro, ...answerLines], followUp),
    related
  };
}

function AskPtAiPage() {
  const defaultAnswer = useMemo(() => buildConversationalAnswer('hello', findBestPtAiAnswer('serialized item'), 'PT AI Local Help'), []);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(defaultAnswer);
  const [history, setHistory] = useState([]);
  const [conversation, setConversation] = useState(() => ([
    {
      id: 'welcome-ai',
      role: 'ai',
      title: defaultAnswer.title,
      answer: defaultAnswer.answer,
      related: defaultAnswer.related,
      meta: 'Built-in workflow guidance',
      pending: false
    }
  ]));
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answerMeta, setAnswerMeta] = useState('Built-in workflow guidance');
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const requestIdRef = useRef(0);
  const fallbackNoticeShownRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const bottomRef = useRef(null);
  const toast = useToast();

  const speechRecognition = useMemo(() => (
    typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
      : null
  ), []);

  const voiceSupported = !!speechRecognition;
  const recorderSupported = typeof window !== 'undefined'
    && !!window.MediaRecorder
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => () => {
    try { recognitionRef.current?.stop(); } catch {}
    try { mediaRecorderRef.current?.stop(); } catch {}
    try { mediaStreamRef.current?.getTracks?.().forEach((track) => track.stop()); } catch {}
    try { window.speechSynthesis?.cancel(); } catch {}
  }, []);

  useEffect(() => {
    try {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } catch {}
  }, [conversation]);

  function speakResult(nextAnswer) {
    if (!speechSupported || !nextAnswer) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance([nextAnswer.title, ...(nextAnswer.answer || [])].join('. '));
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } catch {
      setSpeaking(false);
    }
  }

  function saveHistoryEntry(clean, result) {
    setHistory((prev) => [
      { query: clean, answer: result.title, answerText: (result.answer || []).join('\n') },
      ...prev.filter((item) => String(item.query || '').trim() !== clean)
    ].slice(0, 8));
  }

  async function ask(nextQuery, options = {}) {
    const clean = String(nextQuery || query || '').trim();
    if (!clean) return;
    const localMatch = findBestPtAiAnswer(clean);
    const prohibitedResult = isProhibitedQuestion(clean) ? buildProhibitedAnswer() : null;
    const offTopicResult = !prohibitedResult && !isLikelySystemQuestion(clean, localMatch) ? buildOffTopicAnswer() : null;
    const requestId = Date.now();
    requestIdRef.current = requestId;
    const answerEntryId = `ai-${requestId}`;
    const quickFallback = prohibitedResult || offTopicResult || buildConversationalAnswer(clean, localMatch, 'PT AI Local Help');
    setAnswer(quickFallback);
    setAnswerMeta('Built-in workflow guidance');
    saveHistoryEntry(clean, quickFallback);
    setConversation((prev) => ([
      ...prev,
      { id: `user-${requestId}`, role: 'user', text: clean },
      {
        id: answerEntryId,
        role: 'ai',
        title: quickFallback.title,
        answer: quickFallback.answer,
        related: quickFallback.related,
        meta: 'Built-in workflow guidance',
        pending: true
      }
    ]));
    if (options.autoSpeakQuick) speakResult(quickFallback);
    if (prohibitedResult || offTopicResult) {
      setAsking(false);
      if (!options.keepQuery) setQuery('');
      return;
    }
    setAsking(true);
    try {
      const aiResult = await askPtAiApi({
        query: clean,
        history: history.slice(0, 4).map((item) => ({ question: item.query, answer: item.answerText || item.answer }))
      });
      if (requestIdRef.current !== requestId) return;
      const normalized = buildConversationalAnswer(clean, aiResult);
      setAnswer(normalized);
      setAnswerMeta(`${aiResult?.provider || 'AI backend'}${aiResult?.model ? ` • ${aiResult.model}` : ''}`);
      saveHistoryEntry(clean, normalized);
      setConversation((prev) => prev.map((entry) => (
        entry.id === answerEntryId
          ? {
            ...entry,
            title: normalized.title,
            answer: normalized.answer,
            related: normalized.related,
            meta: `${aiResult?.provider || 'AI backend'}${aiResult?.model ? ` • ${aiResult.model}` : ''}`,
            pending: false
          }
          : entry
      )));
      if (options.autoSpeak) speakResult(normalized);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setAnswer(quickFallback);
      setAnswerMeta('Built-in workflow guidance');
      saveHistoryEntry(clean, quickFallback);
      setConversation((prev) => prev.map((entry) => (
        entry.id === answerEntryId
          ? {
            ...entry,
            title: quickFallback.title,
            answer: quickFallback.answer,
            related: quickFallback.related,
            meta: 'Built-in workflow guidance',
            pending: false
          }
          : entry
      )));
      if (!fallbackNoticeShownRef.current) {
        fallbackNoticeShownRef.current = true;
        toast.show('PT AI gave the fast built-in answer while the live AI backend was unavailable or slow.', { type: 'warning' });
      }
      if (options.autoSpeak) speakResult(quickFallback);
    } finally {
      if (requestIdRef.current === requestId) setAsking(false);
    }
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read voice recording'));
      reader.readAsDataURL(blob);
    });
  }

  function startVoiceInput() {
    if (!speechRecognition) {
      toast.show('Browser speech recognition is not available here. Try Record Voice instead.', { type: 'warning' });
      return;
    }
    try {
      const recognition = new speechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onstart = () => {
        setListening(true);
        setTranscript('Listening for your question...');
        transcriptRef.current = '';
      };
      recognition.onresult = (event) => {
        const text = Array.from(event.results || []).map((row) => row[0]?.transcript || '').join(' ').trim();
        transcriptRef.current = text;
        setTranscript(text);
        setQuery(text);
      };
      recognition.onerror = () => {
        setListening(false);
        toast.show('Voice recognition could not start. You can use Record Voice instead.', { type: 'error' });
      };
      recognition.onend = () => {
        setListening(false);
        recognitionRef.current = null;
        const finalText = String(transcriptRef.current || query || '').trim();
        if (finalText) {
          setTranscript(finalText);
          ask(finalText, { autoSpeak: true, autoSpeakQuick: true });
        } else {
          setTranscript('');
          toast.show('No speech was captured. Please try again and speak clearly.', { type: 'warning' });
        }
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setListening(false);
      toast.show('Voice recognition is unavailable. Try Record Voice instead.', { type: 'error' });
    }
  }

  function stopVoiceInput() {
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
  }

  async function startAudioRecording() {
    if (!recorderSupported) {
      toast.show('Audio recording is not supported in this browser.', { type: 'error' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new window.MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setRecording(false);
        toast.show('Recording failed. Please allow microphone access and try again.', { type: 'error' });
      };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        audioChunksRef.current = [];
        try {
          mediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
        } catch {}
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecording(false);
        if (!blob.size) return;
        try {
          setAsking(true);
          setTranscript('Transcribing voice...');
          const audioBase64 = await readBlobAsDataUrl(blob);
          const result = await transcribePtAi({ audioBase64, mimeType: blob.type || recorder.mimeType || 'audio/webm' });
          const text = String(result?.text || '').trim();
          if (!text) throw new Error('No voice text returned');
          setTranscript(text);
          setQuery(text);
          await ask(text, { autoSpeak: true, autoSpeakQuick: true });
        } catch (error) {
          setAsking(false);
          toast.show(String(error?.message || 'Voice transcription failed'), { type: 'error' });
        }
      };
      mediaRecorderRef.current = recorder;
      setTranscript('Recording voice...');
      setRecording(true);
      recorder.start();
    } catch (error) {
      setRecording(false);
      toast.show('Microphone access was denied or unavailable.', { type: 'error' });
    }
  }

  function stopAudioRecording() {
    try { mediaRecorderRef.current?.stop(); } catch {}
  }

  function speakAnswer() {
    speakResult(answer);
  }

  function stopSpeaking() {
    try { window.speechSynthesis.cancel(); } catch {}
    setSpeaking(false);
  }

  const quickTopics = PT_AI_TOPICS.slice(0, 8);

  function onComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!recording) ask(query);
    }
  }

  return (
    <div className="page-shell chat-page-shell ask-ai-page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Ask PT AI</h1>
          <div className="page-subtitle-compact">Ask how any part of the system works in a chat-style workspace. PT AI understands spelling mistakes, workflow questions, and voice requests.</div>
        </div>
        <div className="page-header-actions">
          <span className="status-pill status-pill-neutral">Topics {PT_AI_TOPICS.length}</span>
          <span className={`status-pill ${(recorderSupported || voiceSupported) ? 'status-pill-approved' : 'status-pill-rejected'}`}>Voice {(recorderSupported || voiceSupported) ? 'Ready' : 'Off'}</span>
          <span className={`status-pill ${speechSupported ? 'status-pill-approved' : 'status-pill-rejected'}`}>Reply {speechSupported ? 'Ready' : 'Off'}</span>
        </div>
      </div>

      <div className="chat-layout ask-ai-layout">
        <div className="card chat-people-card ask-ai-sidebar-card">
          <div className="chat-people-top">
            <div className="section-header">
              <div>
                <h2 className="section-title" style={{ margin: 0 }}>AI Workspace</h2>
                <span className="table-meta">{history.length ? `${history.length} recent question${history.length > 1 ? 's' : ''}` : 'Ready for your first question'}</span>
              </div>
              {speaking ? <span className="status-pill status-pill-approved">Speaking</span> : null}
            </div>
            <div className="surface-panel-muted ask-ai-status-panel">
              <div className="mini-record-title">
                <span>{recording ? 'Recording voice...' : listening ? 'Listening...' : asking ? 'Thinking...' : speaking ? 'Reading answer aloud...' : 'PT AI is ready'}</span>
              </div>
              <div className="mini-record-subtle">
                {transcript
                  ? transcript
                  : recording
                    ? 'Speak clearly and stop when done.'
                    : listening
                      ? 'Browser voice capture is active.'
                      : 'Type or use voice to ask about any workflow in the system.'}
              </div>
            </div>
            <div>
              <div className="field-label" style={{ marginBottom: 8 }}>Quick Topics</div>
              <div className="inline-actions ask-ai-topic-list">
                {quickTopics.map((topic) => (
                  <button key={topic.id} className="btn" onClick={() => { setQuery(topic.title); ask(topic.title); }}>
                    {topic.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="chat-people-list">
            {history.length ? history.map((item, index) => (
              <button
                key={`${item.query}-${index}`}
                type="button"
                className="surface-panel chat-person-item"
                onClick={() => { setQuery(item.query); ask(item.query); }}
                style={{ textAlign: 'left', cursor: 'pointer' }}
              >
                <div className="mini-record-title"><span>{item.query}</span></div>
                <div className="mini-record-subtle">{item.answer}</div>
              </button>
            )) : <div className="surface-panel-muted">Your recent PT AI questions will appear here.</div>}
          </div>
        </div>

        <div className="card chat-room-card ask-ai-room-card">
          <div className="section-header chat-room-header">
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>PT AI Conversation</h2>
              <div className="section-note">{answerMeta || 'Built-in workflow guidance'}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`status-pill ${asking ? 'status-pill-pending' : 'status-pill-neutral'}`}>{asking ? 'Refining' : 'Ready'}</span>
              <span className={`status-pill ${recording || listening ? 'status-pill-approved' : 'status-pill-neutral'}`}>{recording ? 'Recording' : listening ? 'Listening' : 'Idle'}</span>
            </div>
          </div>

          <div className="chat-thread ask-ai-thread">
            {conversation.map((entry) => {
              const mine = entry.role === 'user';
              return (
                <div key={entry.id} className={`chat-message-row${mine ? ' chat-message-row-mine' : ''}`}>
                  <div className={`chat-message-bubble${mine ? ' chat-message-bubble chat-message-bubble-mine' : ''} ask-ai-message-bubble`}>
                    {mine ? (
                      <>
                        <div className="chat-message-meta-top">
                          <span className="chat-message-author">You</span>
                        </div>
                        <div className="chat-message-text">{entry.text}</div>
                      </>
                    ) : (
                      <>
                        <div className="chat-message-meta-top">
                          <div>
                            <div className="chat-message-author">PT AI</div>
                            <div className="section-note ask-ai-bubble-meta">{entry.meta}</div>
                          </div>
                          {entry.pending ? <span className="status-pill status-pill-pending">Updating</span> : null}
                        </div>
                        <div className="ask-ai-answer-title">{entry.title}</div>
                        <div className="ask-ai-answer-lines">
                          {(entry.answer || []).map((line) => (
                            <div key={`${entry.id}-${line}`} className="ask-ai-answer-line">{line}</div>
                          ))}
                        </div>
                        {entry.related?.length ? (
                          <div className="ask-ai-related-block">
                            <div className="ask-ai-related-title">Related Help</div>
                            <div className="inline-actions">
                              {entry.related.map((topic) => (
                                <button key={`${entry.id}-${topic.id}`} className="btn" onClick={() => { setQuery(topic.title); ask(topic.title); }}>
                                  {topic.title}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="chat-composer ask-ai-composer">
            {transcript ? (
              <div className="chat-reply-banner">
                <div>
                  <div className="chat-reply-banner-title">Voice Transcript</div>
                  <div className="chat-reply-banner-text">{transcript}</div>
                </div>
              </div>
            ) : null}
            <div className="chat-compose-row">
              <div className="ask-ai-compose-controls">
                {recorderSupported ? (
                  recording
                    ? <button className="btn chat-compose-emoji-btn ask-ai-record-btn" onClick={stopAudioRecording} title="Stop recording" aria-label="Stop recording">■</button>
                    : <button className="btn chat-compose-emoji-btn ask-ai-record-btn" onClick={startAudioRecording} disabled={listening} title="Record voice" aria-label="Record voice">●</button>
                ) : null}
                {voiceSupported ? (
                  listening
                    ? <button className="btn chat-compose-emoji-btn ask-ai-record-btn" onClick={stopVoiceInput} disabled={recording} title="Stop browser voice" aria-label="Stop browser voice">◼</button>
                    : <button className="btn chat-compose-emoji-btn ask-ai-record-btn" onClick={startVoiceInput} disabled={recording} title="Use browser voice" aria-label="Use browser voice">🎤</button>
                ) : null}
              </div>
              <textarea
                className="input chat-compose-input"
                rows={1}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Ask PT AI anything about the system"
              />
              <button className="btn btn-primary chat-compose-send-btn" onClick={() => ask(query)} disabled={recording} title="Ask now">
                {asking ? '...' : '>'}
              </button>
            </div>
            <div className="inline-actions ask-ai-toolbar">
              {speechSupported ? (
                speaking
                  ? <button className="btn" onClick={stopSpeaking}>Stop Reading</button>
                  : <button className="btn" onClick={speakAnswer} disabled={!answer}>Read Answer</button>
              ) : null}
              <span className="table-meta">
                {recording ? 'Recording voice...' : listening ? 'Listening for your question...' : asking ? 'Showing a fast answer while PT AI refines it...' : 'Press Enter to ask. Use Shift+Enter for a new line.'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AskPtAiPage;
