import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { NativeWindowsRecorder } from './nativeRecorder';
import { TranscriptionProvider } from './transcriber';

export interface RecorderCallbacks {
  onRecordingStateChanged: (isRecording: boolean) => void;
  onAudioCaptured: (base64Audio: string, mimeType: string) => Promise<void>;
  onBrowserTranscript: (text: string) => Promise<void>;
  onCopyLast: (text?: string) => Promise<void>;
  onReinjectLast: () => Promise<void>;
  onError: (message: string) => void;
}

export class RecorderViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentVoice.recorderView';

  private view?: vscode.WebviewView;
  private webviewReady = false;
  private pendingStart = false;
  private recording = false;
  private readonly nativeRecorder = new NativeWindowsRecorder();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: RecorderCallbacks
  ) {}

  public isRecording(): boolean {
    return this.recording || this.nativeRecorder.isRecording();
  }

  public dispose(): void {
    this.nativeRecorder.dispose();
  }

  private shouldUseNativeRecorder(provider: TranscriptionProvider): boolean {
    if (provider === 'browser') {
      return false;
    }
    const captureMode = vscode.workspace
      .getConfiguration('agentVoice')
      .get<'auto' | 'native' | 'webview'>('captureMode', 'auto');
    if (captureMode === 'native') {
      return process.platform === 'win32';
    }
    if (captureMode === 'webview') {
      return false;
    }
    return process.platform === 'win32';
  }

  public async openAndFocus(preserveFocus = false): Promise<void> {
    await vscode.commands.executeCommand('agentVoice.recorderView.focus', { preserveFocus });
  }

  public async toggleRecording(): Promise<void> {
    const provider = vscode.workspace
      .getConfiguration('agentVoice')
      .get<TranscriptionProvider>('provider', 'gemini');

    if (this.shouldUseNativeRecorder(provider) || this.nativeRecorder.isRecording()) {
      await this.toggleNativeRecording();
      return;
    }

    if (!this.view || !this.webviewReady) {
      this.pendingStart = true;
      await this.openAndFocus(false);
      return;
    }

    if (!this.recording) {
      this.view.show?.(true);
      this.postMessage({ type: 'startRecording', provider });
    } else {
      this.postMessage({ type: 'stopRecording' });
    }
  }

  private async toggleNativeRecording(): Promise<void> {
    if (!this.nativeRecorder.isRecording()) {
      try {
        await this.nativeRecorder.start();
        this.recording = true;
        this.callbacks.onRecordingStateChanged(true);
        this.postMessage({
          type: 'nativeRecordingState',
          recording: true,
          detail: 'Listening (Windows Mic)... Click or press Alt+Space to send.'
        });
      } catch (err) {
        this.recording = false;
        this.callbacks.onRecordingStateChanged(false);
        const msg = err instanceof Error ? err.message : String(err);
        this.callbacks.onError(msg);
      }
      return;
    }

    this.recording = false;
    this.callbacks.onRecordingStateChanged(false);
    this.postMessage({
      type: 'nativeRecordingState',
      recording: false,
      detail: 'Processing audio...'
    });

    try {
      const captured = await this.nativeRecorder.stop();
      await this.callbacks.onAudioCaptured(captured.base64, captured.mimeType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.callbacks.onError(msg);
    }
  }

  public notifyStatus(status: 'idle' | 'transcribing' | 'error', detail?: string, lastTranscript?: string): void {
    this.postMessage({ type: 'statusUpdate', status, detail, lastTranscript });
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.webviewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.webviewReady = false;
      this.recording = false;
      this.callbacks.onRecordingStateChanged(false);
    });

    webviewView.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
      switch (message.type) {
        case 'ready': {
          this.webviewReady = true;
          const provider = vscode.workspace
            .getConfiguration('agentVoice')
            .get<TranscriptionProvider>('provider', 'gemini');
          this.postMessage({
            type: 'init',
            provider,
            nativeMode: this.shouldUseNativeRecorder(provider)
          });
          if (this.pendingStart) {
            this.pendingStart = false;
            this.postMessage({ type: 'startRecording', provider });
          }
          break;
        }
        case 'toggleFromWebview': {
          await this.toggleRecording();
          break;
        }
        case 'recordingStarted': {
          this.recording = true;
          this.callbacks.onRecordingStateChanged(true);
          break;
        }
        case 'recordingStopped': {
          this.recording = false;
          this.callbacks.onRecordingStateChanged(false);
          break;
        }
        case 'audioCaptured': {
          this.recording = false;
          this.callbacks.onRecordingStateChanged(false);
          const base64 = typeof message.base64 === 'string' ? message.base64 : '';
          const mimeType = typeof message.mimeType === 'string' ? message.mimeType : 'audio/webm';
          if (base64) {
            await this.callbacks.onAudioCaptured(base64, mimeType);
          } else {
            this.callbacks.onError('No audio data was captured.');
          }
          break;
        }
        case 'browserTranscript': {
          this.recording = false;
          this.callbacks.onRecordingStateChanged(false);
          const text = typeof message.text === 'string' ? message.text.trim() : '';
          await this.callbacks.onBrowserTranscript(text);
          break;
        }
        case 'copyLast': {
          const textToCopy = typeof message.text === 'string' ? message.text : undefined;
          await this.callbacks.onCopyLast(textToCopy);
          break;
        }
        case 'reinjectLast': {
          await this.callbacks.onReinjectLast();
          break;
        }
        case 'error': {
          this.recording = false;
          this.callbacks.onRecordingStateChanged(false);
          const errMsg = typeof message.message === 'string' ? message.message : 'Microphone error.';
          this.callbacks.onError(errMsg);
          break;
        }
      }
    });
  }

  private postMessage(payload: Record<string, unknown>): void {
    if (this.view && this.webviewReady) {
      void this.view.webview.postMessage(payload);
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'recorder.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'style.css')
    );
    const nonce = crypto.randomBytes(16).toString('hex');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>VoxCode Voice Agent</title>
</head>
<body>
  <div class="shell">
    <!-- Top Header -->
    <div class="topbar">
      <div class="brand-row">
        <div class="wave-badge" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
        <div>
          <div class="brand-title">Voice Agent</div>
          <div class="conn-row">
            <span class="conn-dot"></span>
            <span id="providerBadge" class="conn-text">Connected · gemini</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Target IDE Pills -->
    <div class="target-pills" role="tablist" aria-label="Target IDE">
      <button class="target-pill active" data-target="Antigravity" type="button">Antigravity</button>
      <button class="target-pill" data-target="VS Code" type="button">VS Code</button>
      <button class="target-pill" data-target="Cursor" type="button">Cursor</button>
    </div>

    <!-- Centerpiece Glowing Mic Orb + Symmetrical Waveforms -->
    <div class="orb-stage">
      <div class="side-wave left" id="waveLeft" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
      </div>

      <button id="micButton" class="mic-orb" type="button" aria-label="Tap to Talk">
        <span class="orb-ring"></span>
        <svg class="mic-svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 0-2 0 3 3 0 1 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.1A5 5 0 0 0 17 11Z"/>
        </svg>
      </button>

      <div class="side-wave right" id="waveRight" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
    </div>

    <div class="orb-caption">
      <div id="micLabel" class="tap-title">Tap to Talk</div>
      <div class="shortcut-hint">Or press <kbd>Alt</kbd> <kbd>Space</kbd></div>
    </div>

    <!-- Status Card -->
    <div class="status-card" id="statusCard">
      <div class="status-left">
        <div class="status-head">
          <span id="statusDot" class="status-dot"></span>
          <span id="statusTitle" class="status-title">Ready</span>
        </div>
        <div id="statusText" class="status-sub">Your agent is ready to receive commands</div>
      </div>
      <div class="mini-wave" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
    </div>

    <!-- Recent Transcripts -->
    <div class="activity-section">
      <div class="activity-header">
        <span class="activity-title">Recent Transcripts</span>
        <div class="activity-actions">
          <button id="copyBtn" class="see-all-btn" type="button" disabled>Copy</button>
          <button id="reinjectBtn" class="see-all-btn muted-link" type="button" disabled>Auto-Paste</button>
        </div>
      </div>
      <div id="activityList" class="activity-list">
        <div class="activity-empty">Speak a command to see your history here.</div>
      </div>
    </div>

    <!-- Tip Banner -->
    <div class="tip-banner">
      <div class="tip-icon" aria-hidden="true">⚡</div>
      <div class="tip-copy">
        <div class="tip-title">Try voice commands</div>
        <div class="tip-sub">"Check my XAUUSDm scalper in MQL5"</div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
