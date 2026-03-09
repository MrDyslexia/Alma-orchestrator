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
import type { ServerToClientEvents, ClientToServerEvents } from '../types/socket.types';

const log = createLogger('AudioHandler');
type AlmaSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export class AudioHandler {
  handleChunk(socket: AlmaSocket, data: AudioChunk): void {
    const session = sessionManager.get(socket.id);
    if (!session || session.state === 'disconnected') return;

    const audioBuffer = Buffer.from(data.chunk);
    session.wavWriter?.write(audioBuffer);

    const vad = sessionManager.getVad(socket.id);
    if (!vad) return;

    const vadResult = vad.process(audioBuffer, data.timestamp);

    if (vadResult.type === 'speech') {
      if (session.state === 'idle') {
        sessionManager.setState(socket.id, 'listening');
        socket.emit('assistant_status', { status: 'recording' });
      }
      return;
    }

    if (vadResult.type === 'utterance_end') {
      console.log(`[VAD] utterance_end — ${vadResult.buffer.length} bytes`);
      sessionManager.setState(socket.id, 'transcribing');
      socket.emit('assistant_status', { status: 'processing' });
      jobQueueManager.enqueue(socket.id, () => this.runPipeline(socket, vadResult.buffer), 'stt→llm→tts');
    }
  }

  private async runPipeline(socket: AlmaSocket, audioBuffer: Buffer): Promise<void> {
    const session = sessionManager.get(socket.id);
    if (!session) return;

    const t0 = Date.now();
    console.log(`\n━━━ PIPELINE START ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    try {
      // ── STT ───────────────────────────────────────────────────
      console.log(`[T+0ms] STT → ${audioBuffer.length} bytes`);
      const sttResult = await sttService.transcribe({ audioBuffer });
      const text = sttResult.text.trim();
      const t1 = Date.now();
      console.log(`[T+${t1-t0}ms] STT → "${text.substring(0, 80)}"`);

      if (!text) {
        sessionManager.setState(socket.id, 'idle');
        socket.emit('assistant_status', { status: 'idle' });
        return;
      }

      socket.emit('transcription', { text, isFinal: true, confidence: sttResult.confidence });

      // ── Comandos ──────────────────────────────────────────────
      let responseText: string | null = null;
      const commandResult = commandHandler.process(text, session);

      if (commandResult.handled && commandResult.action !== 'none') {
        socket.emit('voice_command_detected', { action: commandResult.action, command: commandResult.action, text });
        console.log(`[T+${Date.now()-t0}ms] Comando: ${commandResult.action}`);
        if (commandResult.responseText && !commandResult.startLlm) {
          responseText = commandResult.responseText;
        } else if (!commandResult.startLlm) {
          sessionManager.setState(socket.id, 'idle');
          socket.emit('assistant_status', { status: 'idle' });
          return;
        }
      }

      // ── Protocolo cognitivo ───────────────────────────────────
      if (!responseText && session.cognitiveState) {
        const protocolResult = cognitiveProtocol.processResponse(text, session.cognitiveState);
        responseText = protocolResult.responseText;
        const stepInfo = cognitiveProtocol.getStepInfo(session.cognitiveState);
        socket.emit('cognitive_step_changed', {
          step: session.cognitiveState.currentStep,
          stepNumber: stepInfo.stepNumber,
          totalSteps: stepInfo.totalSteps,
        });
        if (protocolResult.completed) {
          socket.emit('cognitive_completed', { durationMs: stepInfo.durationMs, stepsCompleted: stepInfo.totalSteps });
          sessionManager.setCognitiveState(socket.id, null);
        }
        console.log(`[T+${Date.now()-t0}ms] Protocolo → "${(responseText||'').substring(0,60)}"`);
      }

      // ── LLM con TTS en paralelo por oraciones ─────────────────
      if (!responseText && session.conversationActive) {
        sessionManager.addMessage(socket.id, 'user', text);
        sessionManager.setState(socket.id, 'thinking');
        socket.emit('assistant_status', { status: 'processing' });

        const tLlm = Date.now();
        console.log(`[T+${tLlm-t0}ms] LLM iniciando streaming...`);

        // Cola de oraciones: cada oración completa del LLM se sintetiza
        // de forma ordenada mientras el LLM sigue generando las siguientes.
        // Esto elimina la espera LLM-completo→TTS-empieza.
        const ttsQueue: string[] = [];
        let ttsPlaying = false;
        let llmDone = false;
        let fullLlmText = '';

        // Reproduce la cola de oraciones en orden, una a una
        const drainQueue = async () => {
          if (ttsPlaying) return;
          ttsPlaying = true;
          while (ttsQueue.length > 0) {
            const sentence = ttsQueue.shift()!;
            console.log(`[T+${Date.now()-t0}ms] TTS oración → "${sentence.substring(0,60)}"`);
            try {
              const ttsResult = await ttsService.synthesize({ text: sentence });
              const tTts = Date.now();
              console.log(`[T+${tTts-t0}ms] TTS oración completada — ${ttsResult.audioBuffer.length} bytes`);
              const audioArrayBuffer = new Uint8Array(ttsResult.audioBuffer).buffer;
              socket.emit('audio_response', {
                audioBuffer: audioArrayBuffer,
                sampleRate: ttsResult.sampleRate,
                durationMs: ttsResult.durationMs,
              });
            } catch (err: any) {
              console.error(`[TTS ERROR] ${err?.message}`);
            }
          }
          ttsPlaying = false;
          // Si el LLM ya terminó y la cola está vacía, cerramos
          if (llmDone && ttsQueue.length === 0) {
            sessionManager.setState(socket.id, 'idle');
            socket.emit('assistant_status', { status: 'idle' });
            console.log(`[T+${Date.now()-t0}ms] ✓ PIPELINE COMPLETO`);
          }
        };

        const llmResult = await llmService.chat(
          sessionManager.getDialog(socket.id),
          (chunk) => {
            if (chunk.delta) socket.emit('assistant_text', { delta: chunk.delta });
          },
          // onSentence: se llama cuando el LLM completa una oración
          (sentence) => {
            fullLlmText += (fullLlmText ? ' ' : '') + sentence;
            ttsQueue.push(sentence);
            console.log(`[T+${Date.now()-t0}ms] Oración lista para TTS: "${sentence.substring(0,50)}"`);
            // Arrancar la cola si no está corriendo
            void drainQueue();
          }
        );

        const tLlmEnd = Date.now();
        console.log(`[T+${tLlmEnd-t0}ms] LLM stream terminado — ${llmResult.fullText.length} chars`);

        sessionManager.addMessage(socket.id, 'assistant', llmResult.fullText);
        socket.emit('assistant_text_done', { text: llmResult.fullText });

        // Marcar LLM como terminado para que drainQueue pueda cerrar
        llmDone = true;

        // Si la cola quedó vacía (texto muy corto sin puntuación), sintetizar todo
        if (ttsQueue.length === 0 && !ttsPlaying) {
          const remaining = llmResult.fullText.trim();
          if (remaining && remaining.length > 2) {
            ttsQueue.push(remaining);
            void drainQueue();
          } else {
            sessionManager.setState(socket.id, 'idle');
            socket.emit('assistant_status', { status: 'idle' });
          }
        }

        return; // estado se maneja dentro de drainQueue
      }

      // ── Sin conversación activa ───────────────────────────────
      if (!responseText && !session.conversationActive) {
        console.log(`[T+${Date.now()-t0}ms] Sin conversación activa — di "hola alma" primero`);
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

      // ── TTS directo (comandos/protocolo, respuesta corta) ─────
      console.log(`[T+${Date.now()-t0}ms] TTS directo → "${responseText.substring(0,60)}"`);
      sessionManager.setState(socket.id, 'speaking');
      socket.emit('assistant_status', { status: 'playing' });

      const ttsResult = await ttsService.synthesize({ text: responseText });
      const audioArrayBuffer = new Uint8Array(ttsResult.audioBuffer).buffer;
      socket.emit('audio_response', {
        audioBuffer: audioArrayBuffer,
        sampleRate: ttsResult.sampleRate,
        durationMs: ttsResult.durationMs,
      });

      console.log(`[T+${Date.now()-t0}ms] ✓ PIPELINE COMPLETO`);

    } catch (err: any) {
      console.error(`[T+${Date.now()-t0}ms] ✗ ERROR: ${err?.message}`);
      socket.emit('error', {
        code: 'INTERNAL_ERROR',
        message: `Error: ${err?.message || 'desconocido'}`,
      });
    } finally {
      // Solo reseteamos aquí si no entramos en el path LLM (que gestiona su propio estado)
      const session = sessionManager.get(socket.id);
      if (session && session.state !== 'idle') {
        sessionManager.setState(socket.id, 'idle');
        socket.emit('assistant_status', { status: 'idle' });
      }
    }
  }

  handleStopRecording(socket: AlmaSocket): void {
    const vad = sessionManager.getVad(socket.id);
    if (!vad) return;
    vad.reset();
    const session = sessionManager.get(socket.id);
    if (!session) return;
    if (session.wavWriter) { session.wavWriter.end(); session.wavWriter = null; }
    sessionManager.setState(socket.id, 'idle');
    socket.emit('assistant_status', { status: 'idle' });
  }
}

export const audioHandler = new AudioHandler();
