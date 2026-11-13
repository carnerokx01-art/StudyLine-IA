pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentModule = 'summary';
let currentGeneratedData = null;
let availableModels = ['gemini-3.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
let cachedModulesData = {};
let uploadedFilesList = [];
let lastSuccessfulModel = null; 

const themeToggleBtn = document.getElementById('themeToggleBtn');

function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    themeToggleBtn.textContent = '🌙';
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    themeToggleBtn.textContent = '☀️';
  }
}

function initTheme() {
  const manualPref = localStorage.getItem('studyline_theme');
  if (manualPref !== null) {
    applyTheme(manualPref === 'dark');
  } else {
    applyTheme(true); // Negro puro por defecto
  }
}

themeToggleBtn.addEventListener('click', () => {
  const isCurrentlyLight = document.documentElement.hasAttribute('data-theme');
  const newDarkState = isCurrentlyLight;
  applyTheme(newDarkState);
  localStorage.setItem('studyline_theme', newDarkState ? 'dark' : 'light');
});

initTheme();

const el = {
  apiKeyInput: document.getElementById('apiKeyInput'),
  saveKeyBtn: document.getElementById('saveKeyBtn'),
  modelSelect: document.getElementById('modelSelect'),
  keyStatus: document.getElementById('keyStatus'),
  subject: document.getElementById('subject'),
  goal: document.getElementById('goal'),
  depthSelect: document.getElementById('depthSelect'),
  text: document.getElementById('text'),
  files: document.getElementById('files'),
  imageFiles: document.getElementById('imageFiles'),
  filePreviewContainer: document.getElementById('filePreviewContainer'),
  activeFileViewer: document.getElementById('activeFileViewer'),
  viewerTitle: document.getElementById('viewerTitle'),
  viewerContentBox: document.getElementById('viewerContentBox'),
  closeViewerBtn: document.getElementById('closeViewerBtn'),
  genBtn: document.getElementById('genBtn'),
  saveTopicBtn: document.getElementById('saveTopicBtn'),
  status: document.getElementById('status'),
  resultCard: document.getElementById('resultCard'),
  resultTitle: document.getElementById('resultTitle'),
  view: document.getElementById('view'),
  navTabBtns: document.querySelectorAll('.nav-tab-btn'),
  savedTopicsContainer: document.getElementById('savedTopicsContainer'),
  savedCountBadge: document.getElementById('savedCountBadge'),
  topTopicSubtitle: document.getElementById('topTopicSubtitle'),
  studyBanner: document.getElementById('studyBanner'),
  bannerSubject: document.getElementById('bannerSubject'),
  bannerGoal: document.getElementById('bannerGoal')
};

const savedKey = localStorage.getItem('studyline_gemini_key') || '';
if (savedKey) {
  el.apiKeyInput.value = savedKey;
  fetchAvailableModels(savedKey);
} else {
  updateKeyStatus('', false);
}

renderSavedTopics();

el.saveKeyBtn.addEventListener('click', () => {
  const key = el.apiKeyInput.value.trim();
  localStorage.setItem('studyline_gemini_key', key);
  if (key) {
    fetchAvailableModels(key);
  } else {
    updateKeyStatus('', false);
  }
});

