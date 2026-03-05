import { createLogger } from '@utils/logger';
import { stateManager } from '@managers/StateManager';
import { StepConsent } from './steps/Step0Consent';
import { StepYear } from './steps/Step1Year';
import { StepMonth } from './steps/Step2Month';
import { StepAddressEncode } from './steps/Step3AddressEncode';
import { StepTime } from './steps/Step4Time';
import { StepCountBack } from './steps/Step5CountBack';
import { StepMonthsReverse } from './steps/Step6MonthsReverse';
import { StepAddressRecall } from './steps/Step7AddressRecall';
import type { ICognitiveStep } from './steps/ICognitiveStep';
import type { CognitiveState, CognitiveStep, ProtocolResult } from '../types/protocol.types';

const log = createLogger('CognitiveProtocol');

// ─── CognitiveProtocol ────────────────────────────────────────────
// State machine que gestiona los 7 pasos del protocolo cognitivo.
// Recibe la respuesta del usuario, delega la evaluación al step
// correspondiente, y devuelve el texto que ALMA debe decir a continuación.

export class CognitiveProtocol {
  // Mapa de step → implementación
  private readonly steps: Record<string, ICognitiveStep> = {
    consent: new StepConsent(),
    year: new StepYear(),
    month: new StepMonth(),
    address_encode: new StepAddressEncode(),
    time: new StepTime(),
    count_back: new StepCountBack(),
    months_reverse: new StepMonthsReverse(),
    address_recall: new StepAddressRecall(),
  };

  // ─── Inicio ──────────────────────────────────────────────────

  // Crea un nuevo estado e inicia el protocolo con el prompt del paso 0
  start(): { state: CognitiveState; promptText: string } {
    const state = stateManager.createCognitiveState();
    const promptText = this.getPrompt('consent');

    log.info('Protocolo cognitivo iniciado');
    return { state, promptText };
  }

  // ─── Procesamiento de respuesta ───────────────────────────────

  // Procesa la respuesta del usuario al paso actual.
  // Devuelve el texto que ALMA debe decir a continuación
  // y si el protocolo se completó.
  processResponse(
    response: string,
    state: CognitiveState
  ): {
    responseText: string;
    nextStep: CognitiveStep;
    completed: boolean;
    result?: ProtocolResult;
  } {
    const currentStep = state.currentStep;
    const stepImpl = this.steps[currentStep];

    if (!stepImpl) {
      log.error({ currentStep }, 'Step no encontrado');
      return {
        responseText: 'Disculpe, hubo un problema. Continuemos.',
        nextStep: 'completed',
        completed: true,
      };
    }

    log.debug(
      { step: currentStep, response: response.substring(0, 60) },
      'Evaluando respuesta'
    );

    // Registrar intento antes de evaluar
    stateManager.registerAttempt(state);

    // Evaluar la respuesta con el step correspondiente
    const evaluation = stepImpl.evaluate(response, state);

    if (evaluation.accepted) {
      // Avanzar al siguiente paso
      const nextStep = stateManager.advance(state, response);

      log.info({ from: currentStep, to: nextStep }, 'Paso completado');

      if (nextStep === 'completed') {
        return {
          responseText: evaluation.responseText,
          nextStep,
          completed: true,
        };
      }

      // Concatenar el feedback del paso actual + prompt del siguiente
      const nextPrompt = this.getPrompt(nextStep);
      const fullResponse = nextPrompt
        ? `${evaluation.responseText} ${nextPrompt}`
        : evaluation.responseText;

      return {
        responseText: fullResponse,
        nextStep,
        completed: false,
      };
    }

    // No aceptado: reintentar el mismo paso
    // Verificar si superó los intentos máximos
    if (stateManager.hasExceededAttempts(state)) {
      log.warn({ step: currentStep }, 'Intentos máximos superados — forzando avance');

      const nextStep = stateManager.advance(state, response);
      const nextPrompt = nextStep !== 'completed' ? this.getPrompt(nextStep) : '';
      const fullResponse = nextPrompt
        ? `${evaluation.responseText} ${nextPrompt}`
        : evaluation.responseText;

      return {
        responseText: fullResponse,
        nextStep,
        completed: nextStep === 'completed',
      };
    }

    // Reintentar el mismo paso
    return {
      responseText: evaluation.responseText,
      nextStep: currentStep,
      completed: false,
    };
  }

  // ─── Prompt del paso actual ───────────────────────────────────

  getCurrentPrompt(state: CognitiveState): string {
    return this.getPrompt(state.currentStep);
  }

  private getPrompt(step: CognitiveStep | string): string {
    return this.steps[step]?.prompt ?? '';
  }

  // ─── Info ─────────────────────────────────────────────────────

  getStepInfo(state: CognitiveState) {
    return {
      currentStep: state.currentStep,
      stepNumber: stateManager.getStepNumber(state.currentStep),
      totalSteps: stateManager.getTotalSteps(),
      durationMs: stateManager.getDurationMs(state),
      attempts: state.attempts,
    };
  }
}

export const cognitiveProtocol = new CognitiveProtocol();
