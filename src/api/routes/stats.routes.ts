import { Router } from 'express';
import { sessionManager } from '@managers/SessionManager';
import { jobQueueManager } from '@queues/JobQueue';
import { connectionHandler } from '@handlers/ConnectionHandler';

const router = Router();

// GET /stats
// Métricas generales del servidor.
// Las métricas de latencia STT/LLM/TTS se reportan aquí
// y son las que necesitas para la evaluación de la tesis.
router.get('/', (_req, res) => {
  res.json({
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    },
    connections: connectionHandler.getStats(),
    queues: jobQueueManager.getAllStats(),
    sessions: sessionManager.getSummary(),
  });
});

export default router;
