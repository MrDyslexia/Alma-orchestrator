import { VAD_MIN_SPEECH_MS, VAD_SILENCE_THRESHOLD_MS, AUDIO_SAMPLE_RATE } from '@config/constants';
import type { VadResult } from '@types/audio.types';

// ─── Voice Activity Detection (VAD) simple ───────────────────────
// Detecta fin de utterance basado en energía RMS y duración de silencio.
// No reemplaza a Silero VAD (que usará el microservicio Python),
// pero sirve como pre-filtro en el orquestador para no enviar
// chunks de silencio puro al STT.

export class VadDetector {
  private silenceStartMs: number | null = null;
  private speechBuffer: Buffer[] = [];
  private hasSpeech = false;
  private speechStartMs: number | null = null;

  // Umbral de energía RMS para considerar que hay voz
  // (ajustable según el hardware del micrófono)
  private readonly RMS_THRESHOLD = 500;

  process(chunk: Buffer, nowMs: number = Date.now()): VadResult {
    const rms = this.calculateRms(chunk);
    const isSpeech = rms > this.RMS_THRESHOLD;

    if (isSpeech) {
      // Hay voz activa
      this.silenceStartMs = null;

      if (!this.hasSpeech) {
        this.hasSpeech = true;
        this.speechStartMs = nowMs;
      }

      this.speechBuffer.push(chunk);
      return { type: 'speech' };
    }

    // Silencio detectado
    if (!this.hasSpeech) {
      // Silencio antes de cualquier voz, ignorar
      return { type: 'silence', durationMs: 0 };
    }

    if (this.silenceStartMs === null) {
      this.silenceStartMs = nowMs;
    }

    const silenceDurationMs = nowMs - this.silenceStartMs;
    this.speechBuffer.push(chunk); // incluir el silencio final en el buffer

    if (silenceDurationMs >= VAD_SILENCE_THRESHOLD_MS) {
      const speechDurationMs = this.speechStartMs ? nowMs - this.speechStartMs : 0;

      // Utterance demasiado corto (ruido), descartar
      if (speechDurationMs < VAD_MIN_SPEECH_MS) {
        this.reset();
        return { type: 'silence', durationMs: silenceDurationMs };
      }

      // Fin de utterance válido
      const buffer = Buffer.concat(this.speechBuffer);
      this.reset();
      return { type: 'utterance_end', buffer };
    }

    return { type: 'silence', durationMs: silenceDurationMs };
  }

  reset(): void {
    this.silenceStartMs = null;
    this.speechBuffer = [];
    this.hasSpeech = false;
    this.speechStartMs = null;
  }

  private calculateRms(buffer: Buffer): number {
    // PCM 16-bit little-endian → calcular RMS de las muestras
    let sum = 0;
    const samples = buffer.length / 2; // 2 bytes por muestra (16-bit)

    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      sum += sample * sample;
    }

    return Math.sqrt(sum / samples);
  }

  // Duración en ms de un buffer PCM 16kHz mono
  static bufferDurationMs(buffer: Buffer): number {
    const samples = buffer.length / 2;
    return (samples / AUDIO_SAMPLE_RATE) * 1000;
  }
}
