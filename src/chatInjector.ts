import { execFile } from 'child_process';
import * as vscode from 'vscode';

const CHAT_FOCUS_COMMANDS = [
  'antigravity.focusChat',
  'antigravity.chat.focus',
  'antigravity.agent.focus',
  'workbench.action.chat.open',
  'aichat.newfollowupaction',
  'composer.startComposerPrompt',
  'windsurf.chat.focus',
  'workbench.panel.chat.view.copilot.focus'
];

const CHAT_SUBMIT_COMMANDS = [
  'workbench.action.chat.submit',
  'antigravity.chat.submit'
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendWindowsKeys(keys: string): Promise<boolean> {
  if (process.platform !== 'win32') {
    return Promise.resolve(false);
  }
  const script = `$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys('${keys}')`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: 3000 },
      (err) => resolve(!err)
    );
  });
}

export interface InjectResult {
  pasted: boolean;
  submitted: boolean;
  focusCommand?: string;
}

/**
 * Copy transcribed text to clipboard, focus the active IDE AI chat input,
 * paste it, and optionally submit.
 */
export async function injectIntoAgentChat(text: string): Promise<InjectResult> {
  const config = vscode.workspace.getConfiguration('agentVoice');
  const autoSubmit = config.get<boolean>('autoSubmit', false);
  const preserveClipboard = config.get<boolean>('preserveClipboard', false);

  let previousClipboard: string | undefined;
  if (preserveClipboard) {
    try {
      previousClipboard = await vscode.env.clipboard.readText();
    } catch {
      previousClipboard = undefined;
    }
  }

  await vscode.env.clipboard.writeText(text);

  const availableCommands = new Set(await vscode.commands.getCommands(true));
  let focusCommand: string | undefined;

  for (const cmd of CHAT_FOCUS_COMMANDS) {
    if (availableCommands.has(cmd)) {
      try {
        await vscode.commands.executeCommand(cmd);
        focusCommand = cmd;
        break;
      } catch {
        // Try next candidate command if this one fails in current IDE state.
      }
    }
  }

  let pasted = false;
  if (focusCommand) {
    await delay(220);
    if (process.platform === 'win32') {
      // OS-level Ctrl+V works in both Webview-based AI chats (Antigravity) and Monaco inputs.
      pasted = await sendWindowsKeys('^v');
    }
    if (!pasted) {
      try {
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        pasted = true;
      } catch {
        pasted = false;
      }
    }
  }

  let submitted = false;
  if (pasted && autoSubmit) {
    await delay(140);
    for (const submitCmd of CHAT_SUBMIT_COMMANDS) {
      if (availableCommands.has(submitCmd)) {
        try {
          await vscode.commands.executeCommand(submitCmd);
          submitted = true;
          break;
        } catch {
          // Continue trying submit commands.
        }
      }
    }
    if (!submitted && process.platform === 'win32') {
      submitted = await sendWindowsKeys('{ENTER}');
    }
  }

  if (preserveClipboard && previousClipboard !== undefined) {
    setTimeout(() => {
      void vscode.env.clipboard.writeText(previousClipboard!);
    }, 700);
  }

  return { pasted, submitted, focusCommand };
}
