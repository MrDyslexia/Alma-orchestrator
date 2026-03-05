export type SessionState =
  | 'idle'          // conectado, esperando activación
  | 'listening'     // grabando audio del usuario
  | 'transcribing'  // STT procesando
  | 'thinking'      // LLM generando respuesta
  | 'speaking'      // TTS generando y enviando audio
  | 'disconnected'; // desconectado temporalmente (grace period)

export interface DialogMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface WavWriter {
  write: (chunk: Buffer) => void;
  end: () => void;
  filename: string;
  hadError: boolean;
}

export interface Session {
  // Identificación
  socketId: string;
  deviceId: string;

  // Estado general
  state: SessionState;
  conversationActive: boolean;

  // Historial de diálogo con el LLM
  dialog: DialogMessage[];

  // Buffer de texto acumulado antes de activar conversación
  userBuffer: string;

  // Mutex: evita llamadas LLM paralelas para la misma sesión
  isProcessing: boolean;

  // Protocolo cognitivo (null si no está activo)
  cognitiveState: import('./protocol.types').CognitiveState | null;

  // Tiempos
  connectedAt: number;
  lastActivity: number;
  disconnectedAt: number | null; // usado durante grace period de reconexión

  // Grabación WAV (null si ENABLE_WAV_RECORDING=false)
  wavWriter: WavWriter | null;
}

export interface SessionStats {
  socketId: string;
  deviceId: string;
  state: SessionState;
  conversationActive: boolean;
  messageCount: number;
  durationMs: number;
  cognitiveStep: string | null;
}
