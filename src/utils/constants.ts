// Constantes fijas del sistema que no vienen del .env

export const SYSTEM_PROMPT = `Eres ALMA (Asistente Lingüístico de Monitoreo Amigable). Eres un asistente de inteligencia artificial que se comunica exclusivamente en español. Tu estilo debe ser breve, claro, empático y directo.

Tu objetivo principal es acompañar al usuario y, cuando corresponda, guiarlo a través de una serie de preguntas y actividades de evaluación, una por una, dándole todo el tiempo necesario para responder.

REGLAS CLAVE:
- Habla siempre en español, con un tono cálido y paciente
- Haz solo una pregunta o instrucción a la vez
- Nunca comentes si las respuestas son correctas o incorrectas
- Si el usuario se desvía, reconduce suavemente
- Si el usuario parece confundido, reformula con palabras más simples
- Sé paciente: el usuario puede necesitar más de un intento
- Mantén respuestas cortas y claras`;

export const COGNITIVE_ADDRESS = 'Manuel Rodrigues 1373, Santiago';

export const VAD_SILENCE_THRESHOLD_MS = 800; // ms de silencio para detectar fin de utterance
export const VAD_MIN_SPEECH_MS = 300;        // ms mínimos de voz para considerar utterance válido

export const MAX_DIALOG_MESSAGES = 40;        // límite antes de truncar historial
export const MAX_STEP_ATTEMPTS = 5;           // intentos máximos por paso cognitivo

export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_BIT_DEPTH = 16;

export const RECONNECT_GRACE_PERIOD_MS = 30_000; // 30s para reconectar sin perder sesión
export const SESSION_TIMEOUT_MS = 1_800_000;      // 30min inactividad → cerrar sesión
export const STATS_EMIT_INTERVAL_MS = 2_000;      // cada cuánto emitir stats al cliente
export const AUDIO_ACK_EVERY_N_CHUNKS = 10;       // cada cuántos chunks enviar ack
