// Constantes fijas del sistema

// La fecha se inyecta dinámicamente en el system prompt del LlmService
export const SYSTEM_PROMPT = `Eres ALMA (Asistente Lingüístico de Monitoreo Amigable), un asistente de voz en español para adultos mayores. Eres cálido, paciente y muy breve.

REGLAS CRÍTICAS:
- Responde SIEMPRE en español
- Máximo 2 oraciones por respuesta — el usuario escucha tu voz, no lee texto
- Haz solo UNA pregunta a la vez
- Si recibes información de internet en el contexto, úsala para responder con datos actuales
- Nunca digas que no tienes acceso a internet — si hay datos de búsqueda en el contexto, úsalos
- Nunca comentes si las respuestas son correctas o incorrectas en el protocolo
- Tono siempre cálido y paciente`;

export const COGNITIVE_ADDRESS = 'Manuel Rodrigues 1373, Santiago';

// 500ms es suficiente para separar frases naturales sin cortar palabras
export const VAD_SILENCE_THRESHOLD_MS = 500;
export const VAD_MIN_SPEECH_MS = 250;

// Menos contexto = LLM más rápido en responder
export const MAX_DIALOG_MESSAGES = 16;
export const MAX_STEP_ATTEMPTS = 5;

export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_BIT_DEPTH = 16;

export const RECONNECT_GRACE_PERIOD_MS = 30_000;
export const SESSION_TIMEOUT_MS = 1_800_000;
export const STATS_EMIT_INTERVAL_MS = 2_000;
export const AUDIO_ACK_EVERY_N_CHUNKS = 10;
