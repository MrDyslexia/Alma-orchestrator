import type { CognitiveState, StepEvaluation } from '../../types/protocol.types';
import type { ICognitiveStep } from './ICognitiveStep';
import { COGNITIVE_ADDRESS } from '@config/constants';

// Paso 3 — Memoria: codificación de dirección
// ALMA da la dirección al usuario y pide que la repita.
// Necesita confirmar que el usuario la recibió antes de continuar.

export class StepAddressEncode implements ICognitiveStep {
  readonly prompt =
    `Necesito que recuerde la siguiente dirección para más adelante: ` +
    `"${COGNITIVE_ADDRESS}". Por favor, repítala para confirmar ` +
    `que la entendió correctamente.`;

  evaluate(response: string, state: CognitiveState): StepEvaluation {
    const normalized = response.toLowerCase().trim();
    const attempts = state.attempts['address_encode'] ?? 0;

    if (containsAddress(normalized)) {
      return {
        accepted: true,
        nextStep: 'time',
        responseText:
          'Perfecto, muy bien. Recuerde esa dirección porque se la preguntaré ' +
          'más adelante. Continuemos.',
      };
    }

    // Primer intento fallido
    if (attempts === 0) {
      return {
        accepted: false,
        nextStep: 'address_encode',
        responseText:
          `No importa, intentémoslo de nuevo. La dirección es: "${COGNITIVE_ADDRESS}". ` +
          `¿Puede repetirla?`,
      };
    }

    // Segundo intento fallido — avanzar igual, registrar dificultad
    if (attempts >= 1) {
      return {
        accepted: true,
        nextStep: 'time',
        responseText:
          'No se preocupe, continuemos. Intente recordar esa dirección ' +
          'para más adelante.',
      };
    }

    return {
      accepted: false,
      nextStep: 'address_encode',
      responseText: `Intente de nuevo: "${COGNITIVE_ADDRESS}"`,
    };
  }
}

function containsAddress(text: string): boolean {
  // Verificar que mencione los elementos clave de la dirección
  const hasStreet =
    text.includes('manuel') ||
    text.includes('rodrigues') ||
    text.includes('rodríguez');
  const hasNumber = text.includes('1373') || text.includes('mil trescientos');
  const hasCity = text.includes('santiago');

  return hasStreet && (hasNumber || hasCity);
}
