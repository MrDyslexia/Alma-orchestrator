import { config } from '@config/index';
import { createLogger } from '@utils/logger';
import { sessionManager } from '@managers/SessionManager';
import { jobQueueManager } from '@queues/JobQueue';
import { cognitiveProtocol } from '@protocol/CognitiveProtocol';
import type { Session } from '../types/session.types';

const log = createLogger('CommandHandler');

export type VoiceCommandAction =
  | 'start_conversation'
  | 'stop_conversation'
  | 'reset_conversation'
  | 'start_cognitive_protocol'
  | 'none';

export interface CommandResult {
  action: VoiceCommandAction;
  handled: boolean;         // true → no pasar al LLM
  responseText?: string;    // texto que ALMA debe decir
  startLlm?: boolean;       // true → lanzar LLM tras el comando
}

export class CommandHandler {
  private readonly activationPhrase: string;
  private readonly deactivationPhrases: string[];

  constructor() {
    this.activationPhrase = config.ACTIVATION_PHRASE.toLowerCase();
    this.deactivationPhrases = config.DEACTIVATION_PHRASES;
  }

  // Analiza el texto transcripto y determina si es un comando de voz.
  // Devuelve CommandResult indicando qué hacer a continuación.
  process(text: string, session: Session): CommandResult {
    const normalized = text.toLowerCase().trim();

    // ── 1. Activación de conversación ─────────────────────────
    if (
      normalized.includes(this.activationPhrase) &&
      !session.conversationActive
    ) {
      const questionAfterPhrase = normalized
        .split(this.activationPhrase)[1]
        ?.trim() ?? '';

      session.conversationActive = true;
      session.userBuffer = '';

      // Si el usuario dijo algo después de "hola alma", incluirlo
      if (questionAfterPhrase) {
        sessionManager.addMessage(session.socketId, 'user', questionAfterPhrase);
      }

      log.info(
        { socketId: session.socketId, question: questionAfterPhrase },
        'Conversación activada'
      );

      return {
        action: 'start_conversation',
        handled: true,
        startLlm: !!questionAfterPhrase,
        responseText: questionAfterPhrase ? undefined : 'Hola, ¿en qué le puedo ayudar?',
      };
    }

    // ── 2. Desactivación de conversación ──────────────────────
    if (
      session.conversationActive &&
      this.deactivationPhrases.some((phrase) => normalized.includes(phrase))
    ) {
      // Vaciar cola de jobs pendientes
      jobQueueManager.flush(session.socketId);

      sessionManager.resetConversation(session.socketId);

      log.info({ socketId: session.socketId }, 'Conversación desactivada por comando');

      return {
        action: 'stop_conversation',
        handled: true,
        responseText: 'Hasta luego, fue un placer hablar con usted.',
      };
    }

    // ── 3. Iniciar protocolo cognitivo ─────────────────────────
    if (
      session.conversationActive &&
      session.cognitiveState === null &&
      COGNITIVE_TRIGGER_PHRASES.some((phrase) => normalized.includes(phrase))
    ) {
      const { state, promptText } = cognitiveProtocol.start();
      sessionManager.setCognitiveState(session.socketId, state);

      log.info({ socketId: session.socketId }, 'Protocolo cognitivo iniciado por comando');

      return {
        action: 'start_cognitive_protocol',
        handled: true,
        responseText: promptText,
      };
    }

    // ── 4. Reset de conversación ───────────────────────────────
    if (
      session.conversationActive &&
      RESET_PHRASES.some((phrase) => normalized.includes(phrase))
    ) {
      jobQueueManager.flush(session.socketId);
      sessionManager.resetConversation(session.socketId);

      return {
        action: 'reset_conversation',
        handled: true,
        responseText: 'Perfecto, empecemos de nuevo. ¿En qué le puedo ayudar?',
      };
    }

    // ── 5. No es un comando ────────────────────────────────────
    return { action: 'none', handled: false };
  }
}

const COGNITIVE_TRIGGER_PHRASES = [
  'hacer el test',
  'hacer la evaluación',
  'hacer la evaluacion',
  'empezar el test',
  'empezar la evaluación',
  'empezar la evaluacion',
  'iniciar evaluación',
  'iniciar evaluacion',
  'quiero hacer el test',
];

const RESET_PHRASES = [
  'empezar de nuevo',
  'empecemos de nuevo',
  'nueva conversación',
  'nueva conversacion',
  'reiniciar',
];

export const commandHandler = new CommandHandler();
