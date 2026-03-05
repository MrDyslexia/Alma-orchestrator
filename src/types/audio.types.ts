// Chunk de audio recibido desde el dispositivo Android via WebSocket
export interface AudioChunk {
  chunk: ArrayBuffer; // PCM 16-bit little-endian, 16kHz, mono
  timestamp: number;
}

// Resultado del VAD (Voice Activity Detection)
export type VadResult =
  | { type: 'speech' }                        // hay voz activa
  | { type: 'silence'; durationMs: number }   // silencio detectado
  | { type: 'utterance_end'; buffer: Buffer } // fin de utterance, buffer listo para STT

// Configuración de audio esperada del dispositivo
export interface AudioConfig {
  sampleRate: number;   // 16000
  channels: number;     // 1 (mono)
  bitDepth: number;     // 16
  chunkSize: number;    // 4096 samples = 256ms a 16kHz
}

// Respuesta de audio enviada de vuelta al dispositivo
export interface AudioResponse {
  audioBuffer: Buffer;  // WAV raw listo para reproducir
  sampleRate: number;
  durationMs: number;
  sessionId: string;
}

// Evento de estado de audio emitido al cliente
export type AudioStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'playing';
