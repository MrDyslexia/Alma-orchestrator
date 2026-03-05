import fs from 'fs';
import path from 'path';
import { config } from '@config/index';
import { createLogger } from '@utils/logger';
import type { WavWriter } from '../types/session.types';

const log = createLogger('AudioManager');

// ─── AudioManager ────────────────────────────────────────────────
// Gestiona grabación WAV por sesión.
// Si ENABLE_WAV_RECORDING=false, todos los métodos son no-ops.
// Esto permite desactivar la grabación sin tocar ningún otro módulo.

export class AudioManager {
  private readonly enabled: boolean;
  private readonly outputDir: string;

  constructor() {
    this.enabled = config.ENABLE_WAV_RECORDING;
    this.outputDir = path.resolve(config.WAV_OUTPUT_DIR);

    if (this.enabled) {
      fs.mkdirSync(this.outputDir, { recursive: true });
      log.info({ outputDir: this.outputDir }, 'Grabación WAV habilitada');
    } else {
      log.info('Grabación WAV deshabilitada (ENABLE_WAV_RECORDING=false)');
    }
  }

  // Crea un WavWriter para la sesión.
  // Devuelve null si la grabación está deshabilitada.
  createWriter(socketId: string): WavWriter | null {
    if (!this.enabled) return null;

    const filename = path.join(
      this.outputDir,
      `audio_${socketId}_${Date.now()}.wav`
    );

    // Encabezado WAV manual (PCM 16-bit, 16kHz, mono)
    // Usamos un stream de escritura directo para evitar dependencia de wav npm
    const writeStream = fs.createWriteStream(filename);
    let bytesWritten = 0;
    let hadError = false;

    // Reservar 44 bytes para el header WAV (se escribe al final)
    const headerBuffer = Buffer.alloc(44);
    writeStream.write(headerBuffer);

    writeStream.on('error', (err) => {
      hadError = true;
      log.error({ err, filename }, 'Error en FileWriter WAV');
    });

    const writer: WavWriter = {
      filename,
      hadError: false,

      write(chunk: Buffer): void {
        if (hadError) return;
        try {
          writeStream.write(chunk);
          bytesWritten += chunk.length;
        } catch (err) {
          hadError = true;
          log.error({ err }, 'Error escribiendo chunk WAV');
        }
      },

      end(): void {
        if (hadError) return;
        try {
          // Escribir header WAV correcto con el tamaño final
          const header = AudioManager.buildWavHeader(bytesWritten, 16000, 1, 16);
          const fd = fs.openSync(filename, 'r+');
          fs.writeSync(fd, header, 0, header.length, 0);
          fs.closeSync(fd);
          writeStream.end();
          log.info({ filename, bytesWritten }, 'Archivo WAV guardado');
        } catch (err) {
          log.error({ err, filename }, 'Error cerrando WAV');
        }
      },
    };

    // Proxy para sincronizar hadError con el stream
    Object.defineProperty(writer, 'hadError', {
      get: () => hadError,
      set: (v: boolean) => { hadError = v; },
    });

    log.debug({ socketId, filename }, 'WAV writer creado');
    return writer;
  }

  // Guarda el transcript JSON de la sesión al finalizar grabación
  saveTranscript(socketId: string, data: Record<string, unknown>): void {
    if (!this.enabled) return;

    const filename = path.join(
      this.outputDir,
      `transcript_${socketId}_${Date.now()}.json`
    );

    try {
      fs.writeFileSync(filename, JSON.stringify(data, null, 2));
      log.info({ filename }, 'Transcript guardado');
    } catch (err) {
      log.error({ err, filename }, 'Error guardando transcript');
    }
  }

  // Lista los últimos N transcripts (para el endpoint REST)
  listTranscripts(limit = 10): unknown[] {
    if (!this.enabled) return [];

    try {
      return fs
        .readdirSync(this.outputDir)
        .filter((f) => f.startsWith('transcript_') && f.endsWith('.json'))
        .map((f) => {
          const fp = path.join(this.outputDir, f);
          const stat = fs.statSync(fp);
          return { filename: f, createdAt: stat.birthtime, size: stat.size };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  // ─── Privados ──────────────────────────────────────────────────

  private static buildWavHeader(
    dataBytes: number,
    sampleRate: number,
    channels: number,
    bitDepth: number
  ): Buffer {
    const header = Buffer.alloc(44);
    const byteRate = (sampleRate * channels * bitDepth) / 8;
    const blockAlign = (channels * bitDepth) / 8;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataBytes, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);          // PCM chunk size
    header.writeUInt16LE(1, 20);           // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataBytes, 40);

    return header;
  }
}

export const audioManager = new AudioManager();
