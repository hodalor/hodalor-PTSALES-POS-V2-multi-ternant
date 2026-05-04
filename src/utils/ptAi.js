const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_AI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
const LANGUAGE_NAMES = {
  en: 'English',
  tw: 'Twi',
  ga: 'Ga',
  ewe: 'Ewe',
  dag: 'Dagbani',
  fr: 'French',
  zh: 'Chinese'
};

const PT_AI_SYSTEM_PROMPT = `
You are PT AI, the in-product assistant for a multi-tenant POS, inventory, finance, and approvals system.

Your job:
- Answer clearly and practically for end users, cashiers, managers, inventory staff, tenant admins, and superadmin users.
- Explain workflows inside this product, not generic theory.
- Handle spelling mistakes and vague phrasing.
- Give step-by-step answers when the user asks "how do I".
- Stay concise but complete.
- If the question is ambiguous, state the most likely workflow and mention a close alternative.

Core system areas you must understand:
- Retail POS, Distribution POS, Warehouse operations
- Products, packs, variants, SKU, barcode, labels
- Serialized and IMEI item handling
- Inventory segregation by retail, distribution, and warehouse branch types
- Purchases, transfers, adjustments, refunds, approvals
- Customers, suppliers, users, branches, grants, permissions, GodHand feature toggles
- Sales, invoices, receipts, line totals, business customer fields
- Finance and cash reconciliation, deposit proof, approvals, backlog handling
- Reports, stock records, backup/sync, IMEI conflicts
- Internal communication, tenant-safe data access, branch-specific visibility

Answer style:
- Prefer numbered or ordered steps when useful.
- Mention the likely page or menu path when you know it.
- Prefer tutorial-style instructions over definitions when the user asks how to do something.
- Name the actual menu, tab, filter, row action, and button when you know them.
- Focus on how to reach the record, page, or action the user needs, not only what the feature means.
- When a user asks where to find something, answer with navigation steps first.
- Do not invent features that are not likely in this system.
- If you are not sure, say what is most likely and what to verify in the app.
- Be conversational like a helpful chatbot, not only a static help article.
- If the user greets you, greet them back naturally and ask how you can help today.
- If the user thanks you, respond politely and ask whether they want help with anything else.
- For normal workflow answers, end naturally with a short follow-up such as asking whether they want help with the next step.
`.trim();

function normalizeOutputLanguage(value) {
  const key = String(value || 'en').trim().toLowerCase();
  return LANGUAGE_NAMES[key] || LANGUAGE_NAMES.en;
}

function buildLanguageAwareSystemPrompt(language) {
  return [
    PT_AI_SYSTEM_PROMPT,
    `Language rule: Write your final answer in ${normalizeOutputLanguage(language)} unless the user explicitly asks for a different output language.`,
    'Keep button names, route names, menu labels, and feature names recognizable when they are official in-product labels.'
  ].join('\n\n');
}

function normalizeAiBaseUrl(value) {
  return String(value || DEFAULT_AI_BASE_URL).trim().replace(/\/+$/, '');
}

function getAiConfig() {
  const apiKey = String(process.env.PT_AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const baseUrl = normalizeAiBaseUrl(process.env.PT_AI_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_AI_BASE_URL);
  const model = String(process.env.PT_AI_MODEL || process.env.OPENAI_MODEL || DEFAULT_AI_MODEL).trim() || DEFAULT_AI_MODEL;
  const transcriptionModel = String(process.env.PT_AI_TRANSCRIBE_MODEL || DEFAULT_AI_TRANSCRIBE_MODEL).trim() || DEFAULT_AI_TRANSCRIBE_MODEL;
  return {
    apiKey,
    baseUrl,
    model,
    transcriptionModel,
    configured: !!apiKey
  };
}

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-6)
    .flatMap((item) => {
      const question = String(item?.question || item?.query || '').trim();
      const answer = String(item?.answer || '').trim();
      const out = [];
      if (question) out.push({ role: 'user', content: question });
      if (answer) out.push({ role: 'assistant', content: answer });
      return out;
    });
}

function splitAnswer(text) {
  return String(text || '')
    .split(/\n{2,}|\r\n\r\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const err = new Error('PT AI request timed out');
      err.code = 'PT_AI_TIMEOUT';
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function askExternalPtAi({ query, history = [], language = 'en' }) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) throw new Error('Question is required');

  const config = getAiConfig();
  if (!config.configured) {
    const err = new Error('PT AI backend is not configured');
    err.code = 'PT_AI_NOT_CONFIGURED';
    throw err;
  }

  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: buildLanguageAwareSystemPrompt(language) },
        ...normalizeHistory(history),
        { role: 'user', content: cleanQuery }
      ]
    })
  }, 12000);

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}

  if (!response.ok) {
    const message = String(parsed?.error?.message || parsed?.message || raw || 'PT AI request failed').trim();
    const err = new Error(message);
    err.code = `PT_AI_HTTP_${response.status}`;
    throw err;
  }

  const text = String(parsed?.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    const err = new Error('PT AI returned an empty answer');
    err.code = 'PT_AI_EMPTY';
    throw err;
  }

  return {
    mode: 'ai',
    title: 'PT AI Answer',
    answer: splitAnswer(text),
    provider: 'openai-compatible',
    model: config.model
  };
}

