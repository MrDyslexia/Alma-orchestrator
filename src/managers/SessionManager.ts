import { config } from '@config/index';
import { MAX_DIALOG_MESSAGES, SYSTEM_PROMPT } from '@config/constants';
import { createLogger } from '@utils/logger';
import { VadDetector } from '@utils/vad';
import type { Session, SessionState, DialogMessage } from '../types/session.types';
import type { CognitiveState } from '../types/protocol.types';

const log = createLogger('SessionManager');

export class SessionManager {
  // Mapa principal: socketId → Session
  private sessions = new Map<string, Session>();

  // Mapa de reconexión: deviceId → socketId anterior
  // Permite restaurar sesión cuando un dispositivo reconecta
  private deviceIndex = new Map<string, string>();

  // Timers de gracia para reconexión: socketId → timer
  private gracePeriodTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // VAD por sesión: socketId → VadDetector
  private vadDetectors = new Map<string, VadDetector>();

  // ─── Creación ──────────────────────────────────────────────────

  create(socketId: string, deviceId: string): Session {
    // Verificar límite de sesiones concurrentes
    const activeSessions = this.countActive();
    if (activeSessions >= config.MAX_CONCURRENT_SESSIONS) {
      throw new Error(
        `Límite de sesiones alcanzado (${config.MAX_CONCURRENT_SESSIONS}). ` +
        `Sesiones activas: ${activeSessions}`
      );
    }

    const session: Session = {
      socketId,
      deviceId,
      state: 'idle',
      conversationActive: false,
      dialog: [{ role: 'system', content: SYSTEM_PROMPT, timestamp: Date.now() }],
      userBuffer: '',
      isProcessing: false,
      cognitiveState: null,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      disconnectedAt: null,
      wavWriter: null,
    };

    this.sessions.set(socketId, session);
    this.deviceIndex.set(deviceId, socketId);
    this.vadDetectors.set(socketId, new VadDetector());

    log.info({ socketId, deviceId, activeSessions: activeSessions + 1 }, 'Sesión creada');
    return session;
  }

  // ─── Recuperación ──────────────────────────────────────────────

  get(socketId: string): Session | undefined {
    return this.sessions.get(socketId);
  }

  getOrThrow(socketId: string): Session {
    const session = this.sessions.get(socketId);
    if (!session) throw new Error(`Sesión no encontrada: ${socketId}`);
    return session;
  }

  getByDeviceId(deviceId: string): Session | undefined {
    const socketId = this.deviceIndex.get(deviceId);
    if (!socketId) return undefined;
    return this.sessions.get(socketId);
  }

  getVad(socketId: string): VadDetector | undefined {
    return this.vadDetectors.get(socketId);
  }

  // ─── Reconexión ────────────────────────────────────────────────

  // Llamado cuando un dispositivo conocido reconecta con nuevo socketId.
  // Transfiere el estado de la sesión anterior al nuevo socketId.
  handleReconnect(newSocketId: string, deviceId: string): Session | null {
    const oldSocketId = this.deviceIndex.get(deviceId);
    if (!oldSocketId) return null;

    const oldSession = this.sessions.get(oldSocketId);
    if (!oldSession) return null;

    // Cancelar timer de gracia si estaba corriendo
    this.cancelGracePeriod(oldSocketId);

    // Migrar sesión al nuevo socketId
    const migratedSession: Session = {
      ...oldSession,
      socketId: newSocketId,
      disconnectedAt: null,
      lastActivity: Date.now(),
    };

    // Limpiar registros del socket anterior
    this.sessions.delete(oldSocketId);
    this.vadDetectors.delete(oldSocketId);

    // Registrar con nuevo socketId
    this.sessions.set(newSocketId, migratedSession);
    this.deviceIndex.set(deviceId, newSocketId);
    this.vadDetectors.set(newSocketId, new VadDetector());

    log.info(
      { newSocketId, oldSocketId, deviceId },
      'Sesión restaurada por reconexión'
    );

    return migratedSession;
  }

