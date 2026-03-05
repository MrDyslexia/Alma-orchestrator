import type { CognitiveState, StepEvaluation } from '../../types/protocol.types';
import type { ICognitiveStep } from './ICognitiveStep';
import { COGNITIVE_ADDRESS } from '@config/constants';

// Paso 7 — Memoria diferida: recordar la dirección del paso 3
// Este es el paso más importante del protocolo:
// evalúa si el usuario retuvo la información dada al principio.

export class StepAddressRecall implements ICognitiveStep {
  readonly prompt =
    'Para finalizar, ¿recuerda la dirección que le mencioné al principio?';

  evaluate(response: string, state: CognitiveState): StepEvaluation {
    const normalized = response.toLowerCase().trim();
    const attempts = state.attempts['address_recall'] ?? 0;
    const recallQuality = evaluateRecall(normalized);

    if (recallQuality === 'full') {
      return {
        accepted: true,
        nextStep: 'completed',
        responseText:
          '¡Muy bien! Recordó la dirección perfectamente. ' +
          'Hemos terminado, muchas gracias por su tiempo y paciencia.',
      };
    }

    if (recallQuality === 'partial') {
      return {
        accepted: true,
        nextStep: 'completed',
        responseText:
          'Gracias, recordó parte de la dirección. ' +
          'Hemos terminado, le agradezco mucho su participación.',
      };
    }

    // No recordó nada — dar un intento más si es el primero
    if (attempts === 0) {
      return {
        accepted: false,
        nextStep: 'address_recall',
        responseText:
          'Tómese su tiempo, ¿recuerda algo de esa dirección que le mencioné?',
      };
    }

    // Segundo intento fallido — terminar igual
    return {
      accepted: true,
      nextStep: 'completed',
      responseText:
        'No se preocupe, es completamente normal. ' +
        'Hemos terminado, muchas gracias por su tiempo.',
    };
  }
}

type RecallQuality = 'full' | 'partial' | 'none';

function evaluateRecall(text: string): RecallQuality {
  const hasStreet =
    text.includes('manuel') ||
    text.includes('rodrigues') ||
    text.includes('rodríguez');

  const hasNumber =
    text.includes('1373') ||
    text.includes('mil trescientos') ||
    text.includes('trece setenta') ||
    text.includes('trece y tres');

  const hasCity = text.includes('santiago');

  const matchCount = [hasStreet, hasNumber, hasCity].filter(Boolean).length;

  if (matchCount >= 3) return 'full';
  if (matchCount >= 1) return 'partial';
  return 'none';
}