export async function translatePtAiContent({ content, language = 'en', format = 'text', context = '' }) {
  const cleanContent = String(content || '').trim();
  if (!cleanContent) throw new Error('Content is required');

  const outputLanguage = normalizeOutputLanguage(language);
  if (outputLanguage === LANGUAGE_NAMES.en) {
    return {
      content: cleanContent,
      provider: 'local',
      model: 'none'
    };
  }

  const config = getAiConfig();
  if (!config.configured) {
    const err = new Error('PT AI backend is not configured');
    err.code = 'PT_AI_NOT_CONFIGURED';
    throw err;
  }

  const normalizedFormat = ['text', 'html', 'json'].includes(String(format || '').trim().toLowerCase())
    ? String(format || '').trim().toLowerCase()
    : 'text';

  const instructions = normalizedFormat === 'html'
    ? [
        `Translate the following HTML into ${outputLanguage}.`,
        'Preserve the HTML structure, tags, attributes, links, lists, headings, and inline formatting.',
        'Do not wrap the result in markdown fences.',
        'Do not add commentary before or after the HTML.',
        'Do not translate code inside <pre> or <code> blocks.'
      ].join(' ')
    : normalizedFormat === 'json'
      ? [
          `Translate the following JSON string values into ${outputLanguage}.`,
          'Preserve all keys, array shapes, ids, and JSON structure.',
          'Return valid JSON only with no markdown fences or extra commentary.',
          'Do not translate code-like identifiers or stable ids.'
        ].join(' ')
      : [
          `Translate the following content into ${outputLanguage}.`,
          'Preserve meaning, line breaks, and ordering.',
          'Return only the translated content with no extra commentary.'
        ].join(' ');

  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: `You are a precise translator for ptSales manuals, help content, and UI guidance. ${context ? `Context: ${context}.` : ''}`
        },
        {
          role: 'user',
          content: `${instructions}\n\n${cleanContent}`
        }
      ]
    })
  }, 30000);

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}

  if (!response.ok) {
    const message = String(parsed?.error?.message || parsed?.message || raw || 'PT AI translation failed').trim();
    const err = new Error(message);
    err.code = `PT_AI_TRANSLATE_HTTP_${response.status}`;
    throw err;
  }

  const text = String(parsed?.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    const err = new Error('PT AI translation returned empty content');
    err.code = 'PT_AI_TRANSLATE_EMPTY';
    throw err;
  }

  return {
    content: text,
    provider: 'openai-compatible',
    model: config.model
  };
}

export async function transcribeExternalPtAi({ audioBase64, mimeType = 'audio/webm' }) {
  const base64 = String(audioBase64 || '').trim();
  if (!base64) throw new Error('Audio is required');

  const config = getAiConfig();
  if (!config.configured) {
    const err = new Error('PT AI backend is not configured');
    err.code = 'PT_AI_NOT_CONFIGURED';
    throw err;
  }

  const cleanBase64 = base64.includes(',') ? base64.split(',').pop() : base64;
  const buffer = Buffer.from(cleanBase64, 'base64');
  if (!buffer.length) {
    const err = new Error('Audio could not be decoded');
    err.code = 'PT_AI_AUDIO_INVALID';
    throw err;
  }

  const form = new FormData();
  form.append('model', config.transcriptionModel);
  form.append('file', new Blob([buffer], { type: String(mimeType || 'audio/webm') }), 'pt-ai-voice.webm');

  const response = await fetchWithTimeout(`${config.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`
    },
    body: form
  }, 20000);

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}

  if (!response.ok) {
    const message = String(parsed?.error?.message || parsed?.message || raw || 'PT AI transcription failed').trim();
    const err = new Error(message);
    err.code = `PT_AI_TRANSCRIBE_HTTP_${response.status}`;
    throw err;
  }

  const text = String(parsed?.text || parsed?.transcript || '').trim();
  if (!text) {
    const err = new Error('PT AI transcription returned empty text');
    err.code = 'PT_AI_TRANSCRIBE_EMPTY';
    throw err;
  }

  return {
    text,
    provider: 'openai-compatible',
    model: config.transcriptionModel
  };
}
