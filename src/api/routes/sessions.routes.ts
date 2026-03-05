import { Router } from 'express';
import { sessionManager } from '@managers/SessionManager';
import { jobQueueManager } from '@queues/JobQueue';

const router = Router();

// GET /sessions
// Lista todas las sesiones activas con su estado.
router.get('/', (_req, res) => {
  const sessions = sessionManager.getAll().map((s) => ({
    socketId: s.socketId,
    deviceId: s.deviceId,
    state: s.state,
    conversationActive: s.conversationActive,
    messageCount: s.dialog.length - 1,
    cognitiveStep: s.cognitiveState?.currentStep ?? null,
    connectedAt: new Date(s.connectedAt).toISOString(),
    durationMs: Date.now() - s.connectedAt,
  }));

  res.json({
    count: sessions.length,
    sessions,
  });
});

// GET /sessions/:socketId
// Detalle de una sesión específica.
router.get('/:socketId', (req, res) => {
  const session = sessionManager.get(req.params.socketId);
  if (!session) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  res.json({
    socketId: session.socketId,
    deviceId: session.deviceId,
    state: session.state,
    conversationActive: session.conversationActive,
    messageCount: session.dialog.length - 1,
    cognitiveState: session.cognitiveState,
    connectedAt: new Date(session.connectedAt).toISOString(),
    lastActivity: new Date(session.lastActivity).toISOString(),
    durationMs: Date.now() - session.connectedAt,
    queue: jobQueueManager.getQueue(session.socketId).getStats(),
  });
});

// POST /sessions/:socketId/reset
// Reinicia la conversación de una sesión (útil desde el dashboard).
router.post('/:socketId/reset', (req, res) => {
  const session = sessionManager.get(req.params.socketId);
  if (!session) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  jobQueueManager.flush(session.socketId);
  sessionManager.resetConversation(session.socketId);

  res.json({ message: 'Conversación reiniciada', socketId: session.socketId });
});

// POST /sessions/reset-all
// Reinicia todas las conversaciones activas.
router.post('/reset-all', (_req, res) => {
  let count = 0;
  for (const session of sessionManager.getAll()) {
    if (session.conversationActive) {
      jobQueueManager.flush(session.socketId);
      sessionManager.resetConversation(session.socketId);
      count++;
    }
  }

  res.json({ message: `${count} conversaciones reiniciadas`, count });
});

export default router;
