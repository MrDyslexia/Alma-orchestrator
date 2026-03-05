import 'dotenv/config';
import { z } from 'zod';

// ─── Schema de validación ────────────────────────────────────────
// Si alguna variable requerida falta o tiene tipo incorrecto,
// el servidor falla inmediatamente con un mensaje claro.

const configSchema = z.object({
  // Servidor
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // STT
  STT_BASE_URL: z.string().url(),
  STT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // LLM
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(512),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),

  // TTS
  TTS_BASE_URL: z.string().url(),
  TTS_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  TTS_EXAGGERATION: z.coerce.number().min(0).max(1).default(0.4),
  TTS_CFG_WEIGHT: z.coerce.number().min(0).max(1).default(0.4),

  // Audio
  AUDIO_SAMPLE_RATE: z.coerce.number().int().positive().default(16_000),
  AUDIO_CHUNK_SIZE: z.coerce.number().int().positive().default(4_096),

  // Grabación WAV
  ENABLE_WAV_RECORDING: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default(false),
  WAV_OUTPUT_DIR: z.string().default('../audio'),

  // Protocolo cognitivo
  COGNITIVE_PROTOCOL_ENABLED: z
    .string()
    .transform((v) => v.toLowerCase() === 'true')
    .default(true),
  ACTIVATION_PHRASE: z.string().min(1).default('hola alma'),
  DEACTIVATION_PHRASES: z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()))
    .default(['gracias alma', 'adiós alma', 'detente alma']),

  // Sesiones
  MAX_CONCURRENT_SESSIONS: z.coerce.number().int().positive().default(50),
  SESSION_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
  RECONNECT_GRACE_PERIOD_MS: z.coerce.number().int().positive().default(30_000),

  // Logs
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

// ─── Parsing y validación ────────────────────────────────────────

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Error de configuración — variables de entorno inválidas:\n');
  parsed.error.issues.forEach((issue) => {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  });
  console.error('\nRevisa tu archivo .env y compáralo con .env.example');
  process.exit(1);
}

// ─── Config exportada ────────────────────────────────────────────
// Usar siempre esta variable en lugar de process.env directamente.
// Está completamente tipada: config.PORT es number, no string.

export const config = parsed.data;

// Tipo inferido del schema (útil para pasar config a funciones)
export type Config = z.infer<typeof configSchema>;
