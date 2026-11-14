import * as vscode from 'vscode';
import { injectIntoAgentChat } from './chatInjector';
import { RecorderViewProvider } from './recorderPanel';
import { transcribeAudio } from './transcriber';

let statusBarItem: vscode.StatusBarItem;
let lastTranscript = '';

function setStatusBarIdle(): void {
  statusBarItem.text = '$(unmute) Talk to Agent';
  statusBarItem.tooltip = 'Click or press Alt+Space (or Ctrl+Shift+V) to speak to your AI agent';
  statusBarItem.backgroundColor = undefined;
}

function setStatusBarListening(): void {
  statusBarItem.text = '$(record) Listening... (Alt+Space to send)';
  statusBarItem.tooltip = 'Recording microphone audio. Click or press Alt+Space to stop and send.';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
}

function setStatusBarTranscribing(): void {
  statusBarItem.text = '$(sync~spin) Transcribing...';
  statusBarItem.tooltip = 'Transcribing voice with AI...';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
}

async function handleTranscriptText(
  text: string,
  providerLabel: string,
  recorderProvider: RecorderViewProvider
): Promise<void> {
  if (!text) {
    setStatusBarIdle();
    recorderProvider.notifyStatus('idle', 'No speech detected.');
    void vscode.window.showInformationMessage('Agent Voice: No speech detected.');
    return;
  }

  lastTranscript = text;
  const result = await injectIntoAgentChat(text);

  setStatusBarIdle();
  recorderProvider.notifyStatus(
    'idle',
    result.pasted
      ? result.submitted
        ? `Sent to chat (${providerLabel}).`
        : `Pasted into chat (${providerLabel}). Press Enter to send.`
      : `Copied to clipboard (${providerLabel}). Paste into chat with Ctrl+V.`,
    text
  );

  if (!result.pasted) {
    void vscode.window.showInformationMessage(
      'Agent Voice: Transcript copied to clipboard. Focus your Agent Chat and press Ctrl+V.'
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'agentVoice.toggleRecording';
  setStatusBarIdle();
  statusBarItem.show();

  const recorderProvider = new RecorderViewProvider(context.extensionUri, {
    onRecordingStateChanged: (isRecording) => {
      if (isRecording) {
        setStatusBarListening();
      } else {
        setStatusBarIdle();
      }
    },
    onAudioCaptured: async (base64Audio, mimeType) => {
      setStatusBarTranscribing();
      recorderProvider.notifyStatus('transcribing', 'Transcribing audio...');
      try {
        const result = await transcribeAudio(base64Audio, mimeType);
        await handleTranscriptText(result.text, result.provider, recorderProvider);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatusBarIdle();
        recorderProvider.notifyStatus('error', message);
        void vscode.window.showErrorMessage(`Agent Voice: ${message}`);
      }
    },
    onBrowserTranscript: async (text) => {
      await handleTranscriptText(text, 'browser', recorderProvider);
    },
    onCopyLast: async (text) => {
      const target = text || lastTranscript;
      if (!target) {
        void vscode.window.showInformationMessage('Agent Voice: No transcript available yet.');
        return;
      }
      await vscode.env.clipboard.writeText(target);
    },
    onReinjectLast: async () => {
      if (!lastTranscript) {
        void vscode.window.showInformationMessage('Agent Voice: No transcript available yet.');
        return;
      }
      await injectIntoAgentChat(lastTranscript);
    },
    onError: (message) => {
      setStatusBarIdle();
      recorderProvider.notifyStatus('error', message);
      void vscode.window.showErrorMessage(`Agent Voice: ${message}`);
    }
  });

  context.subscriptions.push(
    statusBarItem,
    { dispose: () => recorderProvider.dispose() },
    vscode.window.registerWebviewViewProvider(RecorderViewProvider.viewType, recorderProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('agentVoice.toggleRecording', () =>
      recorderProvider.toggleRecording()
    ),
    vscode.commands.registerCommand('agentVoice.openPanel', () =>
      recorderProvider.openAndFocus(false)
    ),
    vscode.commands.registerCommand('agentVoice.pasteLastTranscript', async () => {
      if (!lastTranscript) {
        void vscode.window.showInformationMessage('Agent Voice: No transcript available yet.');
        return;
      }
      await injectIntoAgentChat(lastTranscript);
    })
  );
}

export function deactivate(): void {
  // Status bar and view registrations are disposed via context.subscriptions.
}
