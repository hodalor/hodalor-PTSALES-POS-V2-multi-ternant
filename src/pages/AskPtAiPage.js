import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import { askPtAi as askPtAiApi, transcribePtAi } from '../api/ptAi';
import { findBestPtAiAnswer, PT_AI_TOPICS } from '../utils/ptAiKnowledge';
import { useAppLanguage } from '../utils/localization';

function normalizeChatText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function friendlyUserName(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const first = clean.split(/\s+/)[0] || '';
  if (!first) return '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function addUserAddress(text, userName, { hello = false, helloWord = 'Hello' } = {}) {
  const name = friendlyUserName(userName);
  const clean = String(text || '').trim();
  if (!clean) return '';
  if (!name) return clean;
  return hello ? `${helloWord} ${name}, ${clean}` : `${name}, ${clean}`;
}

function politeLead(userName, variant = 0) {
  const name = friendlyUserName(userName);
  if (!name) {
    return [
      'Sure.',
      'Absolutely.',
      'Of course.',
      'No problem.'
    ][variant % 4];
  }
  return [
    `Sure ${name},`,
    `${name}, we have got this.`,
    `Of course ${name},`,
    `${name}, I am with you on this.`
  ][variant % 4];
}

function introWithAssurance(userName, message, seed = '') {
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) return '';
  const source = String(seed || cleanMessage);
  const variant = Array.from(source).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  const lead = politeLead(userName, variant);
  if (!lead) return cleanMessage;
  return `${lead} ${cleanMessage}`.trim();
}

function buildInitialGreeting(userName, translateText = (value) => value) {
  const helloWord = translateText('Hello');
  return {
    title: helloWord,
    answer: [
      addUserAddress(translateText('I am PT AI.'), userName, { hello: true, helloWord }),
      translateText('How can I help you today with the system?')
    ],
    related: []
  };
}

