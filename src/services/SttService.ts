import { config } from '@config/index';
import { createLogger } from '@utils/logger';
import { retry } from '@utils/retry';
import { ServiceError } from '../types/services.types';
import type { SttRequest, SttResponse } from '../types/services.types';

const log = createLogger('SttService');

export class SttService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = config.STT_BASE_URL;
    this.timeoutMs = config.STT_TIMEOUT_MS;
  }

  // Transcribe un buffer de audio PCM a texto.
  // El microservicio faster-whisper recibe el audio como
  // multipart/form-data y devuelve JSON.
  async transcribe(request: SttRequest): Promise<SttResponse> {
    const startedAt = Date.now();

    log.debug(
      { bufferBytes: request.audioBuffer.length, language: request.language ?? 'es' },
      'Enviando audio a STT'
    );

    return retry(
      async () => {
        const formData = new FormData();
        formData.append(
          'audio',
          new Blob([request.audioBuffer], { type: 'audio/pcm' }),
          'audio.pcm'
        );
        formData.append('language', request.language ?? 'es');
        formData.append('sample_rate', String(config.AUDIO_SAMPLE_RATE));

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        let response: Response;
        try {
          response = await fetch(`${this.baseUrl}/transcribe`, {
            method: 'POST',
            body: formData,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          throw new ServiceError(
            'stt',
            `HTTP ${response.status}: ${response.statusText}`,
            response.status
          );
        }

        const data = (await response.json()) as SttResponse;

        log.info(
          {
            text: data.text.substring(0, 60),
            confidence: data.confidence,
            durationMs: Date.now() - startedAt,
          },
          'STT completado'
        );

        return data;
      },
      { maxAttempts: 2, initialDelayMs: 300 }
    );
  }

  // Health check — verifica que el microservicio esté disponible
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const sttService = new SttService();
