# VoxCode (Agent Voice Bridge)

Speak naturally to your AI coding agent inside **Antigravity IDE**, **VS Code**, **Cursor**, and **Windsurf** — no typing, no interruptions.

---

## How It Works

1. **Trigger Voice Capture:** Click **`Talk to Agent`** in the bottom-right status bar, open the **Voice Agent** panel from the Activity Bar microphone icon, or press **`Alt+Space`** (`Ctrl+Shift+V` when not in Markdown preview).
2. **Native Microphone Recording:**
   - On **Windows**, VoxCode captures **16 kHz mono WAV** audio natively via built-in `winmm.dll` (`mciSendString`), bypassing Electron/VS Code Webview `Permission denied` blocks with **zero external binaries**.
   - On **macOS / Linux** (or when `agentVoice.captureMode` is set to `"webview"`), it uses the Webview `MediaRecorder` API.
3. **AI Transcription & Cleanup:** Audio is transcribed using **Gemini 2.5 Flash** (default), **OpenRouter**, or **OpenAI Whisper**, stripping filler words (`"um"`, `"uh"`) while preserving your custom technical vocabulary.
4. **Instant Clipboard & Chat Injection:** The cleaned transcript is automatically copied to your clipboard (with a one-click **`Copy`** button and history in the **Voice Agent** panel) and attempts to focus & paste into your active IDE chat.

---

## Requirements

- **IDE:** VS Code `^1.85.0`, Antigravity IDE, Cursor, or Windsurf.
- **Microphone:** A working system default microphone (Windows 10/11 requires no extra drivers or binaries).
- **API Key (for cloud transcription):**
  - **Gemini (Default):** A `GEMINI_API_KEY` from Google AI Studio.
  - **OpenRouter:** An `OPENROUTER_API_KEY` (when `agentVoice.provider` is `"openrouter"`).
  - **OpenAI Whisper:** An `OPENAI_API_KEY` (when `agentVoice.provider` is `"openai"`).
  - **Browser Mode (`"browser"`):** Uses Web Speech API with no API key (availability depends on the host IDE's Electron runtime).

### API Key Resolution Order

VoxCode never embeds API keys in the extension package. At runtime, it checks:
1. Extension Settings (`agentVoice.geminiApiKey`, `agentVoice.openrouterApiKey`, or `agentVoice.openaiApiKey`)
2. Environment variables (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`)
3. A `.env` file in your open workspace folder

---

## Keyboard Shortcuts & Commands

| Shortcut | Command | Description |
| :--- | :--- | :--- |
| `Alt+Space` | `agentVoice.toggleRecording` | Start / Stop voice recording |
| `Ctrl+Shift+V` (`Cmd+Shift+V` on Mac) | `agentVoice.toggleRecording` | Alternate toggle (outside Markdown files) |
| Command Palette | `Agent Voice: Open Voice Controller Panel` | Focus the **Voice Agent** sidebar panel |
| Command Palette | `Agent Voice: Re-inject Last Transcript into Chat` | Re-copy and attempt paste of the last transcript |

---

## Extension Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `agentVoice.provider` | `"gemini"` | Transcription backend: `"gemini"`, `"openrouter"`, `"openai"`, or `"browser"` |
| `agentVoice.captureMode` | `"auto"` | `"auto"` (native `winmm.dll` on Windows, webview elsewhere), `"native"`, or `"webview"` |
| `agentVoice.geminiApiKey` | `""` | Gemini API key (optional if set via env or workspace `.env`) |
| `agentVoice.openrouterApiKey` | `""` | OpenRouter API key |
| `agentVoice.openrouterModel` | `"google/gemini-2.5-flash"` | OpenRouter audio-capable model ID |
| `agentVoice.openaiApiKey` | `""` | OpenAI API key for `whisper-1` |
| `agentVoice.autoSubmit` | `false` | Automatically press Enter after pasting into chat |
| `agentVoice.cleanTranscript` | `true` | Remove filler words and false starts while keeping technical terms exact |
| `agentVoice.customVocabulary` | `"XAUUSDm, US30m, ..."` | Comma-separated domain terms to improve transcription accuracy |
| `agentVoice.preserveClipboard` | `false` | Restore previous clipboard contents shortly after pasting |

---

## Troubleshooting

- **"Recorded audio was empty":** Ensure your microphone is enabled and set as the Default Input Device in Windows Sound Settings.
- **Text didn't auto-paste into a Webview chat box:** Some IDE agent sidebars use isolated Webview inputs that ignore programmatic paste. Your transcript is **already copied to the clipboard** automatically—just click the chat input and press `Ctrl+V`, or click **`Copy`** in the **Voice Agent** panel.
- **Missing API key error:** Add your key in **Settings → Agent Voice Bridge**, or place `GEMINI_API_KEY=...` in your workspace `.env`.
