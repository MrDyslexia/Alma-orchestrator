import type { CognitiveState, StepEvaluation } from '../../types/protocol.types';
import type { ICognitiveStep } from './ICognitiveStep';

// Paso 1 — Orientación temporal: año actual
// No se corrige al usuario, solo se registra la respuesta y avanza.

const CURRENT_YEAR = new Date().getFullYear();

export class StepYear implements ICognitiveStep {
  readonly prompt = '¿Qué año es?';

  evaluate(response: string, _state: CognitiveState): StepEvaluation {
    const normalized = response.toLowerCase().trim();

    // Extraer número del texto (acepta "dos mil veinticinco", "2025", etc.)
    const yearMentioned = extractYear(normalized);

    if (!yearMentioned) {
      return {
        accepted: false,
        nextStep: 'year',
        responseText: 'Perdone, ¿me podría decir qué año es?',
      };
    }

    // Avanzar independientemente de si es correcto
    // (el registro queda en state.responses para análisis posterior)
    return {
      accepted: true,
      nextStep: 'month',
      responseText: 'Gracias. Y ahora dígame,',
    };
  }
}

function extractYear(text: string): number | null {
  // Intentar número directo
  const numericMatch = text.match(/\b(19|20)\d{2}\b/);
  if (numericMatch) return parseInt(numericMatch[0], 10);

  // Intentar año en palabras (español)
  const yearWords: Record<string, number> = {
    'dos mil veintiuno': 2021,
    'dos mil veintidós': 2022,
    'dos mil veintitrés': 2023,
    'dos mil veinticuatro': 2024,
    'dos mil veinticinco': 2025,
    'dos mil veintiséis': 2026,
    'dos mil veintisiete': 2027,
  };

  for (const [words, year] of Object.entries(yearWords)) {
    if (text.includes(words)) return year;
  }

  return null;
}
