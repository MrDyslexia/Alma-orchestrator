import { createLogger } from '@utils/logger';
import { sessionManager } from '@managers/SessionManager';
import { audioManager } from '@managers/AudioManager';
import { jobQueueManager } from '@queues/JobQueue';
import { sttService } from '@services/SttService';
import { llmService } from '@services/LlmService';
import { ttsService } from '@services/TtsService';
import { config } from '@config/index';
import type { Socket, Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '../types/socket.types';

const log = createLogger('ConnectionHandler');

type AlmaSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type AlmaServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class ConnectionHandler {
  private connectionCount = 0;

  // ── Conexión nueva ──────────────────────────────────────────

  async handleConnect(socket: AlmaSocket): Promise<void> {
    this.connectionCount++;
    log.info(
      { socketId: socket.id, total: this.connectionCount },
      'Cliente conectado'
    );

    // Verificar salud de los servicios al conectar
    // (no bloqueante — se hace en background)
    void this.checkServicesHealth(socket);
  }

  // ── Registro de dispositivo ─────────────────────────────────
  // El cliente Android envía su deviceId único al conectar.
  // Aquí decidimos si es reconexión (restaurar sesión) o nueva sesión.

  handleRegisterDevice(
    socket: AlmaSocket,
    data: { deviceId: string }
  ): void {
    const { deviceId } = data;

    if (!deviceId) {
      socket.emit('error', {
        code: 'INTERNAL_ERROR',
        message: 'deviceId requerido para registrar el dispositivo',
      });
      return;
    }

    // Intentar reconexión primero
    const restoredSession = sessionManager.handleReconnect(socket.id, deviceId);

    if (restoredSession) {
      log.info({ socketId: socket.id, deviceId }, 'Sesión restaurada');

      socket.emit('connected', {
        message: 'Sesión restaurada correctamente',
        sessionId: socket.id,
        sampleRate: config.AUDIO_SAMPLE_RATE,
        chunkSize: config.AUDIO_CHUNK_SIZE,
        supportsTranscription: true,
        supportsTts: true,
        activationPhrase: config.ACTIVATION_PHRASE,
      });

      // Si estaba en medio de un protocolo cognitivo, notificar el estado
      if (restoredSession.cognitiveState) {
        const step = restoredSession.cognitiveState.currentStep;
        socket.emit('cognitive_step_changed', {
          step,
          stepNumber: 0,
          totalSteps: 7,
        });
      }

      return;
    }

    // Nueva sesión
    try {
      const session = sessionManager.create(socket.id, deviceId);

      // Crear WAV writer si la grabación está habilitada
      session.wavWriter = audioManager.createWriter(socket.id);

      log.info({ socketId: socket.id, deviceId }, 'Nueva sesión creada');

      socket.emit('connected', {
        message: 'Conectado al servidor ALMA',
        sessionId: socket.id,
        sampleRate: config.AUDIO_SAMPLE_RATE,
        chunkSize: config.AUDIO_CHUNK_SIZE,
        supportsTranscription: true,
        supportsTts: true,
        activationPhrase: config.ACTIVATION_PHRASE,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error creando sesión';
      log.error({ socketId: socket.id, deviceId, err }, 'Error creando sesión');

      socket.emit('error', {
        code: 'MAX_SESSIONS_REACHED',
        message,
      });

      socket.disconnect(true);
    }
  }

  // ── Desconexión ─────────────────────────────────────────────

  handleDisconnect(socket: AlmaSocket, reason: string): void {
    this.connectionCount = Math.max(0, this.connectionCount - 1);

    const session = sessionManager.get(socket.id);
    if (!session) return;

    log.info(
      { socketId: socket.id, deviceId: session.deviceId, reason },
      'Cliente desconectado'
    );

    // Guardar transcript si la grabación estaba activa
    if (session.wavWriter) {
      try { session.wavWriter.end(); } catch { /* ignorar */ }

      audioManager.saveTranscript(socket.id, {
        socketId: socket.id,
        deviceId: session.deviceId,
        startedAt: session.connectedAt,
        endedAt: Date.now(),
        dialog: session.dialog,
        cognitiveState: session.cognitiveState,
        disconnectReason: reason,
      });
    }

    // Iniciar grace period (no elimina la sesión inmediatamente)
    sessionManager.handleDisconnect(socket.id);

    // Limpiar cola de jobs (no tiene sentido procesar para socket desconectado)
    jobQueueManager.delete(socket.id);
  }

  // ── Health check de servicios ───────────────────────────────

  private async checkServicesHealth(socket: AlmaSocket): Promise<void> {
    const [sttOk, llmOk, ttsOk] = await Promise.allSettled([
      sttService.isHealthy(),
      llmService.isHealthy(),
      ttsService.isHealthy(),
    ]);

    const healthy = {
      stt: sttOk.status === 'fulfilled' && sttOk.value,
      llm: llmOk.status === 'fulfilled' && llmOk.value,
      tts: ttsOk.status === 'fulfilled' && ttsOk.value,
    };

    if (!healthy.stt || !healthy.llm || !healthy.tts) {
      log.warn({ socketId: socket.id, healthy }, 'Uno o más servicios no disponibles');
    }

    log.debug({ socketId: socket.id, healthy }, 'Health check completado');
  }

  // ── Stats ───────────────────────────────────────────────────

  getStats() {
    return {
      totalConnections: this.connectionCount,
      ...sessionManager.getSummary(),
    };
  }
}

export const connectionHandler = new ConnectionHandler();
