import type { AudioChunk, AudioStatus } from './audio.types';
import type { SessionState } from './session.types';
import type { CognitiveStep } from './protocol.types';

// ─── Eventos que el cliente Android ENVÍA al servidor ────────────

export interface ClientToServerEvents {
  // Audio en tiempo real
  audio_chunk: (data: AudioChunk) => void;

  // Control de grabación
  start_recording: () => void;
  stop_recording: () => void;
  get_final_transcription: () => void;

  // Control de conversación
  reset_conversation: () => void;
  get_conversation_state: () => void;

  // Identificación del dispositivo al conectar
  register_device: (data: { deviceId: string }) => void;
}

// ─── Eventos que el servidor ENVÍA al cliente Android ────────────

export interface ServerToClientEvents {
  // Handshake inicial
  connected: (data: ConnectedPayload) => void;

  // Transcripción del audio
  transcription: (data: TranscriptionPayload) => void;

  // Respuesta del asistente (texto streaming)
  assistant_text: (data: { delta: string }) => void;
  assistant_text_done: (data: { text: string }) => void;

  // Respuesta del asistente (audio TTS)
  audio_response: (data: AudioResponsePayload) => void;

  // Estados del asistente
  assistant_status: (data: { status: AudioStatus }) => void;
  session_state: (data: SessionStatePayload) => void;

  // Protocolo cognitivo
  cognitive_step_changed: (data: CognitiveStepPayload) => void;
  cognitive_completed: (data: CognitiveCompletedPayload) => void;

  // Comandos de voz detectados
  voice_command_detected: (data: VoiceCommandPayload) => void;

  // Confirmaciones y stats
  audio_ack: (data: AudioAckPayload) => void;
  server_stats: (data: ServerStatsPayload) => void;

  // Errores
  error: (data: ErrorPayload) => void;
}

// ─── Payloads detallados ─────────────────────────────────────────

export interface ConnectedPayload {
  message: string;
  sessionId: string;
  sampleRate: number;
  chunkSize: number;
  supportsTranscription: boolean;
  supportsTts: boolean;
  activationPhrase: string;
}

export interface TranscriptionPayload {
  text: string;
  isFinal: boolean;
  confidence: number;
}

export interface AudioResponsePayload {
  audioBuffer: ArrayBuffer; // WAV raw para reproducir en Android
  sampleRate: number;
  durationMs: number;
}

export interface SessionStatePayload {
  state: SessionState;
  conversationActive: boolean;
  messageCount: number;
  durationMs: number;
  cognitiveStep: CognitiveStep | null;
}

export interface CognitiveStepPayload {
  step: CognitiveStep;
  stepNumber: number;   // 1-7 para mostrar progreso en UI
  totalSteps: number;   // 7
}

export interface CognitiveCompletedPayload {
  durationMs: number;
  stepsCompleted: number;
}

export interface VoiceCommandPayload {
  action: 'start_conversation' | 'stop_conversation' | 'reset_conversation' | 'start_cognitive_protocol';
  command: string;
  text: string;
}

export interface AudioAckPayload {
  chunksReceived: number;
  timestamp: number;
  sessionState: SessionState;
}

export interface ServerStatsPayload {
  activeConnections: number;
  chunksReceived: number;
  sessionDurationMs: number;
  isRecording: boolean;
  conversationActive: boolean;
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  service?: 'stt' | 'llm' | 'tts';
}

export type ErrorCode =
  | 'STT_ERROR'
  | 'LLM_ERROR'
  | 'TTS_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'MAX_SESSIONS_REACHED'
  | 'AUDIO_ERROR'
  | 'INTERNAL_ERROR';
