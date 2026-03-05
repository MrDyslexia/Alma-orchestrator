// ─── STT (faster-whisper) ───────────────────────────────────────

export interface SttRequest {
  audioBuffer: Buffer; // PCM 16-bit, 16kHz, mono
  language?: string;   // 'es' por defecto
}

export interface SttResponse {
  text: string;
  confidence: number;  // 0.0 - 1.0
  language: string;
  durationMs: number;
}

// ─── LLM (Ollama / vLLM) ────────────────────────────────────────

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  stream: boolean;
  model: string;
  options?: {
    temperature?: number;
    num_predict?: number;
    top_p?: number;
  };
}

// Chunk de streaming recibido de Ollama/vLLM
export interface LlmStreamChunk {
  delta: string;  // token parcial
  done: boolean;
}

export interface LlmResponse {
  fullText: string;
  durationMs: number;
}

// ─── TTS (Chatterbox) ───────────────────────────────────────────

export interface TtsRequest {
  text: string;
  exaggeration?: number; // 0.0 - 1.0, default: 0.4
  cfgWeight?: number;    // 0.0 - 1.0, default: 0.4
  language?: string;     // 'es' por defecto
}

export interface TtsResponse {
  audioBuffer: Buffer; // WAV raw
  durationMs: number;
  sampleRate: number;
}

// ─── Errores de servicios ────────────────────────────────────────

export type ServiceName = 'stt' | 'llm' | 'tts';

export class ServiceError extends Error {
  constructor(
    public readonly service: ServiceName,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(`[${service.toUpperCase()}] ${message}`);
    this.name = 'ServiceError';
  }
}

// ─── Health check ────────────────────────────────────────────────

export interface ServiceHealth {
  service: ServiceName;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: number;
}
