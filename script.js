const STORAGE_KEY = "tango-learned-v2";

function loadLearned() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveLearned(set) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

const learned = loadLearned();
let currentSection = "html"; // "html" | "css"
let currentMode = "flash";   // "flash" | "quiz"
let activeGroup = "すべて";
let query = "";

// --- DOM refs ---
const sectionTabsEl = document.getElementById("sectionTabs");
const modeTabsEl = document.getElementById("modeTabs");
const flashView = document.getElementById("flashView");
const quizView = document.getElementById("quizView");

const grid = document.getElementById("cardGrid");
const template = document.getElementById("cardTemplate");
const filtersEl = document.getElementById("filters");
const searchEl = document.getElementById("search");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");

function currentCards() {
  return SECTIONS[currentSection].cards;
}
function storageId(card) {
  return currentSection + ":" + card.id;
}

// --- タブ切り替え ---
sectionTabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".section-tab");
  if (!btn) return;
  currentSection = btn.dataset.section;
  document.body.classList.toggle("section-css", currentSection === "css");
  [...sectionTabsEl.children].forEach(b => b.classList.toggle("active", b === btn));
  activeGroup = "すべて";
  query = "";
  searchEl.value = "";
  renderFilters();
  renderCards();
  if (currentMode === "quiz") startQuiz();
});

modeTabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-tab");
  if (!btn) return;
  currentMode = btn.dataset.mode;
  [...modeTabsEl.children].forEach(b => b.classList.toggle("active", b === btn));
  flashView.classList.toggle("hidden", currentMode !== "flash");
  quizView.classList.toggle("hidden", currentMode !== "quiz");
  if (currentMode === "quiz") startQuiz();
});

// --- フラッシュカード ---
function renderFilters() {
  const groups = ["すべて", ...new Set(currentCards().map(c => c.group))];
  filtersEl.innerHTML = "";
  groups.forEach(group => {
    const btn = document.createElement("button");
    btn.className = "filter-btn" + (group === activeGroup ? " active" : "");
    btn.textContent = group;
    btn.addEventListener("click", () => {
      activeGroup = group;
      renderFilters();
      renderCards();
    });
    filtersEl.appendChild(btn);
  });
}

function renderCards() {
  grid.innerHTML = "";
  const filtered = currentCards().filter(c => {
    const matchesGroup = activeGroup === "すべて" || c.group === activeGroup;
    const matchesQuery = c.tag.toLowerCase().includes(query.toLowerCase());
    return matchesGroup && matchesQuery;
  });

  filtered.forEach(card => {
    const node = template.content.cloneNode(true);
    const flashcard = node.querySelector(".flashcard");
    const sid = storageId(card);
    flashcard.dataset.id = sid;

    node.querySelector(".category-badge").textContent = card.group;
    node.querySelector(".tag-name").textContent = card.tag;
    node.querySelector(".meaning").textContent = card.meaning;
    node.querySelector(".usage code").textContent = card.usage;
    node.querySelector(".note").textContent = card.note;

    if (learned.has(sid)) {
      flashcard.classList.add("learned");
    }

    flashcard.addEventListener("click", (e) => {
      if (e.target.closest(".learned-btn")) return;
      flashcard.classList.toggle("flipped");
    });

    node.querySelector(".learned-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (learned.has(sid)) {
        learned.delete(sid);
      } else {
        learned.add(sid);
      }
      saveLearned(learned);
      flashcard.classList.toggle("learned");
      updateProgress();
    });

    grid.appendChild(node);
  });

  updateProgress();
}

function updateProgress() {
  const cards = currentCards();
  const total = cards.length;
  const done = cards.filter(c => learned.has(storageId(c))).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  progressBar.style.setProperty("--pct", pct + "%");
  progressLabel.textContent = `${done} / ${total} 覚えた`;
}

searchEl.addEventListener("input", (e) => {
  query = e.target.value;
  renderCards();
});

// --- クイズモード(意味→解答を1文字ずつ4択で組み立てる方式) ---
const QUIZ_LENGTH = 10;
let quizQueue = [];
let quizIndex = 0;
let quizScore = 0; // ノーミスで完答した問題数
let quizCharPool = [];
let quizAnswerChars = [];
let quizPosition = 0;
let quizMistakeInWord = false;
let quizLocked = false;

const quizProgressEl = document.getElementById("quizProgress");
const quizScoreLabelEl = document.getElementById("quizScoreLabel");
const quizQuestionEl = document.getElementById("quizQuestion");
const quizBlanksEl = document.getElementById("quizBlanks");
const quizOptionsEl = document.getElementById("quizOptions");
const quizFeedbackEl = document.getElementById("quizFeedback");
const quizLiveEl = document.getElementById("quizLive");
const quizDoneEl = document.getElementById("quizDone");
const quizDoneCodeEl = document.getElementById("quizDoneCode");
const quizDoneStatusEl = document.getElementById("quizDoneStatus");
const quizNextBtn = document.getElementById("quizNextBtn");
const quizCardEl = document.querySelector(".quiz-card");
const quizResultEl = document.getElementById("quizResult");
const quizResultTextEl = document.getElementById("quizResultText");
const quizRestartBtn = document.getElementById("quizRestartBtn");

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getAnswerWords(card) {
  return card.answer || [card.tag];
}

