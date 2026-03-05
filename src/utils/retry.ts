import { createLogger } from './logger';

const log = createLogger('retry');

interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;              // multiplicador del delay en cada intento
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 5_000,
  factor: 2,
};

// Reintenta una función async con backoff exponencial.
// Útil para llamadas a STT, LLM y TTS que pueden fallar
// transitoriamente por carga del servidor.
//
// Ejemplo:
//   const result = await retry(
//     () => sttService.transcribe(buffer),
//     { maxAttempts: 3, initialDelayMs: 500 }
//   );

export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error('Unknown error');
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === opts.maxAttempts) break;

      opts.onRetry?.(attempt, lastError);

      log.warn(
        { attempt, maxAttempts: opts.maxAttempts, delayMs: delay, error: lastError.message },
        'Reintentando operación',
      );

      await sleep(delay);
      delay = Math.min(delay * opts.factor, opts.maxDelayMs);
    }
  }

  throw lastError;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
