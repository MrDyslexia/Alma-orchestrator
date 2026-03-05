import { Router } from 'express';
import { sttService } from '@services/SttService';
import { llmService } from '@services/LlmService';
import { ttsService } from '@services/TtsService';
import { sessionManager } from '@managers/SessionManager';

const router = Router();

// GET /health
// Verifica el estado del orquestador y de los tres microservicios.
// Útil para monitoreo entre equipos y para la demo de la tesis.
router.get('/', async (_req, res) => {
  const startedAt = Date.now();

  const [stt, llm, tts] = await Promise.allSettled([
    sttService.isHealthy(),
    llmService.isHealthy(),
    ttsService.isHealthy(),
  ]);

  const services = {
    stt: stt.status === 'fulfilled' ? stt.value : false,
    llm: llm.status === 'fulfilled' ? llm.value : false,
    tts: tts.status === 'fulfilled' ? tts.value : false,
  };

  const allHealthy = Object.values(services).every(Boolean);

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    services,
    sessions: sessionManager.getSummary(),
  });
});

export default router;