function buildSmallTalkAnswer(query, options = {}) {
  const userName = options.userName;
  const translateText = options.translateText || ((value) => value);
  const q = normalizeChatText(query);
  if (!q) return null;
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(q)) {
    const helloWord = translateText('Hello');
    return {
      title: helloWord,
      answer: [
        addUserAddress(translateText('I am PT AI.'), userName, { hello: true, helloWord }),
        translateText('How can I help you today with the system?')
      ],
      related: PT_AI_TOPICS.slice(0, 3)
    };
  }
  if (
    q.includes('how are you')
    || q.includes('how is your day going')
    || q.includes('how s your day going')
    || q.includes('how was your day')
    || q.includes('how is your day')
    || q.includes('how are you doing')
    || q.includes('how are things')
  ) {
    return {
      title: translateText('My day is going well'),
      answer: [
        addUserAddress(translateText('my day is going well, thank you.'), userName, { hello: true, helloWord: translateText('Hello') }),
        translateText('I am here to help with the POS system. How can I help you today?')
      ],
      related: []
    };
  }
  if (q.includes('what is up') || q.includes('whats up') || q === 'sup') {
    return {
      title: translateText('I am here to help'),
      answer: [
        addUserAddress(translateText('I am here and ready to help.'), userName, { hello: true, helloWord: translateText('Hello') }),
        translateText('I was built to assist with the POS system. How can I help you today?')
      ],
      related: []
    };
  }
  if (q.includes('who are you') || q.includes('what can you do')) {
    return {
      title: 'About PT AI',
      answer: [
        addUserAddress('I am PT AI, your in-system assistant for this POS, inventory, approvals, finance, and communication platform.', userName, { hello: true }),
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
        addUserAddress('you are welcome.', userName),
        'Is there anything else you want me to help you with?'
      ],
      related: []
    };
  }
  if (q === 'bye' || q === 'goodbye' || q.includes('see you')) {
    return {
      title: 'Goodbye',
      answer: [
        addUserAddress('goodbye for now.', userName),
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

function buildOffTopicAnswer(userName, translateText = (value) => value) {
  return {
    title: translateText('I focus on this POS system'),
    answer: [
      addUserAddress(translateText('I can give a brief general idea, but I was built mainly to help employees use this POS, inventory, approvals, finance, and communication system.'), userName),
      translateText('Please ask me about a workflow in this system, such as POS sales, purchases, transfers, adjustments, expenses, cash reconciliation, invoices, customers, users, or reports.'),
      translateText('Is there anything else you want me to help you with inside the system?')
    ],
    related: PT_AI_TOPICS.slice(0, 4)
  };
}

function buildProhibitedAnswer(userName, translateText = (value) => value) {
  return {
    title: translateText('I cannot help with that'),
    answer: [
      addUserAddress(translateText('I was not built to help with hacking, privacy abuse, sexual content, breaches of security, or other harmful activity.'), userName),
      translateText('If you need help, I can assist with safe and lawful use of this POS system, such as sales, stock, approvals, reports, finance, customers, users, or communication workflows.'),
      translateText('Is there anything else you want me to help you with inside the system?')
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
  const broadSystemTerms = [
    'pos', 'sale', 'sales', 'receipt', 'invoice', 'product', 'stock', 'inventory', 'purchase', 'transfer',
    'adjustment', 'expense', 'finance', 'cash', 'reconciliation', 'branch', 'customer', 'supplier', 'user',
    'report', 'dashboard', 'approval', 'refund', 'backup', 'sync', 'serial', 'imei', 'communication', 'chat',
    'tenant', 'godhand', 'config', 'settings', 'label'
  ];
  if (broadSystemTerms.some((term) => q.includes(term))) return true;
  if (!localMatch || String(localMatch.title || '').trim() === 'I need a clearer question') return false;
  return q.split(' ').some((token) => token.length >= 5 && normalizeChatText(localMatch.title).includes(token));
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

function isUnknownResult(result) {
  const title = String(result?.title || '').trim().toLowerCase();
  const answerLines = Array.isArray(result?.answer)
    ? result.answer.map((line) => String(line || '').trim()).filter(Boolean)
    : String(result?.answer || result?.text || '').split(/\n{2,}|\r\n\r\n/).map((line) => line.trim()).filter(Boolean);
  return !answerLines.length || title === 'i need a clearer question';
}

function findPreviousUserQuestion(history, currentQuery) {
  const current = String(currentQuery || '').trim().toLowerCase();
  return (Array.isArray(history) ? [...history].reverse() : []).find((item) => {
    const candidate = String(item?.query || '').trim();
    return candidate && candidate.toLowerCase() !== current;
  })?.query || '';
}

function isFollowUpQuestion(query, previousQuestion = '') {
  const q = normalizeChatText(query);
  const previous = normalizeChatText(previousQuestion);
  if (!q || !previous) return false;
  const followUpPhrase = [
    'also',
    'what about',
    'how about',
    'and if',
    'then',
    'for that',
    'for this',
    'that one',
    'this one',
    'same process',
    'same thing',
    'another one'
  ].some((phrase) => q.includes(phrase));
  if (followUpPhrase) return true;
  const previousTokens = previous.split(' ').filter((token) => token.length >= 4);
  const sharedTokens = q.split(' ').filter((token) => token.length >= 4 && previousTokens.includes(token));
  return sharedTokens.length >= 2;
}

function buildUnknownAnswer(query, previousQuestion = '', userName = '', translateText = (value) => value) {
  const connected = previousQuestion
    ? translateText('That is a good follow-up question.')
    : '';
  return {
    title: translateText('I do not have a reliable answer yet'),
    answer: ensureFollowUp([
      connected,
      addUserAddress(translateText('I do not have a reliable answer for that question right now, so I do not want to guess or mislead you.'), userName),
      translateText('If you want, ask the same question with the exact page, button, menu, or workflow name and I will help with what I know.')
    ].filter(Boolean), translateText('Is there another way I can help you inside the system?')),
    related: []
  };
}

function buildConversationalAnswer(query, result, fallbackTitle = 'PT AI Answer', options = {}) {
  const userName = options.userName;
  const translateText = options.translateText || ((value) => value);
  const smallTalk = buildSmallTalkAnswer(query, { userName, translateText });
  if (smallTalk) return smallTalk;

  const previousQuestion = String(options.previousQuestion || '').trim();
  if (isUnknownResult(result)) return buildUnknownAnswer(query, previousQuestion, userName, translateText);

  const title = translateText(String(result?.title || fallbackTitle).trim() || fallbackTitle);
  const rawAnswerLines = Array.isArray(result?.answer)
    ? result.answer.map((line) => translateText(String(line || '').trim())).filter(Boolean)
    : String(result?.answer || result?.text || '').split(/\n{2,}|\r\n\r\n/).map((line) => translateText(line.trim())).filter(Boolean);
  const tutorialMode = looksLikeHowToQuestion(query);
  const answerLines = tutorialMode ? formatTutorialLines(rawAnswerLines) : rawAnswerLines;
  const followUpMode = isFollowUpQuestion(query, previousQuestion);
  const intro = followUpMode
    ? tutorialMode
      ? introWithAssurance(userName, `${translateText('That is a good follow-up question.')} ${translateText('Follow these steps.')}`, `${query}|followup|tutorial`)
      : introWithAssurance(userName, `${translateText('That is a good follow-up question.')} ${translateText('Here is what I can confirm.')}`, `${query}|followup|general`)
    : tutorialMode
      ? introWithAssurance(userName, translateText('Follow these steps.'), `${query}|tutorial`)
      : introWithAssurance(userName, translateText('Here is the best help I found.'), `${query}|general`);
  const followUp = tutorialMode
    ? translateText('If you want, I can also show the exact menu path or button names for another task. Is there anything else you want me to help you with?')
    : translateText('Is there anything else you want me to help you with?');

  return {
    ...result,
    title,
    answer: ensureFollowUp([intro, ...answerLines], followUp),
    related: []
  };
}

function AnimatedAnswerLines({ entryId, lines, animate, onProgress }) {
  const fullText = useMemo(
    () => (Array.isArray(lines) ? lines.map((line) => String(line || '')).join('\n') : ''),
    [lines]
  );
  const [visibleLength, setVisibleLength] = useState(animate ? 0 : fullText.length);

  useEffect(() => {
    if (!animate || typeof onProgress !== 'function') return undefined;
    onProgress();
    return undefined;
  }, [animate, visibleLength, onProgress]);

  useEffect(() => {
    if (!animate) {
      setVisibleLength(fullText.length);
      return undefined;
    }

    setVisibleLength(0);
    if (!fullText) return undefined;

    let cancelled = false;
    let timeoutId;
    let nextLength = 0;

    const tick = () => {
      if (cancelled) return;
      const char = fullText[nextLength] || '';
      const step = char === '\n' ? 1 : fullText.length - nextLength > 220 ? 3 : fullText.length - nextLength > 120 ? 2 : 1;
      nextLength = Math.min(fullText.length, nextLength + step);
      setVisibleLength(nextLength);
      if (nextLength >= fullText.length) return;
      const delay = char === '\n' ? 180 : char === ' ' ? 34 : 28;
      timeoutId = window.setTimeout(tick, delay);
    };

    timeoutId = window.setTimeout(tick, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [entryId, fullText, animate]);

  const visibleText = fullText.slice(0, visibleLength);
  const visibleLines = visibleText ? visibleText.split('\n') : [];
  const showCursor = animate && visibleLength < fullText.length;

  return (
    <div className={`ask-ai-answer-lines${animate ? ' ask-ai-answer-lines-typing' : ''}`}>
      {visibleLines.map((line, index) => (
        <div key={`${entryId}-${index}`} className="ask-ai-answer-line">{line}</div>
      ))}
      {showCursor ? (
        <div className="ask-ai-answer-line ask-ai-answer-line-cursor">
          <span className="ask-ai-typing-cursor" />
        </div>
      ) : null}
    </div>
  );
}

function AskPtAiPage() {
  const auth = useSelector((s) => s.auth);
  const { t, speechLocale, recognitionLocale } = useAppLanguage();
  const currentUserName = useMemo(() => friendlyUserName(auth?.user?.name || ''), [auth?.user?.name]);
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(null);
  const [history, setHistory] = useState([]);
  const [conversation, setConversation] = useState([]);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answerMeta, setAnswerMeta] = useState(() => t('Built-in workflow guidance'));
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const requestIdRef = useRef(0);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const bottomRef = useRef(null);
  const threadRef = useRef(null);
  const [animatedEntryId, setAnimatedEntryId] = useState(null);
  const welcomedRef = useRef(false);
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
    scrollThreadToBottom('smooth');
  }, [conversation]);

  useEffect(() => {
    if (welcomedRef.current) return;
    const greeting = buildInitialGreeting(currentUserName, t);
    welcomedRef.current = true;
    setAnswer(greeting);
    setAnswerMeta(t('Built-in workflow guidance'));
    setConversation([
      {
        id: 'welcome-ai',
        role: 'ai',
        title: greeting.title,
        answer: greeting.answer,
        related: greeting.related,
        meta: t('Built-in workflow guidance'),
        pending: false
      }
    ]);
    setAnimatedEntryId('welcome-ai');
  }, [currentUserName, t]);

  function scrollThreadToBottom(behavior = 'auto') {
    try {
      if (threadRef.current) {
        threadRef.current.scrollTo({ top: threadRef.current.scrollHeight, behavior });
        return;
      }
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    } catch {
      try {
        if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
      } catch {}
    }
  }

  function handleTypingProgress() {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      scrollThreadToBottom('auto');
    });
  }

  function speakResult(nextAnswer) {
    if (!speechSupported || !nextAnswer) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance([nextAnswer.title, ...(nextAnswer.answer || [])].join('. '));
      utterance.lang = speechLocale;
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
    const previousQuestion = findPreviousUserQuestion(history, clean);
    const localMatch = findBestPtAiAnswer(clean);
    const prohibitedResult = isProhibitedQuestion(clean) ? buildProhibitedAnswer(currentUserName, t) : null;
    const offTopicResult = !prohibitedResult && !isLikelySystemQuestion(clean, localMatch) ? buildOffTopicAnswer(currentUserName, t) : null;
    const requestId = Date.now();
    requestIdRef.current = requestId;
    const answerEntryId = `ai-${requestId}`;
    const quickFallback = prohibitedResult || offTopicResult || buildConversationalAnswer(clean, localMatch, t('PT AI Local Help'), { previousQuestion, userName: currentUserName, translateText: t });
    setAnswer(quickFallback);
    setAnswerMeta(t('Built-in workflow guidance'));
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
        meta: t('Built-in workflow guidance'),
        pending: true
      }
    ]));
    setAnimatedEntryId(answerEntryId);
    if (!options.keepQuery) setQuery('');
    if (options.autoSpeakQuick) speakResult(quickFallback);
    if (prohibitedResult || offTopicResult) {
      setAsking(false);
      return;
    }
    setAsking(true);
    try {
      const aiResult = await askPtAiApi({
        query: clean,
        history: history.slice(0, 4).map((item) => ({ question: item.query, answer: item.answerText || item.answer })),
        language: speechLocale
      });
      if (requestIdRef.current !== requestId) return;
      const normalized = buildConversationalAnswer(clean, aiResult, t('PT AI Answer'), { previousQuestion, userName: currentUserName, translateText: t });
      setAnswer(normalized);
      setAnswerMeta(`${t(aiResult?.provider || 'AI backend')}${aiResult?.model ? ` • ${aiResult.model}` : ''}`);
      saveHistoryEntry(clean, normalized);
      setConversation((prev) => prev.map((entry) => (
        entry.id === answerEntryId
          ? {
            ...entry,
            title: normalized.title,
            answer: normalized.answer,
            related: normalized.related,
            meta: `${t(aiResult?.provider || 'AI backend')}${aiResult?.model ? ` • ${aiResult.model}` : ''}`,
            pending: false
          }
          : entry
      )));
      if (options.autoSpeak) speakResult(normalized);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setAnswer(quickFallback);
      setAnswerMeta(t('Built-in workflow guidance'));
      saveHistoryEntry(clean, quickFallback);
      setConversation((prev) => prev.map((entry) => (
        entry.id === answerEntryId
          ? {
            ...entry,
            title: quickFallback.title,
            answer: quickFallback.answer,
            related: quickFallback.related,
            meta: t('Built-in workflow guidance'),
            pending: false
          }
          : entry
      )));
      if (options.autoSpeak) speakResult(quickFallback);
    } finally {
      if (requestIdRef.current === requestId) setAsking(false);
    }
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(t('Failed to read voice recording')));
      reader.readAsDataURL(blob);
    });
  }

  function startVoiceInput() {
    if (!speechRecognition) {
      toast.show(t('Browser speech recognition is not available here. Try Record Voice instead.'), { type: 'warning' });
      return;
    }
    try {
      const recognition = new speechRecognition();
      recognition.lang = recognitionLocale;
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onstart = () => {
        setListening(true);
        setTranscript(t('Listening for your question...'));
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
        toast.show(t('Voice recognition could not start. You can use Record Voice instead.'), { type: 'error' });
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
          toast.show(t('No speech was captured. Please try again and speak clearly.'), { type: 'warning' });
        }
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setListening(false);
      toast.show(t('Voice recognition is unavailable. Try Record Voice instead.'), { type: 'error' });
    }
  }

  function stopVoiceInput() {
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
  }

  async function startAudioRecording() {
    if (!recorderSupported) {
      toast.show(t('Audio recording is not supported in this browser.'), { type: 'error' });
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
        toast.show(t('Recording failed. Please allow microphone access and try again.'), { type: 'error' });
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
          setTranscript(t('Transcribing voice...'));
          const audioBase64 = await readBlobAsDataUrl(blob);
          const result = await transcribePtAi({ audioBase64, mimeType: blob.type || recorder.mimeType || 'audio/webm' });
          const text = String(result?.text || '').trim();
          if (!text) throw new Error(t('No voice text returned'));
          setTranscript(text);
          setQuery(text);
          await ask(text, { autoSpeak: true, autoSpeakQuick: true });
        } catch (error) {
          setAsking(false);
          toast.show(String(error?.message || t('Voice transcription failed')), { type: 'error' });
        }
      };
      mediaRecorderRef.current = recorder;
      setTranscript(t('Recording voice...'));
      setRecording(true);
      recorder.start();
    } catch (error) {
      setRecording(false);
      toast.show(t('Microphone access was denied or unavailable.'), { type: 'error' });
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
          <h1 style={{ margin: 0 }}>{t('Ask PT AI')}</h1>
          <div className="page-subtitle-compact">{t('Ask how any part of the system works in a chat-style workspace. PT AI understands spelling mistakes, workflow questions, and voice requests.')}</div>
        </div>
        <div className="page-header-actions">
          <span className="status-pill status-pill-neutral">{t('Topics {count}', { count: PT_AI_TOPICS.length })}</span>
          <span className={`status-pill ${(recorderSupported || voiceSupported) ? 'status-pill-approved' : 'status-pill-rejected'}`}>{t('Voice')} {(recorderSupported || voiceSupported) ? t('Ready') : t('Off')}</span>
          <span className={`status-pill ${speechSupported ? 'status-pill-approved' : 'status-pill-rejected'}`}>{t('Reply')} {speechSupported ? t('Ready') : t('Off')}</span>
        </div>
      </div>

      <div className="chat-layout ask-ai-layout" data-no-localize="true">
        <div className="card chat-people-card ask-ai-sidebar-card">
          <div className="chat-people-top">
            <div className="section-header">
              <div>
                <h2 className="section-title" style={{ margin: 0 }}>AI Workspace</h2>
                <span className="table-meta">{history.length ? t(history.length > 1 ? '{count} recent questions' : '{count} recent question', { count: history.length }) : t('Ready for your first question')}</span>
              </div>
              {speaking ? <span className="status-pill status-pill-approved">{t('Speaking')}</span> : null}
            </div>
            <div className="surface-panel-muted ask-ai-status-panel">
              <div className="mini-record-title">
                <span>{recording ? t('Recording voice...') : listening ? t('Listening...') : asking ? t('Thinking...') : speaking ? t('Reading answer aloud...') : t('PT AI is ready')}</span>
              </div>
              <div className="mini-record-subtle">
                {transcript
                  ? transcript
                  : recording
                    ? t('Speak clearly and stop when done.')
                    : listening
                      ? t('Browser voice capture is active.')
                      : t('Type or use voice to ask about any workflow in the system.')}
              </div>
            </div>
            <div>
              <div className="field-label" style={{ marginBottom: 8 }}>{t('Quick Topics')}</div>
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
            )) : <div className="surface-panel-muted">{t('Your recent PT AI questions will appear here.')}</div>}
          </div>
        </div>

        <div className="card chat-room-card ask-ai-room-card">
          <div className="section-header chat-room-header">
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>{t('PT AI Conversation')}</h2>
              <div className="section-note">{answerMeta || t('Built-in workflow guidance')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`status-pill ${asking ? 'status-pill-pending' : 'status-pill-neutral'}`}>{asking ? t('Refining') : t('Ready')}</span>
              <span className={`status-pill ${recording || listening ? 'status-pill-approved' : 'status-pill-neutral'}`}>{recording ? t('Recording') : listening ? t('Listening') : t('Idle')}</span>
            </div>
          </div>

          <div ref={threadRef} className="chat-thread ask-ai-thread">
            {conversation.map((entry) => {
              const mine = entry.role === 'user';
              return (
                <div key={entry.id} className={`chat-message-row${mine ? ' chat-message-row-mine' : ''}`}>
                  <div className={`chat-message-bubble${mine ? ' chat-message-bubble chat-message-bubble-mine' : ''} ask-ai-message-bubble`}>
                    {mine ? (
                      <>
                        <div className="chat-message-meta-top">
                          <span className="chat-message-author">{t('You')}</span>
                        </div>
                        <div className="chat-message-text">{entry.text}</div>
                      </>
                    ) : (
                      <>
                        <div className="chat-message-meta-top">
                          <div>
                            <div className="chat-message-author">{t('PT AI')}</div>
                            <div className="section-note ask-ai-bubble-meta">{entry.meta}</div>
                          </div>
                          {entry.pending ? <span className="status-pill status-pill-pending">{t('Updating')}</span> : null}
                        </div>
                        <div className="ask-ai-answer-title">{entry.title}</div>
                        <AnimatedAnswerLines
                          entryId={entry.id}
                          lines={entry.answer || []}
                          animate={entry.id === animatedEntryId}
                          onProgress={handleTypingProgress}
                        />
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
                    : <button className="btn chat-compose-emoji-btn ask-ai-record-btn" onClick={startAudioRecording} disabled={listening} title={t('Record voice')} aria-label={t('Record voice')}>●</button>
                ) : null}
                {voiceSupported ? (
                  listening
                    ? <button className="btn chat-compose-emoji-btn ask-ai-record-btn" onClick={stopVoiceInput} disabled={recording} title={t('Stop browser voice')} aria-label={t('Stop browser voice')}>◼</button>
                    : <button className="btn chat-compose-emoji-btn ask-ai-record-btn" onClick={startVoiceInput} disabled={recording} title={t('Use browser voice')} aria-label={t('Use browser voice')}>🎤</button>
                ) : null}
              </div>
              <textarea
                className="input chat-compose-input"
                rows={1}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder={t('Ask PT AI anything about the system')}
              />
              <button className="btn btn-primary chat-compose-send-btn" onClick={() => ask(query)} disabled={recording} title={t('Ask now')}>
                {asking ? '...' : '>'}
              </button>
            </div>
            <div className="inline-actions ask-ai-toolbar">
              {speechSupported ? (
                speaking
                  ? <button className="btn" onClick={stopSpeaking}>{t('Stop Reading')}</button>
                  : <button className="btn" onClick={speakAnswer} disabled={!answer}>{t('Read Answer')}</button>
              ) : null}
              <span className="table-meta">
                {recording ? t('Recording voice...') : listening ? t('Listening for your question...') : asking ? t('Showing a fast answer while PT AI refines it...') : t('Press Enter to ask. Use Shift+Enter for a new line.')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AskPtAiPage;
