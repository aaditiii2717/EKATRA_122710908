/**
 * ReadEase — app.js
 *
 * Readability formulas implemented (all industry-standard):
 *  1. Flesch Reading Ease      (Flesch, 1948)
 *  2. Flesch-Kincaid Grade     (Kincaid et al., 1975)
 *  3. Gunning Fog Index        (Gunning, 1952)
 *  4. SMOG Grade               (McLaughlin, 1969)
 *  5. Coleman-Liau Index       (Coleman & Liau, 1975)
 *  6. Automated Readability    (Senter & Smith, 1967)
 *
 * Syllable counting uses multi-rule heuristic:
 *  – Vowel-group counting (aeiouy treated as Y)
 *  – Silent-e subtraction
 *  – -le consonant-cluster rule
 *  – -ed suffix rules (no extra syllable unless preceded by d/t)
 *  – Minimum 1 syllable per word
 */

'use strict';

/* ═══════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════ */
const S = {
  age:      null,
  grade:    '',
  interests: [],
  profileSaved: false,   // true after first complete analysis
  history:  [],          // [{snippet, flesch, fk, date, age, grade}]
  result:   null,        // last computed result
  ttsActive: null,       // { id, utterance }
};

/* ═══════════════════════════════════════════════════
   SYLLABLE COUNTER  (heuristic, English)
═══════════════════════════════════════════════════ */
function countSyllables(raw) {
  const word = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;

  let w = word;

  // Strip common non-syllabic suffixes that don't add a syllable
  // -ed: only adds syllable if stem ends in d or t
  w = w.replace(/([^dt])ed$/, '$1');
  // -es: silent when preceded by a sibilant after a vowel
  w = w.replace(/([aeiou])es$/, '$1s');

  // Count vowel groups (aeiouy)
  const groups = w.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;

  // Silent terminal -e (not preceded by vowel, not -le)
  if (/[^aeiouy]e$/.test(w) && !/[bcdfghjklmnpqrstvwxz]le$/.test(w)) {
    count -= 1;
  }

  // Consonant + le at end adds a syllable (ap-ple, sim-ple)
  if (/[^aeiouy]le$/.test(w)) count += 0; // already counted in vowel groups

  // Ensure minimum
  return Math.max(1, count);
}

/* ═══════════════════════════════════════════════════
   TEXT TOKENISERS
═══════════════════════════════════════════════════ */
/**
 * Split text into sentences using punctuation boundaries.
 * Returns only sentences with at least 2 words.
 */