function buildAnswerChars(words) {
  const chars = [];
  words.forEach((word, wi) => {
    [...word].forEach((ch, ci) => {
      chars.push({ char: ch, wordStart: ci === 0 && wi > 0 });
    });
  });
  return chars;
}

function sectionCharPool(section) {
  const set = new Set();
  SECTIONS[section].cards.forEach(c => {
    getAnswerWords(c).join("").split("").forEach(ch => set.add(ch));
  });
  return [...set];
}

function startQuiz() {
  const cards = currentCards();
  quizCharPool = sectionCharPool(currentSection);
  const n = Math.min(QUIZ_LENGTH, cards.length);
  quizQueue = shuffle(cards).slice(0, n);
  quizIndex = 0;
  quizScore = 0;
  quizCardEl.classList.remove("hidden");
  quizResultEl.classList.add("hidden");
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const card = quizQueue[quizIndex];
  quizAnswerChars = buildAnswerChars(getAnswerWords(card));
  quizPosition = 0;
  quizMistakeInWord = false;
  quizLocked = false;

  quizLiveEl.classList.remove("hidden");
  quizDoneEl.classList.add("hidden");

  quizProgressEl.textContent = `問題 ${quizIndex + 1} / ${quizQueue.length}`;
  quizScoreLabelEl.textContent = `ノーミス正解 ${quizScore}`;
  quizQuestionEl.textContent = card.meaning;

  renderQuizBlanks();
  renderQuizOptions();
}

function renderQuizBlanks() {
  quizBlanksEl.innerHTML = "";
  quizAnswerChars.forEach((item, i) => {
    const b = document.createElement("div");
    b.className = "quiz-blank" + (item.wordStart ? " word-start" : "");
    if (i < quizPosition) {
      b.classList.add("filled");
      b.textContent = item.char;
    } else if (i === quizPosition) {
      b.classList.add("current");
    }
    quizBlanksEl.appendChild(b);
  });
}

function renderQuizOptions() {
  quizFeedbackEl.textContent = "";
  quizFeedbackEl.className = "quiz-feedback";
  const correctChar = quizAnswerChars[quizPosition].char;
  const decoys = shuffle(quizCharPool.filter(c => c !== correctChar)).slice(0, 3);
  const choices = shuffle([correctChar, ...decoys]);

  quizOptionsEl.innerHTML = "";
  choices.forEach(ch => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.textContent = ch;
    btn.addEventListener("click", () => handleQuizChoice(btn, ch, correctChar));
    quizOptionsEl.appendChild(btn);
  });
}

function handleQuizChoice(btn, chosen, correctChar) {
  if (quizLocked) return;
  quizLocked = true;
  [...quizOptionsEl.children].forEach(b => (b.disabled = true));

  if (chosen === correctChar) {
    btn.classList.add("correct");
    quizFeedbackEl.textContent = "正解! この調子で";
    quizFeedbackEl.className = "quiz-feedback correct";
    setTimeout(() => {
      quizPosition++;
      renderQuizBlanks();
      const filledBlank = quizBlanksEl.children[quizPosition - 1];
      if (filledBlank) filledBlank.classList.add("pop");
      if (quizPosition >= quizAnswerChars.length) {
        finishQuizWord();
      } else {
        quizLocked = false;
        renderQuizOptions();
      }
    }, 380);
  } else {
    quizMistakeInWord = true;
    btn.classList.add("wrong");
    quizFeedbackEl.textContent = "違います、もう一度";
    quizFeedbackEl.className = "quiz-feedback wrong";
    setTimeout(() => {
      [...quizOptionsEl.children].forEach(b => {
        b.disabled = false;
        b.classList.remove("wrong");
      });
      quizFeedbackEl.textContent = "";
      quizLocked = false;
    }, 550);
  }
}

function finishQuizWord() {
  const card = quizQueue[quizIndex];
  if (!quizMistakeInWord) quizScore++;

  quizLiveEl.classList.add("hidden");
  quizDoneEl.classList.remove("hidden");
  quizDoneCodeEl.textContent = card.usage;
  quizDoneStatusEl.textContent = quizMistakeInWord ? "完答(ミスあり)" : "ノーミスで完答! 🎉";
  quizScoreLabelEl.textContent = `ノーミス正解 ${quizScore}`;
}

quizNextBtn.addEventListener("click", () => {
  quizIndex++;
  if (quizIndex >= quizQueue.length) {
    quizCardEl.classList.add("hidden");
    quizResultEl.classList.remove("hidden");
    quizResultTextEl.textContent = `結果: ${quizQueue.length}問中 ${quizScore}問ノーミス正解!`;
  } else {
    renderQuizQuestion();
  }
});

quizRestartBtn.addEventListener("click", startQuiz);

// --- 初期化 ---
renderFilters();
renderCards();
