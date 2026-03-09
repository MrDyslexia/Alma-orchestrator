import { config } from '@config/index';
import { createLogger } from '@utils/logger';
import { ServiceError } from '../types/services.types';
import type { LlmMessage, LlmStreamChunk, LlmResponse } from '../types/services.types';

const log = createLogger('LlmService');

type StreamCallback = (chunk: LlmStreamChunk) => void;
export type SentenceCallback = (sentence: string) => void;

// Detecta fin de oración: .!? seguido de espacio o fin de string
const SENTENCE_END_RE = /[.!?]+(?:\s|$)/;

// ── Web Search via DuckDuckGo (sin API key) ───────────────────────
// Usamos la API HTML de DDG que devuelve resultados sin autenticación.
// Ideal para preguntas sobre noticias, clima, información actual.
async function webSearch(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return `No se pudo buscar: HTTP ${res.status}`;
    const data = await res.json() as any;

    const parts: string[] = [];

    // Abstract (Wikipedia-style summary)
    if (data.AbstractText) parts.push(data.AbstractText);

    // Answer box (conversión, definición, etc.)
    if (data.Answer) parts.push(data.Answer);

    // Resultados relacionados
    const related: string[] = (data.RelatedTopics || [])
      .slice(0, 4)
      .filter((t: any) => t.Text)
      .map((t: any) => t.Text as string);
    if (related.length > 0) parts.push(...related);

    if (parts.length === 0) return `Sin resultados para: "${query}"`;
    return parts.join('\n').substring(0, 800);
  } catch (e: any) {
    return `Error en búsqueda: ${e?.message}`;
  }
}

// Detecta si la pregunta requiere información actual/externa
function needsSearch(text: string): boolean {
  const lower = text.toLowerCase();
  const triggers = [
    'clima', 'tiempo', 'temperatura', 'lluvia', 'pronóstico',
    'noticias', 'hoy', 'ahora', 'actualmente', 'último', 'última',
    'quién es', 'qué es', 'cuándo', 'precio', 'dólar', 'euro',
    'partido', 'resultado', 'ganó', 'perdió', 'juega',
    'presidente', 'gobierno', 'elección', 'ley',
    'qué hora', 'qué día', 'qué fecha',
  ];
  return triggers.some(t => lower.includes(t));
}

export class LlmService {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = config.LLM_BASE_URL;
    this.model = config.LLM_MODEL;
  }

  async chat(
    messages: LlmMessage[],
    onChunk: StreamCallback,
    onSentence?: SentenceCallback,
  ): Promise<LlmResponse> {
    const startedAt = Date.now();
    let firstTokenMs: number | null = null;

    // ── Web search si la pregunta lo necesita ─────────────────────
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg && needsSearch(lastUserMsg.content as string)) {
      const query = lastUserMsg.content as string;
      console.log(`[LLM] Web search para: "${query.substring(0,60)}"`);
      const searchResult = await webSearch(query);
      console.log(`[LLM] Search result: "${searchResult.substring(0,100)}..."`);

      // Inyectamos el resultado como contexto en el system message
      const searchCtx: LlmMessage = {
        role: 'system',
        content: `Información actualizada de internet para responder la pregunta del usuario:\n${searchResult}\n\nUsa esta información en tu respuesta. Fecha actual: ${new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
      };
      messages = [messages[0], searchCtx, ...messages.slice(1)];
    }

    const body = {
      model: this.model,
      messages,
      stream: true,
      think: false,        // desactiva thinking en qwen3
      options: {
        num_predict: config.LLM_MAX_TOKENS,
        temperature: config.LLM_TEMPERATURE,
        top_p: 0.9,
        num_ctx: 2048,
      },
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ServiceError('llm', `No se pudo conectar con el LLM: ${String(err)}`);
    }

    if (!response.ok || !response.body) {
      throw new ServiceError('llm', `HTTP ${response.status}: ${response.statusText}`, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';
    let fullText = '';
    let sentenceBuf = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = lineBuffer.indexOf('\n')) >= 0) {
          const line = lineBuffer.slice(0, nl).trim();
          lineBuffer = lineBuffer.slice(nl + 1);
          if (!line) continue;

          let parsed: Record<string, unknown>;
          try { parsed = JSON.parse(line) as Record<string, unknown>; }
          catch { continue; }

          const message = parsed.message as { content?: string } | undefined;
          const delta = message?.content ?? '';

          if (delta) {
            if (firstTokenMs === null) {
              firstTokenMs = Date.now() - startedAt;
              log.debug({ firstTokenMs }, 'TTFT');
            }
            fullText += delta;
            sentenceBuf += delta;
            onChunk({ delta, done: false });

            // Detectar oraciones completas y disparar TTS en paralelo
            if (onSentence) {
              let match = SENTENCE_END_RE.exec(sentenceBuf);
              while (match && match.index !== undefined) {
                const endIdx = match.index + match[0].length;
                const sentence = sentenceBuf.slice(0, endIdx).trim();
                sentenceBuf = sentenceBuf.slice(endIdx).trimStart();
                if (sentence.length > 3) onSentence(sentence);
                match = SENTENCE_END_RE.exec(sentenceBuf);
              }
            }
          }

          if (parsed.done === true) {
            // Fragmento final sin puntuación
            if (onSentence && sentenceBuf.trim().length > 3) {
              onSentence(sentenceBuf.trim());
              sentenceBuf = '';
            }
            onChunk({ delta: '', done: true });
            log.info({ chars: fullText.length, ttftMs: firstTokenMs, totalMs: Date.now() - startedAt }, 'LLM OK');
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!fullText.trim()) throw new ServiceError('llm', 'El LLM devolvió una respuesta vacía');
    return { fullText, durationMs: Date.now() - startedAt };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch { return false; }
  }
}

export const llmService = new LlmService();
