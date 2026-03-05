// Los 7 pasos del protocolo cognitivo + estados de control
export type CognitiveStep =
  | 'consent'          // Paso 0: ¿Acepta contestar las preguntas?
  | 'year'             // Paso 1: ¿Qué año es?
  | 'month'            // Paso 2: ¿Qué mes es?
  | 'address_encode'   // Paso 3: Memorizar dirección "Manuel Rodrigues 1373, Santiago"
  | 'time'             // Paso 4: ¿Qué hora es aproximadamente?
  | 'count_back'       // Paso 5: Contar desde 20 hasta 1
  | 'months_reverse'   // Paso 6: Meses en orden inverso desde diciembre
  | 'address_recall'   // Paso 7: Repetir la dirección memorizada
  | 'completed';       // Protocolo finalizado

// Secuencia ordenada de pasos (útil para navegación)
export const COGNITIVE_STEP_ORDER: CognitiveStep[] = [
  'consent',
  'year',
  'month',
  'address_encode',
  'time',
  'count_back',
  'months_reverse',
  'address_recall',
  'completed',
];

// Estado completo del protocolo para una sesión
export interface CognitiveState {
  currentStep: CognitiveStep;
  stepStartedAt: number;

  // Respuestas del usuario por paso (para registro)
  responses: Partial<Record<CognitiveStep, string>>;

  // Intentos por paso (para calcular dificultad)
  attempts: Partial<Record<CognitiveStep, number>>;

  // Timestamps de completado por paso
  stepTimings: Partial<Record<CognitiveStep, number>>;

  startedAt: number;
  completedAt: number | null;
}

// Resultado que cada step devuelve al CognitiveProtocol
export interface StepEvaluation {
  // ¿La respuesta es suficiente para avanzar al siguiente paso?
  accepted: boolean;

  // Siguiente paso a ejecutar
  nextStep: CognitiveStep;

  // Texto que ALMA dice al usuario antes del siguiente paso
  // Si accepted=false, puede ser un mensaje de aliento para reintentar
  responseText: string;
}

// Resultado final del protocolo completo (para persistencia futura)
export interface ProtocolResult {
  sessionId: string;
  deviceId: string;
  startedAt: number;
  completedAt: number;
  responses: Partial<Record<CognitiveStep, string>>;
  attempts: Partial<Record<CognitiveStep, number>>;
  stepTimings: Partial<Record<CognitiveStep, number>>;
  totalDurationMs: number;
}
