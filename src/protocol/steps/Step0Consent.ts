import type { CognitiveState, StepEvaluation } from '../../types/protocol.types';
import type { ICognitiveStep } from './ICognitiveStep';

// Paso 0 — Consentimiento
// ALMA pregunta si el usuario está dispuesto a responder
// las preguntas de evaluación. Solo avanza si acepta.

export class StepConsent implements ICognitiveStep {
  readonly prompt =
    '¿Estaría dispuesto o dispuesta a contestar una breve serie de preguntas ' +
    'y actividades para evaluar su estado actual?';

  evaluate(response: string, _state: CognitiveState): StepEvaluation {
    const normalized = response.toLowerCase().trim();

    const accepted = ACCEPTANCE_WORDS.some((word) => normalized.includes(word));
    const rejected = REJECTION_WORDS.some((word) => normalized.includes(word));

    if (accepted && !rejected) {
      return {
        accepted: true,
        nextStep: 'year',
        responseText: 'Perfecto, muchas gracias. Empecemos con algo sencillo.',
      };
    }

    if (rejected) {
      return {
        accepted: false,
        nextStep: 'consent',
        responseText:
          'No hay problema, podemos hacerlo en otro momento. ' +
          'Estoy aquí cuando usted quiera.',
      };
    }

    // Respuesta ambigua — pedir confirmación
    return {
      accepted: false,
      nextStep: 'consent',
      responseText:
        'Disculpe, no le entendí bien. ¿Le gustaría responder ' +
        'algunas preguntas cortas?',
    };
  }
}

const ACCEPTANCE_WORDS = [
  'sí', 'si', 'claro', 'bueno', 'bien', 'dale', 'de acuerdo',
  'por supuesto', 'adelante', 'cómo no', 'encantado', 'encantada',
  'está bien', 'vamos', 'okay', 'ok',
];

const REJECTION_WORDS = [
  'no', 'ahora no', 'después', 'luego', 'otro momento',
  'no quiero', 'no puedo', 'estoy ocupado', 'estoy ocupada',
];
