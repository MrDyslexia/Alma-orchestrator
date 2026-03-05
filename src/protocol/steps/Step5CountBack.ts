import type { CognitiveState, StepEvaluation } from '../../types/protocol.types';
import type { ICognitiveStep } from './ICognitiveStep';

export class StepCountBack implements ICognitiveStep {
  readonly prompt = 'Ahora, por favor, cuente hacia atrás desde el 20 hasta el 1.';

  evaluate(response: string, state: CognitiveState): StepEvaluation {
    const normalized = response.toLowerCase().trim();
    const attempts = state.attempts['count_back'] ?? 0;
    const numbers = extractNumbers(normalized);
    const quality = evaluateCountBack(numbers);

    if (quality === 'complete') {
      return { accepted: true, nextStep: 'months_reverse', responseText: 'Muy bien hecho. Sigamos.' };
    }

    if (quality === 'partial' || attempts >= 1) {
      return { accepted: true, nextStep: 'months_reverse', responseText: 'Bien, continuemos con el siguiente ejercicio.' };
    }

    return {
      accepted: false,
      nextStep: 'count_back',
      responseText: 'Inténtelo de nuevo, cuente hacia atrás: 20, 19, 18... hasta llegar al 1.',
    };
  }
}

function extractNumbers(text: string): number[] {
  const digitMatches = text.match(/\b\d+\b/g) ?? [];
  const numbers = digitMatches.map(Number).filter((n) => n >= 1 && n <= 20);

  const wordNumbers: Record<string, number> = {
    'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
    'dieciséis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19, 'veinte': 20,
  };

  for (const [word, num] of Object.entries(wordNumbers)) {
    if (text.includes(word) && !numbers.includes(num)) numbers.push(num);
  }

  return numbers.sort((a, b) => b - a);
}

function evaluateCountBack(numbers: number[]): 'complete' | 'partial' | 'insufficient' {
  if (numbers.length >= 15) return 'complete';
  if (numbers.length >= 5)  return 'partial';
  return 'insufficient';
}
