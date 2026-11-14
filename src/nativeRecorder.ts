import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CapturedAudio {
  base64: string;
  mimeType: string;
}

/**
 * Native Windows microphone recorder using built-in winmm.dll (MCI waveaudio).
 * Avoids VS Code / Electron Webview getUserMedia permission blocks with zero external binaries.
 */
export class NativeWindowsRecorder {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private wavPath: string | undefined;
  private recording = false;

  public isRecording(): boolean {
    return this.recording;
  }

  public start(): Promise<void> {
    if (this.recording) {
      return Promise.resolve();
    }

    if (process.platform !== 'win32') {
      return Promise.reject(new Error('Native MCI recorder is only available on Windows.'));
    }

    const tempWav = path.join(os.tmpdir(), `agent-voice-${Date.now()}.wav`);
    this.wavPath = tempWav;

    const escapedPath = tempWav.replace(/'/g, "''");
    const psScript = [
      "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public class WinMM { [DllImport(\"winmm.dll\")] public static extern int mciSendString(string cmd, StringBuilder ret, int retLen, IntPtr hwnd); }'",
      '$sb = New-Object System.Text.StringBuilder 256',
      '$r1 = [WinMM]::mciSendString("open new Type waveaudio alias avrec", $sb, 256, [IntPtr]::Zero)',
      'if ($r1 -ne 0) { Write-Error "MCI open failed with code $r1"; exit 1 }',
      '[WinMM]::mciSendString("set avrec time format ms bitspersample 16 channels 1 samplespersec 16000 bytespersec 32000 alignment 2", $sb, 256, [IntPtr]::Zero) | Out-Null',
      '$r2 = [WinMM]::mciSendString("record avrec", $sb, 256, [IntPtr]::Zero)',
      'if ($r2 -ne 0) { [WinMM]::mciSendString("close avrec", $sb, 256, [IntPtr]::Zero) | Out-Null; Write-Error "MCI record failed with code $r2"; exit 1 }',
      'Write-Output "RECORDING_STARTED"',
      '[Console]::Out.Flush()',
      '[void][Console]::In.ReadLine()',
      '[WinMM]::mciSendString("stop avrec", $sb, 256, [IntPtr]::Zero) | Out-Null',
      `$r3 = [WinMM]::mciSendString("save avrec \`"${escapedPath}\`"", $sb, 256, [IntPtr]::Zero)`,
      '[WinMM]::mciSendString("close avrec", $sb, 256, [IntPtr]::Zero) | Out-Null',
      'if ($r3 -ne 0) { Write-Error "MCI save failed with code $r3"; exit 1 }',
      'Write-Output "RECORDING_SAVED"'
    ].join('\n');

    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

    return new Promise((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
      this.proc = child;

      let settled = false;
      let stderrBuf = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        if (!settled && text.includes('RECORDING_STARTED')) {
          settled = true;
          this.recording = true;
          resolve();
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          this.recording = false;
          this.proc = undefined;
          reject(err);
        }
      });

      child.on('exit', (code) => {
        if (!settled) {
          settled = true;
          this.recording = false;
          this.proc = undefined;
          reject(new Error(stderrBuf.trim() || `Microphone recorder exited with code ${code}`));
        }
      });
    });
  }

  public stop(): Promise<CapturedAudio> {
    if (!this.proc || !this.recording || !this.wavPath) {
      return Promise.reject(new Error('Recorder is not active.'));
    }

    const child = this.proc;
    const wavFile = this.wavPath;
    this.recording = false;
    this.proc = undefined;
    this.wavPath = undefined;

    return new Promise((resolve, reject) => {
      let stderrBuf = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
      });

      child.once('exit', (code) => {
        try {
          if (code !== 0 || !fs.existsSync(wavFile)) {
            reject(new Error(stderrBuf.trim() || `Failed to save audio (exit code ${code}).`));
            return;
          }
          const buf = fs.readFileSync(wavFile);
          try {
            fs.unlinkSync(wavFile);
          } catch {
            // Ignore temp file cleanup errors.
          }
          if (buf.length <= 44) {
            reject(new Error('Recorded audio was empty. Check your Windows default microphone.'));
            return;
          }
          resolve({
            base64: buf.toString('base64'),
            mimeType: 'audio/wav'
          });
        } catch (err) {
          reject(err);
        }
      });

      try {
        child.stdin.write('stop\n');
        child.stdin.end();
      } catch {
        child.kill();
      }
    });
  }

  public dispose(): void {
    if (this.proc) {
      try {
        this.proc.stdin.write('stop\n');
        this.proc.stdin.end();
      } catch {
        this.proc.kill();
      }
      this.proc = undefined;
    }
    this.recording = false;
    if (this.wavPath && fs.existsSync(this.wavPath)) {
      try {
        fs.unlinkSync(this.wavPath);
      } catch {
        // Ignore cleanup errors.
      }
    }
    this.wavPath = undefined;
  }
}
