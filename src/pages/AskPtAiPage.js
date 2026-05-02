import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/ToastProvider';
import { askPtAi as askPtAiApi, transcribePtAi } from '../api/ptAi';
import { findBestPtAiAnswer, PT_AI_TOPICS } from '../utils/ptAiKnowledge';

function AskPtAiPage() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(() => findBestPtAiAnswer('serialized item'));
  const [history, setHistory] = useState([]);
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

  function normalizeAnswer(result, fallbackTitle = 'PT AI Answer') {
    const title = String(result?.title || fallbackTitle).trim() || fallbackTitle;
    const answerLines = Array.isArray(result?.answer)
      ? result.answer.map((line) => String(line || '').trim()).filter(Boolean)
      : String(result?.answer || result?.text || '').split(/\n{2,}|\r\n\r\n/).map((line) => line.trim()).filter(Boolean);
    return {
      ...result,
      title,
      answer: answerLines,
      related: Array.isArray(result?.related) ? result.related : []
    };
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
    const requestId = Date.now();
    requestIdRef.current = requestId;
    const quickFallback = normalizeAnswer(findBestPtAiAnswer(clean), 'PT AI Local Help');
    setAnswer(quickFallback);
    setAnswerMeta('Built-in workflow guidance');
    saveHistoryEntry(clean, quickFallback);
    if (options.autoSpeakQuick) speakResult(quickFallback);
    setAsking(true);
    try {
      const aiResult = await askPtAiApi({
        query: clean,
        history: history.slice(0, 4).map((item) => ({ question: item.query, answer: item.answerText || item.answer }))
      });
      if (requestIdRef.current !== requestId) return;
      const normalized = normalizeAnswer(aiResult);
      setAnswer(normalized);
      setAnswerMeta(`${aiResult?.provider || 'AI backend'}${aiResult?.model ? ` • ${aiResult.model}` : ''}`);
      saveHistoryEntry(clean, normalized);
      if (options.autoSpeak) speakResult(normalized);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setAnswer(quickFallback);
      setAnswerMeta('Built-in workflow guidance');
      saveHistoryEntry(clean, quickFallback);
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
        setTranscript('');
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
        if (finalText) ask(finalText, { autoSpeak: true, autoSpeakQuick: true });
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
      setTranscript('');
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

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Ask PT AI</h1>
          <div className="page-subtitle-compact">Ask how any part of the system works. PT AI understands common spelling mistakes, workflow questions, and can listen and read answers aloud.</div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-label">Covered Topics</div><div className="stat-value">{PT_AI_TOPICS.length}</div></div>
        <div className="card stat-card"><div className="stat-label">Voice Input</div><div className="stat-value" style={{ fontSize: '1.2rem' }}>{(recorderSupported || voiceSupported) ? 'Ready' : 'Browser Off'}</div></div>
        <div className="card stat-card"><div className="stat-label">Voice Reply</div><div className="stat-value" style={{ fontSize: '1.2rem' }}>{speechSupported ? 'Ready' : 'Browser Off'}</div></div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="field-label">Ask PT AI</div>
        <textarea
          className="input"
          rows={4}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Example: how do I add a serialized item, how to sell phone imei, how does cash reconciliation work"
        />
        <div className="approval-row-actions" style={{ justifyContent: 'space-between' }}>
          <div className="inline-actions">
            <button className="btn btn-primary" onClick={() => ask(query)} disabled={recording}>{asking ? 'Refining...' : 'Ask Now'}</button>
            {recorderSupported ? (
              recording
                ? <button className="btn" onClick={stopAudioRecording}>Stop Recording</button>
                : <button className="btn" onClick={startAudioRecording} disabled={listening}>Record Voice</button>
            ) : null}
            {voiceSupported ? (
              listening
                ? <button className="btn" onClick={stopVoiceInput}>Stop Voice Input</button>
                : <button className="btn" onClick={startVoiceInput} disabled={recording}>Use Browser Voice</button>
            ) : null}
            {speechSupported ? (
              speaking
                ? <button className="btn" onClick={stopSpeaking}>Stop Reading</button>
                : <button className="btn" onClick={speakAnswer} disabled={!answer}>Read Answer</button>
            ) : null}
          </div>
          <span className="table-meta">
            {recording ? 'Recording voice...' : listening ? `Listening${transcript ? `: ${transcript}` : '...'}` : asking ? 'Showing fast answer while PT AI refines it...' : speaking ? 'Reading answer aloud...' : 'You can type, record voice, or use browser voice.'}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) 360px', gap: 16 }}>
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="section-header">
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>{answer?.title || 'Answer'}</h2>
              <div className="section-note">{answerMeta}</div>
            </div>
            {speaking ? <span className="status-pill status-pill-approved">Speaking</span> : null}
          </div>
          <div className="surface-panel-muted" style={{ display: 'grid', gap: 10 }}>
            {(answer?.answer || []).map((line) => (
              <div key={line} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span className="status-pill status-pill-pending" style={{ minWidth: 24, padding: '4px 0' }} />
                <div style={{ lineHeight: 1.7 }}>{line}</div>
              </div>
            ))}
          </div>
          {answer?.related?.length ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="field-label">Related Help</div>
              <div className="inline-actions">
                {answer.related.map((topic) => (
                  <button key={topic.id} className="btn" onClick={() => { setQuery(topic.title); ask(topic.title); }}>
                    {topic.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 16, alignSelf: 'start' }}>
          <div className="card" style={{ display: 'grid', gap: 10 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Quick Topics</h2>
            <div className="inline-actions">
              {quickTopics.map((topic) => (
                <button key={topic.id} className="btn" onClick={() => { setQuery(topic.title); ask(topic.title); }}>
                  {topic.title}
                </button>
              ))}
            </div>
          </div>
          <div className="card" style={{ display: 'grid', gap: 10 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Recent Questions</h2>
            {history.length ? history.map((item, index) => (
              <div key={`${item.query}-${index}`} className="mini-record">
                <div className="mini-record-title"><span>{item.query}</span></div>
                <div className="mini-record-subtle">{item.answer}</div>
              </div>
            )) : <div className="table-meta">Your recent questions will appear here.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AskPtAiPage;
