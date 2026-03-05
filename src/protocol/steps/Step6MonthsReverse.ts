import type { CognitiveState, StepEvaluation } from '../../types/protocol.types';
import type { ICognitiveStep } from './ICognitiveStep';

const MONTHS_ORDER = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export class StepMonthsReverse implements ICognitiveStep {
  readonly prompt = 'Ahora diga los meses del año en orden inverso, empezando por diciembre.';

  evaluate(response: string, state: CognitiveState): StepEvaluation {
    const normalized = response.toLowerCase().trim();
    const attempts = state.attempts['months_reverse'] ?? 0;
    const mentionedMonths = MONTHS_ORDER.filter((m) => normalized.includes(m));
    const startsWithDecember = mentionedMonths[0] === 'diciembre';

    if (mentionedMonths.length >= 10 && startsWithDecember) {
      return { accepted: true, nextStep: 'address_recall', responseText: 'Excelente. Ya casi terminamos, solo una pregunta más.' };
    }

    if (mentionedMonths.length >= 4 || attempts >= 1) {
      return { accepted: true, nextStep: 'address_recall', responseText: 'Muy bien, sigamos. Solo una última pregunta.' };
    }

    return {
      accepted: false,
      nextStep: 'months_reverse',
      responseText: 'Intente de nuevo. Empiece por diciembre, noviembre, octubre... hasta llegar a enero.',
    };
  }
}