function splitSentences(text) {
  // Match sequences ending in .  !  ?  (with optional quotes/spaces)
  const raw = text.match(/[^.!?]+[.!?]+["'\u2019\u201d]?\s*/g) || [];
  // Also catch a final fragment without terminal punctuation
  const lastChunk = text.replace(/.*[.!?]["'\u2019\u201d]?\s*/s, '').trim();
  if (lastChunk && lastChunk.split(/\s+/).length >= 2) raw.push(lastChunk);
  return raw.map(s => s.trim()).filter(s => s.split(/\s+/).filter(Boolean).length >= 2);
}

/** Extract alphabetic word tokens from a string. */
function getWords(text) {
  return text.replace(/[^a-zA-Z'\-\s]/g, ' ').split(/\s+/).filter(w => w.length > 0);
}

/** Count only alphanumeric characters (for ARI / Coleman-Liau). */
function countChars(text) {
  return (text.match(/[a-zA-Z0-9]/g) || []).length;
}

/* ═══════════════════════════════════════════════════
   READABILITY FORMULAS
═══════════════════════════════════════════════════ */
/**
 * Flesch Reading Ease (0–100; higher = easier)
 *   206.835 − 1.015·(W/S) − 84.6·(Syl/W)
 */
function fleschReadingEase(W, S, Syl) {
  if (S === 0 || W === 0) return 0;
  return Math.min(100, Math.max(0, 206.835 - 1.015 * (W / S) - 84.6 * (Syl / W)));
}

/**
 * Flesch-Kincaid Grade Level (≈ US grade)
 *   0.39·(W/S) + 11.8·(Syl/W) − 15.59
 */
function fleschKincaid(W, S, Syl) {
  if (S === 0 || W === 0) return 0;
  return Math.max(0, 0.39 * (W / S) + 11.8 * (Syl / W) - 15.59);
}

/**
 * Gunning Fog Index (grade level; higher = harder)
 *   0.4·[(W/S) + 100·(CW/W)]
 *   CW = words with 3+ syllables (excluding proper nouns, compound words)
 */
function gunningFog(W, S, CW) {
  if (S === 0 || W === 0) return 0;
  return Math.max(0, 0.4 * (W / S + 100 * (CW / W)));
}

/**
 * SMOG Grade (gold-standard for 100% comprehension)
 *   1.0430·√(P × 30/S) + 3.1291
 *   P = count of polysyllabic (3+ syl) words
 *   Requires extrapolation when S < 30
 */
function smogGrade(S, P) {
  if (S === 0) return 0;
  return Math.max(0, 1.0430 * Math.sqrt(P * (30 / S)) + 3.1291);
}

/**
 * Coleman-Liau Index (uses characters, not syllables)
 *   0.0588·L − 0.296·S − 15.8
 *   L = avg letters per 100 words
 *   S = avg sentences per 100 words
 */
function colemanLiau(W, sentCount, charCount) {
  if (W === 0) return 0;
  const L = (charCount / W) * 100;
  const Sv = (sentCount / W) * 100;
  return Math.max(0, 0.0588 * L - 0.296 * Sv - 15.8);
}

/**
 * Automated Readability Index
 *   4.71·(C/W) + 0.5·(W/S) − 21.43
 *   C = character count (alphanumeric only)
 */
function automatedReadability(W, S, C) {
  if (S === 0 || W === 0) return 0;
  return Math.max(0, 4.71 * (C / W) + 0.5 * (W / S) - 21.43);
}

/* ═══════════════════════════════════════════════════
   PER-SENTENCE DIFFICULTY SCORE
   Weighted composite — higher = harder
═══════════════════════════════════════════════════ */
function sentenceDifficulty(sent, userAge) {
  const words = getWords(sent);
  const W = words.length;
  if (W === 0) return { score: 0, W, syllables: 0, complexWords: 0, avgSyl: 0 };

  const syllables = words.reduce((t, w) => t + countSyllables(w), 0);
  const complexWords = words.filter(w => countSyllables(w) >= 3).length;
  const avgSyl = syllables / W;

  // Per-sentence pseudo-Flesch (treating each sentence as a 1-sentence doc)
  const sentFlesch = Math.min(100, Math.max(0, 206.835 - 1.015 * W - 84.6 * avgSyl));
  // Per-sentence Fog
  const sentFog = 0.4 * (W + 100 * (complexWords / Math.max(W, 1)));

  // Composite (0–100 scale)
  let score = (100 - sentFlesch) * 0.45 + sentFog * 2.8 + (complexWords / Math.max(W, 1)) * 35;

  // Age calibration: younger readers penalised more for long/complex sentences
  // A 5-year-old is affected ~1.5× more than a 25-year-old
  const ageFactor = Math.max(0.5, 1.5 - (userAge - 5) * 0.025);
  score = Math.min(100, score * ageFactor);

  return { score: +score.toFixed(2), W, syllables, complexWords, avgSyl: +avgSyl.toFixed(2) };
}

/* ═══════════════════════════════════════════════════
   FULL ANALYSIS
═══════════════════════════════════════════════════ */
function analyze(text, age) {
  const sentences = splitSentences(text);
  const allWords = getWords(text);
  const W = allWords.length;
  const Syl = allWords.reduce((t, w) => t + countSyllables(w), 0);
  const CW = allWords.filter(w => countSyllables(w) >= 3).length;  // complex words (Fog)
  const P  = CW;                                                     // polysyllabic (SMOG)
  const C  = countChars(text);
  const S  = sentences.length;
  const avgSentLen = S > 0 ? +(W / S).toFixed(1) : 0;
  const avgSylPerWord = W > 0 ? +(Syl / W).toFixed(2) : 0;
  const avgWordLen = W > 0 ? +(C / W).toFixed(1) : 0;

  // Global formula scores
  const flesch = +fleschReadingEase(W, S, Syl).toFixed(1);
  const fk     = +fleschKincaid(W, S, Syl).toFixed(1);
  const fog    = +gunningFog(W, S, CW).toFixed(1);
  const smog   = +smogGrade(S, P).toFixed(1);
  const cl     = +colemanLiau(W, S, C).toFixed(1);
  const ari    = +automatedReadability(W, S, C).toFixed(1);

  // Average grade level across all grade-level formulas
  const avgGrade = +((fk + fog + smog + cl + ari) / 5).toFixed(1);

  // Per-sentence scoring
  const scored = sentences.map((sent, i) => {
    const d = sentenceDifficulty(sent, age);
    return { index: i, text: sent, ...d };
  });

  // Sort descending by difficulty, take top N (up to 5 or however many exist)
  const maxHard = Math.min(5, scored.length);
  const hard = [...scored].sort((a, b) => b.score - a.score).slice(0, maxHard);

  return { sentences, W, S, Syl, CW, C, avgSentLen, avgSylPerWord, avgWordLen, flesch, fk, fog, smog, cl, ari, avgGrade, scored, hard };
}

/* ═══════════════════════════════════════════════════
   HELPERS — labels & age calibration
═══════════════════════════════════════════════════ */
function fleschLabel(score) {
  if (score >= 90) return 'Very Easy';
  if (score >= 80) return 'Easy';
  if (score >= 70) return 'Fairly Easy';
  if (score >= 60) return 'Standard';
  if (score >= 50) return 'Fairly Difficult';
  if (score >= 30) return 'Difficult';
  return 'Very Difficult';
}

function gradeLabel(grade) {
  const m = { primary:'primary school student', middle:'middle school student', high:'high school student', undergrad:'college student', postgrad:'postgraduate student', adult:'working adult' };
  return m[grade] || 'student';
}

/** Approximate expected FK grade for a given age */
function expectedGradeForAge(age) {
  if (age <=  6) return 1;
  if (age <=  7) return 2;
  if (age <=  8) return 3;
  if (age <=  9) return 4;
  if (age <= 10) return 5;
  if (age <= 11) return 6;
  if (age <= 12) return 7;
  if (age <= 13) return 8;
  if (age <= 14) return 9;
  if (age <= 15) return 10;
  if (age <= 16) return 11;
  if (age <= 17) return 12;
  if (age <= 22) return 14;  // college
  return 16;                  // postgrad / adult
}

function difficultyClass(fk, age) {
  const expected = expectedGradeForAge(age);
  const delta = fk - expected;
  if (delta <= -1)  return 'easy';
  if (delta <= 2)   return 'moderate';
  return 'hard';
}

function difficultyEmoji(cls) {
  return { easy: '✅', moderate: '⚡', hard: '🔴' }[cls] || '🔵';
}

function difficultyMessage(fk, flesch, age, grade, cls) {
  const expected = expectedGradeForAge(age);
  const delta = +(fk - expected).toFixed(1);
  const dir = delta >= 0 ? `${delta} grade${Math.abs(delta) !== 1 ? 's' : ''} above` : `${Math.abs(delta)} grade${Math.abs(delta) !== 1 ? 's' : ''} below`;
  const verdict = { easy: 'Well within your range — comfortable reading.', moderate: 'Slightly challenging but manageable for you.', hard: 'Significantly above your level — this will be tough.' }[cls];
  return `<strong>Flesch ${flesch}/100 (${fleschLabel(flesch)}) · FK Grade ${fk} · ${dir} your level.</strong><br>${verdict}`;
}

/* ═══════════════════════════════════════════════════
   HIGHLIGHT hard words (3+ syllables)
═══════════════════════════════════════════════════ */
function highlightHard(text) {
  return text.replace(/\b([A-Za-z]{5,})\b/g, w => {
    if (countSyllables(w) >= 3) return `<mark>${w}</mark>`;
    return w;
  });
}

/* ═══════════════════════════════════════════════════
   PLAIN-ENGLISH SIMPLIFIER
═══════════════════════════════════════════════════ */
const SYNONYMS = {
  // Connectives
  'consequently':'as a result','subsequently':'later','nevertheless':'still',
  'notwithstanding':'despite this','furthermore':'also','additionally':'also',
  'henceforth':'from now on','aforementioned':'the previously mentioned',
  'pursuant':'following','heretofore':'until now','inasmuch':'since',
  'whereas':'while','hitherto':'until now','accordingly':'so',
  'thereafter':'after that','thereby':'by doing so','hence':'so',
  'thus':'so','therefore':'so','however':'but','although':'even though',
  'despite':'even with','regardless':'no matter what',
  // Verbs
  'demonstrate':'show','facilitate':'help','implement':'carry out',
  'accumulate':'build up','accelerate':'speed up','communicate':'share',
  'comprehend':'understand','deteriorate':'get worse','disseminate':'spread',
  'enumerate':'list','evaluate':'judge','formulate':'create','generate':'make',
  'incorporate':'include','initiate':'start','terminate':'end',
  'consolidate':'combine','utilize':'use','establish':'set up',
  'indicate':'show','illustrate':'show','elaborate':'explain further',
  'acknowledge':'admit','anticipate':'expect','appreciate':'value',
  'collaborate':'work together','compensate':'pay back','concentrate':'focus',
  'contaminate':'pollute','contribute':'add to','coordinate':'organize',
  'criticize':'find fault with','deliberate':'think carefully','differentiate':'tell apart',
  'eliminate':'remove','emphasize':'stress','encounter':'meet','exaggerate':'overstate',
  'investigate':'look into','manipulate':'control','negotiate':'discuss terms',
  'participate':'take part','predominate':'be the main','regulate':'control',
  'represent':'stand for','retaliate':'fight back','scrutinize':'examine closely',
  'simulate':'copy','speculate':'guess','tolerate':'put up with',
  'transform':'change','undermine':'weaken','validate':'confirm',
  'exacerbate':'make worse','alleviate':'ease','perpetuate':'keep going',
  'precipitate':'cause','substantiate':'prove','corroborate':'confirm',
  'ascertain':'find out','circumvent':'get around','mitigate':'reduce',
  'instigate':'start','advocate':'support','contradict':'go against',
  'commenced':'started','obtained':'got','required':'needed',
  'attempted':'tried','requested':'asked','provided':'gave','received':'got',
  'trolling':'harassing online','trolled':'harassed online',
  'accusing':'blaming','accused':'blamed','issuing':'giving out',
  'issued':'gave out','facing':'dealing with','sparked':'caused',
  // Nouns
  'criticism':'negative comments','sentiments':'feelings',
  'sentiment':'feeling','controversy':'heated argument','apology':'saying sorry',
  'religious':'faith-related','religion':'faith',
  'phenomenon':'event','characteristic':'feature','individuals':'people',
  'methodology':'method','environment':'surroundings','circumstances':'situation',
  'investigation':'study','requirements':'needs','opportunities':'chances',
  'modification':'change','observation':'watching','perspective':'view',
  'regulation':'rule','comprehension':'understanding',
  'collaboration':'teamwork','compensation':'payment',
  'coordination':'organization','deliberation':'careful thought',
  'elimination':'removal','emphasis':'focus','manipulation':'control',
  'negotiation':'discussion','participation':'involvement',
  'retaliation':'fighting back','scrutiny':'close examination',
  'speculation':'guessing','tolerance':'patience',
  'transformation':'big change','validation':'confirmation',
  'implication':'meaning','interpretation':'understanding','perception':'view',
  'assumption':'belief','conclusion':'final decision','recommendation':'suggestion',
  'implementation':'putting into action','consideration':'thought',
  'identification':'finding','evaluation':'judging','documentation':'record',
  'authorization':'permission','administration':'management',
  'communication':'sharing','determination':'strong will',
  'expectation':'what someone hopes for','qualification':'skill',
  'infrastructure':'basic systems','discrimination':'unfair treatment',
  'prejudice':'unfair opinion','awareness':'knowing about',
  'harassment':'bullying','intimidation':'scaring','humiliation':'embarrassment',
  'predominantly':'mainly','substantial':'large','approximately':'about',
  'significant':'important','particularly':'especially','extraordinary':'amazing',
  'fundamental':'basic','sophisticated':'complex','insufficient':'not enough',
  'equivalent':'equal','prohibited':'not allowed','virtually':'almost',
  'typically':'usually','continuously':'all the time','throughout':'all through',
  'pertaining':'relating','concerning':'about','regarding':'about',
  'subsequent':'following','preceding':'before','sensitive':'touchy',
};

/**
 * Simplify a sentence into plain English.
 * 1. Replace words using synonym table
 * 2. Break at relative clauses (who/which)
 * 3. Break at conjunctions for long sentences
 * 4. If result is still very similar, add a clarity prefix
 */
function simplify(text) {
  let s = text.trim();

  // 1. Replace synonyms — longer matches first to avoid partial replacements
  const sortedSynonyms = Object.entries(SYNONYMS).sort((a, b) => b[0].length - a[0].length);
  sortedSynonyms.forEach(([hard, easy]) => {
    const esc = hard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\b${esc}\\b`, 'gi'), (match) => {
      const isCapitalised = match[0] === match[0].toUpperCase() && /[A-Z]/.test(match[0]);
      return isCapitalised ? easy.charAt(0).toUpperCase() + easy.slice(1) : easy;
    });
  });

  // 2. Split at "who/which + verb" relative clauses
  s = s.replace(
    /,\s*(who|which)\s+(was|were|has|have|had|is|are|began|started|caused|said|made|helped|tried|went|showed|gave|took|found|kept|turned|became|wanted|needed|asked|told)/gi,
    (_, pron, verb) => `. ${pron.charAt(0).toUpperCase() + pron.slice(1)} ${verb}`
  );
  // Simpler relative clause fallback
  s = s.replace(/,\s*(who|which|that)\s+/gi, '. This ');

  // 3. Semicolons → new sentence
  s = s.replace(/;\s*/g, '. ');

  // 4. Break at conjunctions for long sentences
  if (s.length > 110) {
    s = s.replace(
      /,\s*(and|but|so|yet|while|although|because|since|after|before|when|if|as)\s+/gi,
      (_, conj) => `. ${conj.charAt(0).toUpperCase() + conj.slice(1)} `
    );
  }

  // 5. Clean up spacing and capitalise after periods
  s = s
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .replace(/\.\s+([a-z])/g, (_, c) => `. ${c.toUpperCase()}`)
    .trim();

  // 6. Similarity check — if result barely differs from original, add prefix
  const origSet = new Set(text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean));
  const newSet  = new Set(s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean));
  const sameCount = [...newSet].filter(w => origSet.has(w)).length;
  const similarity = newSet.size > 0 ? sameCount / newSet.size : 1;

  if (similarity > 0.84 && s.length > 70) {
    s = `Simply put: ${s}`;
  }

  if (s.length > 320) s = s.slice(0, 320) + '…';
  return s;
}
function whyHard(sent) {
  const words = getWords(sent.text);
  const reasons = [];
  if (sent.W > 22) reasons.push(`long sentence (${sent.W} words)`);
  if (sent.complexWords > 2) {
    const examples = words.filter(w => countSyllables(w) >= 3).slice(0, 3);
    reasons.push(`${sent.complexWords} complex words (e.g., <em>${examples.join(', ')}</em>)`);
  }
  if (sent.avgSyl > 1.9) reasons.push(`high average syllables per word (${sent.avgSyl})`);
  if (reasons.length === 0) reasons.push('dense vocabulary and sentence structure');
  return reasons.map((r, i) => i === 0 ? r.charAt(0).toUpperCase() + r.slice(1) : r).join('; ') + '.';
}


/* ═══════════════════════════════════════════════════
   HISTORY (localStorage)
═══════════════════════════════════════════════════ */
const HISTORY_KEY = 'readease_history_v2';
const PROFILE_KEY = 'readease_profile_v2';

function loadHistory() {
  try { S.history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { S.history = []; }
}

function saveHistory(entry) {
  S.history.unshift(entry);
  if (S.history.length > 10) S.history = S.history.slice(0, 10);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(S.history)); }
  catch {}
}

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (p && p.age && p.grade) {
      S.age = p.age; S.grade = p.grade; S.interests = p.interests || [];
      S.profileSaved = true;
      // Restore UI
      document.getElementById('user-age').value = S.age;
      document.getElementById('user-grade').value = S.grade;
      S.interests.forEach(v => {
        const chip = document.querySelector(`.chip[data-val="${v}"]`);
        if (chip) chip.classList.add('active');
      });
    }
  } catch {}
}

function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ age: S.age, grade: S.grade, interests: S.interests })); }
  catch {}
}

function clearHistory() {
  S.history = [];
  try { localStorage.removeItem(HISTORY_KEY); }
  catch {}
  renderHistory();
}

/* ═══════════════════════════════════════════════════
   RENDER HISTORY
═══════════════════════════════════════════════════ */
function renderHistory() {
  const sec  = document.getElementById('history-section');
  const list = document.getElementById('history-list');
  if (!S.history.length) { sec.classList.add('hidden'); return; }

  sec.classList.remove('hidden');
  list.innerHTML = S.history.map((h, i) => `
    <div class="history-item" onclick="loadHistoryItem(${i})" title="Click to view details">
      <span class="hi-text">"${h.snippet}"</span>
      <div class="hi-meta">
        <span class="hi-badge">Flesch ${h.flesch}</span>
        <span class="hi-badge">FK Grade ${h.fk}</span>
        <span class="hi-date">${h.date}</span>
      </div>
    </div>
  `).join('');
}

function loadHistoryItem(i) {
  /* Re-run analysis on saved text (not stored — just show a toast) */
  alert(`History item ${i + 1}: Flesch ${S.history[i].flesch}, FK Grade ${S.history[i].fk}\n\nTo re-analyze, paste the text again in the analyzer.`);
}

/* ═══════════════════════════════════════════════════
   RENDER RESULTS
═══════════════════════════════════════════════════ */
function renderResults(r) {
  const { W, S: sentCount, Syl, CW, avgSentLen, avgSylPerWord, avgWordLen,
          flesch, fk, fog, smog, cl, ari, avgGrade, hard } = r;

  // Subtitle
  const ageTxt = `${S.age}-year-old ${gradeLabel(S.grade)}`;
  document.getElementById('result-subtitle').innerHTML = `Calibrated for a <strong>${ageTxt}</strong>`;

  // Difficulty banner
  const cls = difficultyClass(fk, S.age);
  const banner = document.getElementById('diff-banner');
  banner.className = `diff-banner ${cls}`;
  document.getElementById('diff-icon').textContent = difficultyEmoji(cls);
  document.getElementById('diff-text').innerHTML = difficultyMessage(fk, flesch, S.age, S.grade, cls);

  // Gauge
  const circumference = 257.6;
  const frac = Math.min(1, Math.max(0, flesch / 100));
  document.getElementById('g-fill').style.strokeDashoffset = circumference - frac * circumference;
  document.getElementById('g-score').textContent = flesch.toFixed(0);
  document.getElementById('g-sublabel').textContent = fleschLabel(flesch);

  // Grade summary (3 simple pills)
  const delta = +(fk - expectedGradeForAge(S.age)).toFixed(1);
  const avgGradeDisplay = fk.toFixed(1);
  document.getElementById('gs-grade').textContent = `Grade ${avgGradeDisplay}`;
  const ageMatchLabel = delta > 0.5 ? `+${delta} above` : delta < -0.5 ? `${Math.abs(delta)} below` : 'At your level';
  const ageMatchEl = document.getElementById('gs-age-match');
  ageMatchEl.textContent = ageMatchLabel;
  ageMatchEl.style.color = cls === 'easy' ? 'var(--green)' : cls === 'hard' ? 'var(--red)' : 'var(--amber)';
  const complexPct = W > 0 ? Math.round((CW / W) * 100) : 0;
  document.getElementById('gs-complex-pct').textContent = `${complexPct}%`;

  // Quick stats
  document.getElementById('qs-words').textContent   = W;
  document.getElementById('qs-sents').textContent   = sentCount;
  document.getElementById('qs-syl').textContent     = Syl;
  document.getElementById('qs-asl').textContent     = avgSentLen;
  document.getElementById('qs-asw').textContent     = avgSylPerWord;
  document.getElementById('qs-complex').textContent = CW;

  // Hard sentences — context-aware title & subtitle
  const n = hard.length;
  const maxDifficulty = hard.length > 0 ? hard[0].score : 0;
  const isAllEasy = cls === 'easy' || maxDifficulty < 20;

  // Title
  let sectionTitle, sectionSub, ctaTitle, ctaSub, explSectionTitle, explBtnText;
  if (isAllEasy) {
    sectionTitle = n === 1
      ? '📋 Sentence Reviewed'
      : `📋 ${n} Sentences Reviewed`;
    sectionSub   = 'This text reads comfortably for your age. The sentence below is shown for reference.';
    ctaTitle     = 'Want to explore this sentence further?';
    ctaSub       = 'We can break it down into even simpler language if you like.';
    explSectionTitle = '💡 Sentence Breakdown';
    explBtnText  = 'Yes, Break It Down';
  } else if (cls === 'moderate') {
    sectionTitle = n <= 1
      ? '⚠️ Most Challenging Sentence'
      : `⚠️ ${n} Most Challenging Sentences`;
    sectionSub   = 'These sentences may need a second read. Highlighted words have 3+ syllables.';
    ctaTitle     = 'Want plain-English explanations?';
    ctaSub       = 'Each sentence decoded into simpler language.';
    explSectionTitle = '💡 Plain-English Explanations';
    explBtnText  = 'Yes, Explain Them!';
  } else {
    sectionTitle = n <= 1
      ? '🔍 Hardest Sentence Found'
      : `🔍 ${n} Hardest Sentences`;
    sectionSub   = 'Ranked by composite difficulty for your age. Highlighted words have 3+ syllables.';
    ctaTitle     = 'Want plain-English explanations?';
    ctaSub       = 'Each hard sentence decoded into simple language.';
    explSectionTitle = '💡 Plain-English Explanations';
    explBtnText  = 'Yes, Explain Them!';
  }

  document.getElementById('hard-title').textContent = sectionTitle;
  document.querySelector('#hard-list')?.previousElementSibling?.querySelector('.rb-sub')  // update subtitle
  document.getElementById('hard-pill').textContent = `${n} of ${sentCount}`;

  // Update the rb-sub directly
  const rbSub = document.querySelector('.results-block .rb-sub');
  if (rbSub) rbSub.textContent = sectionSub;

  // Update explain CTA
  document.getElementById('ecta-title').textContent = ctaTitle;
  document.getElementById('ecta-sub').textContent   = ctaSub;
  document.getElementById('explain-btn').textContent = explBtnText;
  // Store for toggle reset
  S._explBtnText = explBtnText;
  S._explTitle   = explSectionTitle;

  // Hard sentence cards
  const hardList = document.getElementById('hard-list');
  hardList.innerHTML = '';
  hard.forEach((sent, i) => {
    const rank = i + 1;
    const card = document.createElement('div');
    card.className = `hard-card r${rank}`;
    card.innerHTML = `
      <div class="hc-rank-bar"></div>
      <div class="hc-body">
        <div class="hc-top">
          <div class="hc-num">${rank}</div>
          <div class="hc-text">${highlightHard(sent.text)}</div>
        </div>
      </div>
      <div class="hc-footer">
        <div class="hc-metrics">
          <span class="hc-metric">Words: <strong>${sent.W}</strong></span>
          <span class="hc-metric">Avg syllables: <strong>${sent.avgSyl}</strong></span>
          <span class="hc-metric">Complex words: <strong>${sent.complexWords}</strong></span>
          <span class="hc-metric">Difficulty: <strong>${sent.score}/100</strong></span>
        </div>
        <button class="btn-audio" id="play-s-${rank}" onclick="speakText('play-s-${rank}', \`${esc(sent.text)}\`)">🔊 Listen</button>
      </div>
    `;
    hardList.appendChild(card);
  });

  // Build explanations (hidden)
  buildExplanations(hard, explSectionTitle);

  // Reset explain section
  document.getElementById('expl-section').classList.add('hidden');
  document.getElementById('expl-section').querySelector('h4').textContent = explSectionTitle;
  S.result = r;
}

function buildExplanations(hard, sectionTitle) {
  const list = document.getElementById('expl-list');
  list.innerHTML = '';
  const isEasyContext = sectionTitle && sectionTitle.includes('Breakdown');
  hard.forEach((sent, i) => {
    const rank = i + 1;
    const simpleText = simplify(sent.text);
    const why = whyHard(sent);
    const card = document.createElement('div');
    card.className = 'expl-card';
    // For easy texts, hide the "why is this hard" section
    const whySection = isEasyContext ? '' : `
      <div class="expl-why">
        <span class="expl-why-label">Why is this tricky?</span>
        ${why}
      </div>`;
    card.innerHTML = `
      <div class="expl-orig">
        <span class="expl-orig-label">Sentence #${rank}</span>
        ${sent.text}
      </div>
      <div class="expl-body">
        <div class="expl-simple"><strong>In simple words:</strong> ${simpleText}</div>
        ${whySection}
      </div>
      <div class="expl-audio-row">
        <span>🔊 Hear this explanation read aloud</span>
        <button class="btn-audio" id="play-e-${rank}" onclick="speakText('play-e-${rank}', \`${esc(simpleText)}\`)">▶ Play</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function esc(str) {
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

/* ═══════════════════════════════════════════════════
   TEXT-TO-SPEECH
═══════════════════════════════════════════════════ */
let _ttsBtn = null;

function speakText(btnId, text) {
  if (!window.speechSynthesis) {
    alert('Text-to-speech is not supported in your browser. Please use Chrome or Edge.');
    return;
  }

  // If same button: stop
  if (_ttsBtn === btnId && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    resetTtsBtn(btnId);
    _ttsBtn = null;
    return;
  }

  // Stop existing
  window.speechSynthesis.cancel();
  if (_ttsBtn) { resetTtsBtn(_ttsBtn); _ttsBtn = null; }

  const utt = new SpeechSynthesisUtterance(text);
  utt.rate   = S.age < 10 ? 0.78 : S.age < 15 ? 0.88 : 0.94;
  utt.pitch  = 1.05;
  utt.volume = 1;

  // Pick a good English voice
  const voices = window.speechSynthesis.getVoices();
  const best = voices.find(v => v.lang === 'en-US' && v.localService)
             || voices.find(v => v.lang === 'en-GB' && v.localService)
             || voices.find(v => v.lang.startsWith('en'));
  if (best) utt.voice = best;

  const btn = document.getElementById(btnId);
  if (btn) { btn.classList.add('playing'); btn.textContent = '⏹ Stop'; }
  _ttsBtn = btnId;

  utt.onend = utt.onerror = () => { resetTtsBtn(btnId); _ttsBtn = null; };
  window.speechSynthesis.speak(utt);
}

function resetTtsBtn(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.classList.remove('playing');
  // Determine icon from id prefix
  btn.textContent = btnId.startsWith('play-s-') ? '🔊 Listen' : '▶ Play';
}

/* ═══════════════════════════════════════════════════
   WIZARD NAVIGATION
═══════════════════════════════════════════════════ */
function showPanel(id) {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goToStep1() {
  window.speechSynthesis && window.speechSynthesis.cancel();
  showPanel('step1-panel');
}

function goToStep2() {
  const age   = parseInt(document.getElementById('user-age').value, 10);
  const grade = document.getElementById('user-grade').value;
  if (!age || age < 5 || age > 80) { showError('Please enter a valid age between 5 and 80.'); return; }
  if (!grade) { showError('Please select your study level.'); return; }

  S.age = age; S.grade = grade;
  saveProfile();
  updateStep2Profile();
  showPanel('step2-panel');
}

function updateStep2Profile() {
  const line = document.getElementById('step2-profile-line');
  line.innerHTML = `Calibrating for a <strong>${S.age}-year-old ${gradeLabel(S.grade)}</strong>. <button class="link-btn" onclick="goToStep1()">Change profile</button>`;
}

function goToStep3() {
  const text = document.getElementById('main-text').value.trim();
  if (!text) { showError('Please paste some text first.'); return; }

  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    showError('Could not detect any complete sentences. Please paste longer text.');
    return;
  }

  // Stop any TTS
  window.speechSynthesis && window.speechSynthesis.cancel();

  showLoader(true);
  // Brief delay for UX
  setTimeout(() => {
    try {
      const r = analyze(text, S.age);
      S.profileSaved = true;

      // Save to history
      const snippet = text.replace(/\s+/g, ' ').slice(0, 80);
      saveHistory({
        snippet,
        flesch: r.flesch,
        fk:     r.fk,
        date:   new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }),
        age:    S.age,
        grade:  S.grade,
      });

      showLoader(false);
      renderResults(r);
      showPanel('step3-panel');
      document.getElementById('tool').scrollIntoView({ behavior: 'smooth', block: 'start' });
      renderHistory();
    } catch (e) {
      showLoader(false);
      showError('Something went wrong during analysis. Please try with different text.');
      console.error(e);
    }
  }, 900);
}

/**
 * "Analyze Another Text" — skip Step 1 if profile already saved.
 */
function analyzeAnother() {
  window.speechSynthesis && window.speechSynthesis.cancel();
  document.getElementById('main-text').value = '';
  updateWordCount('');

  if (S.profileSaved) {
    updateStep2Profile();
    showPanel('step2-panel');
  } else {
    showPanel('step1-panel');
  }
  document.getElementById('tool').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleExplanations() {
  const sec = document.getElementById('expl-section');
  const btn = document.getElementById('explain-btn');
  const hidden = sec.classList.contains('hidden');
  sec.classList.toggle('hidden', !hidden);
  btn.textContent = hidden ? 'Hide' : (S._explBtnText || 'Yes, Show Me!');
  if (hidden) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ═══════════════════════════════════════════════════
   MISC UI HELPERS
═══════════════════════════════════════════════════ */
function showLoader(show) {
  const el = document.getElementById('loading-overlay');
  el.classList.toggle('show', show);
}

function showError(msg) {
  // Simple inline toast — no alert()
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position:fixed;bottom:32px;left:50%;transform:translateX(-50%);
      background:#0f172a;color:#fff;padding:12px 22px;border-radius:100px;
      font-size:.88rem;font-weight:600;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.25);
      opacity:0;transition:opacity .3s;pointer-events:none;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3200);
}

function updateWordCount(text) {
  const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const sents = splitSentences(text).length;
  document.getElementById('wc-words').textContent = `${words} word${words !== 1 ? 's' : ''}`;
  document.getElementById('wc-sents').textContent = `${sents} sentence${sents !== 1 ? 's' : ''}`;
}

/* ═══════════════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════════════ */
// Chips
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('active');
    const v = chip.dataset.val;
    if (chip.classList.contains('active')) { if (!S.interests.includes(v)) S.interests.push(v); }
    else S.interests = S.interests.filter(i => i !== v);
  });
});

// Textarea live counter
document.getElementById('main-text').addEventListener('input', e => updateWordCount(e.target.value));

// Age input — show/hide interests for age > 12
function toggleInterests(age) {
  const group = document.getElementById('interests-group');
  if (!group) return;
  if (age > 12) {
    group.classList.remove('hidden');
  } else {
    group.classList.add('hidden');
    // Clear interest selections for young children
    if (age <= 12) {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      S.interests = [];
    }
  }
}

document.getElementById('user-age').addEventListener('input', e => {
  const age = parseInt(e.target.value, 10);
  if (!isNaN(age)) toggleInterests(age);
});

// Navbar scroll effect
window.addEventListener('scroll', () => {
  document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 30);
}, { passive: true });

// Preload TTS voices
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices());
}

/* ═══════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════ */
loadHistory();
loadProfile();
renderHistory();
// Restore interest visibility based on saved age
if (S.age) toggleInterests(S.age);

// If profile was already saved, start at step 2 next time
// (but first visit always shows step 1 so user can confirm)