async function fetchAvailableModels(key) {
  el.keyStatus.textContent = 'Buscando modelos Gemini...';
  el.keyStatus.style.color = '#38bdf8';
  
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Error HTTP ${res.status}`);
    }
    
    const data = await res.json();
    const validModels = (data.models || []).filter(m => {
      const name = m.name.replace('models/', '');
      return name.toLowerCase().startsWith('gemini-') && m.supportedGenerationMethods?.includes('generateContent');
    });

    if (validModels.length === 0) throw new Error('No se encontraron modelos compatibles.');

    availableModels = validModels.map(m => m.name.replace('models/', ''));
    availableModels.sort((a, b) => (a.includes('3.5-flash-lite') ? -1 : 1));

    el.modelSelect.innerHTML = availableModels.map(m => `<option value="${m}">${m}</option>`).join('');
    updateKeyStatus(key, true, `${availableModels.length} modelos listos`);
  } catch (err) {
    availableModels = ['gemini-3.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    el.modelSelect.innerHTML = availableModels.map(m => `<option value="${m}">${m}</option>`).join('');
    updateKeyStatus(key, false, `Clave guardada (${err.message})`);
  }
}

function updateKeyStatus(key, isValid, customMsg = '') {
  if (key && isValid) {
    el.keyStatus.textContent = `✦ Activa: ${customMsg}`;
    el.keyStatus.style.color = 'var(--success)';
  } else if (key) {
    el.keyStatus.textContent = `✦ Guardada: ${customMsg}`;
    el.keyStatus.style.color = 'var(--warning)';
  } else {
    el.keyStatus.textContent = `Introduce tu Gemini API Key para comenzar.`;
    el.keyStatus.style.color = 'var(--danger)';
    el.modelSelect.innerHTML = '<option value="">Sin clave configurada</option>';
  }
}

function showStatus(msg, type = 'info', showLoadingSpinner = true) {
  el.status.className = `status-banner ${type}`;
  el.status.style.display = 'flex';
  el.status.innerHTML = showLoadingSpinner && type === 'info' 
    ? `<span class="spinner"></span><span>${msg}</span>` 
    : `<span>${msg}</span>`;
}

function hideStatus() {
  el.status.style.display = 'none';
}

el.navTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    el.navTabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentModule = btn.dataset.module;

    if (cachedModulesData[currentModule]) {
      renderResult(currentModule, cachedModulesData[currentModule]);
    } else {
      processModuleRequest(currentModule);
    }
  });
});

el.genBtn.addEventListener('click', async () => {
  await generateAllModulesSequential();
});

// Respaldo inteligente: Usa el último modelo exitoso primero y no vuelve a reiniciar desde cero
async function fetchWithModelFallback(text, images, subject, goal, depth, modKey, apiKey, initialModel) {
  const preferred = el.modelSelect.value.trim();
  const pool = [lastSuccessfulModel, preferred, 'gemini-3.5-flash-lite', initialModel, ...availableModels, 'gemini-1.5-flash', 'gemini-1.5-pro'];
  const modelsToTry = [...new Set(pool.filter(m => m))];

  let lastErr = null;

  for (const mTry of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        showStatus(`Procesando [${modKey.toUpperCase()}] con ${mTry}...`, 'info', true);
        const data = await fetchModuleFromGemini(text, images, subject, goal, depth, modKey, apiKey, mTry, 25000);
        if (data) {
          lastSuccessfulModel = mTry; 
          return data;
        }
      } catch (err) {
        lastErr = err;
        if (err.message?.includes('429') || err.message?.includes('limit')) {
          showStatus(`Límite en ${mTry}. Cambiando modelo...`, 'warning', false);
          await sleep(800);
          break;
        }
        await sleep(800);
      }
    }
  }
  throw lastErr || new Error('Todos los modelos fallaron o alcanzaron su límite.');
}

async function generateAllModulesSequential() {
  const text = el.text.value.trim();
  const apiKey = (localStorage.getItem('studyline_gemini_key') || el.apiKeyInput.value).trim();
  const preferredModel = el.modelSelect.value.trim() || 'gemini-3.5-flash-lite';
  const subject = el.subject.value.trim() || 'Materia sin título';
  const goal = el.goal.value.trim() || 'Estudio general';
  const depth = el.depthSelect.value;

  const imagesPayload = uploadedFilesList.filter(f => f.type === 'image').map(f => f.payload);

  if (!apiKey) return showStatus('Falta la Gemini API Key.', 'error', false);
  if (!text && imagesPayload.length === 0) return showStatus('Escribe texto, sube un documento o añade imágenes.', 'error', false);

  el.resultCard.hidden = true;
  setControlsDisabled(true);
  cachedModulesData = {};

  const modules = [
    { key: 'summary', name: 'Resumen y Conceptos' },
    { key: 'cards', name: 'Tarjetas' },
    { key: 'quiz', name: 'Cuestionario' },
    { key: 'oral', name: 'Examen Oral' }
  ];

  try {
    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const data = await fetchWithModelFallback(text, imagesPayload, subject, goal, depth, mod.key, apiKey, preferredModel);
      if (data) {
        cachedModulesData[mod.key] = data;
      } else {
        throw new Error(`No se pudo generar el módulo ${mod.name}`);
      }
      await sleep(400);
    }

    currentGeneratedData = {
      subject, goal, moduleType: currentModule, depth,
      data: cachedModulesData[currentModule] || cachedModulesData['summary']
    };

    el.topTopicSubtitle.textContent = subject;
    el.bannerSubject.textContent = subject;
    el.bannerGoal.textContent = `Objetivo: ${goal}`;
    el.studyBanner.hidden = false;

    el.resultCard.hidden = false;
    renderResult(currentModule, cachedModulesData[currentModule] || cachedModulesData['summary']);
    hideStatus();
  } catch (err) {
    showStatus(`Error en la generación: ${err.message}`, 'error', false);
  }

  setControlsDisabled(false);
}

async function processModuleRequest(moduleType) {
  if (cachedModulesData[moduleType]) {
    renderResult(moduleType, cachedModulesData[moduleType]);
  } else {
    await generateAllModulesSequential();
  }
}

function setControlsDisabled(disabled) {
  el.genBtn.disabled = disabled;
  el.navTabBtns.forEach(b => b.style.pointerEvents = disabled ? 'none' : 'auto');
}

function renderFilePreviews() {
  if (uploadedFilesList.length === 0) {
    el.filePreviewContainer.innerHTML = '';
    el.activeFileViewer.hidden = true;
    return;
  }

  el.filePreviewContainer.innerHTML = uploadedFilesList.map((fileItem, idx) => {
    const thumbContent = fileItem.type === 'image' 
      ? `<img src="${fileItem.dataUrl || fileItem.src}" class="preview-thumb" alt="Vista previa">` 
      : `<div class="preview-thumb">📄</div>`;

    return `
      <div class="preview-chip" onclick="openFileViewer(${idx})">
        ${thumbContent}
        <div class="preview-info">
          <div class="preview-name" title="${fileItem.name}">${fileItem.name}</div>
          <div class="preview-type">Clic para ver</div>
        </div>
        <button class="preview-remove" onclick="event.stopPropagation(); removeUploadedFile(${idx})" title="Eliminar">✕</button>
      </div>
    `;
  }).join('');
}

window.openFileViewer = (index) => {
  const item = uploadedFilesList[index];
  if (!item) return;
  displayFileInViewer(item);
};

function displayFileInViewer(item) {
  el.viewerTitle.textContent = `Visualizando: ${item.name}`;
  
  if (item.type === 'image' || (item.dataUrl && item.dataUrl.startsWith('data:image'))) {
    el.viewerContentBox.innerHTML = `<img src="${item.dataUrl || item.src}" alt="${item.name}">`;
  } else if (item.dataUrl && item.dataUrl.startsWith('data:application/pdf')) {
    el.viewerContentBox.innerHTML = `<embed src="${item.dataUrl}" type="application/pdf" width="100%" height="420px" style="border-radius: 8px; border: 1px solid var(--panel-border);">`;
  } else {
    el.viewerContentBox.innerHTML = `<div style="width:100%; text-align:left; font-family:monospace; font-size:0.82rem; background:var(--bg-main); padding:14px; border-radius:8px; border:1px solid var(--panel-border); white-space:pre-wrap; max-height:350px; overflow-y:auto; color:var(--text-main);"><strong>Contenido del documento (${item.name}):</strong>\n\n${item.extractedText || 'Sin texto previo.'}</div>`;
  }

  el.activeFileViewer.hidden = false;
  el.activeFileViewer.scrollIntoView({ behavior: 'smooth' });
}

el.closeViewerBtn.addEventListener('click', () => {
  el.activeFileViewer.hidden = true;
});

window.removeUploadedFile = (index) => {
  uploadedFilesList.splice(index, 1);
  renderFilePreviews();
};

el.files.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  let texts = [];

  for (const file of files) {
    try {
      let fileText = '';
      const base64DataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.readAsDataURL(file);
      });

      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          fileText += textContent.items.map(item => item.str).join(' ') + '\n';
        }
      } else if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        fileText = result.value;
      } else {
        fileText = await file.text();
      }

      texts.push(fileText);
      uploadedFilesList.push({
        name: file.name,
        type: 'doc',
        dataUrl: base64DataUrl,
        extractedText: fileText
      });
    } catch (err) {
      alert(`No se pudo leer el archivo ${file.name}.`);
    }
  }

  if (texts.length > 0) {
    el.text.value += (el.text.value ? '\n\n' : '') + texts.join('\n\n');
  }
  renderFilePreviews();
  el.files.value = '';
});

el.imageFiles.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      const fullDataUrl = uploadEvent.target.result;
      const base64String = fullDataUrl.split(',')[1];
      uploadedFilesList.push({
        name: file.name,
        type: 'image',
        src: fullDataUrl,
        dataUrl: fullDataUrl,
        payload: { inline_data: { mime_type: file.type || 'image/jpeg', data: base64String } }
      });
      renderFilePreviews();
    };
    reader.readAsDataURL(file);
  });
  el.imageFiles.value = '';
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchModuleFromGemini(text, images, subject, goal, depth, moduleType, apiKey, model, timeoutMs = 25000) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const depthLimits = {
    rapido: { summary: 3, cards: 4, quiz: 4, oral: 3 },
    medio: { summary: 6, cards: 8, quiz: 7, oral: 5 },
    extenso: { summary: 12, cards: 18, quiz: 15, oral: 12 }
  };

  const limits = depthLimits[depth] || depthLimits.medio;

  const prompts = {
    summary: `Genera un análisis completo sobre "${subject}" (Objetivo: ${goal}). Devuelve ÚNICAMENTE un objeto JSON válido con este formato estricto: {"generalSummary": "Un párrafo completo y detallado explicando el resumen general del tema y su contexto principal.", "concepts": [{"title": "Nombre del Concepto", "desc": "Descripción detallada", "relevance": "Por qué es importante"}], con exactamente ${limits.summary} conceptos clave. Sin texto adicional ni formato markdown extra.`,
    cards: `Genera ${limits.cards} tarjetas de estudio detalladas para "${subject}". Devuelve ÚNICAMENTE un array JSON válido de objetos: [{"front": "Pregunta o Concepto", "back": "Respuesta o Definición"}]. Sin texto adicional.`,
    quiz: `Genera ${limits.quiz} preguntas completas de opción múltiple sobre "${subject}". Devuelve ÚNICAMENTE un array JSON válido de objetos: [{"id": 0, "question": "Pregunta", "options": ["Opción A", "Opción B", "Opción C", "Opción D"], "answer": "Opción exacta"}]. Sin texto adicional.`,
    oral: `Genera ${limits.oral} preguntas abiertas profundas para examen oral sobre "${subject}". Devuelve ÚNICAMENTE un array JSON válido de objetos con este formato estricto: [{"id": 0, "question": "Pregunta detallada", "keyPoints": ["Punto clave 1", "Punto clave 2", "Punto clave 3"], "keywords": ["palabra1", "palabra2"]}]. Sin texto adicional.`
  };

  const promptText = `${prompts[moduleType]}\n\nMaterial de estudio:\n${text.slice(0, 20000)}`;
  const contentParts = [{ text: promptText }];
  if (images && images.length > 0) {
    images.forEach(img => contentParts.push(img));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: contentParts }],
        generationConfig: { response_mime_type: "application/json", maxOutputTokens: 4000, temperature: 0.2 }
      })
    });

    clearTimeout(timer);
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `Error HTTP ${res.status}`);
    }

    const resData = await res.json();
    let rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Respuesta vacía del servidor.');

    const match = rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) rawText = match[0];

    return JSON.parse(rawText);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Tiempo agotado (25s)');
    throw err;
  }
}

async function renderResult(type, data) {
  if (!data) return;
  el.view.className = 'animate-fade-in';

  if (type === 'summary') {
    el.resultTitle.textContent = 'Resumen y Conceptos Clave';
    
    const generalSummaryText = data.generalSummary || 'Resumen general no disponible.';
    const conceptsList = data.concepts || (Array.isArray(data) ? data : []);

    let html = `
      <div class="love-banner animate-fade-in">
        <span style="font-size: 1.3rem;">❤️</span>
        <div><strong>Para Ti:</strong> ¡Tú puedes con todo, mi amor! Cada minuto que dedicas a estudiar te acerca a tu meta. Eres brillante, confía en tu preparación. ✨</div>
      </div>

      <div class="general-summary-box">
        <h4>📖 Resumen General del Tema</h4>
        <p>${generalSummaryText}</p>
      </div>

      <div class="summary-header-row">
        <div>
          <h3 style="font-size: 1.1rem; font-weight: 800;">Conceptos Clave Indispensables</h3>
          <p style="font-size: 0.82rem; color: var(--text-muted);">${conceptsList.length} términos analizados de tus apuntes</p>
        </div>
        <input type="text" id="conceptSearch" class="summary-search-input" placeholder="Buscar término...">
      </div>
      <div class="concepts-grid" id="conceptsGridContainer">
    `;

    conceptsList.forEach(item => {
      const title = item.title || 'Concepto';
      const desc = item.desc || item;
      const relevance = item.relevance || 'Fundamental para el examen.';

      html += `
        <div class="concept-card" data-search="${title.toLowerCase()} ${desc.toLowerCase()}">
          <div>
            <div class="concept-card-header">
              <div class="concept-title">${title}</div>
              <span class="concept-badge-exam">Examen</span>
            </div>
            <div class="concept-body">${desc}</div>
          </div>
          <div class="concept-footer-relevance">
            <strong>Relevancia:</strong> ${relevance}
          </div>
        </div>
      `;
    });

    html += `
      </div>
      <div class="action-cta-banner">
        <div>
          <div style="font-weight: 700; font-size: 0.98rem;">¿Lista para poner a prueba tu conocimiento?</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">Evalúa tu comprensión con tarjetas o un cuestionario interactivo.</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button id="goToCardsBtn" class="render-btn-secondary" style="padding: 8px 14px; font-size:0.82rem;">Repasar Tarjetas</button>
          <button id="goToQuizBtn" class="render-btn-primary" style="padding: 8px 14px; font-size:0.82rem;">Hacer Cuestionario</button>
        </div>
      </div>
    `;

    el.view.innerHTML = html;

    document.getElementById('conceptSearch')?.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      document.querySelectorAll('.concept-card').forEach(card => {
        const text = card.getAttribute('data-search') || '';
        card.style.display = text.includes(query) ? 'flex' : 'none';
      });
    });

    document.getElementById('goToCardsBtn').onclick = () => document.querySelector('[data-module="cards"]').click();
    document.getElementById('goToQuizBtn').onclick = () => document.querySelector('[data-module="quiz"]').click();

  } else if (type === 'cards') {
    el.resultTitle.textContent = 'Tarjetas Flashcards';
    let idx = 0;
    let masteredCount = 0;
    let animDirection = 'animate-slide-right';

    const updateCardView = () => {
      const c = data[idx];
      el.view.innerHTML = `
        <div class="flashcard-wrapper ${animDirection}">
          <div class="flashcard-top-bar">
            <div class="fc-counter-badge">
              <span>Tarjeta ${idx + 1} de ${data.length}</span>
              <span class="fc-mastered-chip">${masteredCount} / ${data.length} dominadas</span>
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted); font-weight:600;">Haz clic en la tarjeta para voltear</div>
          </div>

          <div class="fc-card-3d" id="fcCard3d">
            <div class="fc-card-inner">
              <div class="fc-card-front">
                <span class="fc-badge fc-badge-front">Pregunta / Concepto</span>
                <div class="fc-main-text">${c.front}</div>
                <span class="fc-hint-flip">Haz clic para ver respuesta</span>
              </div>
              <div class="fc-card-back">
                <span class="fc-badge fc-badge-back">Respuesta Correcta</span>
                <div class="fc-main-text">${c.back}</div>
                <span class="fc-hint-flip">Haz clic para volver a la pregunta</span>
              </div>
            </div>
          </div>

          <div class="fc-controls-row">
            <button class="btn-fc-nav" id="prevCardBtn">Anterior</button>
            <button class="btn-fc-flip" id="flipCardBtn">Girar Tarjeta</button>
            <button class="btn-fc-master" id="masterCardBtn">¡Me la sé!</button>
            <button class="btn-fc-nav" id="nextCardBtn">Siguiente</button>
          </div>
        </div>
      `;

      const card3d = document.getElementById('fcCard3d');
      const flipBtn = document.getElementById('flipCardBtn');
      const toggleFlip = () => {
        card3d.classList.toggle('flipped');
        flipBtn.textContent = card3d.classList.contains('flipped') ? 'Ver Pregunta' : 'Girar Tarjeta';
      };

      card3d.onclick = toggleFlip;
      flipBtn.onclick = toggleFlip;

      document.getElementById('prevCardBtn').onclick = () => { animDirection = 'animate-slide-left'; idx = (idx - 1 + data.length) % data.length; updateCardView(); };
      document.getElementById('nextCardBtn').onclick = () => { animDirection = 'animate-slide-right'; idx = (idx + 1) % data.length; updateCardView(); };
      document.getElementById('masterCardBtn').onclick = () => { animDirection = 'animate-slide-right'; masteredCount = Math.min(data.length, masteredCount + 1); idx = (idx + 1) % data.length; updateCardView(); };
    };

    updateCardView();
  } else if (type === 'quiz') {
    el.resultTitle.textContent = 'Cuestionario de Opción Múltiple';
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    let html = `<div class="quiz-container animate-fade-in">`;
    html += `
      <div class="quiz-progress-bar">
        <span>Evaluación Interactiva (${data.length} preguntas)</span>
        <span id="liveScoreBadge">Cuestionario listo</span>
      </div>
    `;

    data.forEach((q, i) => {
      html += `
        <div class="quiz-question-card" id="qCard-${i}">
          <span class="quiz-q-tag">Pregunta ${i + 1} de ${data.length}</span>
          <p class="quiz-q-title">${i + 1}. ${q.question}</p>
      `;
      q.options.forEach((opt, optIdx) => {
        const letter = letters[optIdx] || String.fromCharCode(65 + optIdx);
        html += `
          <label class="quiz-option-label" id="label-q${i}-${optIdx}">
            <input type="radio" name="q${i}" value="${opt}" data-qid="${i}" data-correct="${encodeURIComponent(q.answer)}">
            <div class="quiz-letter-badge">${letter}</div>
            <span>${opt}</span>
          </label>
        `;
      });
      html += `<div id="feedback-q${i}" style="margin-top: 10px; font-size: 0.85rem; font-weight: 600;" hidden></div>`;
      html += `</div>`;
    });

    html += `
      <div style="text-align: center; margin-top: 20px;">
        <button id="checkQuizBtn" class="render-btn-primary" style="padding: 12px 28px; font-size: 0.98rem;">Calificar Cuestionario Completo</button>
      </div>
      <div id="qRes" style="margin-top:16px;"></div>
    </div>`;

    el.view.innerHTML = html;

    el.view.querySelectorAll('input[type="radio"]').forEach(input => {
      input.addEventListener('change', () => {
        const answeredCount = el.view.querySelectorAll('input[type="radio"]:checked').length;
        const badge = document.getElementById('liveScoreBadge');
        if (badge) badge.textContent = `Respondidas: ${answeredCount} / ${data.length}`;
      });
    });

    document.getElementById('checkQuizBtn').onclick = () => {
      let score = 0;

      data.forEach((q, i) => {
        const sel = document.querySelector(`input[name="q${i}"]:checked`);
        const feedbackBox = document.getElementById(`feedback-q${i}`);
        const parentCard = document.getElementById(`qCard-${i}`);
        const correctVal = q.answer;

        parentCard.querySelectorAll('input[type="radio"]').forEach(r => r.disabled = true);

        if (sel && sel.value === correctVal) {
          score++;
          sel.closest('.quiz-option-label').style.background = 'rgba(16, 185, 129, 0.12)';
          sel.closest('.quiz-option-label').style.borderColor = 'var(--success)';
          feedbackBox.innerHTML = `<span style="color: var(--success);">✨ ¡Correcto!</span>`;
        } else {
          if (sel) {
            sel.closest('.quiz-option-label').style.background = 'rgba(239, 68, 68, 0.12)';
            sel.closest('.quiz-option-label').style.borderColor = 'var(--danger)';
          }
          parentCard.querySelectorAll('input[type="radio"]').forEach(r => {
            if (r.value === correctVal) {
              r.closest('.quiz-option-label').style.background = 'rgba(16, 185, 129, 0.12)';
              r.closest('.quiz-option-label').style.borderColor = 'var(--success)';
            }
          });
          feedbackBox.innerHTML = `<span style="color: var(--danger);">❌ Incorrecto. La respuesta correcta era: <strong>${correctVal}</strong></span>`;
        }
        feedbackBox.hidden = false;
      });

      const pct = Math.round((score / data.length) * 100);
      document.getElementById('qRes').innerHTML = `
        <div style="padding: 16px 20px; background: rgba(99, 102, 241, 0.08); border-radius: 11px; border: 1px solid rgba(99, 102, 241, 0.25); color: var(--primary); text-align: center; font-size: 1.05rem;" class="animate-fade-in">
          <strong>Calificación final: ${score} / ${data.length} (${pct}%)</strong>
          <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">¡Revisa los aciertos y correcciones detalladas arriba!</p>
        </div>
      `;
      document.getElementById('qRes').scrollIntoView({ behavior: 'smooth' });
    };
  } else if (type === 'oral') {
    el.resultTitle.textContent = 'Simulador de Examen Oral';
    let idx = 0;

    const renderOral = () => {
      const q = data[idx];
      el.view.innerHTML = `
        <div class="oral-container animate-fade-in">
          <div class="oral-meta-header">
            <span class="oral-difficulty-badge">Pregunta ${idx + 1} de ${data.length}</span>
            <button id="speakQuestionBtn" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.05rem;" title="Escuchar pregunta">🔊</button>
          </div>

          <h2 class="oral-question-title">${q.question}</h2>

          <div class="oral-points-box">
            <div class="oral-points-title">✦ Puntos clave esperados:</div>
            <ul class="oral-points-list">
              ${(q.keyPoints || q.keywords || []).map(point => `<li>${point}</li>`).join('')}
            </ul>
          </div>

          <div style="font-size: 0.82rem; font-weight: 600; margin-bottom: 6px; color: var(--text-muted);">
            Tu respuesta oral (usa el micrófono o escribe):
          </div>

          <div class="oral-input-wrapper">
            <textarea id="oralAnswerText" class="oral-textarea" placeholder="Habla por el micrófono o redacta tu respuesta..."></textarea>
            <button id="recMicBtn" class="oral-mic-btn" title="Hablar">🎙️</button>
          </div>

          <div class="oral-footer-actions">
            <button id="clearOralBtn" style="background:transparent; color:var(--text-muted); border:none; font-weight:600; cursor:pointer; font-size:0.85rem;">Borrar respuesta</button>
            <div style="display:flex; gap:8px;">
              <button id="nextOralBtn" class="render-btn-secondary" style="padding: 8px 14px; font-size:0.82rem;">Siguiente pregunta</button>
              <button id="evalOralBtn" class="render-btn-primary" style="padding: 8px 16px; font-size:0.82rem;">Evaluar Respuesta</button>
            </div>
          </div>

          <div id="oralFeedbackContainer"></div>
        </div>
      `;

      document.getElementById('speakQuestionBtn').onclick = () => {
        const u = new SpeechSynthesisUtterance(q.question);
        u.lang = 'es-ES';
        window.speechSynthesis.speak(u);
      };

      const recBtn = document.getElementById('recMicBtn');
      const textarea = document.getElementById('oralAnswerText');

      recBtn.onclick = () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return alert('Tu navegador no soporta reconocimiento de voz.');
        const r = new SR();
        r.lang = 'es-ES';
        r.start();
        recBtn.classList.add('listening');
        textarea.placeholder = 'Escuchando...';

        r.onresult = (e) => {
          textarea.value += (textarea.value ? ' ' : '') + e.results[0][0].transcript;
          recBtn.classList.remove('listening');
        };
        r.onerror = () => recBtn.classList.remove('listening');
        r.onend = () => recBtn.classList.remove('listening');
      };

      document.getElementById('clearOralBtn').onclick = () => {
        textarea.value = '';
        document.getElementById('oralFeedbackContainer').innerHTML = '';
      };

      document.getElementById('evalOralBtn').onclick = () => {
        const userText = textarea.value.trim().toLowerCase();
        if (!userText) return alert('Escribe o dicta tu respuesta antes de evaluar.');

        const points = q.keyPoints || q.keywords || [];
        const matchedPoints = points.filter(p => {
          const words = p.toLowerCase().split(' ').filter(w => w.length > 3);
          return words.some(w => userText.includes(w));
        });

        const scorePct = Math.round((matchedPoints.length / points.length) * 100);

        document.getElementById('oralFeedbackContainer').innerHTML = `
          <div class="oral-feedback-card animate-fade-in">
            <h3 style="font-size: 0.98rem; font-weight: 700; margin-bottom: 6px; color: var(--primary);">
              Evaluación del Profesor (${scorePct}% de cobertura)
            </h3>
            <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 10px;">
              ${scorePct >= 75 ? '¡Excelente dominio del tema! Explicaste los puntos principales con claridad.' : 'Buen intento, pero te faltaron algunos detalles clave.'}
            </p>
            <div style="font-size: 0.8rem; font-weight: 600;">Puntos detectados:</div>
            <ul style="margin-top: 4px; padding-left: 16px; font-size: 0.82rem;">
              ${points.map(p => {
                const found = matchedPoints.includes(p);
                return `<li style="color: ${found ? 'var(--success)' : 'var(--warning)'};">${found ? '✓' : '✗'} ${p}</li>`;
              }).join('')}
            </ul>
          </div>
        `;
        document.getElementById('oralFeedbackContainer').scrollIntoView({ behavior: 'smooth' });
      };

      document.getElementById('nextOralBtn').onclick = () => {
        idx = (idx + 1) % data.length;
        renderOral();
      };
    };

    renderOral();
  }
}

el.saveTopicBtn.addEventListener('click', () => {
  if (!currentGeneratedData) return;
  const topics = JSON.parse(localStorage.getItem('studyline_saved_topics') || '[]');
  
  const savedFilesSnapshot = uploadedFilesList.map(f => ({
    name: f.name,
    type: f.type,
    dataUrl: f.dataUrl,
    extractedText: f.extractedText || ''
  }));

  const newTopic = {
    id: Date.now(),
    date: new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
    ...currentGeneratedData,
    allCachedData: cachedModulesData,
    filesSnapshot: savedFilesSnapshot
  };

  topics.unshift(newTopic);
  localStorage.setItem('studyline_saved_topics', JSON.stringify(topics));
  renderSavedTopics();
  alert('¡Tema guardado con éxito en el historial!');
});

function renderSavedTopics() {
  const topics = JSON.parse(localStorage.getItem('studyline_saved_topics') || '[]');
  el.savedCountBadge.textContent = topics.length;

  if (topics.length === 0) {
    el.savedTopicsContainer.innerHTML = '<p class="empty-notice">No hay temas guardados aún.</p>';
    return;
  }

  el.savedTopicsContainer.innerHTML = topics.map(t => {
    const hasFiles = t.filesSnapshot && t.filesSnapshot.length > 0;
    return `
      <div class="topic-item animate-fade-in" style="flex-direction: column; align-items: stretch; gap: 6px;">
        <div class="topic-info" onclick="loadTopic(${t.id})">
          <div class="topic-title">${t.subject}</div>
          <div class="topic-meta">${t.moduleType.toUpperCase()} • ${t.depth} • ${t.date}</div>
        </div>
        ${hasFiles ? `
          <div style="display:flex; flex-direction:column; gap:4px; border-top: 1px solid var(--panel-border); padding-top: 6px;">
            ${t.filesSnapshot.map((file, fIdx) => `
              <button onclick="loadSavedFile(${t.id}, ${fIdx})" style="background:var(--bg-main); color:var(--primary); border:1px solid var(--panel-border); padding:4px 8px; font-size:0.7rem; border-radius:6px; text-align:left; cursor:pointer; font-weight:600;">
                📂 Ver: ${file.name}
              </button>
            `).join('')}
          </div>
        ` : ''}
        <div style="display:flex; justify-content:flex-end;">
          <button class="btn-del" onclick="deleteTopic(${t.id})">Eliminar</button>
        </div>
      </div>
    `;
  }).join('');
}

window.loadTopic = (id) => {
  const topics = JSON.parse(localStorage.getItem('studyline_saved_topics') || '[]');
  const t = topics.find(item => item.id === id);
  if (!t) return;
  
  cachedModulesData = t.allCachedData || { [t.moduleType]: t.data };
  
  if (t.filesSnapshot) {
    uploadedFilesList = t.filesSnapshot.map(f => ({
      name: f.name,
      type: f.type,
      dataUrl: f.dataUrl,
      extractedText: f.extractedText
    }));
    renderFilePreviews();
  }

  el.topTopicSubtitle.textContent = t.subject;
  el.bannerSubject.textContent = t.subject;
  el.bannerGoal.textContent = `Objetivo: ${t.goal || 'Estudio'}`;
  el.studyBanner.hidden = false;
  el.resultCard.hidden = false;
  renderResult(currentModule, cachedModulesData[currentModule] || t.data);
  el.resultCard.scrollIntoView({ behavior: 'smooth' });
};

window.loadSavedFile = (topicId, fileIndex) => {
  const topics = JSON.parse(localStorage.getItem('studyline_saved_topics') || '[]');
  const t = topics.find(item => item.id === topicId);
  if (!t || !t.filesSnapshot || !t.filesSnapshot[fileIndex]) return;

  const fileItem = t.filesSnapshot[fileIndex];
  displayFileInViewer(fileItem);
};

window.deleteTopic = (id) => {
  let topics = JSON.parse(localStorage.getItem('studyline_saved_topics') || '[]');
  topics = topics.filter(item => item.id !== id);
  localStorage.setItem('studyline_saved_topics', JSON.stringify(topics));
  renderSavedTopics();
};

const secretVlssBtn = document.getElementById('secretVlssBtn');
const matrixCanvas = document.getElementById('matrixCanvas');
let matrixInterval = null;
let isVlssActive = false;

function initMatrixRain() {
  const ctx = matrixCanvas.getContext('2d');
  matrixCanvas.width = window.innerWidth;
  matrixCanvas.height = window.innerHeight;
  const chars = '日ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const fontSize = 16;
  const columns = matrixCanvas.width / fontSize;
  const drops = Array(Math.floor(columns)).fill(1);

  matrixInterval = setInterval(() => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);
    ctx.fillStyle = '#10b981';
    ctx.font = fontSize + 'px monospace';

    drops.forEach((drop, i) => {
      const text = chars.charAt(Math.floor(Math.random() * chars.length));
      ctx.fillText(text, i * fontSize, drop * fontSize);
      if (drop * fontSize > matrixCanvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    });
  }, 33);
}

secretVlssBtn.addEventListener('click', () => {
  isVlssActive = !isVlssActive;
  const vlssAudio = document.getElementById('vlssAudio');

  if (isVlssActive) {
    document.documentElement.setAttribute('data-theme', 'vlss55');
    matrixCanvas.style.display = 'block';
    initMatrixRain();
    secretVlssBtn.style.background = '#047857';
    vlssAudio?.play().catch(() => {});
  } else {
    document.documentElement.removeAttribute('data-theme');
    matrixCanvas.style.display = 'none';
    clearInterval(matrixInterval);
    secretVlssBtn.style.background = '';
    vlssAudio?.pause();
  }
});

window.addEventListener('resize', () => {
  if (isVlssActive && matrixCanvas) {
    matrixCanvas.width = window.innerWidth;
    matrixCanvas.height = window.innerHeight;
  }
});