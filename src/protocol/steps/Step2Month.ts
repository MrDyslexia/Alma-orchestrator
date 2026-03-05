import type { CognitiveState, StepEvaluation } from '../../types/protocol.types';
import type { ICognitiveStep } from './ICognitiveStep';

export class StepMonth implements ICognitiveStep {
  readonly prompt = '¿Qué mes es?';

  evaluate(response: string, _state: CognitiveState): StepEvaluation {
    const normalized = response.toLowerCase().trim();
    const monthMentioned = extractMonth(normalized);

    if (!monthMentioned) {
      return {
        accepted: false,
        nextStep: 'month',
        responseText: 'Disculpe, ¿me podría decir en qué mes estamos?',
      };
    }

    return {
      accepted: true,
      nextStep: 'address_encode',
      responseText: 'Muy bien. Ahora le voy a pedir que recuerde algo importante.',
    };
  }
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4,
  mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4,
  may: 5, jun: 6, jul: 7, ago: 8,
  sep: 9, oct: 10, nov: 11, dic: 12,
};

function extractMonth(text: string): number | null {
  for (const [name, num] of Object.entries(MONTHS)) {
    if (text.includes(name)) return num;
  }
  return null;
}
