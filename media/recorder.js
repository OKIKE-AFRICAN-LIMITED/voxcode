(function () {
  const vscode = acquireVsCodeApi();

  const micButton = document.getElementById('micButton');
  const micLabel = document.getElementById('micLabel');
  const waveLeft = document.getElementById('waveLeft');
  const waveRight = document.getElementById('waveRight');
  const statusDot = document.getElementById('statusDot');
  const statusTitle = document.getElementById('statusTitle');
  const statusText = document.getElementById('statusText');
  const providerBadge = document.getElementById('providerBadge');
  const activityList = document.getElementById('activityList');
  const copyBtn = document.getElementById('copyBtn');
  const reinjectBtn = document.getElementById('reinjectBtn');
  const targetPills = document.querySelectorAll('.target-pill');

  let currentProvider = 'gemini';
  let useNativeMode = false;
  let isRecording = false;
  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let recognition = null;
  let browserFinalText = '';
  const history = [];

  targetPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      targetPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  function setUiRecording(active) {
    isRecording = active;
    micButton.classList.toggle('recording', active);
    waveLeft?.classList.toggle('active', active);
    waveRight?.classList.toggle('active', active);
    micLabel.textContent = active ? 'Listening... Tap to Send' : 'Tap to Talk';
    if (statusDot) {
      statusDot.className = active ? 'status-dot recording' : 'status-dot';
    }
    if (statusTitle) {
      statusTitle.textContent = active ? 'Listening' : 'Ready';
    }
  }

  function renderHistory() {
    if (!activityList) return;
    if (history.length === 0) {
      activityList.innerHTML = '<div class="activity-empty">Speak a command to see your history here.</div>';
      return;
    }

    activityList.innerHTML = '';
    for (const item of history.slice(0, 3)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'activity-item';
      btn.title = item.text;
      btn.innerHTML = `
        <span class="activity-left">
          <span class="act-dot"></span>
          <span class="act-text"></span>
        </span>
        <span class="act-time">${item.time}</span>
      `;
      const textEl = btn.querySelector('.act-text');
      const timeEl = btn.querySelector('.act-time');
      if (textEl) textEl.textContent = item.text;
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'copyLast', text: item.text });
        if (timeEl) {
          timeEl.textContent = 'Copied!';
          setTimeout(() => {
            timeEl.textContent = item.time;
          }, 1200);
        }
      });
      activityList.appendChild(btn);
    }
  }

  function releaseStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
  }

  function pickSupportedMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];
    for (const mime of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return '';
  }

  async function startMediaRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access (getUserMedia) is unavailable in this IDE webview.');
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    const mimeType = pickSupportedMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);

    audioChunks = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      releaseStream();
      setUiRecording(false);

      const finalMime = mediaRecorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type: finalMime });
      audioChunks = [];

      if (blob.size === 0) {
        vscode.postMessage({ type: 'error', message: 'Recorded audio was empty.' });
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const commaIdx = result.indexOf(',');
        const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : '';
        vscode.postMessage({ type: 'audioCaptured', mimeType: finalMime, base64 });
      };
      reader.onerror = () => {
        vscode.postMessage({ type: 'error', message: 'Failed to read recorded audio.' });
      };
      reader.readAsDataURL(blob);
    };

    mediaRecorder.start(200);
    setUiRecording(true);
    statusText.textContent = 'Listening... Speak now, then tap or press Alt+Space.';
    vscode.postMessage({ type: 'recordingStarted' });
  }

  function startBrowserSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      throw new Error('Browser Web Speech API is not supported in this IDE runtime. Use "gemini" provider.');
    }

    browserFinalText = '';
    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          browserFinalText += (browserFinalText ? ' ' : '') + transcript.trim();
        } else {
          interim += transcript;
        }
      }
      statusText.textContent = `${(browserFinalText + ' ' + interim).trim()}`;
    };

    recognition.onerror = (event) => {
      setUiRecording(false);
      vscode.postMessage({
        type: 'error',
        message: `Web Speech error (${event.error}). Switch agentVoice.provider to "gemini".`
      });
    };

    recognition.onend = () => {
      if (isRecording) {
        setUiRecording(false);
        vscode.postMessage({ type: 'browserTranscript', text: browserFinalText.trim() });
      }
    };

    recognition.start();
    setUiRecording(true);
    statusText.textContent = 'Listening (Browser Speech)...';
    vscode.postMessage({ type: 'recordingStarted' });
  }

  async function startRecording(provider) {
    if (isRecording) return;
    if (provider) {
      currentProvider = provider;
      providerBadge.textContent = `Connected · ${provider}`;
    }

    try {
      if (currentProvider === 'browser') {
        startBrowserSpeechRecognition();
      } else {
        await startMediaRecording();
      }
    } catch (err) {
      releaseStream();
      setUiRecording(false);
      const message = err && err.message ? err.message : String(err);
      statusText.textContent = message;
      vscode.postMessage({ type: 'error', message });
    }
  }

  function stopRecording() {
    if (!isRecording) return;

    if (currentProvider === 'browser' && recognition) {
      const text = browserFinalText.trim();
      setUiRecording(false);
      recognition.onend = null;
      recognition.stop();
      recognition = null;
      vscode.postMessage({ type: 'browserTranscript', text });
      return;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      statusText.textContent = 'Processing audio...';
      mediaRecorder.stop();
    } else {
      releaseStream();
      setUiRecording(false);
      vscode.postMessage({ type: 'recordingStopped' });
    }
  }

  micButton.addEventListener('click', () => {
    if (useNativeMode) {
      vscode.postMessage({ type: 'toggleFromWebview' });
      return;
    }
    if (isRecording) {
      stopRecording();
    } else {
      void startRecording(currentProvider);
    }
  });

  copyBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'copyLast' });
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 1200);
  });

  reinjectBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'reinjectLast' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'init': {
        if (msg.provider) {
          currentProvider = msg.provider;
          providerBadge.textContent = `Connected · ${msg.provider}`;
        }
        useNativeMode = Boolean(msg.nativeMode);
        break;
      }
      case 'nativeRecordingState': {
        setUiRecording(Boolean(msg.recording));
        if (msg.detail) {
          statusText.textContent = msg.detail;
        }
        break;
      }
      case 'startRecording': {
        void startRecording(msg.provider);
        break;
      }
      case 'stopRecording': {
        stopRecording();
        break;
      }
      case 'statusUpdate': {
        if (msg.status === 'transcribing') {
          if (statusDot) statusDot.className = 'status-dot busy';
          if (statusTitle) statusTitle.textContent = 'Transcribing';
        } else if (msg.status === 'error') {
          if (statusDot) statusDot.className = 'status-dot recording';
          if (statusTitle) statusTitle.textContent = 'Error';
        } else {
          if (statusDot) statusDot.className = 'status-dot';
          if (statusTitle) statusTitle.textContent = 'Ready';
        }
        if (msg.detail) {
          statusText.textContent = msg.detail;
        }
        if (msg.lastTranscript) {
          history.unshift({ text: msg.lastTranscript, time: 'just now' });
          renderHistory();
          if (copyBtn) copyBtn.disabled = false;
          reinjectBtn.disabled = false;
        }
        break;
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
