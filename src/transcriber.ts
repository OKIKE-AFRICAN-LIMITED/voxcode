import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type TranscriptionProvider = 'gemini' | 'openrouter' | 'openai' | 'browser';

export interface TranscriptionResult {
  text: string;
  provider: TranscriptionProvider;
}

const DEFAULT_FALLBACK_ENV_PATH = 'e:\\apache\\.env';

/**
 * Parse a specific key from a .env file without mutating process.env.
 */
function readKeyFromEnvFile(filePath: string, keyName: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
      const eqIdx = normalized.indexOf('=');
      if (eqIdx === -1) {
        continue;
      }
      const key = normalized.slice(0, eqIdx).trim();
      if (key !== keyName) {
        continue;
      }
      let value = normalized.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) {
        return value;
      }
    }
  } catch {
    // Ignore unreadable .env files and continue fallback chain.
  }
  return undefined;
}

/**
 * Resolve an API key from VS Code settings, process.env, workspace .env files, or e:\apache\.env.
 */
export function resolveApiKey(
  settingKey: 'geminiApiKey' | 'openrouterApiKey' | 'openaiApiKey',
  envKey: string
): string | undefined {
  const config = vscode.workspace.getConfiguration('agentVoice');
  const configured = config.get<string>(settingKey)?.trim();
  if (configured) {
    return configured;
  }

  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const candidate = path.join(folder.uri.fsPath, '.env');
    const found = readKeyFromEnvFile(candidate, envKey);
    if (found) {
      return found;
    }
  }

  return readKeyFromEnvFile(DEFAULT_FALLBACK_ENV_PATH, envKey);
}

function normalizeAudioMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base === 'audio/wave' || base === 'audio/x-wav') {
    return 'audio/wav';
  }
  return base || 'audio/webm';
}

function buildGeminiPrompt(cleanTranscript: boolean, customVocabulary: string): string {
  const instructions: string[] = [
    'Transcribe the user audio accurately into plain text.'
  ];

  if (cleanTranscript) {
    instructions.push(
      'Remove filler words (such as "um", "uh", "er") and obvious false starts while preserving the speaker\'s exact intent, punctuation, and technical terms.'
    );
  } else {
    instructions.push('Transcribe verbatim without altering wording.');
  }

  const vocab = customVocabulary.trim();
  if (vocab) {
    instructions.push(`Pay special attention to these domain/technical terms: ${vocab}.`);
  }

  instructions.push(
    'Return ONLY the transcribed text. Do not wrap in quotes, markdown, or add commentary. If the audio is silent or unintelligible, return an empty string.'
  );

  return instructions.join(' ');
}

/**
 * Transcribe base64-encoded audio using Gemini 2.5 Flash multimodal REST API.
 */
async function transcribeWithGemini(
  base64Audio: string,
  mimeType: string,
  cleanTranscript: boolean,
  customVocabulary: string
): Promise<string> {
  const apiKey = resolveApiKey('geminiApiKey', 'GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'Missing GEMINI_API_KEY. Set "agentVoice.geminiApiKey" in Settings, add GEMINI_API_KEY to your workspace .env, or switch "agentVoice.provider" to "browser".'
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = buildGeminiPrompt(cleanTranscript, customVocabulary);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: normalizeAudioMimeType(mimeType),
                data: base64Audio
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

/**
 * Transcribe base64-encoded audio using OpenAI Whisper API.
 */
async function transcribeWithOpenAI(
  base64Audio: string,
  mimeType: string,
  customVocabulary: string
): Promise<string> {
  const apiKey = resolveApiKey('openaiApiKey', 'OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'Missing OPENAI_API_KEY. Set "agentVoice.openaiApiKey" in Settings or add OPENAI_API_KEY to .env.'
    );
  }

  const cleanMime = normalizeAudioMimeType(mimeType);
  const ext = cleanMime.includes('wav') ? 'wav' : cleanMime.includes('mp4') ? 'm4a' : 'webm';
  const buffer = Buffer.from(base64Audio, 'base64');
  const blob = new Blob([buffer], { type: cleanMime });

  const form = new FormData();
  form.append('file', blob, `voice.${ext}`);
  form.append('model', 'whisper-1');
  if (customVocabulary.trim()) {
    form.append('prompt', customVocabulary.trim());
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI Whisper error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as { text?: string };
  return (data.text ?? '').trim();
}

/**
 * Transcribe base64-encoded audio using OpenRouter chat completions with input_audio.
 */
async function transcribeWithOpenRouter(
  base64Audio: string,
  mimeType: string,
  cleanTranscript: boolean,
  customVocabulary: string,
  model: string
): Promise<string> {
  const apiKey = resolveApiKey('openrouterApiKey', 'OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error(
      'Missing OPENROUTER_API_KEY. Set "agentVoice.openrouterApiKey" in Settings or add OPENROUTER_API_KEY to .env.'
    );
  }

  const cleanMime = normalizeAudioMimeType(mimeType);
  const format = cleanMime.includes('wav') ? 'wav' : cleanMime.includes('mp3') ? 'mp3' : 'wav';
  const prompt = buildGeminiPrompt(cleanTranscript, customVocabulary);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Title': 'Agent Voice Bridge'
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'input_audio',
              input_audio: {
                data: base64Audio,
                format
              }
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

export async function transcribeAudio(
  base64Audio: string,
  mimeType: string
): Promise<TranscriptionResult> {
  const config = vscode.workspace.getConfiguration('agentVoice');
  const provider = config.get<TranscriptionProvider>('provider', 'gemini');
  const cleanTranscript = config.get<boolean>('cleanTranscript', true);
  const customVocabulary = config.get<string>('customVocabulary', '');

  if (provider === 'openrouter') {
    const model = config.get<string>('openrouterModel', 'google/gemini-2.5-flash');
    const text = await transcribeWithOpenRouter(
      base64Audio,
      mimeType,
      cleanTranscript,
      customVocabulary,
      model
    );
    return { text, provider: 'openrouter' };
  }

  if (provider === 'openai') {
    const text = await transcribeWithOpenAI(base64Audio, mimeType, customVocabulary);
    return { text, provider: 'openai' };
  }

  const text = await transcribeWithGemini(base64Audio, mimeType, cleanTranscript, customVocabulary);
  return { text, provider: 'gemini' };
}
