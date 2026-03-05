import { createLogger } from '@utils/logger';
import { sessionManager } from '@managers/SessionManager';
import { jobQueueManager } from '@queues/JobQueue';
import { sttService } from '@services/SttService';
import { llmService } from '@services/LlmService';
import { ttsService } from '@services/TtsService';
import { commandHandler } from '@handlers/CommandHandler';
import { cognitiveProtocol } from '@protocol/CognitiveProtocol';
import type { Socket } from 'socket.io';
import type { AudioChunk } from '../types/audio.types';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types/socket.types';

const log = createLogger('AudioHandler');

type AlmaSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export class AudioHandler {
  // Procesa un chunk de audio entrante para una sesión.
  // Si el VAD detecta fin de utterance, encola el pipeline STT→LLM→TTS.
  handleChunk(socket: AlmaSocket, data: AudioChunk): void {
    const session = sessionManager.get(socket.id);
    if (!session || session.state === 'disconnected') return;

    const audioBuffer = Buffer.from(data.chunk);

    // Escribir en WAV si la grabación está habilitada
    session.wavWriter?.write(audioBuffer);

    // Pasar por VAD
    const vad = sessionManager.getVad(socket.id);
    if (!vad) return;

    const vadResult = vad.process(audioBuffer, data.timestamp);

    if (vadResult.type === 'speech') {
      // Hay voz activa — notificar al cliente si no estaba grabando
      if (session.state === 'idle') {
        sessionManager.setState(socket.id, 'listening');
        socket.emit('assistant_status', { status: 'recording' });
      }
      return;
    }

    if (vadResult.type === 'utterance_end') {
      // Fin de utterance detectado → encolar pipeline completo
      const utteranceBuffer = vadResult.buffer;

      sessionManager.setState(socket.id, 'transcribing');
      socket.emit('assistant_status', { status: 'processing' });

      jobQueueManager.enqueue(
        socket.id,
        () => this.runPipeline(socket, utteranceBuffer),
        'stt→llm→tts'
      );
    }
  }

  // Pipeline completo para un utterance:
  // 1. STT: audio → texto
  // 2. Comando o protocolo o LLM
  // 3. TTS: texto → audio
  // 4. Emitir audio al cliente
  private async runPipeline(
    socket: AlmaSocket,
    audioBuffer: Buffer
  ): Promise<void> {
    const session = sessionManager.get(socket.id);
    if (!session) return;

    const pipelineStart = Date.now();

    try {
      // ── Paso 1: STT ─────────────────────────────────────────
      log.debug({ socketId: socket.id }, 'Iniciando STT');

      const sttResult = await sttService.transcribe({ audioBuffer });
      const text = sttResult.text.trim();

      if (!text) {
        sessionManager.setState(socket.id, 'idle');
        socket.emit('assistant_status', { status: 'idle' });
        return;
      }

      socket.emit('transcription', {
        text,
        isFinal: true,
        confidence: sttResult.confidence,
      });

      log.info(
        { socketId: socket.id, text: text.substring(0, 60), confidence: sttResult.confidence },
        'STT completado'
      );

      // ── Paso 2: Determinar qué hacer con el texto ──────────
      let responseText: string | null = null;

      // 2a. Verificar comandos de voz
      const commandResult = commandHandler.process(text, session);

      if (commandResult.handled && commandResult.action !== 'none') {
        socket.emit('voice_command_detected', {
          action: commandResult.action,
          command: commandResult.action,
          text,
        });

        if (commandResult.responseText && !commandResult.startLlm) {
          // El comando tiene respuesta directa, no necesita LLM
          responseText = commandResult.responseText;
        } else if (!commandResult.startLlm) {
          sessionManager.setState(socket.id, 'idle');
          socket.emit('assistant_status', { status: 'idle' });
          return;
        }
        // Si startLlm=true, continúa al paso LLM con el mensaje ya añadido
      }

      // 2b. Protocolo cognitivo activo
      if (!responseText && session.cognitiveState) {
        const protocolResult = cognitiveProtocol.processResponse(text, session.cognitiveState);
        responseText = protocolResult.responseText;

        // Notificar cambio de paso al cliente
        const stepInfo = cognitiveProtocol.getStepInfo(session.cognitiveState);
        socket.emit('cognitive_step_changed', {
          step: session.cognitiveState.currentStep,
          stepNumber: stepInfo.stepNumber,
          totalSteps: stepInfo.totalSteps,
        });

        if (protocolResult.completed) {
          socket.emit('cognitive_completed', {
            durationMs: stepInfo.durationMs,
            stepsCompleted: stepInfo.totalSteps,
          });
          sessionManager.setCognitiveState(socket.id, null);
        }
      }

      // 2c. Conversación general con LLM
      if (!responseText && session.conversationActive) {
        sessionManager.addMessage(socket.id, 'user', text);
        sessionManager.setState(socket.id, 'thinking');
        socket.emit('assistant_status', { status: 'processing' });

        let llmFullText = '';

        const llmResult = await llmService.chat(
          sessionManager.getDialog(socket.id),
          (chunk) => {
            if (chunk.delta) {
              socket.emit('assistant_text', { delta: chunk.delta });
              llmFullText += chunk.delta;
            }
          }
        );

        responseText = llmResult.fullText;
        sessionManager.addMessage(socket.id, 'assistant', responseText);
        socket.emit('assistant_text_done', { text: responseText });
      }

      // 2d. Sin conversación activa — acumular en buffer
      if (!responseText && !session.conversationActive) {
        session.userBuffer += (session.userBuffer ? ' ' : '') + text;
        sessionManager.setState(socket.id, 'idle');
        socket.emit('assistant_status', { status: 'idle' });
        return;
      }

      if (!responseText) {
        sessionManager.setState(socket.id, 'idle');
        socket.emit('assistant_status', { status: 'idle' });
        return;
      }

      // ── Paso 3: TTS ─────────────────────────────────────────
      sessionManager.setState(socket.id, 'speaking');
      socket.emit('assistant_status', { status: 'playing' });

      log.debug({ socketId: socket.id, chars: responseText.length }, 'Iniciando TTS');

      const ttsResult = await ttsService.synthesize({ text: responseText });

      // ── Paso 4: Emitir audio al cliente ─────────────────────
      // Convertir Buffer a ArrayBuffer para enviar via WebSocket
      const audioArrayBuffer = new Uint8Array(ttsResult.audioBuffer).buffer;
      socket.emit('audio_response', {
        audioBuffer: audioArrayBuffer,
        sampleRate: ttsResult.sampleRate,
        durationMs: ttsResult.durationMs,
      });

      log.info(
        {
          socketId: socket.id,
          totalMs: Date.now() - pipelineStart,
          audioDurationMs: ttsResult.durationMs,
        },
        'Pipeline completado'
      );

    } catch (err) {
      log.error({ socketId: socket.id, err }, 'Error en pipeline');
      socket.emit('error', {
        code: 'INTERNAL_ERROR',
        message: 'Error procesando audio. Por favor, intente de nuevo.',
      });
    } finally {
      sessionManager.setState(socket.id, 'idle');
      socket.emit('assistant_status', { status: 'idle' });
    }
  }

  // Forzar transcripción final del buffer VAD al detener grabación
  handleStopRecording(socket: AlmaSocket): void {
    const vad = sessionManager.getVad(socket.id);
    if (!vad) return;

    // Reset del VAD para limpiar cualquier audio pendiente
    vad.reset();

    const session = sessionManager.get(socket.id);
    if (!session) return;

    // Cerrar WAV writer si estaba activo
    if (session.wavWriter) {
      session.wavWriter.end();
      session.wavWriter = null;
    }

    sessionManager.setState(socket.id, 'idle');
    socket.emit('assistant_status', { status: 'idle' });

    log.info({ socketId: socket.id }, 'Grabación detenida');
  }
}

export const audioHandler = new AudioHandler();
