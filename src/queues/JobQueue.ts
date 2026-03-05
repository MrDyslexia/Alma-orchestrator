import { createLogger } from '@utils/logger';

const log = createLogger('JobQueue');

// ─── Tipos ────────────────────────────────────────────────────────

type Job = () => Promise<void>;

interface QueueEntry {
  job: Job;
  enqueuedAt: number;
  label: string; // descripción para logs
}

interface QueueStats {
  sessionId: string;
  pending: number;
  processing: boolean;
  totalProcessed: number;
  totalErrors: number;
}

// ─── JobQueue ─────────────────────────────────────────────────────
// Cola FIFO por sesión. Garantiza que los jobs de una sesión
// se ejecuten de a uno, en orden, sin solapamiento.
//
// Esto resuelve el bug del POC donde dos utterances casi simultáneos
// disparaban dos llamadas LLM en paralelo corrompiendo el diálogo.
//
// Cada sesión tiene su propia cola → sesiones distintas
// corren en paralelo sin bloquearse entre sí.

export class SessionJobQueue {
  private queue: QueueEntry[] = [];
  private processing = false;
  private totalProcessed = 0;
  private totalErrors = 0;

  constructor(private readonly sessionId: string) {}

  // Agrega un job al final de la cola y arranca el procesamiento
  // si no hay nada corriendo.
  enqueue(job: Job, label = 'job'): void {
    this.queue.push({ job, enqueuedAt: Date.now(), label });

    log.debug(
      { sessionId: this.sessionId, label, pending: this.queue.length },
      'Job encolado'
    );

    // Arrancar procesamiento si está idle
    if (!this.processing) {
      void this.processNext();
    }
  }

  // ¿Hay jobs pendientes o en ejecución?
  get isBusy(): boolean {
    return this.processing || this.queue.length > 0;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  // Vacía la cola sin ejecutar los jobs pendientes.
  // Útil cuando el usuario dice "detente alma" a mitad de una respuesta.
  flush(): void {
    const flushed = this.queue.length;
    this.queue = [];
    if (flushed > 0) {
      log.info({ sessionId: this.sessionId, flushed }, 'Cola vaciada');
    }
  }

  getStats(): QueueStats {
    return {
      sessionId: this.sessionId,
      pending: this.queue.length,
      processing: this.processing,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors,
    };
  }

  // ─── Procesamiento interno ────────────────────────────────────

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const entry = this.queue.shift()!;
    const startedAt = Date.now();

    log.debug(
      {
        sessionId: this.sessionId,
        label: entry.label,
        waitMs: startedAt - entry.enqueuedAt,
      },
      'Ejecutando job'
    );

    try {
      await entry.job();
      this.totalProcessed++;

      log.debug(
        {
          sessionId: this.sessionId,
          label: entry.label,
          durationMs: Date.now() - startedAt,
        },
        'Job completado'
      );
    } catch (err) {
      this.totalErrors++;
      log.error(
        {
          sessionId: this.sessionId,
          label: entry.label,
          durationMs: Date.now() - startedAt,
          err,
        },
        'Error en job — continuando con el siguiente'
      );
      // No relanzamos el error: un job fallido no debe
      // bloquear los siguientes jobs de la sesión
    }

    // Procesar el siguiente job en el próximo tick
    // para no bloquear el event loop
    setImmediate(() => void this.processNext());
  }
}

// ─── JobQueueManager ──────────────────────────────────────────────
// Registro central de colas por sesión.
// El orquestador usa esta clase para encolar jobs sin
// necesitar mantener referencias a las colas individualmente.

export class JobQueueManager {
  private queues = new Map<string, SessionJobQueue>();

  // Obtiene o crea la cola para una sesión
  getQueue(sessionId: string): SessionJobQueue {
    let queue = this.queues.get(sessionId);
    if (!queue) {
      queue = new SessionJobQueue(sessionId);
      this.queues.set(sessionId, queue);
      log.debug({ sessionId }, 'Cola de jobs creada');
    }
    return queue;
  }

  // Encola un job para una sesión específica
  enqueue(sessionId: string, job: Job, label?: string): void {
    this.getQueue(sessionId).enqueue(job, label);
  }

  // Vacía la cola de una sesión (ej: comando "detente alma")
  flush(sessionId: string): void {
    this.queues.get(sessionId)?.flush();
  }

  // Elimina la cola cuando la sesión se cierra definitivamente
  delete(sessionId: string): void {
    const queue = this.queues.get(sessionId);
    if (queue) {
      queue.flush();
      this.queues.delete(sessionId);
      log.debug({ sessionId }, 'Cola de jobs eliminada');
    }
  }

  // Stats globales de todas las colas activas
  getAllStats(): QueueStats[] {
    return Array.from(this.queues.values()).map((q) => q.getStats());
  }
}

export const jobQueueManager = new JobQueueManager();
