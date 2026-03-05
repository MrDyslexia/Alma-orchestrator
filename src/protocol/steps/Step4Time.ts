import type { CognitiveState, StepEvaluation } from '../../types/protocol.types';
import type { ICognitiveStep } from './ICognitiveStep';

export class StepTime implements ICognitiveStep {
  readonly prompt = '¿Qué hora es aproximadamente?';

  evaluate(response: string, _state: CognitiveState): StepEvaluation {
    const normalized = response.toLowerCase().trim();

    if (mentionsTime(normalized)) {
      return {
        accepted: true,
        nextStep: 'count_back',
        responseText: 'Gracias. Ahora le pido que haga un pequeño ejercicio.',
      };
    }

    return {
      accepted: false,
      nextStep: 'time',
      responseText: 'No importa si no tiene reloj cerca, dígame aproximadamente ¿qué hora cree que es?',
    };
  }
}

function mentionsTime(text: string): boolean {
  if (/\b([01]?\d|2[0-3])([:\s]([0-5]\d))?\b/.test(text)) return true;

  const periods = [
    'mañana', 'madrugada', 'mediodía', 'medio día',
    'tarde', 'noche', 'medianoche', 'amanecer', 'anochecer',
  ];
  if (periods.some((p) => text.includes(p))) return true;

  const hourWords = ['una', 'dos', 'tres', 'cuatro', 'cinco', 'seis',
    'siete', 'ocho', 'nueve', 'diez', 'once', 'doce'];
  return hourWords.some((h) => text.includes(`las ${h}`) || text.includes(`la ${h}`));
}
