import { COGNITIVE_STEP_ORDER } from '../types/protocol.types';
import { MAX_STEP_ATTEMPTS } from '@config/constants';
import { createLogger } from '@utils/logger';
import type { CognitiveState, CognitiveStep, ProtocolResult } from '../types/protocol.types';

const log = createLogger('StateManager');

export class StateManager {

  // ─── Inicialización ────────────────────────────────────────────

  createCognitiveState(): CognitiveState {
    return {
      currentStep: 'consent',
      stepStartedAt: Date.now(),
      responses: {},
      attempts: {},
      stepTimings: {},
      startedAt: Date.now(),
      completedAt: null,
    };
  }

  // ─── Navegación entre pasos ────────────────────────────────────

  // Registra la respuesta del usuario al paso actual y avanza al siguiente.
  // Devuelve el nuevo step o 'completed' si era el último.
  advance(state: CognitiveState, response: string): CognitiveStep {
    const current = state.currentStep;

    // Guardar respuesta y timing
    state.responses[current] = response;
    state.stepTimings[current] = Date.now() - state.stepStartedAt;

    const nextStep = this.getNextStep(current);

    log.info(
      {
        from: current,
        to: nextStep,
        attempts: state.attempts[current] ?? 1,
        timingMs: state.stepTimings[current],
      },
      'Avanzando paso cognitivo'
    );

    state.currentStep = nextStep;
    state.stepStartedAt = Date.now();

    if (nextStep === 'completed') {
      state.completedAt = Date.now();
    }

    return nextStep;
  }

  // Registra un intento fallido sin avanzar de paso.
  // Devuelve cuántos intentos lleva para que el step decida qué hacer.
  registerAttempt(state: CognitiveState): number {
    const step = state.currentStep;
    state.attempts[step] = (state.attempts[step] ?? 0) + 1;
    return state.attempts[step]!;
  }

  // ¿El usuario superó los intentos máximos para este paso?
  hasExceededAttempts(state: CognitiveState): boolean {
    const attempts = state.attempts[state.currentStep] ?? 0;
    return attempts >= MAX_STEP_ATTEMPTS;
  }

  // ─── Consultas de estado ───────────────────────────────────────

  isCompleted(state: CognitiveState): boolean {
    return state.currentStep === 'completed';
  }

  getStepNumber(step: CognitiveStep): number {
    const idx = COGNITIVE_STEP_ORDER.indexOf(step);
    // 'consent' es paso 0, 'completed' no tiene número
    return idx;
  }

  getTotalSteps(): number {
    // Sin contar 'consent' ni 'completed'
    return COGNITIVE_STEP_ORDER.length - 2;
  }

  getDurationMs(state: CognitiveState): number {
    const end = state.completedAt ?? Date.now();
    return end - state.startedAt;
  }

  // ─── Resultado final ───────────────────────────────────────────

  buildResult(sessionId: string, deviceId: string, state: CognitiveState): ProtocolResult {
    return {
      sessionId,
      deviceId,
      startedAt: state.startedAt,
      completedAt: state.completedAt ?? Date.now(),
      responses: state.responses,
      attempts: state.attempts,
      stepTimings: state.stepTimings,
      totalDurationMs: this.getDurationMs(state),
    };
  }

  // ─── Privados ──────────────────────────────────────────────────

  private getNextStep(current: CognitiveStep): CognitiveStep {
    const idx = COGNITIVE_STEP_ORDER.indexOf(current);
    if (idx === -1 || idx === COGNITIVE_STEP_ORDER.length - 1) {
      return 'completed';
    }
    return COGNITIVE_STEP_ORDER[idx + 1]!;
  }
}

export const stateManager = new StateManager();
