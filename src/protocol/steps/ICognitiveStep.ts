import type { CognitiveState, StepEvaluation } from '../../types/protocol.types';

// Contrato que deben implementar todos los pasos cognitivos.
export interface ICognitiveStep {
  readonly prompt: string;
  evaluate(response: string, state: CognitiveState): StepEvaluation;
}
