(function () {
  'use strict';

  if (window.__geminiSelectReaderInjected) return;
  window.__geminiSelectReaderInjected = true;

  // ---------------------------------------------------------------------------
  // Constants / persisted settings
  // ---------------------------------------------------------------------------

  const TTS_RPC_ID = 'XqA3Ic';
  const MAX_TTS_CHARS = 4096; // hard limit of the Gemini web TTS RPC
  const SPEEDS = ['0.5', '0.75', '1.0', '1.25', '1.5', '2.0'];
  const DEFAULT_LOCALE = 'en-US';

  // The web TTS RPC has no documented voice-id field. The locale changes the
  // language/voice Gemini picks, so we expose the English locales as "voices".
  const VOICES = [
    { id: 'en-US', label: 'US English' },
    { id: 'en-GB', label: 'UK English' },
    { id: 'en-AU', label: 'AU English' },
    { id: 'en-IN', label: 'IN English' }
  ];

  // Optional named voices for the official Gemini TTS API mode.
  const NAMED_VOICES = [
    'Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Aoede', 'Leda', 'Orus'
  ];

  const KEYS = {
    speed: 'gemini_tts_speed',
    voice: 'gemini_tts_voice',
    loop: 'gemini_tts_loop',
    position: 'gemini_tts_position',
    clean: 'gemini_tts_clean',
    follow: 'gemini_tts_follow',
    study: 'gemini_tts_study',
    dialogue: 'gemini_tts_dialogue',
    apiMode: 'gemini_tts_api_mode',
    apiKey: 'gemini_tts_api_key',
    apiVoice: 'gemini_tts_api_voice',
    recent: 'gemini_tts_recent'
  };

  function storageGet(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* localStorage can be blocked on some pages */
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      /* ignore */
    }
  }

  function normalizeSpeed(value) {
    return SPEEDS.includes(value) ? value : '1.0';
  }

  function normalizeLocale(value) {
    return VOICES.some((voice) => voice.id === value) ? value : DEFAULT_LOCALE;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let currentSpeed = normalizeSpeed(storageGet(KEYS.speed, '1.0'));
  let currentLocale = normalizeLocale(storageGet(KEYS.voice, DEFAULT_LOCALE));
  let loopEnabled = storageGet(KEYS.loop, '0') === '1';

  let currentSelectionText = '';
  let currentChunks = [];
  let currentChunkIndex = 0;
  let activeSelectionRect = null;
  let activeSelectionRange = null;

  let currentChunkSentences = [];
  let currentSentenceRanges = [];
  let currentChunkLocales = [];
  let studySentenceIndex = -1;
  let studyRepeatsLeft = 0;

  let activeAudio = null;
  let activeBlobUrl = null;
  let activeAudioBase64 = '';
  let fallbackUtterance = null;
  let fallbackActive = false;

  let prefetchedChunkIndex = -1;
  let prefetchedBase64 = '';

  let cleanEnabled = storageGet(KEYS.clean, '1') === '1';
  let followEnabled = storageGet(KEYS.follow, '0') === '1';
  let studyEnabled = storageGet(KEYS.study, '0') === '1';
  let dialogueEnabled = storageGet(KEYS.dialogue, '0') === '1';
  let apiModeEnabled = storageGet(KEYS.apiMode, '0') === '1';
  let apiVoice = NAMED_VOICES.includes(storageGet(KEYS.apiVoice, 'Kore'))
    ? storageGet(KEYS.apiVoice, 'Kore')
    : 'Kore';

  let abEnabled = false;
  let abStart = 0;
  let abEnd = 0;
  let sleepTimerAt = 0;
  let toolsOpen = false;
  let followOverlay = null;
  let followTextMap = null;
  let lastFollowText = '';

  let toolbarEl = null;
  let isSeeking = false;
  let isAudioSessionActive = false;
  let playToken = 0;
  let noticeTimer = null;

  const ui = {};

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function base64ToBlobUrl(base64, fallbackMime = 'audio/ogg') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Normal case is Ogg Opus (format 2). Detect MP3 as a safety net.
    const head = String.fromCharCode(bytes[0] || 0, bytes[1] || 0, bytes[2] || 0, bytes[3] || 0);
    const isMp3 = head.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    const isWav = head.startsWith('RIFF');
    const mimeType = isWav
      ? 'audio/wav'
      : (head === 'OggS' ? 'audio/ogg' : (isMp3 ? 'audio/mpeg' : fallbackMime));

    return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  }

  function splitText(text, maxChars) {
    const normalized = String(text).replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    if (normalized.length <= maxChars) return [normalized];

    const sentences = normalized.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [normalized];
    const chunks = [];
    let buffer = '';

    function flush() {
      if (buffer) {
        chunks.push(buffer);
        buffer = '';
      }
    }

    for (const rawSentence of sentences) {
      let sentence = rawSentence.trim();
      if (!sentence) continue;

      if (sentence.length > maxChars) {
        let rest = sentence;
        while (rest.length > maxChars) {
          let cut = rest.lastIndexOf(' ', maxChars);
          if (cut < Math.floor(maxChars * 0.5)) cut = maxChars;
          chunks.push(rest.slice(0, cut).trim());
          rest = rest.slice(cut).trim();
        }
        sentence = rest;
        if (!sentence) continue;
      }

      if (buffer && buffer.length + 1 + sentence.length > maxChars) flush();
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    }

    flush();
    return chunks;
  }

  function cleanTextForSpeech(text) {
    let cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/https?:\/\/\S+|www\.\S+/g, ' ');
    cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    cleaned = cleaned.replace(/\[[0-9]+\]/g, ' ');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
    cleaned = cleaned.replace(/[#>*_~]+/g, ' ');
    cleaned = cleaned.replace(/\s+([,.!?;:])/g, '$1');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned || String(text || '').replace(/\s+/g, ' ').trim();
  }

  function splitIntoSentences(normalized) {
    return normalized.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [normalized];
  }

  function splitTextWithSentences(text, maxChars) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return { chunks: [], sentencesByChunk: [] };
    if (normalized.length <= maxChars) {
      return { chunks: [normalized], sentencesByChunk: [splitIntoSentences(normalized)] };
    }

    const chunks = [];
    const sentencesByChunk = [];
    let buffer = '';
    let bufferSentences = [];

    function flush() {
      if (!buffer) return;
      chunks.push(buffer);
      sentencesByChunk.push(bufferSentences.slice());
      buffer = '';
      bufferSentences = [];
    }

    for (const rawSentence of splitIntoSentences(normalized)) {
      let sentence = rawSentence.trim();
      if (!sentence) continue;

      if (sentence.length > maxChars) {
        let rest = sentence;
        while (rest.length > maxChars) {
          let cut = rest.lastIndexOf(' ', maxChars);
          if (cut < Math.floor(maxChars * 0.5)) cut = maxChars;
          const piece = rest.slice(0, cut).trim();
          chunks.push(piece);
          sentencesByChunk.push([piece]);
          rest = rest.slice(cut).trim();
        }
        sentence = rest;
        if (!sentence) continue;
      }

      if (buffer && buffer.length + 1 + sentence.length > maxChars) flush();
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
      bufferSentences.push(sentence);
    }

    flush();
    return { chunks, sentencesByChunk };
  }

  function friendlyError(error) {
    const message = error && error.message ? error.message : String(error);
    if (/not logged|sign in|session|401|403|xsrf|consent/i.test(message)) {
      return 'Gemini session not found. Open gemini.google.com, sign in, then retry.';
    }
    if (/4096|too long/i.test(message)) {
      return 'That text was too long for one request. It has been split automatically.';
    }
    return message;
  }

  // ---------------------------------------------------------------------------
  // Power features: highlighting, cleanup, reading modes, history
  // ---------------------------------------------------------------------------

  function buildNormalizedTextMap(root) {
    if (!root || typeof document.createTreeWalker !== 'function') return null;
    const showText = 4;
    const accept = 1;
    const reject = 2;
    const walker = document.createTreeWalker(root, showText, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return reject;
        const parent = node.parentElement;
        if (!parent) return reject;
        if (parent.closest('script, style, noscript, svg, textarea, input, select')) return reject;
        if (toolbarEl && toolbarEl.contains(parent)) return reject;
        if (followOverlay && followOverlay.contains(parent)) return reject;
        return accept;
      }
    });

    let normalized = '';
    const positions = [];
    let node;
    while ((node = walker.nextNode())) {
      const raw = node.nodeValue || '';
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (/\s/.test(ch)) {
          if (normalized && !/\s$/.test(normalized)) {
            normalized += ' ';
            positions.push({ node, offset: i });
          }
        } else {
          normalized += ch;
          positions.push({ node, offset: i });
        }
      }
    }
    return { normalized, positions };
  }

  function findRangeForText(text) {
    const needle = cleanTextForSpeech(text).replace(/\s+/g, ' ').trim();
    if (!needle) return null;
    if (!followTextMap) {
      followTextMap = buildNormalizedTextMap(document.body || document.documentElement);
    }
    if (!followTextMap) return null;

    const index = followTextMap.normalized.indexOf(needle);
    if (index < 0) return null;
    const start = followTextMap.positions[index];
    const end = followTextMap.positions[index + needle.length - 1];
    if (!start || !end) return null;

    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset + 1);
      return range;
    } catch (err) {
      return null;
    }
  }

  function ensureFollowOverlay() {
    if (followOverlay || !document.body) return followOverlay;
    followOverlay = document.createElement('div');
    followOverlay.className = 'gemini-tts-follow-overlay';
    followOverlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(followOverlay);
    return followOverlay;
  }

  function clearFollowHighlight() {
    lastFollowText = '';
    if (!followOverlay) return;
    followOverlay.innerHTML = '';
    followOverlay.classList.remove('is-visible');
  }

  function renderFollowHighlight(text) {
    if (!followEnabled || !text) {
      clearFollowHighlight();
      return;
    }
    if (text === lastFollowText) return;
    lastFollowText = text;

    const overlay = ensureFollowOverlay();
    if (!overlay || typeof document.createRange !== 'function') return;

    try {
      const range = findRangeForText(text);
      overlay.innerHTML = '';
      if (!range) {
        overlay.classList.remove('is-visible');
        return;
      }
      const rects = range.getClientRects ? Array.from(range.getClientRects()) : [];
      if (!rects.length) {
        const rect = range.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) rects.push(rect);
      }
      for (const rect of rects) {
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        const box = document.createElement('div');
        box.className = 'gemini-tts-follow-rect';
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
        overlay.appendChild(box);
      }
      overlay.classList.add('is-visible');
    } catch (err) {
      overlay.classList.remove('is-visible');
    }
  }

  function readableRoot() {
    const selectors = 'article, main, [role="main"], .article, .post, .entry-content, .content';
    let candidates = [];
    try {
      candidates = Array.from(document.querySelectorAll(selectors));
    } catch (err) {
      candidates = [];
    }

    if (activeSelectionRange && activeSelectionRange.commonAncestorContainer) {
      const node = activeSelectionRange.commonAncestorContainer;
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (element) {
        const containing = candidates.find((item) => item.contains(element));
        if (containing) return containing;
      }
    }

    let best = null;
    let bestLength = 0;
    for (const item of candidates) {
      const length = (item.innerText || item.textContent || '').length;
      if (length > bestLength) {
        best = item;
        bestLength = length;
      }
    }
    return best || document.body || document.documentElement;
  }

  function textFromHere(articleOnly) {
    try {
      const selection = window.getSelection();
      let range = activeSelectionRange;
      if (selection && selection.rangeCount > 0 && String(selection).trim()) {
        range = selection.getRangeAt(0).cloneRange();
      }
      if (!range) return currentSelectionText;

      const root = articleOnly ? readableRoot() : (document.body || document.documentElement);
      const extended = range.cloneRange();
      extended.selectNodeContents(root);
      extended.setStart(range.startContainer, range.startOffset);
      extended.setEnd(root, root.childNodes.length);
      return cleanTextForSpeech(extended.toString());
    } catch (err) {
      return cleanTextForSpeech(currentSelectionText);
    }
  }

  function saveRecentRead(text) {
    if (!text) return;
    try {
      const parsed = JSON.parse(storageGet(KEYS.recent, '[]'));
      const list = Array.isArray(parsed) ? parsed : [];
      const first = text.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (list[0] && list[0].text === first) return;
      list.unshift({ text: first, at: Date.now() });
      storageSet(KEYS.recent, JSON.stringify(list.slice(0, 20)));
    } catch (err) {
      /* ignore malformed history */
    }
  }

  function downloadActiveAudio() {
    if (!activeBlobUrl || !activeAudioBase64) {
      showNotice('Play something first, then download it.');
      return;
    }
    let ext = 'ogg';
    try {
      const head = atob(activeAudioBase64.slice(0, 12));
      if (head.startsWith('RIFF')) ext = 'wav';
    } catch (err) {
      /* keep ogg default */
    }
    const name =
      currentSelectionText
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/gi, '')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'gemini-voice';
    const anchor = document.createElement('a');
    anchor.href = activeBlobUrl;
    anchor.download = `${name}.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    showNotice('Audio downloaded.', 2500);
  }

  function buildSentenceRanges() {
    if (!activeAudio || !Number.isFinite(activeAudio.duration)) return;
    if (!currentChunkSentences.length) return;
    const total =
      currentChunkSentences.reduce((sum, sentence) => sum + sentence.length, 0) || 1;
    let cursor = 0;
    currentSentenceRanges = currentChunkSentences.map((sentence) => {
      const end = cursor + (sentence.length / total) * activeAudio.duration;
      const item = { start: cursor, end, text: sentence };
      cursor = end;
      return item;
    });
  }

  function sentenceIndexAt(time) {
    if (!currentSentenceRanges.length) return -1;
    for (let i = 0; i < currentSentenceRanges.length; i++) {
      if (time >= currentSentenceRanges[i].start && time < currentSentenceRanges[i].end) return i;
    }
    return currentSentenceRanges.length - 1;
  }

  function checkTimedModes() {
    if (!activeAudio || !Number.isFinite(activeAudio.duration)) return;
    const time = activeAudio.currentTime;

    if (sleepTimerAt && Date.now() >= sleepTimerAt) {
      sleepTimerAt = 0;
      showNotice('Sleep timer finished.');
      finishPlayback();
      return;
    }

    if (abEnabled && abEnd > abStart && time >= abEnd) {
      activeAudio.currentTime = abStart;
      updateTimeUI();
      return;
    }

    if (studyEnabled && currentSentenceRanges.length) {
      const index = sentenceIndexAt(time);
      if (index >= 0) {
        if (index !== studySentenceIndex) {
          studySentenceIndex = index;
          studyRepeatsLeft = 2;
        }
        const range = currentSentenceRanges[index];
        if (time >= range.end - 0.05 && studyRepeatsLeft > 0) {
          studyRepeatsLeft--;
          activeAudio.currentTime = range.start;
          updateTimeUI();
          return;
        }
      }
    }

    if (followEnabled) {
      const index = sentenceIndexAt(time);
      const text = index >= 0
        ? currentSentenceRanges[index].text
        : (currentChunks[currentChunkIndex] || '');
      renderFollowHighlight(text);
    }
  }

  // ---------------------------------------------------------------------------
  // Gemini web TTS protocol
  // ---------------------------------------------------------------------------

  let localTokensCache = null;
  let localTokensCachedAt = 0;

  function extractLocalGeminiTokens() {
    const host = window.location.hostname;
    const onGemini = host === 'gemini.google.com' || host.endsWith('.gemini.google.com');
    if (!onGemini) return null;
    if (localTokensCache && Date.now() - localTokensCachedAt < 5 * 60 * 1000) {
      return localTokensCache;
    }

    const html = document.documentElement ? document.documentElement.innerHTML : '';
    if (!html) return null;

    const atMatch = html.match(/SNlM0e\\?":\\?"([^"\\]+)/);
    const blMatch =
      html.match(/cfb2h\\?":\\?"([^"\\]+)/) ||
      html.match(/boq_assistant-bard-web-server_[A-Za-z0-9_.-]+/);
    const fsidMatch = html.match(/FdrFJe\\?":\\?"([\d-]+)/);

    if (!atMatch || !blMatch) return null;

    localTokensCache = {
      atValue: atMatch[1],
      blValue: blMatch[1] || blMatch[0],
      fSid: fsidMatch ? fsidMatch[1] : '',
      locale: document.documentElement.lang || navigator.language || DEFAULT_LOCALE
    };
    localTokensCachedAt = Date.now();
    return localTokensCache;
  }

  async function fetchDirectGeminiTts(text, tokens, locale) {
    const trimmed = String(text).trim();
    if (!trimmed) throw new Error('No text to read');
    if (trimmed.length > MAX_TTS_CHARS) {
      throw new Error(`Text exceeds the ${MAX_TTS_CHARS}-character Gemini TTS limit`);
    }

    const targetLocale = locale || tokens.locale || DEFAULT_LOCALE;
    const hl = tokens.locale || 'en';
    const endpoint =
      `https://gemini.google.com/_/BardChatUi/data/batchexecute` +
      `?rpcids=${TTS_RPC_ID}&source-path=%2Fapp` +
      `&bl=${encodeURIComponent(tokens.blValue)}` +
      `&f.sid=${encodeURIComponent(tokens.fSid)}` +
      `&hl=${encodeURIComponent(hl)}` +
      `&_reqid=${Date.now() % 1000000}&rt=c`;

    // [null, text, language, unknown, 2]
    // Slot 4: 1 = 24 kHz mono MP3, 2 = Ogg Opus (what the Gemini page uses).
    const requestMessage = [null, trimmed, targetLocale, null, 2];
    const rpcPayload = [[[TTS_RPC_ID, JSON.stringify(requestMessage), null, 'generic']]];

    const body = new URLSearchParams({
      'f.req': JSON.stringify(rpcPayload),
      at: tokens.atValue
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Same-Domain': '1'
      },
      body: body.toString()
    });

    if (!response.ok) throw new Error(`Gemini TTS returned HTTP ${response.status}`);

    const responseText = await response.text();
    if (/^\s*<!DOCTYPE html>/i.test(responseText)) {
      throw new Error('Gemini session expired. Sign in again at gemini.google.com.');
    }

    const cleaned = responseText.replace(/^\)\]\}'\s*/, '');
    let rows = null;
    for (const line of cleaned.split('\n')) {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith('[[')) continue;
      try {
        const parsed = JSON.parse(trimmedLine);
        if (Array.isArray(parsed)) {
          rows = parsed;
          break;
        }
      } catch (err) {
        /* keep looking */
      }
    }

    if (!rows) throw new Error('Gemini TTS response did not contain a batch payload');

    const ttsRow = rows.find((row) => row && row[0] === 'wrb.fr' && row[1] === TTS_RPC_ID);
    if (!ttsRow || typeof ttsRow[2] !== 'string') {
      throw new Error('Gemini TTS audio data not found in response');
    }

    const payload = JSON.parse(ttsRow[2]);
    const audioBase64 = payload && payload[0];
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      throw new Error('Gemini TTS returned empty audio data');
    }

    return audioBase64;
  }

  function requestGeminiTtsBackground(text, localeOverride) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Gemini TTS request timed out'));
      }, 45000);

      function finish(callback, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      }

      try {
        chrome.runtime.sendMessage(
          { action: 'GEMINI_TTS', text, locale: localeOverride || currentLocale },
          (response) => {
            if (chrome.runtime.lastError) {
              finish(reject, new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response || !response.success) {
              finish(reject, new Error((response && response.error) || 'Gemini TTS failed'));
              return;
            }
            finish(resolve, response.audioBase64);
          }
        );
      } catch (err) {
        finish(reject, new Error('Extension was reloaded. Refresh this page and retry.'));
      }
    });
  }

  async function fetchOfficialApiTts(text, voiceName) {
    const key = storageGet(KEYS.apiKey, '');
    if (!key) throw new Error('Add a Gemini API key in the Tools menu, or turn off API mode.');
    if (text.length > 8000) throw new Error('This chunk exceeds the official API input limit.');

    const body = {
      model: 'gemini-3.8-flash-tts',
      input: [{
        type: 'user_input',
        content: [{
          type: 'text',
          text,
          annotations: [{ type: 'speech_metadata', style: 'clear, natural reading' }]
        }]
      }],
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [{ voice: voiceName || apiVoice }]
      }
    };

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`Gemini API returned HTTP ${response.status}`);
    const data = await response.json();
    const parts = [];
    for (const step of data.steps || []) {
      for (const part of step.content || []) parts.push(part);
    }
    const audioPart = parts.find((part) => part && part.type === 'audio' && part.data);
    if (!audioPart) throw new Error('Gemini API did not return audio data.');
    return audioPart.data;
  }

  async function getGeminiAudioBase64(text, localeOverride) {
    if (apiModeEnabled) {
      return fetchOfficialApiTts(text, apiVoice);
    }

    const locale = localeOverride || currentLocale;
    const localTokens = extractLocalGeminiTokens();
    if (localTokens) {
      try {
        return await fetchDirectGeminiTts(text, localTokens, locale);
      } catch (err) {
        if (err && /401|403|session|expired|sign in/i.test(err.message || '')) {
          localTokensCache = null;
          localTokensCachedAt = 0;
        }
        console.warn('[Gemini Voice Reader] Direct Gemini call failed, using background:', err);
      }
    }
    return requestGeminiTtsBackground(text, locale);
  }

  // Allow the background worker to relay a request through an open Gemini tab
  // (useful when Brave/Chrome will not send the Gemini cookies to the worker).
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.action !== 'GEMINI_TTS_IN_PAGE') return;
      (async () => {
        const tokens = extractLocalGeminiTokens();
        if (!tokens) {
          throw new Error('This Gemini tab has no session tokens. Refresh the Gemini tab.');
        }
        const audioBase64 = await fetchDirectGeminiTts(message.text, tokens, message.locale);
        sendResponse({ success: true, audioBase64 });
      })().catch((err) => {
        sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
      });
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Audio lifecycle
  // ---------------------------------------------------------------------------

  function clearActiveAudio() {
    const audio = activeAudio;
    activeAudio = null;
    activeAudioBase64 = '';

    if (audio) {
      try {
        audio.pause();
      } catch (err) {
        /* ignore */
      }
      audio.removeAttribute('src');
      try {
        audio.load();
      } catch (err) {
        /* ignore */
      }
    }

    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = null;
    }
  }

  function cancelFallback() {
    const utterance = fallbackUtterance;
    fallbackUtterance = null;
    fallbackActive = false;
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
    }
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (err) {
        /* ignore */
      }
    }
  }

  function cancelPlayback() {
    playToken++;
    clearActiveAudio();
    cancelFallback();
    isSeeking = false;
  }

  function setActiveAudio(base64) {
    clearActiveAudio();

    activeBlobUrl = base64ToBlobUrl(base64);
    activeAudioBase64 = base64;
    const audio = new Audio(activeBlobUrl);
    audio.preload = 'auto';
    audio.playbackRate = parseFloat(currentSpeed);
    audio.preservesPitch = true;
    audio.loop = loopEnabled;

    audio.addEventListener('loadedmetadata', () => {
      buildSentenceRanges();
      updateTimeUI();
    });
    audio.addEventListener('durationchange', () => {
      buildSentenceRanges();
      updateTimeUI();
    });
    audio.addEventListener('timeupdate', () => {
      updateTimeUI();
      checkTimedModes();
    });
    audio.addEventListener('ended', () => {
      if (audio !== activeAudio) return;
      if (loopEnabled) return;
      advanceChunk();
    });
    audio.addEventListener('error', () => {
      if (audio !== activeAudio) return;
      const text = currentChunks[currentChunkIndex] || currentSelectionText;
      console.warn('[Gemini Voice Reader] Audio element failed, using Web Speech fallback');
      clearActiveAudio();
      playFallbackSpeech(text);
    });

    activeAudio = audio;
  }

  function prefetchNextChunk(index, token) {
    const next = index + 1;
    if (next >= currentChunks.length || prefetchedChunkIndex === next) return;
    const locale = currentChunkLocales[next] || currentLocale;
    getGeminiAudioBase64(currentChunks[next], locale)
      .then((base64) => {
        if (token !== playToken) return;
        prefetchedChunkIndex = next;
        prefetchedBase64 = base64;
      })
      .catch(() => {
        /* prefetch is best effort */
      });
  }

  async function playChunkAt(index) {
    if (!currentChunks.length) return;
    if (index >= currentChunks.length) {
      finishPlayback();
      return;
    }

    currentChunkIndex = index;
    const token = ++playToken;
    const text = currentChunks[index];
    const locale = currentChunkLocales[index] || currentLocale;
    isAudioSessionActive = true;
    updatePlayerUI('loading');

    try {
      let base64;
      if (prefetchedChunkIndex === index && prefetchedBase64) {
        base64 = prefetchedBase64;
        prefetchedChunkIndex = -1;
        prefetchedBase64 = '';
      } else {
        base64 = await getGeminiAudioBase64(text, locale);
      }
      if (token !== playToken) return;

      setActiveAudio(base64);
      currentSentenceRanges = [];
      studySentenceIndex = -1;
      studyRepeatsLeft = 0;
      updateTimeUI();
      try {
        await activeAudio.play();
      } catch (err) {
        if (token !== playToken) return;
        if (err && err.name === 'NotAllowedError') {
          updatePlayerUI('paused');
          showNotice('Playback was blocked by the browser. Click Resume.');
          return;
        }
        throw err;
      }
      if (token !== playToken) return;

      updatePlayerUI('playing');
      updateTimeUI();
      prefetchNextChunk(index, token);
    } catch (err) {
      if (token !== playToken) return;
      console.warn('[Gemini Voice Reader] Gemini TTS failed, using Web Speech:', err);
      showNotice(friendlyError(err));
      playFallbackSpeech(text);
    }
  }

  function startPlayback(text) {
    if (!text) return;
    const plain = String(text).replace(/\s+/g, ' ').trim();
    const cleaned = cleanEnabled ? cleanTextForSpeech(plain) : plain;
    if (!cleaned) return;

    currentSelectionText = cleaned;
    const split = splitTextWithSentences(cleaned, MAX_TTS_CHARS);
    currentChunks = split.chunks;
    currentChunkSentences = split.sentencesByChunk;
    currentChunkLocales = dialogueEnabled
      ? currentChunks.map((chunk, index) => (index % 2 === 0 ? VOICES[0].id : VOICES[1].id))
      : [];
    currentChunkIndex = 0;
    isAudioSessionActive = true;
    followTextMap = null;
    lastFollowText = '';
    saveRecentRead(cleaned);

    if (cleanEnabled && cleaned !== plain) {
      showNotice('Text cleaned for speech.', 3000);
    } else if (dialogueEnabled) {
      showNotice('Dialogue mode on. Accents alternate by sentence.', 4000);
    } else if (currentChunks.length > 1) {
      showNotice(`Long selection split into ${currentChunks.length} parts.`, 5000);
    }

    playChunkAt(0);
  }

  function advanceChunk() {
    if (loopEnabled) return;
    if (currentChunkIndex + 1 < currentChunks.length) {
      playChunkAt(currentChunkIndex + 1);
    } else {
      finishPlayback();
    }
  }

  // Playback reached the end. Keep the player visible (and keep the selection
  // text ready for replay); it is dismissed only by the X button or by clicking
  // outside after the page selection is gone.
  function finishPlayback() {
    cancelPlayback();
    isAudioSessionActive = false;
    currentChunks = [];
    currentChunkIndex = 0;
    currentChunkSentences = [];
    currentSentenceRanges = [];
    currentChunkLocales = [];
    studySentenceIndex = -1;
    studyRepeatsLeft = 0;
    prefetchedChunkIndex = -1;
    prefetchedBase64 = '';
    sleepTimerAt = 0;
    clearFollowHighlight();
    updatePlayerUI('idle');
    updateToolsUI();
    showNotice('Finished. Click Listen to replay, or click outside to close.', 4000);
  }

  function playFallbackSpeech(text) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      showNotice('Gemini TTS failed and this browser has no fallback voice.');
      updatePlayerUI('idle');
      return;
    }

    cancelFallback();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = clamp(parseFloat(currentSpeed) || 1, 0.1, 2);
    fallbackUtterance = utterance;
    fallbackActive = true;

    utterance.onend = () => {
      if (fallbackUtterance !== utterance) return;
      fallbackUtterance = null;
      fallbackActive = false;
      if (loopEnabled) {
        playFallbackSpeech(text);
      } else {
        advanceChunk();
      }
    };

    utterance.onerror = (event) => {
      if (fallbackUtterance !== utterance) return;
      fallbackUtterance = null;
      fallbackActive = false;
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      showNotice(`Speech playback failed: ${event.error || 'unknown error'}`);
      handleStop();
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      showNotice('The fallback voice could not start.');
      handleStop();
      return;
    }

    updatePlayerUI('playing');
    updateTimeUI();
  }

  function handlePlayPause() {
    if (!toolbarEl) return;

    if (ui.mainBtn && ui.mainBtn.classList.contains('is-loading')) {
      cancelPlayback();
      updatePlayerUI('idle');
      return;
    }

    if (activeAudio) {
      if (activeAudio.paused) {
        activeAudio.play().then(() => {
          if (activeAudio && !activeAudio.paused) updatePlayerUI('playing');
        }).catch((err) => {
          console.warn('[Gemini Voice Reader] Resume failed:', err);
          showNotice('Could not resume playback.');
        });
      } else {
        activeAudio.pause();
        updatePlayerUI('paused');
      }
      return;
    }

    if (fallbackActive) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        updatePlayerUI('playing');
      } else {
        window.speechSynthesis.pause();
        updatePlayerUI('paused');
      }
      return;
    }

    if (currentSelectionText) {
      startPlayback(currentSelectionText);
    }
  }

  function handleStop() {
    cancelPlayback();
    isAudioSessionActive = false;
    currentChunks = [];
    currentChunkIndex = 0;
    currentChunkSentences = [];
    currentSentenceRanges = [];
    currentChunkLocales = [];
    currentSelectionText = '';
    sleepTimerAt = 0;
    abEnabled = false;
    clearFollowHighlight();
    updatePlayerUI('idle');
    updateToolsUI();
    hideToolbar(true);
  }

  function handleSeekRelative(deltaSeconds) {
    if (!activeAudio || !Number.isFinite(activeAudio.duration)) return;
    activeAudio.currentTime = clamp(activeAudio.currentTime + deltaSeconds, 0, activeAudio.duration);
    updateTimeUI();
  }

  function setSpeed(speed) {
    currentSpeed = normalizeSpeed(speed);
    storageSet(KEYS.speed, currentSpeed);

    if (activeAudio) {
      activeAudio.playbackRate = parseFloat(currentSpeed);
    }

    if (ui.speedPills) {
      ui.speedPills.forEach((pill) => {
        pill.classList.toggle('active', pill.dataset.speed === currentSpeed);
      });
    }
  }

  function changeVoice(locale) {
    const nextLocale = normalizeLocale(locale);
    const changed = nextLocale !== currentLocale;
    currentLocale = nextLocale;
    storageSet(KEYS.voice, currentLocale);
    if (ui.voiceSelect) ui.voiceSelect.value = currentLocale;

    if (!changed) return;

    if (isAudioSessionActive && currentChunks.length) {
      const resumeIndex = currentChunkIndex;
      cancelPlayback();
      isAudioSessionActive = true;
      showNotice('Generating the same text with the new voice…', 4000);
      playChunkAt(resumeIndex);
    } else {
      const label = VOICES.find((voice) => voice.id === currentLocale);
      showNotice(`Voice set to ${label ? label.label : currentLocale}.`, 2500);
    }
  }

  function toggleLoop() {
    loopEnabled = !loopEnabled;
    storageSet(KEYS.loop, loopEnabled ? '1' : '0');

    if (activeAudio) activeAudio.loop = loopEnabled;

    updateLoopUI();

    if (loopEnabled && activeAudio && activeAudio.ended) {
      activeAudio.currentTime = 0;
      activeAudio.play().catch(() => {});
    }
  }

  function updateLoopUI() {
    if (!ui.loopBtn) return;
    ui.loopBtn.classList.toggle('is-looping', loopEnabled);
    ui.loopBtn.setAttribute('aria-pressed', loopEnabled ? 'true' : 'false');
    ui.loopBtn.title = loopEnabled
      ? 'Loop is ON (click to turn off) · select a word to loop that word'
      : 'Loop selected text · select a word to loop that word';
  }

  function toggleFollow() {
    followEnabled = !followEnabled;
    storageSet(KEYS.follow, followEnabled ? '1' : '0');
    if (!followEnabled) clearFollowHighlight();
    else followTextMap = null;
    updateToolsUI();
    showNotice(followEnabled ? 'Follow along is on.' : 'Follow along is off.', 2500);
  }

  function toggleClean() {
    cleanEnabled = !cleanEnabled;
    storageSet(KEYS.clean, cleanEnabled ? '1' : '0');
    updateToolsUI();
    showNotice(cleanEnabled ? 'Text cleanup is on.' : 'Text cleanup is off.', 2500);
  }

  function toggleStudy() {
    studyEnabled = !studyEnabled;
    storageSet(KEYS.study, studyEnabled ? '1' : '0');
    studySentenceIndex = -1;
    studyRepeatsLeft = 0;
    updateToolsUI();
    showNotice(studyEnabled ? 'Study mode repeats each sentence twice.' : 'Study mode is off.', 3000);
  }

  function toggleDialogue() {
    dialogueEnabled = !dialogueEnabled;
    storageSet(KEYS.dialogue, dialogueEnabled ? '1' : '0');
    updateToolsUI();
    showNotice(dialogueEnabled ? 'Dialogue mode on. Applies on next play.' : 'Dialogue mode is off.', 3000);
  }

  function toggleApiMode() {
    apiModeEnabled = !apiModeEnabled;
    storageSet(KEYS.apiMode, apiModeEnabled ? '1' : '0');
    updateToolsUI();
    if (apiModeEnabled && !storageGet(KEYS.apiKey, '')) {
      showNotice('Add your Gemini API key in Tools, or turn API mode off.', 6000);
    } else {
      showNotice(apiModeEnabled ? 'Official API mode is on.' : 'Using Gemini web voice.', 2500);
    }
  }

  function toggleAB() {
    if (!activeAudio || !Number.isFinite(activeAudio.duration)) {
      showNotice('Play audio first, then set an A to B loop.', 3500);
      return;
    }
    abEnabled = !abEnabled;
    if (abEnabled) {
      abStart = clamp(activeAudio.currentTime, 0, Math.max(0, activeAudio.duration - 0.5));
      abEnd = Math.min(activeAudio.duration, abStart + 5);
      showNotice('A to B markers ready. Drag them on the timeline.', 4000);
    } else {
      showNotice('A to B loop is off.', 2500);
    }
    updateABMarkers();
    updateToolsUI();
  }

  function setSleepTimer(minutes) {
    sleepTimerAt = Date.now() + minutes * 60 * 1000;
    updateToolsUI();
    showNotice(`Sleep timer set for ${minutes} minutes.`, 3500);
  }

  function playFromHere(articleOnly) {
    const text = textFromHere(articleOnly);
    if (!text) {
      showNotice('No text found after this selection.', 3000);
      return;
    }
    if (toolbarEl) toolbarEl.classList.remove('is-hidden');
    startPlayback(text);
  }

  function toggleTools() {
    toolsOpen = !toolsOpen;
    updateToolsUI();
  }

  function renderRecentList() {
    if (!ui.recentList) return;
    ui.recentList.innerHTML = '';
    let list = [];
    try {
      const parsed = JSON.parse(storageGet(KEYS.recent, '[]'));
      if (Array.isArray(parsed)) list = parsed.slice(0, 5);
    } catch (err) {
      list = [];
    }
    if (!list.length) {
      const empty = document.createElement('span');
      empty.className = 'gemini-tts-recent-empty';
      empty.textContent = 'No recent clips yet';
      ui.recentList.appendChild(empty);
      return;
    }
    for (const item of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gemini-tts-recent-item';
      button.title = item.text;
      button.textContent = item.text.slice(0, 42);
      button.addEventListener('click', () => startPlayback(item.text));
      ui.recentList.appendChild(button);
    }
  }

  function updateABMarkers() {
    if (!ui.markerA || !ui.markerB) return;
    const duration = activeAudio && Number.isFinite(activeAudio.duration) ? activeAudio.duration : 0;
    ui.markerA.style.display = abEnabled ? 'block' : 'none';
    ui.markerB.style.display = abEnabled ? 'block' : 'none';
    if (duration > 0) {
      ui.markerA.style.left = `${clamp((abStart / duration) * 100, 0, 100)}%`;
      ui.markerB.style.left = `${clamp((abEnd / duration) * 100, 0, 100)}%`;
    }
  }

  function updateToolsUI() {
    if (!ui.toolsPanel) return;
    ui.toolsPanel.classList.toggle('is-open', toolsOpen);
    if (ui.toolsBtn) ui.toolsBtn.setAttribute('aria-expanded', toolsOpen ? 'true' : 'false');

    const states = {
      follow: followEnabled,
      clean: cleanEnabled,
      study: studyEnabled,
      dialogue: dialogueEnabled,
      api: apiModeEnabled
    };
    for (const key of Object.keys(states)) {
      const button = ui.toolButtons && ui.toolButtons[key];
      if (button) button.classList.toggle('is-on', states[key]);
    }
    if (ui.abBtn) ui.abBtn.classList.toggle('is-on', abEnabled);
    if (ui.apiFields) ui.apiFields.style.display = apiModeEnabled ? 'block' : 'none';
    if (ui.sleepLabel) {
      ui.sleepLabel.textContent = sleepTimerAt
        ? `Sleep ${formatTime(Math.max(0, Math.ceil((sleepTimerAt - Date.now()) / 1000)))}`
        : 'Sleep';
    }
    renderRecentList();
    updateABMarkers();
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  function showNotice(message, timeout = 7000) {
    if (!ui.status) return;
    ui.status.textContent = message;
    ui.status.classList.add('is-visible');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      if (ui.status) ui.status.classList.remove('is-visible');
    }, timeout);
  }

  function updateTimeUI() {
    if (!ui.time || !ui.slider) return;

    if (!activeAudio) {
      if (fallbackActive) {
        ui.time.textContent = 'Fallback voice';
        ui.slider.disabled = true;
      }
      return;
    }

    const duration = Number.isFinite(activeAudio.duration) ? activeAudio.duration : 0;
    if (duration > 0) {
      ui.slider.max = String(duration);
      ui.slider.disabled = false;
    }

    if (!isSeeking) {
      ui.slider.value = String(activeAudio.currentTime);
    }
    paintSlider();

    const prefix = currentChunks.length > 1 ? `${currentChunkIndex + 1}/${currentChunks.length} · ` : '';
    ui.time.textContent = `${prefix}${formatTime(activeAudio.currentTime)} / ${formatTime(duration)}`;
    ui.time.title = `${formatTime(activeAudio.currentTime)} of ${formatTime(duration)}`;
    ui.slider.setAttribute(
      'aria-valuetext',
      `${formatTime(activeAudio.currentTime)} of ${formatTime(duration)}`
    );
    updateABMarkers();
    if (ui.sleepLabel && sleepTimerAt) {
      ui.sleepLabel.textContent = `Sleep ${formatTime(Math.max(0, Math.ceil((sleepTimerAt - Date.now()) / 1000)))}`;
    }
  }

  function paintSlider() {
    if (!ui.slider) return;
    const max = parseFloat(ui.slider.max) || 0;
    const value = parseFloat(ui.slider.value) || 0;
    const percent = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
    ui.slider.style.setProperty('--gemini-tts-progress', `${percent}%`);
  }

  function updatePlayerUI(state) {
    if (!toolbarEl || !ui.mainBtn) return;

    ui.mainBtn.classList.remove('is-loading', 'is-paused');

    if (state === 'loading') {
      ui.mainBtn.classList.add('is-loading');
      ui.mainBtn.innerHTML = '<span class="gemini-tts-spinner"></span><span>Loading...</span>';
      ui.mainBtn.setAttribute('aria-label', 'Cancel loading');
      ui.playerControls.style.display = 'flex';
      ui.slider.value = '0';
      ui.slider.max = '0';
      ui.slider.disabled = true;
      paintSlider();
      ui.time.textContent = 'Loading…';
    } else if (state === 'playing') {
      ui.mainBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg><span>Pause</span>';
      ui.mainBtn.setAttribute('aria-label', 'Pause');
      ui.playerControls.style.display = 'flex';
      ui.slider.disabled = !activeAudio;
      updateTimeUI();
    } else if (state === 'paused') {
      ui.mainBtn.classList.add('is-paused');
      ui.mainBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M8 5v14l11-7z"/></svg><span>Resume</span>';
      ui.mainBtn.setAttribute('aria-label', 'Resume');
      ui.playerControls.style.display = 'flex';
      ui.slider.disabled = !activeAudio;
      updateTimeUI();
    } else {
      ui.mainBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>' +
        '<span>Listen</span>';
      ui.mainBtn.setAttribute('aria-label', 'Listen to selected text');
      ui.playerControls.style.display = 'none';
      ui.slider.value = '0';
      ui.slider.max = '0';
      ui.slider.disabled = true;
      paintSlider();
      ui.time.textContent = '0:00 / 0:00';
    }

    keepOnScreen();
  }

  function keepOnScreen() {
    if (!toolbarEl || toolbarEl.classList.contains('is-hidden')) return;
    const rect = toolbarEl.getBoundingClientRect();
    placeAt(rect.left, rect.top);
  }

  function svgIcon(path) {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">${path}</svg>`;
  }

  function createButton(className, title, html) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = title;
    if (html) button.innerHTML = html;
    return button;
  }

  function createToolbar() {
    toolbarEl = document.createElement('div');
    toolbarEl.className = 'gemini-tts-toolbar is-hidden';
    toolbarEl.setAttribute('role', 'toolbar');
    toolbarEl.setAttribute('aria-label', 'Gemini voice reader');

    // Stop page handlers from clearing the selection / closing menus.
    toolbarEl.addEventListener('mousedown', (event) => event.stopPropagation());
    toolbarEl.addEventListener('mouseup', (event) => event.stopPropagation());
    toolbarEl.addEventListener('click', (event) => event.stopPropagation());

    const mainRow = document.createElement('div');
    mainRow.className = 'gemini-tts-row gemini-tts-row-main';

    // Drag handle
    ui.dragHandle = document.createElement('div');
    ui.dragHandle.className = 'gemini-tts-drag-handle';
    ui.dragHandle.title = 'Drag to move · double-click to reset position';
    ui.dragHandle.setAttribute('aria-hidden', 'true');
    ui.dragHandle.textContent = '⋮⋮';
    mainRow.appendChild(ui.dragHandle);
    wireDrag();

    // Main Listen / Pause / Resume button
    ui.mainBtn = createButton('gemini-tts-btn-main', 'Listen to selected text', '');
    ui.mainBtn.addEventListener('click', handlePlayPause);
    mainRow.appendChild(ui.mainBtn);

    // Player controls (hidden until there is audio)
    ui.playerControls = document.createElement('div');
    ui.playerControls.className = 'gemini-tts-player-controls';
    ui.playerControls.style.display = 'none';

    const btnBack = createButton(
      'gemini-tts-btn-icon',
      'Rewind 5 seconds',
      svgIcon('<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>')
    );
    btnBack.addEventListener('click', () => handleSeekRelative(-5));
    ui.playerControls.appendChild(btnBack);

    const btnForward = createButton(
      'gemini-tts-btn-icon',
      'Forward 5 seconds',
      svgIcon('<path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>')
    );
    btnForward.addEventListener('click', () => handleSeekRelative(5));
    ui.playerControls.appendChild(btnForward);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'gemini-tts-progress-wrap';

    ui.slider = document.createElement('input');
    ui.slider.type = 'range';
    ui.slider.className = 'gemini-tts-slider';
    ui.slider.min = '0';
    ui.slider.max = '0';
    ui.slider.step = '0.05';
    ui.slider.value = '0';
    ui.slider.disabled = true;
    ui.slider.setAttribute('aria-label', 'Audio position in seconds');

    ui.slider.addEventListener('pointerdown', () => {
      isSeeking = true;
    });
    const endSeeking = () => {
      isSeeking = false;
      updateTimeUI();
    };
    ui.slider.addEventListener('pointerup', endSeeking);
    ui.slider.addEventListener('pointercancel', endSeeking);
    ui.slider.addEventListener('change', endSeeking);
    ui.slider.addEventListener('input', () => {
      if (!activeAudio) return;
      const value = parseFloat(ui.slider.value);
      if (Number.isFinite(value)) activeAudio.currentTime = value;
      paintSlider();
      updateTimeUI();
    });

    progressWrap.appendChild(ui.slider);

    ui.markerA = document.createElement('div');
    ui.markerA.className = 'gemini-tts-ab-marker gemini-tts-ab-marker-a';
    ui.markerA.textContent = 'A';
    ui.markerA.title = 'Drag to set the loop start';
    ui.markerA.style.display = 'none';

    ui.markerB = document.createElement('div');
    ui.markerB.className = 'gemini-tts-ab-marker gemini-tts-ab-marker-b';
    ui.markerB.textContent = 'B';
    ui.markerB.title = 'Drag to set the loop end';
    ui.markerB.style.display = 'none';

    function wireMarker(marker, isStart) {
      let dragging = false;
      function move(event) {
        if (!dragging || !activeAudio || !Number.isFinite(activeAudio.duration)) return;
        const rect = progressWrap.getBoundingClientRect();
        if (!rect.width) return;
        const seconds = clamp(((event.clientX - rect.left) / rect.width) * activeAudio.duration, 0, activeAudio.duration);
        if (isStart) abStart = Math.min(seconds, Math.max(0, abEnd - 0.25));
        else abEnd = Math.max(seconds, Math.min(activeAudio.duration, abStart + 0.25));
        updateABMarkers();
      }
      function stop(event) {
        if (!dragging) return;
        dragging = false;
        try { marker.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }
        marker.removeEventListener('pointermove', move);
        marker.removeEventListener('pointerup', stop);
        marker.removeEventListener('pointercancel', stop);
      }
      marker.addEventListener('pointerdown', (event) => {
        if (!abEnabled) return;
        event.preventDefault();
        event.stopPropagation();
        dragging = true;
        try { marker.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
        marker.addEventListener('pointermove', move);
        marker.addEventListener('pointerup', stop);
        marker.addEventListener('pointercancel', stop);
      });
    }

    wireMarker(ui.markerA, true);
    wireMarker(ui.markerB, false);
    progressWrap.appendChild(ui.markerA);
    progressWrap.appendChild(ui.markerB);
    ui.playerControls.appendChild(progressWrap);

    ui.time = document.createElement('span');
    ui.time.className = 'gemini-tts-time';
    ui.time.textContent = '0:00 / 0:00';
    ui.playerControls.appendChild(ui.time);

    ui.loopBtn = createButton(
      'gemini-tts-btn-icon gemini-tts-loop-btn',
      'Loop the selected clip',
      svgIcon('<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>')
    );
    ui.loopBtn.setAttribute('aria-pressed', 'false');
    ui.loopBtn.addEventListener('click', toggleLoop);
    ui.playerControls.appendChild(ui.loopBtn);

    ui.abBtn = createButton('gemini-tts-btn-icon gemini-tts-ab-btn', 'A to B loop with timeline markers', 'AB');
    ui.abBtn.addEventListener('click', toggleAB);
    ui.playerControls.appendChild(ui.abBtn);

    ui.downloadBtn = createButton(
      'gemini-tts-btn-icon gemini-tts-download-btn',
      'Download current audio',
      svgIcon('<path d="M5 20h14v-2H5v2zm7-16v10l4-4 1.41 1.41L12 17.83 6.59 11.41 8 10l4 4V4h0z"/>')
    );
    ui.downloadBtn.addEventListener('click', downloadActiveAudio);
    ui.playerControls.appendChild(ui.downloadBtn);

    const btnStop = createButton(
      'gemini-tts-btn-icon btn-stop',
      'Stop and close',
      svgIcon('<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>')
    );
    btnStop.addEventListener('click', handleStop);
    ui.playerControls.appendChild(btnStop);

    mainRow.appendChild(ui.playerControls);
    toolbarEl.appendChild(mainRow);

    // Voice + speed row
    const optionsRow = document.createElement('div');
    optionsRow.className = 'gemini-tts-row gemini-tts-row-options';

    ui.voiceSelect = document.createElement('select');
    ui.voiceSelect.className = 'gemini-tts-voice-select';
    ui.voiceSelect.title = 'Voice accent. Gemini chooses the exact voice for each locale.';
    ui.voiceSelect.setAttribute('aria-label', 'Voice accent');
    VOICES.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = voice.label;
      ui.voiceSelect.appendChild(option);
    });
    ui.voiceSelect.value = currentLocale;
    ui.voiceSelect.addEventListener('change', () => changeVoice(ui.voiceSelect.value));
    optionsRow.appendChild(ui.voiceSelect);

    const speedsContainer = document.createElement('div');
    speedsContainer.className = 'gemini-tts-speeds';
    ui.speedPills = [];
    SPEEDS.forEach((speed) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `gemini-tts-speed-pill${speed === currentSpeed ? ' active' : ''}`;
      pill.dataset.speed = speed;
      pill.textContent = `${speed}x`;
      pill.addEventListener('click', () => setSpeed(speed));
      speedsContainer.appendChild(pill);
      ui.speedPills.push(pill);
    });
    optionsRow.appendChild(speedsContainer);

    ui.toolsBtn = createButton(
      'gemini-tts-btn-icon gemini-tts-tools-btn',
      'More tools',
      svgIcon('<path d="M3 17v2h6v-2H3zm3.5-9v2H21v-2H6.5zM3 7v2h6V7H3zm13.5 9v2H21v-2h-4.5z"/>')
    );
    ui.toolsBtn.setAttribute('aria-expanded', 'false');
    ui.toolsBtn.addEventListener('click', toggleTools);
    optionsRow.appendChild(ui.toolsBtn);
    toolbarEl.appendChild(optionsRow);

    // Compact tools popover. Power features stay one click away without
    // turning the widget into a settings panel.
    ui.toolsPanel = document.createElement('div');
    ui.toolsPanel.className = 'gemini-tts-tools-panel';

    const toggleRow = document.createElement('div');
    toggleRow.className = 'gemini-tts-tools-row';
    ui.toolButtons = {};
    function addToolButton(key, label, title, handler) {
      const button = createButton('gemini-tts-tool-chip', title, label);
      button.addEventListener('click', handler);
      toggleRow.appendChild(button);
      ui.toolButtons[key] = button;
      return button;
    }
    addToolButton('follow', 'Follow', 'Highlight the sentence being read', toggleFollow);
    addToolButton('clean', 'Clean', 'Remove links, citations, markdown, and extra spaces', toggleClean);
    addToolButton('study', 'Study', 'Repeat each sentence twice', toggleStudy);
    addToolButton('dialogue', 'Dialogue', 'Alternate accents for a conversational feel', toggleDialogue);
    addToolButton('api', 'API', 'Use an official Gemini API key for named voices', toggleApiMode);
    ui.toolsPanel.appendChild(toggleRow);

    const actionRow = document.createElement('div');
    actionRow.className = 'gemini-tts-tools-row gemini-tts-tools-actions';
    const fromHereBtn = createButton('gemini-tts-tool-chip', 'Read from here to the end of the page', 'From here');
    fromHereBtn.addEventListener('click', () => playFromHere(false));
    actionRow.appendChild(fromHereBtn);

    const articleBtn = createButton('gemini-tts-tool-chip', 'Read the main article from here', 'Article');
    articleBtn.addEventListener('click', () => playFromHere(true));
    actionRow.appendChild(articleBtn);

    const downloadToolBtn = createButton('gemini-tts-tool-chip', 'Download current audio', 'Download');
    downloadToolBtn.addEventListener('click', downloadActiveAudio);
    actionRow.appendChild(downloadToolBtn);

    ui.sleepLabel = document.createElement('span');
    ui.sleepLabel.className = 'gemini-tts-sleep-label';
    ui.sleepLabel.textContent = 'Sleep';
    actionRow.appendChild(ui.sleepLabel);

    for (const minutes of [5, 15, 30, 60]) {
      const sleepBtn = createButton('gemini-tts-tool-chip gemini-tts-sleep-chip', `Stop after ${minutes} minutes`, String(minutes));
      sleepBtn.addEventListener('click', () => setSleepTimer(minutes));
      actionRow.appendChild(sleepBtn);
    }
    ui.toolsPanel.appendChild(actionRow);

    ui.apiFields = document.createElement('div');
    ui.apiFields.className = 'gemini-tts-api-fields';
    ui.apiFields.style.display = apiModeEnabled ? 'block' : 'none';

    ui.apiKeyInput = document.createElement('input');
    ui.apiKeyInput.type = 'password';
    ui.apiKeyInput.className = 'gemini-tts-api-key';
    ui.apiKeyInput.placeholder = 'Gemini API key (stored locally)';
    ui.apiKeyInput.value = storageGet(KEYS.apiKey, '');
    ui.apiKeyInput.addEventListener('change', () => {
      storageSet(KEYS.apiKey, ui.apiKeyInput.value.trim());
      showNotice('Gemini API key saved locally.', 2500);
    });
    ui.apiFields.appendChild(ui.apiKeyInput);

    ui.apiVoiceSelect = document.createElement('select');
    ui.apiVoiceSelect.className = 'gemini-tts-api-voice';
    ui.apiVoiceSelect.setAttribute('aria-label', 'Named voice');
    NAMED_VOICES.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voice;
      option.textContent = voice;
      ui.apiVoiceSelect.appendChild(option);
    });
    ui.apiVoiceSelect.value = apiVoice;
    ui.apiVoiceSelect.addEventListener('change', () => {
      apiVoice = ui.apiVoiceSelect.value;
      storageSet(KEYS.apiVoice, apiVoice);
      showNotice(`Named voice set to ${apiVoice}.`, 2500);
    });
    ui.apiFields.appendChild(ui.apiVoiceSelect);
    ui.toolsPanel.appendChild(ui.apiFields);

    ui.recentList = document.createElement('div');
    ui.recentList.className = 'gemini-tts-recent';
    ui.toolsPanel.appendChild(ui.recentList);

    toolbarEl.appendChild(ui.toolsPanel);

    // Error / status line
    ui.status = document.createElement('div');
    ui.status.className = 'gemini-tts-status';
    ui.status.setAttribute('role', 'status');
    toolbarEl.appendChild(ui.status);

    (document.body || document.documentElement).appendChild(toolbarEl);

    updatePlayerUI('idle');
    updateLoopUI();
    updateToolsUI();
  }

  // ---------------------------------------------------------------------------
  // Positioning / dragging
  // ---------------------------------------------------------------------------

  function getSavedPosition() {
    try {
      const parsed = JSON.parse(storageGet(KEYS.position, 'null'));
      if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) {
        return parsed;
      }
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  function saveCurrentPosition() {
    if (!toolbarEl) return;
    const rect = toolbarEl.getBoundingClientRect();
    storageSet(KEYS.position, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
  }

  function placeAt(left, top) {
    if (!toolbarEl) return;
    const width = toolbarEl.offsetWidth || 420;
    const height = toolbarEl.offsetHeight || 100;
    const maxLeft = Math.max(6, window.innerWidth - width - 6);
    const maxTop = Math.max(6, window.innerHeight - height - 6);
    toolbarEl.style.left = `${clamp(left, 6, maxLeft)}px`;
    toolbarEl.style.top = `${clamp(top, 6, maxTop)}px`;
  }

  function positionNearSelection(rect) {
    if (!toolbarEl) return;
    const width = toolbarEl.offsetWidth || 420;
    const height = toolbarEl.offsetHeight || 100;
    let left = rect ? rect.left + rect.width / 2 - width / 2 : (window.innerWidth - width) / 2;
    let top = rect ? rect.top - height - 12 : 80;
    if (top < 6) top = rect ? rect.bottom + 12 : 6;
    placeAt(left, top);
  }

  function wireDrag() {
    let dragState = null;

    function onPointerMove(event) {
      if (!dragState) return;
      dragState.moved = true;
      placeAt(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
    }

    function onPointerUp(event) {
      if (!dragState) return;
      try {
        ui.dragHandle.releasePointerCapture(event.pointerId);
      } catch (err) {
        /* ignore */
      }
      ui.dragHandle.removeEventListener('pointermove', onPointerMove);
      ui.dragHandle.removeEventListener('pointerup', onPointerUp);
      ui.dragHandle.removeEventListener('pointercancel', onPointerUp);
      if (dragState.moved) saveCurrentPosition();
      dragState = null;
    }

    ui.dragHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = toolbarEl.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false
      };
      try {
        ui.dragHandle.setPointerCapture(event.pointerId);
      } catch (err) {
        /* ignore */
      }
      ui.dragHandle.addEventListener('pointermove', onPointerMove);
      ui.dragHandle.addEventListener('pointerup', onPointerUp);
      ui.dragHandle.addEventListener('pointercancel', onPointerUp);
    });

    // Double-click resets the saved position and returns the pill near the text.
    ui.dragHandle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      storageRemove(KEYS.position);
      let rect = activeSelectionRect;
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        try {
          const liveRect = selection.getRangeAt(0).getBoundingClientRect();
          if (liveRect.width > 0 && liveRect.height > 0) rect = liveRect;
        } catch (err) {
          /* keep last known rect */
        }
      }
      positionNearSelection(rect);
    });
  }

  function showToolbar(rect) {
    if (!toolbarEl) createToolbar();
    if (rect) activeSelectionRect = rect;

    if (activeAudio) {
      updatePlayerUI(activeAudio.paused ? 'paused' : 'playing');
    } else if (fallbackActive) {
      const paused = window.speechSynthesis && window.speechSynthesis.paused;
      updatePlayerUI(paused ? 'paused' : 'playing');
    } else {
      updatePlayerUI('idle');
    }

    toolbarEl.classList.remove('is-hidden');

    const saved = getSavedPosition();
    if (saved) {
      placeAt(saved.left, saved.top);
    } else {
      positionNearSelection(activeSelectionRect);
    }
  }

  function hideToolbar(force) {
    if (!toolbarEl) return;
    if (!force && isAudioSessionActive) return;
    toolbarEl.classList.add('is-hidden');
  }

  window.addEventListener('resize', () => {
    if (!toolbarEl || toolbarEl.classList.contains('is-hidden')) return;
    const rect = toolbarEl.getBoundingClientRect();
    placeAt(rect.left, rect.top);
  });

  // ---------------------------------------------------------------------------
  // Selection detection
  // ---------------------------------------------------------------------------

  document.addEventListener('mouseup', (event) => {
    // Clicking the player itself must never count as an outside click, even if
    // focusing one of its controls cleared the page selection.
    if (toolbarEl && toolbarEl.contains(event.target)) return;

    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';

      if (text.length > 0) {
        let rect = null;
        try {
          rect = selection.getRangeAt(0).getBoundingClientRect();
        } catch (err) {
          /* ignore */
        }

        const changed = text !== currentSelectionText;
        currentSelectionText = text;
        followTextMap = null;
        try {
          activeSelectionRange = selection && selection.rangeCount > 0
            ? selection.getRangeAt(0).cloneRange()
            : null;
        } catch (err) {
          activeSelectionRange = null;
        }

        // A new highlight always starts a new clip.
        if (changed && (activeAudio || fallbackActive || (ui.mainBtn && ui.mainBtn.classList.contains('is-loading')))) {
          cancelPlayback();
          currentChunks = [];
          currentChunkIndex = 0;
          isAudioSessionActive = false;
          updatePlayerUI('idle');
        }

        showToolbar(rect);
        return;
      }

      hideToolbar(false);
    }, 25);
  }, true);

  window.addEventListener('scroll', () => {
    if (!followEnabled || !followOverlay || !currentSentenceRanges.length) return;
    const time = activeAudio ? activeAudio.currentTime : 0;
    const index = sentenceIndexAt(time);
    if (index < 0) return;
    lastFollowText = '';
    renderFollowHighlight(currentSentenceRanges[index].text);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || !event.shiftKey) return;
    const tag = event.target && event.target.tagName ? String(event.target.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    let handled = true;
    switch (String(event.key).toLowerCase()) {
      case 'l':
        handlePlayPause();
        break;
      case 'arrowleft':
        handleSeekRelative(-5);
        break;
      case 'arrowright':
        handleSeekRelative(5);
        break;
      case 'f':
        toggleFollow();
        break;
      case 'c':
        toggleClean();
        break;
      case 't':
        toggleStudy();
        break;
      case 'd':
        toggleDialogue();
        break;
      case 'a':
        toggleAB();
        break;
      case 's':
        setSleepTimer(15);
        break;
      case 'o':
        toggleTools();
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  console.info('[Gemini Voice Reader Everywhere] Ready on', window.location.hostname);
})();
