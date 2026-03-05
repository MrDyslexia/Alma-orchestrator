import http from 'http';
import express from 'express';
import { config } from '@config/index';
import { logger } from '@utils/logger';
import { createSocketServer } from './socket/SocketServer';
import apiRouter from './api/index';

// ── Express ───────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use('/api', apiRouter);

app.get('/', (_req, res) => {
  res.json({
    name: 'ALMA Orchestrator',
    version: '2.0.0',
    status: 'running',
    endpoints: { health: '/api/health', stats: '/api/stats', sessions: '/api/sessions' },
  });
});

// ── HTTP + Socket.IO ──────────────────────────────────────────────

const httpServer = http.createServer(app);
const io = createSocketServer(httpServer);

// ── Arranque ──────────────────────────────────────────────────────

httpServer.listen(config.PORT, '0.0.0.0', () => {
  logger.info(`
╔══════════════════════════════════════════════╗
║           ALMA Orchestrator v2.0             ║
╠══════════════════════════════════════════════╣
║  Puerto      : ${String(config.PORT).padEnd(28)}║
║  Entorno     : ${config.NODE_ENV.padEnd(28)}║
║  LLM         : ${config.LLM_MODEL.substring(0, 28).padEnd(28)}║
║  STT         : ${config.STT_BASE_URL.substring(0, 28).padEnd(28)}║
║  TTS         : ${config.TTS_BASE_URL.substring(0, 28).padEnd(28)}║
║  Grabación   : ${String(config.ENABLE_WAV_RECORDING).padEnd(28)}║
║  Max sesiones: ${String(config.MAX_CONCURRENT_SESSIONS).padEnd(28)}║
╚══════════════════════════════════════════════╝
  `);
});

// ── Shutdown limpio ───────────────────────────────────────────────

function shutdown(signal: string) {
  logger.info({ signal }, 'Iniciando shutdown...');
  io.close(() => {
    logger.info('Socket.IO cerrado');
    httpServer.close(() => { logger.info('Servidor HTTP cerrado'); process.exit(0); });
  });
  setTimeout(() => { logger.warn('Shutdown forzado tras timeout'); process.exit(1); }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',  (err)    => { logger.fatal({ err }, 'Excepción no capturada'); process.exit(1); });
process.on('unhandledRejection', (reason) => { logger.error({ reason }, 'Promise sin manejar'); });

export { app, httpServer, io };