  // ─── Desconexión y grace period ────────────────────────────────

  // Cuando un dispositivo se desconecta, no eliminamos la sesión
  // inmediatamente. Le damos RECONNECT_GRACE_PERIOD_MS para reconectar
  // sin perder el estado (progreso del test cognitivo, historial, etc.)
  handleDisconnect(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;

    session.state = 'disconnected';
    session.disconnectedAt = Date.now();

    log.info(
      { socketId, gracePeriodMs: config.RECONNECT_GRACE_PERIOD_MS },
      'Dispositivo desconectado — iniciando grace period'
    );

    const timer = setTimeout(() => {
      this.forceDelete(socketId);
    }, config.RECONNECT_GRACE_PERIOD_MS);

    this.gracePeriodTimers.set(socketId, timer);
  }

  private cancelGracePeriod(socketId: string): void {
    const timer = this.gracePeriodTimers.get(socketId);
    if (timer) {
      clearTimeout(timer);
      this.gracePeriodTimers.delete(socketId);
    }
  }

  private forceDelete(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;

    // Limpiar wav writer si quedó abierto
    if (session.wavWriter) {
      try { session.wavWriter.end(); } catch { /* ignorar */ }
    }

    this.sessions.delete(socketId);
    this.deviceIndex.delete(session.deviceId);
    this.vadDetectors.delete(socketId);
    this.gracePeriodTimers.delete(socketId);

    log.info({ socketId }, 'Sesión eliminada tras grace period');
  }

  // ─── Mutaciones de estado ──────────────────────────────────────

  setState(socketId: string, state: SessionState): void {
    const session = this.getOrThrow(socketId);
    session.state = state;
    session.lastActivity = Date.now();
  }

  setProcessing(socketId: string, value: boolean): void {
    const session = this.getOrThrow(socketId);
    session.isProcessing = value;
  }

  // ─── Diálogo ───────────────────────────────────────────────────

  addMessage(socketId: string, role: DialogMessage['role'], content: string): void {
    const session = this.getOrThrow(socketId);

    session.dialog.push({ role, content, timestamp: Date.now() });
    session.lastActivity = Date.now();

    // Truncar historial si excede el límite, preservando siempre
    // el mensaje de sistema (índice 0)
    if (session.dialog.length > MAX_DIALOG_MESSAGES + 1) {
      const systemMessage = session.dialog[0]!;
      const recent = session.dialog.slice(-(MAX_DIALOG_MESSAGES));
      session.dialog = [systemMessage, ...recent];

      log.debug({ socketId }, 'Historial de diálogo truncado');
    }
  }

  getDialog(socketId: string): DialogMessage[] {
    return this.getOrThrow(socketId).dialog;
  }

  resetConversation(socketId: string): void {
    const session = this.getOrThrow(socketId);
    session.conversationActive = false;
    session.userBuffer = '';
    session.cognitiveState = null;
    session.isProcessing = false;
    session.dialog = [{ role: 'system', content: SYSTEM_PROMPT, timestamp: Date.now() }];
    session.state = 'idle';

    log.info({ socketId }, 'Conversación reiniciada');
  }

  // ─── Protocolo cognitivo ────────────────────────────────────────

  setCognitiveState(socketId: string, state: CognitiveState | null): void {
    const session = this.getOrThrow(socketId);
    session.cognitiveState = state;
  }

  // ─── Stats ─────────────────────────────────────────────────────

  countActive(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.state !== 'disconnected') count++;
    }
    return count;
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSummary() {
    const sessions = this.getAll();
    return {
      total: sessions.length,
      active: this.countActive(),
      byState: sessions.reduce<Record<string, number>>((acc, s) => {
        acc[s.state] = (acc[s.state] ?? 0) + 1;
        return acc;
      }, {}),
      withActiveCognitive: sessions.filter((s) => s.cognitiveState !== null).length,
    };
  }
}

// Singleton — una sola instancia para todo el proceso
export const sessionManager = new SessionManager();
