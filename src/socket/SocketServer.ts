import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { createLogger } from '@utils/logger';
import { audioHandler } from '@handlers/AudioHandler';
import { connectionHandler } from '@handlers/ConnectionHandler';
import { sessionManager } from '@managers/SessionManager';
import { cognitiveProtocol } from '@protocol/CognitiveProtocol';
import { STATS_EMIT_INTERVAL_MS } from '@config/constants';
import type { ServerToClientEvents, ClientToServerEvents } from '../types/socket.types';

const log = createLogger('SocketServer');

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? false                      // en producción solo conexiones desde la red local
        : '*',
      methods: ['GET', 'POST'],
    },
    // Configuración de transporte optimizada para audio continuo
    transports: ['websocket'],       // sin fallback a polling — audio requiere WS
    pingTimeout: 60_000,             // 60s antes de considerar conexión muerta
    pingInterval: 25_000,            // ping cada 25s para mantener conexión viva
    maxHttpBufferSize: 1e7,          // 10MB — necesario para chunks de audio grandes
  });

  // ── Registro de eventos por conexión ───────────────────────────

  io.on('connection', (socket) => {
    // Conectado — aún no sabemos el deviceId
    void connectionHandler.handleConnect(socket);

    // ── Registro de dispositivo ──────────────────────────────
    socket.on('register_device', (data) => {
      connectionHandler.handleRegisterDevice(socket, data);
    });

    // ── Audio entrante ───────────────────────────────────────
    socket.on('audio_chunk', (data) => {
      audioHandler.handleChunk(socket, data);
    });

    // ── Control de grabación ─────────────────────────────────
    socket.on('start_recording', () => {
      log.debug({ socketId: socket.id }, 'start_recording');
      socket.emit('assistant_status', { status: 'recording' });
    });

    socket.on('stop_recording', () => {
      audioHandler.handleStopRecording(socket);
    });

    socket.on('get_final_transcription', () => {
      // El VAD ya maneja el fin de utterance automáticamente.
      // Este evento es por compatibilidad con clientes que usan
      // el modelo push-to-talk en lugar de VAD continuo.
      audioHandler.handleStopRecording(socket);
    });

    // ── Gestión de conversación ──────────────────────────────
    socket.on('reset_conversation', () => {
      sessionManager.resetConversation(socket.id);
      socket.emit('session_state', buildSessionState(socket.id));
      log.info({ socketId: socket.id }, 'Conversación reiniciada manualmente');
    });

    socket.on('get_conversation_state', () => {
      socket.emit('session_state', buildSessionState(socket.id));
    });

    // ── Stats periódicas ─────────────────────────────────────
    const statsInterval = setInterval(() => {
      try {
        const session = sessionManager.get(socket.id);
        if (!session) return;

        socket.emit('server_stats', {
          activeConnections: sessionManager.countActive(),
          chunksReceived: 0,          // el conteo real vive en AudioHandler
          sessionDurationMs: Date.now() - session.connectedAt,
          isRecording: session.state === 'listening',
          conversationActive: session.conversationActive,
        });
      } catch { /* socket puede cerrarse entre ticks */ }
    }, STATS_EMIT_INTERVAL_MS);

    // ── Desconexión ──────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      clearInterval(statsInterval);
      connectionHandler.handleDisconnect(socket, reason);
    });

    // ── Error de socket ──────────────────────────────────────
    socket.on('error', (err) => {
      log.error({ socketId: socket.id, err }, 'Error de socket');
    });
  });

  log.info('SocketServer configurado');
  return io;
}

// ── Helper ────────────────────────────────────────────────────────

function buildSessionState(socketId: string) {
  const session = sessionManager.get(socketId);
  if (!session) {
    return {
      state: 'idle' as const,
      conversationActive: false,
      messageCount: 0,
      durationMs: 0,
      cognitiveStep: null,
    };
  }

  return {
    state: session.state,
    conversationActive: session.conversationActive,
    messageCount: session.dialog.length - 1, // sin contar el system prompt
    durationMs: Date.now() - session.connectedAt,
    cognitiveStep: session.cognitiveState?.currentStep ?? null,
  };
}
