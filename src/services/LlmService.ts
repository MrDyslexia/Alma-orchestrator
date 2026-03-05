import { config } from '@config/index';
import { createLogger } from '@utils/logger';
import { ServiceError } from '../types/services.types';
import type { LlmMessage, LlmStreamChunk, LlmResponse } from '../types/services.types';

const log = createLogger('LlmService');

// Callback invocado con cada token parcial durante el streaming
type StreamCallback = (chunk: LlmStreamChunk) => void;

export class LlmService {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = config.LLM_BASE_URL;
    this.model = config.LLM_MODEL;
  }

  // Envía el historial de diálogo al LLM y hace streaming de la respuesta.
  // onChunk se invoca con cada token parcial para que el orquestador
  // pueda emitirlo al cliente Android en tiempo real.
  // Devuelve el texto completo al finalizar.
  async chat(messages: LlmMessage[], onChunk: StreamCallback): Promise<LlmResponse> {
    const startedAt = Date.now();
    let firstTokenMs: number | null = null;

    log.debug(
      { model: this.model, messages: messages.length },
      'Iniciando llamada LLM'
    );

    const body = {
      model: this.model,
      messages,
      stream: true,
      options: {
        num_predict: config.LLM_MAX_TOKENS,
        temperature: config.LLM_TEMPERATURE,
        top_p: 0.9,
      },
    };

    const controller = new AbortController();

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ServiceError('llm', `No se pudo conectar con el LLM: ${String(err)}`);
    }

    if (!response.ok || !response.body) {
      throw new ServiceError(
        'llm',
        `HTTP ${response.status}: ${response.statusText}`,
        response.status
      );
    }

    // Procesar stream NDJSON (newline-delimited JSON)
    // Ollama y vLLM devuelven una línea JSON por token
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Procesar todas las líneas completas del buffer
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);

          if (!line) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue; // línea incompleta o inválida, ignorar
          }

          const message = parsed.message as { content?: string } | undefined;
          const delta = message?.content ?? '';

          if (delta) {
            if (firstTokenMs === null) {
              firstTokenMs = Date.now() - startedAt;
              log.debug({ firstTokenMs }, 'Primer token recibido (TTFT)');
            }

            fullText += delta;
            onChunk({ delta, done: false });
          }

          if (parsed.done === true) {
            onChunk({ delta: '', done: true });

            log.info(
              {
                model: this.model,
                chars: fullText.length,
                ttftMs: firstTokenMs,
                totalMs: Date.now() - startedAt,
              },
              'LLM completado'
            );
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!fullText.trim()) {
      throw new ServiceError('llm', 'El LLM devolvió una respuesta vacía');
    }

    return {
      fullText,
      durationMs: Date.now() - startedAt,
    };
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const llmService = new LlmService();
