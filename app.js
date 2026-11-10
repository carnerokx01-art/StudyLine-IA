pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentModule = 'summary';
let currentGeneratedData = null;
let availableModels = ['gemini-3.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
let cachedModulesData = {};

const themeToggleBtn = document.getElementById('themeToggleBtn');

function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeToggleBtn.textContent = '☀️';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeToggleBtn.textContent = '🌙';
  }
}

function initTheme() {
  const manualPref = localStorage.getItem('studyline_theme');
  if (manualPref !== null) {
    applyTheme(manualPref === 'dark');
  } else {
    const currentHour = new Date().getHours();
    const isNightTime = currentHour >= 17 || currentHour < 7;
    applyTheme(isNightTime);
  }
}

themeToggleBtn.addEventListener('click', () => {
  const isCurrentlyDark = document.documentElement.hasAttribute('data-theme');
  const newThemeState = !isCurrentlyDark;
  applyTheme(newThemeState);
  localStorage.setItem('studyline_theme', newThemeState ? 'dark' : 'light');
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
  fileList: document.getElementById('fileList'),
  genBtn: document.getElementById('genBtn'),
  saveTopicBtn: document.getElementById('saveTopicBtn'),
  status: document.getElementById('status'),
  resultCard: document.getElementById('resultCard'),
  resultTitle: document.getElementById('resultTitle'),
  view: document.getElementById('view'),
  topModBtns: document.querySelectorAll('.top-mod-btn'),
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
  el.keyStatus.textContent = 'Buscando modelos Gemini nativos...';
  el.keyStatus.style.color = '#0369a1';
  
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Error HTTP ${res.status}`);
    }
    
    const data = await res.json();
    const validModels = (data.models || []).filter(m => {
      const name = m.name.replace('models/', '');
      const isGemini = name.toLowerCase().startsWith('gemini-');
      const supportsGen = m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent');
      return isGemini && supportsGen;
    });

    if (validModels.length === 0) throw new Error('No se encontraron modelos Gemini compatibles.');

    availableModels = validModels.map(m => m.name.replace('models/', ''));
    
    availableModels.sort((a, b) => {
      if (a.includes('3.5-flash-lite')) return -1;
      if (b.includes('3.5-flash-lite')) return 1;
      if (a.includes('flash')) return -1;
      if (b.includes('flash')) return 1;
      return 0;
    });

    el.modelSelect.innerHTML = availableModels.map(m => `<option value="${m}">${m}</option>`).join('');
    updateKeyStatus(key, true, `${availableModels.length} modelos Gemini listos`);
  } catch (err) {
    availableModels = ['gemini-3.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    el.modelSelect.innerHTML = availableModels.map(m => `<option value="${m}">${m}</option>`).join('');
    updateKeyStatus(key, false, `Clave guardada (${err.message})`);
  }
}

function updateKeyStatus(key, isValid, customMsg = '') {
  if (key && isValid) {
    el.keyStatus.textContent = `Clave activa: ${customMsg}`;
    el.keyStatus.style.color = 'var(--success)';
  } else if (key) {
    el.keyStatus.textContent = `Clave guardada: ${customMsg}`;
    el.keyStatus.style.color = 'var(--warning)';
  } else {
    el.keyStatus.textContent = `Sin Clave: guarda tu Gemini API Key para comenzar.`;
    el.keyStatus.style.color = 'var(--danger)';
    el.modelSelect.innerHTML = '<option value="">Sin clave configurada</option>';
  }
}

function showStatus(msg, type = 'info', showLoadingSpinner = true) {
  el.status.className = type;
  el.status.style.display = 'flex';
  if (showLoadingSpinner && type === 'info') {
    el.status.innerHTML = `<span class="spinner"></span><span>${msg}</span>`;
  } else {
    el.status.innerHTML = `<span>${msg}</span>`;
  }
}

function hideStatus() {
  el.status.style.display = 'none';
}

el.topModBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    el.topModBtns.forEach(b => b.classList.remove('active'));
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

async function fetchWithModelFallback(text, subject, goal, depth, modKey, apiKey, initialModel) {
  const preferred = el.modelSelect.value.trim();
  const pool = [preferred, 'gemini-3.5-flash-lite', initialModel, ...availableModels, 'gemini-1.5-flash', 'gemini-1.5-pro'];
  const modelsToTry = [...new Set(pool.filter(m => m))];

  let lastErr = null;

  for (const mTry of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        showStatus(`Generando [${modKey.toUpperCase()}] con ${mTry}...`, 'info', true);
        const data = await fetchModuleFromGemini(text, subject, goal, depth, modKey, apiKey, mTry, 20000);
        if (data) return data;
      } catch (err) {
        lastErr = err;
        const errMsg = err.message || '';
        if (errMsg.includes('Quota exceeded') || errMsg.includes('429') || errMsg.includes('limit')) {
          showStatus(`Límite en ${mTry}. Cambiando a modelo alternativo...`, 'warning', false);
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

  if (!apiKey) return showStatus('Falta la Gemini API Key.', 'error', false);
  if (!text) return showStatus('Escribe texto o sube un documento.', 'error', false);

  el.resultCard.hidden = true;
  setControlsDisabled(true);
  cachedModulesData = {};

  const modules = [
    { key: 'summary', name: 'Resumen' },
    { key: 'cards', name: 'Tarjetas' },
    { key: 'quiz', name: 'Cuestionario' },
    { key: 'oral', name: 'Examen Oral' }
  ];

  try {
    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const data = await fetchWithModelFallback(text, subject, goal, depth, mod.key, apiKey, preferredModel);

      if (data) {
        cachedModulesData[mod.key] = data;
      } else {
        throw new Error(`No se pudo generar el módulo ${mod.name}`);
      }
      await sleep(500);
    }

    currentGeneratedData = {
      subject,
      goal,
      moduleType: currentModule,
      depth,
      data: cachedModulesData[currentModule] || cachedModulesData['summary']
    };

    el.topTopicSubtitle.textContent = `Tema: ${subject}`;
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
  el.topModBtns.forEach(b => b.style.pointerEvents = disabled ? 'none' : 'auto');
}

el.files.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  el.fileList.innerHTML = '';
  let texts = [];

  for (const file of files) {
    const li = document.createElement('li');
    li.textContent = `${file.name}`;
    el.fileList.appendChild(li);

    try {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          fullText += textContent.items.map(item => item.str).join(' ') + '\n';
        }
        texts.push(fullText);
      } else if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
        file.name.endsWith('.docx')
      ) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        texts.push(result.value);
      } else {
        texts.push(await file.text());
      }
    } catch (err) {
      console.error(`Error al procesar el archivo ${file.name}:`, err);
      alert(`No se pudo leer el archivo ${file.name}. Asegúrate de que no esté dañado.`);
    }
  }

  if (texts.length > 0) {
    el.text.value += (el.text.value ? '\n\n' : '') + texts.join('\n\n');
  }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchModuleFromGemini(text, subject, goal, depth, moduleType, apiKey, model, timeoutMs = 20000) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const depthLimits = {
    rapido: { summary: 3, cards: 3, quiz: 3, oral: 2 },
    medio: { summary: 5, cards: 6, quiz: 5, oral: 4 },
    extenso: { summary: 8, cards: 10, quiz: 8, oral: 6 }
  };

  const limits = depthLimits[depth] || depthLimits.medio;

  const prompts = {
    summary: `Genera exactamente ${limits.summary} conceptos clave detallados sobre "${subject}" (Objetivo: ${goal}). Devuelve ÚNICAMENTE un array JSON válido de objetos con este formato estricto: [{"title": "Nombre del Concepto", "desc": "Descripción detallada", "relevance": "Por qué es importante"}]. Sin texto adicional ni formato markdown extra.`,
    cards: `Genera ${limits.cards} tarjetas de estudio para "${subject}". Devuelve ÚNICAMENTE un array JSON válido de objetos: [{"front": "Pregunta", "back": "Respuesta"}]. Sin texto adicional.`,
    quiz: `Genera ${limits.quiz} preguntas de opción múltiple sobre "${subject}". Devuelve ÚNICAMENTE un array JSON válido de objetos: [{"id": 0, "question": "Pregunta", "options": ["Opción A", "Opción B", "Opción C", "Opción D"], "answer": "Opción exacta"}]. Sin texto adicional.`,
    oral: `Genera ${limits.oral} preguntas abiertas para examen oral sobre "${subject}". Devuelve ÚNICAMENTE un array JSON válido de objetos: [{"id": 0, "question": "Pregunta", "keywords": ["palabra1", "palabra2"]}]. Sin texto adicional.`
  };

  const promptText = `${prompts[moduleType]}\n\nMaterial:\n${text.slice(0, 15000)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          response_mime_type: "application/json",
          maxOutputTokens: 2500,
          temperature: 0.2
        }
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

    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) rawText = match[0];

    return JSON.parse(rawText);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Tiempo agotado (20s)');
    throw err;
  }
}

