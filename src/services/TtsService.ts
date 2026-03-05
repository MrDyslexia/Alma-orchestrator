import { config } from '@config/index';
import { createLogger } from '@utils/logger';
import { retry } from '@utils/retry';
import { ServiceError } from '../types/services.types';
import type { TtsRequest, TtsResponse } from '../types/services.types';

const log = createLogger('TtsService');

export class TtsService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = config.TTS_BASE_URL;
    this.timeoutMs = config.TTS_TIMEOUT_MS;
  }

  // Sintetiza texto a audio WAV.
  // El microservicio Chatterbox recibe JSON y devuelve audio/wav.
  async synthesize(request: TtsRequest): Promise<TtsResponse> {
    const startedAt = Date.now();

    log.debug(
      { chars: request.text.length, text: request.text.substring(0, 50) },
      'Enviando texto a TTS'
    );

    return retry(
      async () => {
        const body = {
          text: request.text,
          language: request.language ?? 'es',
          exaggeration: request.exaggeration ?? config.TTS_EXAGGERATION,
          cfg_weight: request.cfgWeight ?? config.TTS_CFG_WEIGHT,
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        let response: Response;
        try {
          response = await fetch(`${this.baseUrl}/synthesize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          throw new ServiceError(
            'tts',
            `HTTP ${response.status}: ${response.statusText}`,
            response.status
          );
        }

        // El microservicio devuelve audio/wav como bytes crudos
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(arrayBuffer);

        // Leer duración desde header WAV (offset 40 = data chunk size)
        const dataSizeBytes = audioBuffer.readUInt32LE(40);
        const sampleRate = audioBuffer.readUInt32LE(24);
        const byteRate = audioBuffer.readUInt32LE(28);
        const durationMs = Math.round((dataSizeBytes / byteRate) * 1000);

        log.info(
          {
            chars: request.text.length,
            audioBytes: audioBuffer.length,
            durationMs,
            synthesisMs: Date.now() - startedAt,
          },
          'TTS completado'
        );

        return { audioBuffer, durationMs, sampleRate };
      },
      { maxAttempts: 2, initialDelayMs: 500 }
    );
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const ttsService = new TtsService();
