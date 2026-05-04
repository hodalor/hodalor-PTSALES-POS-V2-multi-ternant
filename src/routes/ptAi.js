import { Router } from 'express';
import { requireAuth, requireFeature, requireRoleOrPerm } from '../middleware/auth.js';
import { askExternalPtAi, transcribeExternalPtAi, translatePtAiContent } from '../utils/ptAi.js';

const r = Router();

r.use(requireAuth);

r.post('/ask', requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['view_pt_ai']), async (req, res) => {
  const query = String(req.body?.query || '').trim();
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const language = String(req.body?.language || 'en').trim();
  if (!query) return res.status(400).json({ error: 'Question is required' });

  const result = await askExternalPtAi({ query, history, language });
  res.json(result);
});

r.post('/transcribe', requireFeature('modules.communication'), requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['view_pt_ai']), async (req, res) => {
  const audioBase64 = String(req.body?.audioBase64 || '').trim();
  const mimeType = String(req.body?.mimeType || 'audio/webm').trim();
  if (!audioBase64) return res.status(400).json({ error: 'Audio is required' });

  const result = await transcribeExternalPtAi({ audioBase64, mimeType });
  res.json(result);
});

r.post('/translate', async (req, res) => {
  const content = String(req.body?.content || '').trim();
  const language = String(req.body?.language || 'en').trim();
  const format = String(req.body?.format || 'text').trim();
  const context = String(req.body?.context || '').trim();
  if (!content) return res.status(400).json({ error: 'Content is required' });

  const result = await translatePtAiContent({ content, language, format, context });
  res.json(result);
});

export default r;
