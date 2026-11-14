# Agent Voice Bridge — Universal VS Code / Antigravity IDE Extension (`.vsix`)

> **Goal:** Build a universal VS Code / Antigravity IDE / Cursor / Windsurf extension (`.vsix`) that lets the user speak to their AI coding agent via microphone (Push-to-Talk or Hands-Free Toggle) and automatically injects + submits the transcribed text directly into the active Agent Chat input. Designed with a clean Phase 2 upgrade path for **Hands-Free Two-Way Agent Voice** (where the agent speaks back concise summaries).

---

## 1. Product Architecture (Phase 1: Voice-to-Agent Input)

### Core User Flow
1. **Status Bar Mic Button & Hotkey (`Alt+Space` or `Ctrl+Shift+V`):**
   - Clicking `$(unmute) Talk to Agent` in the status bar (or pressing the shortcut) starts/stops recording.
   - While recording, the status bar changes to `$(record) Listening... (Press Alt+Space to send)` with a red/amber highlight.
2. **Audio Capture + Fast AI Transcription:**
   - **Recorder Layer:** Lightweight hidden/docked Webview panel (using browser `navigator.mediaDevices.getUserMedia` + `MediaRecorder` in `audio/webm` or `audio/wav`) OR native local mic capture so no external binary dependencies are required.
   - **Transcription Engine (Multi-Provider, Zero-Friction):**
     - **Primary (Gemini Flash Audio API):** Uses `gemini-2.5-flash` multimodal audio transcription via the user's `GEMINI_API_KEY` (fast, accurate with technical/trading terms like `XAUUSDm`, `MQL5`, `ATR`, `walk-forward`, and automatically strips filler words like *"um"*, *"uh"* while preserving exact intent).
     - **Fallback (Web Speech API / OpenAI Whisper):** Optional toggle in VS Code Settings (`agentVoice.provider`: `gemini` | `openai` | `browser`).
3. **Direct Agent Chat Injection (`Auto-Paste + Auto-Submit`):**
   - Once transcribed, the extension automatically routes the text straight into the active AI Agent Chat box:
     1. Copies transcribed text to clipboard (preserving previous clipboard optionally).
     2. Executes the IDE's native chat focus command (auto-detecting Antigravity / VS Code Chat / Cursor / Windsurf commands such as `workbench.action.chat.open`, `antigravity.focusChat`, `aichat.newfollowupaction`, or focuses the active chat input).
     3. Triggers `editor.action.clipboardPasteAction`.
     4. Optional setting (`agentVoice.autoSubmit`: `true`/`false`): automatically sends `Enter` to submit, or leaves it in the input box so the user can review/append before pressing `Enter`.

---

## 2. Phase 2 Roadmap (Future Upgrade: Two-Way Hands-Free Mode)

Designed modularly so Phase 2 drops right in without rewriting Phase 1:
- **Voice Activity Detection (VAD) Hands-Free Loop:** Auto-detects when you start speaking and when you pause for 1.5 seconds, sending the prompt with zero button presses.
- **Agent Talks Back (TTS Summary Hook):**
  - Hooks into agent output / Antigravity post-response hook (`after_agent_response`).
  - Instead of reading raw code blocks or tables aloud, passes the response through a 1-second Gemini Flash prompt: *"Summarize this agent output into 1-2 natural spoken sentences for the developer"* and plays it via low-latency TTS (Gemini Live Audio / ElevenLabs / Web Speech `speechSynthesis`).

---

## 3. Directory & File Structure (`e:\agent-voice-extension`)

```text
e:\agent-voice-extension\
├── package.json              # VS Code / Antigravity extension manifest, commands, keybindings, settings
├── tsconfig.json             # TypeScript config
├── src\
│   ├── extension.ts          # Main entry point: status bar item, commands, keybindings, chat injection
│   ├── recorderPanel.ts      # WebviewView / floating mic controller for MediaRecorder audio capture
│   ├── transcriber.ts        # Gemini 2.5 Flash / Whisper API audio transcription client
│   └── chatInjector.ts       # Smart IDE chat focus + clipboard paste + optional auto-submit
├── media\
│   ├── recorder.js           # Webview microphone capture + live waveform / level meter + VAD
│   └── style.css             # Clean compact UI for the Voice Controller panel
└── VOICE_EXTENSION_SPEC.md   # This specification & starter prompt
```

---

## 4. Extension Settings (`contributes.configuration`)

- `agentVoice.geminiApiKey`: Gemini API key (also auto-reads `GEMINI_API_KEY` from environment or workspace `.env` so it works out of the box).
- `agentVoice.autoSubmit`: Automatically press Enter after injecting voice transcription into the chat box (default: `false` so you can verify, or `true` for full hands-free).
- `agentVoice.cleanTranscript`: Instruct Gemini to clean up stutters/false starts while keeping technical terms exact (default: `true`).
- `agentVoice.customVocabulary`: Custom domain hints (e.g., `"XAUUSDm, US30m, USOILm, BTCUSDm, MQL5, ATR, scalper, walk-forward, Antigravity"`).

---

## 5. Step-by-Step Build & Packaging Plan (For the New Conversation)

1. **Scaffold & Install Dependencies:**
   - Initialize `package.json` and `tsconfig.json` in `e:\agent-voice-extension`.
   - Install `@types/vscode`, `typescript`, `esbuild`, and `@vscode/vsce` (for `.vsix` packaging).
2. **Build Core Modules (`src/`):**
   - Implement `transcriber.ts` (Gemini 2.5 Flash inline audio base64 REST call — zero heavy SDK bloat, instant startup).
   - Implement `recorderPanel.ts` & `media/recorder.js` (Mic permission, audio buffer recording, visual level meter, Push-to-Talk & Toggle modes).
   - Implement `chatInjector.ts` (Multi-IDE chat focus detection + clipboard injection).
   - Wire `extension.ts` status bar button (`$(unmute) Agent Voice`) and hotkey (`Alt+Space`).
3. **Compile & Package into `.vsix`:**
   - Run `npm run compile` and `npx @vscode/vsce package` to produce `agent-voice-bridge-0.1.0.vsix`.
4. **Install into Antigravity IDE:**
   - Install the `.vsix` directly so it's immediately active in the status bar across all workspaces (including `e:\apache`).