function renderResult(type, data) {
  if (!data) return;

  if (type === 'summary') {
    el.resultTitle.textContent = 'Resumen y Conceptos Clave';
    
    let html = `
      <div class="love-banner">
        <span style="font-size: 1.4rem;">❤️</span>
        <div><strong>Para Ti:</strong> ¡Tú puedes con todo, mi amor! Cada minuto que dedicas a estudiar te acerca a tu meta. Eres brillante, confía en tu preparación. ✨</div>
      </div>

      <div class="summary-header-row">
        <div>
          <h3 style="font-size: 1.2rem; font-weight: 800;">Conceptos Clave Indispensables</h3>
          <p style="font-size: 0.88rem; color: var(--text-muted);">${data.length} términos analizados de tus apuntes</p>
        </div>
        <input type="text" id="conceptSearch" class="summary-search-input" placeholder="Buscar término o definición...">
      </div>

      <div class="concepts-grid" id="conceptsGridContainer">
    `;

    data.forEach(item => {
      const title = typeof item === 'object' ? (item.title || 'Concepto') : 'Concepto';
      const desc = typeof item === 'object' ? (item.desc || item) : item;
      const relevance = typeof item === 'object' ? (item.relevance || 'Fundamental para el examen.') : 'Concepto clave evaluado.';

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
          <div style="font-weight: 700; font-size: 1.05rem;">¿Lista para poner a prueba tu conocimiento?</div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">Evalúa tu comprensión con tarjetas o un cuestionario interactivo.</div>
        </div>
        <div style="display:flex; gap:10px;">
          <button id="goToCardsBtn" style="background:var(--input-bg); color:var(--text); border:1px solid var(--border); padding: 10px 18px; font-size:0.88rem;">Repasar Tarjetas</button>
          <button id="goToQuizBtn" style="background:var(--primary); padding: 10px 18px; font-size:0.88rem;">Hacer Cuestionario</button>
        </div>
      </div>
    `;

    el.view.innerHTML = html;

    const searchInput = document.getElementById('conceptSearch');
    if (searchInput) {
      searchInput.oninput = (e) => {
        const query = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.concept-card');
        cards.forEach(card => {
          const text = card.getAttribute('data-search') || '';
          card.style.display = text.includes(query) ? 'flex' : 'none';
        });
      };
    }

    document.getElementById('goToCardsBtn').onclick = () => {
      document.querySelector('[data-module="cards"]').click();
    };
    document.getElementById('goToQuizBtn').onclick = () => {
      document.querySelector('[data-module="quiz"]').click();
    };

  } else if (type === 'cards') {
    el.resultTitle.textContent = 'Tarjetas Flashcards';
    let idx = 0;
    let masteredCount = 0;

    const updateCardView = () => {
      const c = data[idx];
      el.view.innerHTML = `
        <div class="flashcard-wrapper">
          <div class="flashcard-top-bar">
            <div class="fc-counter-badge">
              <span>Tarjeta ${idx + 1} de ${data.length}</span>
              <span class="fc-mastered-chip">${masteredCount} / ${data.length} dominadas</span>
            </div>
            <div style="font-size:0.85rem; color:var(--text-muted); font-weight:600;">
              Presiona la tarjeta o usa el botón para voltear
            </div>
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
            <button class="btn-fc-flip" id="flipCardBtn">Girar y Ver Respuesta</button>
            <button class="btn-fc-master" id="masterCardBtn">¡Me la sé!</button>
            <button class="btn-fc-nav" id="nextCardBtn">Siguiente</button>
          </div>
        </div>
      `;

      const card3d = document.getElementById('fcCard3d');
      const flipBtn = document.getElementById('flipCardBtn');
      const prevBtn = document.getElementById('prevCardBtn');
      const nextBtn = document.getElementById('nextCardBtn');
      const masterBtn = document.getElementById('masterCardBtn');

      const toggleFlip = () => {
        card3d.classList.toggle('flipped');
        if (card3d.classList.contains('flipped')) {
          flipBtn.textContent = 'Voltear a Pregunta';
        } else {
          flipBtn.textContent = 'Girar y Ver Respuesta';
        }
      };

      card3d.onclick = toggleFlip;
      flipBtn.onclick = toggleFlip;

      prevBtn.onclick = () => {
        idx = (idx - 1 + data.length) % data.length;
        updateCardView();
      };

      nextBtn.onclick = () => {
        idx = (idx + 1) % data.length;
        updateCardView();
      };

      masterBtn.onclick = () => {
        masteredCount = Math.min(data.length, masteredCount + 1);
        idx = (idx + 1) % data.length;
        updateCardView();
      };
    };

    updateCardView();
  } else if (type === 'quiz') {
    el.resultTitle.textContent = 'Cuestionario de Opción Múltiple';
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    let html = `<div class="quiz-container">`;
    
    html += `
      <div class="quiz-progress-bar">
        <span>Evaluación Interactiva (${data.length} preguntas)</span>
        <span id="liveScoreBadge">Aciertos: 0 / ${data.length}</span>
      </div>
    `;

    data.forEach((q, i) => {
      html += `
        <div class="quiz-question-card">
          <span class="quiz-q-tag">Opción Múltiple • ${i + 1} de ${data.length}</span>
          <p class="quiz-q-title">${i + 1}. ${q.question}</p>
      `;
      q.options.forEach((opt, optIdx) => {
        const letter = letters[optIdx] || String.fromCharCode(65 + optIdx);
        html += `
          <label class="quiz-option-label">
            <input type="radio" name="q${i}" value="${opt}" data-qid="${i}" data-ans="${encodeURIComponent(q.answer)}">
            <div class="quiz-letter-badge">${letter}</div>
            <span>${opt}</span>
          </label>
        `;
      });
      html += `</div>`;
    });

    html += `
      <div style="text-align: center; margin-top: 24px;">
        <button id="checkQuizBtn" style="padding: 14px 32px; font-size: 1.05rem;">Calificar Cuestionario</button>
      </div>
      <div id="qRes" style="margin-top:20px;"></div>
    </div>`;

    el.view.innerHTML = html;

    const radioInputs = el.view.querySelectorAll('input[type="radio"]');
    radioInputs.forEach(input => {
      input.addEventListener('change', () => {
        let currentScore = 0;
        data.forEach((q, qIdx) => {
          const selected = el.view.querySelector(`input[name="q${qIdx}"]:checked`);
          if (selected && selected.value === q.answer) {
            currentScore++;
          }
        });
        document.getElementById('liveScoreBadge').textContent = `Aciertos: ${currentScore} / ${data.length}`;
      });
    });

    document.getElementById('checkQuizBtn').onclick = () => {
      let score = 0;
      data.forEach((q, i) => {
        const sel = document.querySelector(`input[name="q${i}"]:checked`);
        if (sel && sel.value === q.answer) score++;
      });
      const pct = Math.round((score / data.length) * 100);
      document.getElementById('qRes').innerHTML = `
        <div style="padding: 18px 24px; background: var(--banner-bg); border-radius: 12px; border: 1px solid var(--banner-border); color: var(--primary); text-align: center; font-size: 1.15rem;">
          <strong>Calificación final: ${score} / ${data.length} (${pct}%)</strong>
          <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 6px;">¡Excelente esfuerzo! Sigue practicando para dominar todos los conceptos.</p>
        </div>
      `;
      document.getElementById('qRes').scrollIntoView({ behavior: 'smooth' });
    };
  } else if (type === 'oral') {
    el.resultTitle.textContent = 'Simulador de Examen Oral';
    let idx = 0;
    const updateOral = () => {
      const q = data[idx];
      el.view.innerHTML = `
        <p style="font-size:1.1rem; margin-bottom:12px;"><strong>Pregunta ${idx + 1}:</strong> ${q.question}</p>
        <div style="display:flex; gap:10px; margin:16px 0; flex-wrap:wrap;">
          <button id="speakBtn" style="background:#0284c7;">Escuchar Pregunta</button>
          <button id="recBtn" style="background:#10b981;">Responder por Voz</button>
          <button id="nextOral">Siguiente Pregunta</button>
        </div>
        <p id="tBox" style="font-style:italic; color:var(--text-muted); margin-top:8px;"></p>
        <div id="oFeedback" style="margin-top:10px;"></div>
      `;
      document.getElementById('speakBtn').onclick = () => {
        const u = new SpeechSynthesisUtterance(q.question);
        u.lang = 'es-ES';
        window.speechSynthesis.speak(u);
      };
      document.getElementById('recBtn').onclick = () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return alert('Tu navegador no soporta reconocimiento de voz (usa Chrome o Edge).');
        const r = new SR();
        r.lang = 'es-ES';
        document.getElementById('tBox').textContent = 'Escuchando tu respuesta...';
        r.start();
        r.onresult = (e) => {
          const text = e.results[0][0].transcript;
          document.getElementById('tBox').textContent = `Tu respuesta: "${text}"`;
          const hits = (q.keywords || []).filter(k => text.toLowerCase().includes(k.toLowerCase()));
          document.getElementById('oFeedback').innerHTML = hits.length > 0 
            ? `<p style="color:var(--success); font-weight:600;">¡Excelente! Mencionaste conceptos clave: ${hits.join(', ')}</p>` 
            : `<p style="color:var(--warning); font-weight:600;">Sugerencia: Procura incluir conceptos como: ${(q.keywords || []).join(', ')}</p>`;
        };
      };
      document.getElementById('nextOral').onclick = () => { idx = (idx + 1) % data.length; updateOral(); };
    };
    updateOral();
  }
}

el.saveTopicBtn.addEventListener('click', () => {
  if (!currentGeneratedData) return;
  const topics = JSON.parse(localStorage.getItem('studyline_saved_topics') || '[]');
  const newTopic = {
    id: Date.now(),
    date: new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
    ...currentGeneratedData,
    allCachedData: cachedModulesData
  };
  topics.unshift(newTopic);
  localStorage.setItem('studyline_saved_topics', JSON.stringify(topics));
  renderSavedTopics();
  alert('Tema guardado con éxito.');
});

function renderSavedTopics() {
  const topics = JSON.parse(localStorage.getItem('studyline_saved_topics') || '[]');
  el.savedCountBadge.textContent = topics.length;

  if (topics.length === 0) {
    el.savedTopicsContainer.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">No hay temas guardados aún.</p>';
    return;
  }

  el.savedTopicsContainer.innerHTML = topics.map(t => `
    <div class="topic-item">
      <div class="topic-info" onclick="loadTopic(${t.id})">
        <div class="topic-title">${t.subject}</div>
        <div class="topic-meta">${t.moduleType.toUpperCase()} • ${t.depth} • ${t.date}</div>
      </div>
      <button class="btn-del" onclick="deleteTopic(${t.id})">Eliminar</button>
    </div>
  `).join('');
}

window.loadTopic = (id) => {
  const topics = JSON.parse(localStorage.getItem('studyline_saved_topics') || '[]');
  const t = topics.find(item => item.id === id);
  if (!t) return;
  
  if (t.allCachedData) {
    cachedModulesData = t.allCachedData;
  } else {
    cachedModulesData = { [t.moduleType]: t.data };
  }

  el.topTopicSubtitle.textContent = `Tema: ${t.subject}`;
  el.bannerSubject.textContent = t.subject;
  el.bannerGoal.textContent = `Objetivo: ${t.goal || 'Estudio'}`;
  el.studyBanner.hidden = false;

  el.resultCard.hidden = false;
  renderResult(currentModule, cachedModulesData[currentModule] || t.data);
  el.resultCard.scrollIntoView({ behavior: 'smooth' });
};

window.deleteTopic = (id) => {
  let topics = JSON.parse(localStorage.getItem('studyline_saved_topics') || '[]');
  topics = topics.filter(item => item.id !== id);
  localStorage.setItem('studyline_saved_topics', JSON.stringify(topics));
  renderSavedTopics();
};