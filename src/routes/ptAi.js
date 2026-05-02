import { Router } from 'express';
import { requireAuth, requireFeature, requireRoleOrPerm } from '../middleware/auth.js';
import { askExternalPtAi, transcribeExternalPtAi } from '../utils/ptAi.js';

const r = Router();

r.use(requireAuth);
r.use(requireFeature('modules.communication'));

r.post('/ask', requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['view_pt_ai']), async (req, res) => {
  const query = String(req.body?.query || '').trim();
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!query) return res.status(400).json({ error: 'Question is required' });

  const result = await askExternalPtAi({ query, history });
  res.json(result);
});

r.post('/transcribe', requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], ['view_pt_ai']), async (req, res) => {
  const audioBase64 = String(req.body?.audioBase64 || '').trim();
  const mimeType = String(req.body?.mimeType || 'audio/webm').trim();
  if (!audioBase64) return res.status(400).json({ error: 'Audio is required' });

  const result = await transcribeExternalPtAi({ audioBase64, mimeType });
  res.json(result);
});

export default r;
