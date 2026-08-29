/* ============================================================
   Dress Up! — shared scenario and competition flow.

   Each dress-up mode owns its wardrobe and renderer. Once that mode has
   initialized, it starts this controller with:

     DressUpCompetition.start({
       getOutfit,                 // () => serializable outfit snapshot
       makeRival,                 // (scenario) => rival outfit snapshot
       renderSnapshot,            // (container, snapshot) => void
       scoreOutfit,               // (snapshot, scenario, judge) => 1..10
       beforeCompetition,         // optional () => void
     });

   This file deliberately has no network or module dependencies so it also
   works when either HTML page is opened directly with file://.
   ============================================================ */

(function installDressUpCompetition(global) {
  "use strict";

  const RIVAL_NAME = "Mika";
  // Keep the competition encouraging: a themed player look should usually
  // beat Mika's polished preset, while an off-theme outfit can still lose.
  const PLAYER_SCORE_EDGE = 3.5;

  const SCENARIOS = Object.freeze([
    Object.freeze({
      id: "wedding",
      emoji: "💐",
      label: "Garden Wedding",
      title: "A magical garden wedding",
      prompt: "Dress up for a joyful wedding beneath flowers and twinkling lights.",
      hint: "Try something elegant, festive, and ready for photographs.",
      image: "assets/scenarios/wedding.webp",
      imageAlt: "A flower-filled garden prepared for a romantic wedding celebration",
    }),
    Object.freeze({
      id: "school-dance",
      emoji: "🪩",
      label: "School Dance",
      title: "The big school dance",
      prompt: "Create a look for dancing with friends under a sparkling disco ball.",
      hint: "Fun, confident, and easy to dance in is a winning combination.",
      image: "assets/scenarios/school-dance.webp",
      imageAlt: "A colorful school dance with balloons, lights, and a disco ball",
    }),
    Object.freeze({
      id: "fashion-show",
      emoji: "✨",
      label: "Fashion Show",
      title: "A dazzling fashion show",
      prompt: "Style a bold runway outfit that will turn every head at the show.",
      hint: "This is the moment for drama, personality, and surprising details.",
      image: "assets/scenarios/fashion-show.webp",
      imageAlt: "A glamorous illuminated runway at a lively fashion show",
    }),
    Object.freeze({
      id: "berry-picking",
      emoji: "🫐",
      label: "Berry Picking",
      title: "Berry picking in the woods",
      prompt: "Dress for a cheerful afternoon collecting berries along a forest trail.",
      hint: "Think comfortable, practical, and charming enough for a picnic afterward.",
      image: "assets/scenarios/berry-picking.webp",
      imageAlt: "A sunny woodland clearing filled with baskets and ripe berries",
    }),
  ]);

  const JUDGES = Object.freeze([
    Object.freeze({
      id: "celeste",
      name: "Celeste Star",
      emoji: "🌟",
      role: "Runway Editor",
      introduction: "Celeste loves confident silhouettes and a little sparkle.",
      generosity: 0.15,
    }),
    Object.freeze({
      id: "juniper",
      name: "Juniper Bloom",
      emoji: "🌼",
      role: "Style Storyteller",
      introduction: "Juniper looks for an outfit that belongs in the moment.",
      generosity: 0.05,
    }),
    Object.freeze({
      id: "riko",
      name: "Riko Flash",
      emoji: "⚡",
      role: "Trend Scout",
      introduction: "Riko rewards fearless choices and surprising combinations.",
      generosity: -0.05,
    }),
    Object.freeze({
      id: "maribel",
      name: "Maribel Lace",
      emoji: "🎀",
      role: "Couture Designer",
      introduction: "Maribel notices polish, balance, and beautiful details.",
      generosity: 0.25,
    }),
    Object.freeze({
      id: "nova",
      name: "Nova Beat",
      emoji: "🎧",
      role: "Culture Critic",
      introduction: "Nova wants personality from head to toe.",
      generosity: -0.15,
    }),
    Object.freeze({
      id: "theo",
      name: "Theo Velvet",
      emoji: "🎩",
      role: "Wardrobe Curator",
      introduction: "Theo admires thoughtful styling and a memorable finish.",
      generosity: 0,
    }),
  ]);

  const TIMING = Object.freeze({
    rivalDressing: 1450,
    runwayEntrance: 1150,
    judgeEntrance: 520,
    beforeScore: 260,
    betweenScores: 520,
    afterJudge: 650,
    countStep: 68,
  });

  const REQUIRED_ADAPTER_METHODS = Object.freeze([
    "getOutfit",
    "makeRival",
    "renderSnapshot",
    "scoreOutfit",
  ]);

  let activeController = null;

  function start(adapter) {
    if (activeController) {
      console.warn("DressUpCompetition.start() was called more than once; the existing flow is still active.");
      return activeController.publicApi;
    }

    validateAdapter(adapter);

    const stage = document.getElementById("stage");
    if (!stage) throw new Error("DressUpCompetition needs an element with id=\"stage\".");

    const frame = document.getElementById("app-frame") || stage.parentElement || document.body;
    const refs = mountInterface(stage, frame);
    const state = {
      phase: "boot",
      scenario: null,
      player: null,
      rival: null,
      judges: [],
      rounds: [],
      runToken: 0,
      lastFocus: null,
    };

    const pendingDelays = new Map();
    const inertHistory = new Map();
    const timingScale = global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 0.08 : 1;

    function announce(message) {
      refs.live.textContent = "";
      // Two writes make repeated announcements reliable in VoiceOver.
      scheduleFrame(() => {
        refs.live.textContent = message;
      });
    }

    function setPhase(phase) {
      state.phase = phase;
      refs.root.dataset.phase = phase;
      refs.screen.dataset.phase = phase;
      refs.stage.dataset.competitionPhase = phase;
    }

    function invalidateRun() {
      state.runToken += 1;
      for (const [timer, resolve] of pendingDelays) {
        global.clearTimeout(timer);
        resolve(false);
      }
      pendingDelays.clear();
      return state.runToken;
    }

    function isCurrentRun(token) {
      return token === state.runToken;
    }

    function delay(milliseconds, token) {
      if (!isCurrentRun(token)) return Promise.resolve(false);
      return new Promise((resolve) => {
        const timer = global.setTimeout(() => {
          pendingDelays.delete(timer);
          resolve(isCurrentRun(token));
        }, Math.round(milliseconds * timingScale));
        pendingDelays.set(timer, resolve);
      });
    }

    function setBackgroundInert(shouldBeInert) {
      for (const child of frame.children) {
        if (child === refs.root) continue;

        if (shouldBeInert) {
          if (!inertHistory.has(child)) {
            inertHistory.set(child, {
              ariaHidden: child.getAttribute("aria-hidden"),
              inert: child.hasAttribute("inert"),
            });
          }
          child.setAttribute("inert", "");
          child.setAttribute("aria-hidden", "true");
        } else {
          const previous = inertHistory.get(child);
          if (!previous) continue;
          if (!previous.inert) child.removeAttribute("inert");
          if (previous.ariaHidden === null) child.removeAttribute("aria-hidden");
          else child.setAttribute("aria-hidden", previous.ariaHidden);
          inertHistory.delete(child);
        }
      }
      document.body.classList.toggle("dressup-competition-open", shouldBeInert);
    }

    function updateScenarioInterface() {
      const scenario = state.scenario;
      refs.scenarioImage.src = scenario.image;
      refs.scenarioImage.alt = scenario.imageAlt;
      refs.scenarioEmoji.textContent = scenario.emoji;
      refs.scenarioLabel.textContent = scenario.label;
      refs.scenarioTitle.textContent = scenario.title;
      refs.scenarioPrompt.textContent = scenario.prompt;
      refs.scenarioHint.textContent = scenario.hint;
      refs.competitionBackdrop.style.backgroundImage = `url("${scenario.image}")`;

      refs.chipEmoji.textContent = scenario.emoji;
      refs.chipLabel.textContent = scenario.label;
      refs.chip.setAttribute("aria-label", `Current dress-up challenge: ${scenario.label}`);
      refs.enterButton.setAttribute("aria-label", `Enter the competition for ${scenario.label}`);
      refs.competitionScenario.textContent = `${scenario.emoji} ${scenario.label}`;
    }

    function setChallengeChipVisible(visible) {
      refs.chip.hidden = !visible;
      if (refs.brandTitle) refs.brandTitle.hidden = visible;
    }

    function chooseScenario(excludedId) {
      const choices = SCENARIOS.filter((scenario) => scenario.id !== excludedId);
      state.scenario = randomItem(choices.length ? choices : SCENARIOS);
      updateScenarioInterface();
    }

    function openScenarioDialog(options) {
      const opts = options || {};
      invalidateRun();
      clearCompetitionView();
      if (opts.chooseNew || !state.scenario) chooseScenario(opts.excludeId);
      else updateScenarioInterface();

      setPhase("intro");
      state.lastFocus = document.activeElement;
      refs.screen.hidden = true;
      refs.dialog.hidden = false;
      setChallengeChipVisible(false);
      refs.enterButton.hidden = true;
      refs.error.hidden = true;
      refs.stage.classList.remove("has-dressup-challenge", "is-competition-active");
      setBackgroundInert(true);
      announce(`New challenge: ${state.scenario.title}. ${state.scenario.prompt}`);
      focusSoon(refs.acceptButton);
    }

    function enterDressing() {
      invalidateRun();
      setPhase("dressing");
      refs.dialog.hidden = true;
      refs.screen.hidden = true;
      setChallengeChipVisible(true);
      refs.enterButton.hidden = false;
      refs.enterButton.disabled = false;
      refs.error.hidden = true;
      refs.stage.classList.add("has-dressup-challenge");
      refs.stage.classList.remove("is-competition-active");
      setBackgroundInert(false);
      announce(`Challenge accepted: ${state.scenario.label}. Dress your best, then enter the competition.`);
      focusSoon(refs.enterButton);
    }

    async function beginCompetition() {
      if (state.phase !== "dressing" || refs.enterButton.disabled) return;

      const token = invalidateRun();
      setPhase("rival-dressing");
      refs.enterButton.disabled = true;
      refs.error.hidden = true;
      refs.dialog.hidden = true;
      refs.screen.hidden = false;
      refs.prep.hidden = false;
      refs.runway.hidden = true;
      refs.judging.hidden = true;
      refs.result.hidden = true;
      refs.skipButton.hidden = true;
      refs.competitionTitle.textContent = `${RIVAL_NAME} is getting ready…`;
      refs.stage.classList.add("is-competition-active");
      setBackgroundInert(true);
      focusSoon(refs.competitionTitle);
      announce(`${RIVAL_NAME}, your competing stylist, is choosing an outfit.`);

      try {
        const playerValue = await Promise.resolve(adapter.getOutfit());
        if (!isCurrentRun(token)) return;
        state.player = cloneSnapshot(playerValue);

        if (typeof adapter.beforeCompetition === "function") {
          await Promise.resolve(adapter.beforeCompetition());
          if (!isCurrentRun(token)) return;
        }

        const rivalValue = await Promise.resolve(adapter.makeRival(state.scenario));
        if (!isCurrentRun(token)) return;
        state.rival = cloneSnapshot(rivalValue);
        state.judges = pickDistinct(JUDGES, 3);
        state.rounds = buildRounds(adapter, state.player, state.rival, state.scenario, state.judges);

        await renderLooks();
        if (!isCurrentRun(token)) return;
        renderJudgeCards();
        refs.skipButton.hidden = false;

        if (!(await delay(TIMING.rivalDressing, token))) return;
        await showRunway(token);
      } catch (error) {
        failCompetition(error);
      }
    }

    async function renderLooks() {
      refs.playerMount.replaceChildren();
      refs.rivalMount.replaceChildren();
      await Promise.resolve(adapter.renderSnapshot(refs.playerMount, cloneSnapshot(state.player)));
      await Promise.resolve(adapter.renderSnapshot(refs.rivalMount, cloneSnapshot(state.rival)));
    }

    async function showRunway(token) {
      if (!isCurrentRun(token)) return;
      setPhase("runway");
      refs.prep.hidden = true;
      refs.runway.hidden = false;
      refs.judging.hidden = true;
      refs.result.hidden = true;
      refs.competitionTitle.textContent = "Take the runway!";
      refs.playerLook.classList.add("is-entering");
      refs.rivalLook.classList.add("is-entering");
      announce(`You and ${RIVAL_NAME} are entering the runway.`);

      if (!(await delay(TIMING.runwayEntrance, token))) return;
      await revealJudges(token);
    }

    async function revealJudges(token) {
      if (!isCurrentRun(token)) return;
      setPhase("judging");
      refs.judging.hidden = false;
      refs.competitionTitle.textContent = "The judges have their scores";
      announce("Three judges will now score your look and Mika's look from 1 to 10.");

      const cards = Array.from(refs.judgeList.querySelectorAll(".competition-judge"));
      for (let index = 0; index < state.rounds.length; index += 1) {
        if (!isCurrentRun(token)) return;
        const round = state.rounds[index];
        const card = cards[index];
        const playerOutput = card.querySelector("[data-score-player]");
        const rivalOutput = card.querySelector("[data-score-rival]");

        card.classList.add("is-current", "is-revealed");
        card.removeAttribute("aria-hidden");
        announce(`Judge ${index + 1}, ${round.judge.name}, ${round.judge.role}. ${round.judge.introduction}`);
        if (!(await delay(TIMING.judgeEntrance, token))) return;

        card.classList.add("is-scoring-player");
        if (!(await delay(TIMING.beforeScore, token))) return;
        if (!(await countToScore(playerOutput, round.playerScore, token))) return;
        card.classList.remove("is-scoring-player");
        card.classList.add("has-player-score");
        announce(`${round.judge.name} gives your outfit ${round.playerScore} out of 10.`);

        if (!(await delay(TIMING.betweenScores, token))) return;
        card.classList.add("is-scoring-rival");
        if (!(await countToScore(rivalOutput, round.rivalScore, token))) return;
        card.classList.remove("is-scoring-rival");
        card.classList.add("has-rival-score", "is-complete");
        card.classList.remove("is-current");
        announce(`${round.judge.name} gives ${RIVAL_NAME} ${round.rivalScore} out of 10.`);

        if (!(await delay(TIMING.afterJudge, token))) return;
      }

      showResults(token, false);
    }

    async function countToScore(output, target, token) {
      output.closest(".competition-score").classList.add("is-counting");
      output.textContent = "0";
      for (let value = 1; value <= target; value += 1) {
        if (!(await delay(TIMING.countStep, token))) return false;
        output.textContent = String(value);
      }
      output.closest(".competition-score").classList.remove("is-counting");
      output.closest(".competition-score").classList.add("is-revealed");
      return true;
    }

    function skipReveal() {
      if (!["rival-dressing", "runway", "judging"].includes(state.phase) || !state.rounds.length) return;
      const token = invalidateRun();
      showResults(token, true);
    }

    function showResults(token, wasSkipped) {
      if (!isCurrentRun(token) || !state.rounds.length) return;
      revealEveryScore();

      const totals = totalScores(state.rounds);
      const playerWon = totals.player > totals.rival;
      setPhase("results");
      refs.prep.hidden = true;
      refs.runway.hidden = false;
      refs.judging.hidden = false;
      refs.result.hidden = false;
      refs.skipButton.hidden = true;
      refs.competitionTitle.textContent = playerWon ? "You won the style challenge!" : `${RIVAL_NAME} wins the style challenge!`;
      refs.playerTotal.textContent = String(totals.player);
      refs.rivalTotal.textContent = String(totals.rival);
      refs.resultEmoji.textContent = playerWon ? "🏆" : "👑";
      refs.resultTitle.textContent = playerWon ? "You are the winner!" : `${RIVAL_NAME} takes the crown!`;
      refs.resultMessage.textContent = playerWon
        ? `Your ${state.scenario.label.toLowerCase()} look impressed the judges. Fabulous styling!`
        : `${RIVAL_NAME} won this round, but your next look could steal the show.`;
      refs.playerLook.classList.toggle("is-winner", playerWon);
      refs.rivalLook.classList.toggle("is-winner", !playerWon);
      refs.result.classList.toggle("is-player-winner", playerWon);
      refs.result.classList.toggle("is-rival-winner", !playerWon);
      refs.result.classList.toggle("was-skipped", Boolean(wasSkipped));
      launchConfetti(refs.confetti);
      announce(
        playerWon
          ? `You win with ${totals.player} points to ${RIVAL_NAME}'s ${totals.rival}. Congratulations!`
          : `${RIVAL_NAME} wins with ${totals.rival} points to your ${totals.player}. Great competition!`,
      );
      focusSoon(refs.resultTitle);
    }

    function revealEveryScore() {
      const cards = Array.from(refs.judgeList.querySelectorAll(".competition-judge"));
      cards.forEach((card, index) => {
        const round = state.rounds[index];
        card.classList.remove("is-current", "is-scoring-player", "is-scoring-rival");
        card.classList.add("is-revealed", "has-player-score", "has-rival-score", "is-complete");
        card.removeAttribute("aria-hidden");
        card.querySelector("[data-score-player]").textContent = String(round.playerScore);
        card.querySelector("[data-score-rival]").textContent = String(round.rivalScore);
        for (const score of card.querySelectorAll(".competition-score")) {
          score.classList.remove("is-counting");
          score.classList.add("is-revealed");
        }
      });
    }

    function renderJudgeCards() {
      refs.judgeList.replaceChildren();
      state.rounds.forEach((round, index) => {
        const card = document.createElement("li");
        card.className = "competition-judge";
        card.dataset.judge = round.judge.id;
        card.dataset.judgeIndex = String(index);
        card.setAttribute("aria-hidden", "true");
        card.innerHTML = `
          <div class="competition-judge__identity">
            <span class="competition-judge__avatar" aria-hidden="true">${escapeHTML(round.judge.emoji)}</span>
            <span class="competition-judge__text">
              <strong>${escapeHTML(round.judge.name)}</strong>
              <small>${escapeHTML(round.judge.role)}</small>
            </span>
          </div>
          <div class="competition-judge__scores">
            <div class="competition-score competition-score--player">
              <span class="competition-score__label">You</span>
              <output class="competition-score__value" data-score-player aria-label="Your score from ${escapeHTML(round.judge.name)}">?</output>
              <span class="competition-score__maximum" aria-hidden="true">/10</span>
            </div>
            <div class="competition-score competition-score--rival">
              <span class="competition-score__label">${escapeHTML(RIVAL_NAME)}</span>
              <output class="competition-score__value" data-score-rival aria-label="${escapeHTML(RIVAL_NAME)}'s score from ${escapeHTML(round.judge.name)}">?</output>
              <span class="competition-score__maximum" aria-hidden="true">/10</span>
            </div>
          </div>`;
        refs.judgeList.appendChild(card);
      });
    }

    function clearCompetitionView() {
      refs.playerMount.replaceChildren();
      refs.rivalMount.replaceChildren();
      refs.judgeList.replaceChildren();
      refs.confetti.replaceChildren();
      refs.playerTotal.textContent = "0";
      refs.rivalTotal.textContent = "0";
      refs.resultTitle.textContent = "";
      refs.resultMessage.textContent = "";
      refs.playerLook.className = "competition-look competition-look--player";
      refs.rivalLook.className = "competition-look competition-look--rival";
      refs.result.className = "competition-result";
      state.player = null;
      state.rival = null;
      state.judges = [];
      state.rounds = [];
    }

    function failCompetition(error) {
      console.error("Dress-up competition could not start:", error);
      invalidateRun();
      setPhase("dressing");
      refs.screen.hidden = true;
      refs.enterButton.disabled = false;
      refs.enterButton.hidden = false;
      setChallengeChipVisible(true);
      refs.error.hidden = false;
      refs.error.textContent = "The competition could not start. Please try again.";
      refs.stage.classList.remove("is-competition-active");
      setBackgroundInert(false);
      announce("The competition could not start. Please try again.");
      focusSoon(refs.enterButton);
    }

    function rerollScenario() {
      const previous = state.scenario && state.scenario.id;
      chooseScenario(previous);
      announce(`New situation: ${state.scenario.title}. ${state.scenario.prompt}`);
      focusSoon(refs.acceptButton);
    }

    function tryAgain() {
      clearCompetitionView();
      enterDressing();
    }

    function newChallenge() {
      const previous = state.scenario && state.scenario.id;
      openScenarioDialog({ chooseNew: true, excludeId: previous });
    }

    function trapFocus(event) {
      if (event.key !== "Tab") return;
      const surface = !refs.dialog.hidden ? refs.dialog : !refs.screen.hidden ? refs.screen : null;
      if (!surface) return;
      const focusable = Array.from(surface.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.closest("[hidden]") && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeIndex = focusable.indexOf(document.activeElement);
      if (activeIndex === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    refs.rerollButton.addEventListener("click", rerollScenario);
    refs.acceptButton.addEventListener("click", enterDressing);
    refs.enterButton.addEventListener("click", beginCompetition);
    refs.skipButton.addEventListener("click", skipReveal);
    refs.tryAgainButton.addEventListener("click", tryAgain);
    refs.newChallengeButton.addEventListener("click", newChallenge);
    refs.root.addEventListener("keydown", trapFocus);

    const publicApi = Object.freeze({
      enterCompetition: beginCompetition,
      newChallenge,
      getPhase: () => state.phase,
      getScenario: () => state.scenario,
    });

    activeController = { publicApi };
    openScenarioDialog({ chooseNew: true });
    return publicApi;
  }

  function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== "object") {
      throw new TypeError("DressUpCompetition.start(adapter) requires an adapter object.");
    }
    for (const method of REQUIRED_ADAPTER_METHODS) {
      if (typeof adapter[method] !== "function") {
        throw new TypeError(`DressUpCompetition adapter is missing ${method}().`);
      }
    }
    if (adapter.beforeCompetition !== undefined && typeof adapter.beforeCompetition !== "function") {
      throw new TypeError("DressUpCompetition adapter beforeCompetition must be a function when provided.");
    }
  }

  function mountInterface(stage, frame) {
    const chipHost = frame.querySelector("#header-title-slot") || stage;
    const ctaHost = frame.querySelector("#competition-cta-slot") || stage;
    chipHost.insertAdjacentHTML("beforeend", `
      <aside id="dressup-challenge-chip" class="dressup-challenge-chip" hidden>
        <span class="dressup-challenge-chip__emoji" data-challenge-emoji aria-hidden="true"></span>
        <span class="dressup-challenge-chip__copy">
          <small>Today’s challenge</small>
          <strong data-challenge-label></strong>
        </span>
      </aside>`);

    stage.insertAdjacentHTML("beforeend", `
      <p id="dressup-competition-error" class="dressup-competition-error" role="alert" hidden></p>`);

    ctaHost.insertAdjacentHTML("beforeend", `
      <button id="dressup-enter-competition" class="dressup-enter-competition" type="button" hidden aria-describedby="dressup-challenge-chip">
        <span class="dressup-enter-competition__icon" aria-hidden="true">🏆</span>
        <span class="dressup-enter-competition__copy">
          <strong>Enter Competition</strong>
          <small>Face your fashion rival</small>
        </span>
      </button>`);

    frame.insertAdjacentHTML("beforeend", `
      <div id="dressup-competition" class="dressup-competition" data-phase="boot">
        <section class="scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="scenario-dialog-title" aria-describedby="scenario-dialog-prompt scenario-dialog-hint" hidden>
          <div class="scenario-dialog__backdrop" aria-hidden="true"></div>
          <div class="scenario-dialog__card">
            <p class="scenario-dialog__eyebrow">✨ Your new situation ✨</p>
            <figure class="scenario-dialog__picture">
              <img data-scenario-image alt="" decoding="async" />
              <figcaption class="scenario-dialog__badge">
                <span data-scenario-emoji aria-hidden="true"></span>
                <span data-scenario-label></span>
              </figcaption>
            </figure>
            <div class="scenario-dialog__copy">
              <h2 id="scenario-dialog-title" data-scenario-title></h2>
              <p id="scenario-dialog-prompt" data-scenario-prompt></p>
              <p id="scenario-dialog-hint" class="scenario-dialog__hint" data-scenario-hint></p>
            </div>
            <div class="scenario-dialog__actions">
              <button class="scenario-dialog__reroll" data-action="reroll" type="button">
                <span aria-hidden="true">🎲</span> Another situation
              </button>
              <button class="scenario-dialog__accept" data-action="accept" type="button">
                Dress for it <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </section>

        <section class="competition-screen" role="dialog" aria-modal="true" aria-labelledby="competition-screen-title" hidden>
          <div class="competition-screen__backdrop" aria-hidden="true"></div>
          <div class="competition-screen__panel">
            <header class="competition-screen__header">
              <p class="competition-screen__scenario" data-competition-scenario></p>
              <h2 id="competition-screen-title" data-competition-title tabindex="-1"></h2>
            </header>

            <section class="competition-prep" aria-label="Rival is dressing">
              <div class="competition-prep__sparkles" aria-hidden="true">
                <span>✦</span><span>✧</span><span>✦</span>
              </div>
              <div class="competition-prep__silhouette" aria-hidden="true">👗</div>
              <p><strong>${escapeHTML(RIVAL_NAME)}</strong> is creating a competing look…</p>
              <div class="competition-prep__dots" aria-hidden="true"><i></i><i></i><i></i></div>
            </section>

            <section class="competition-runway" aria-label="Competition runway" hidden>
              <article class="competition-look competition-look--player" data-player-look>
                <h3><span aria-hidden="true">💖</span> Your Look</h3>
                <div class="competition-look__frame">
                  <div class="competition-look__mount" data-player-mount></div>
                </div>
                <p class="competition-look__total">Total <output data-player-total>0</output></p>
              </article>
              <div class="competition-runway__versus" aria-hidden="true">VS</div>
              <article class="competition-look competition-look--rival" data-rival-look>
                <h3><span aria-hidden="true">💜</span> ${escapeHTML(RIVAL_NAME)}</h3>
                <div class="competition-look__frame">
                  <div class="competition-look__mount" data-rival-mount></div>
                </div>
                <p class="competition-look__total">Total <output data-rival-total>0</output></p>
              </article>
            </section>

            <section class="competition-judging" aria-labelledby="competition-judging-title" hidden>
              <h3 id="competition-judging-title" class="competition-judging__title">Judges’ scores</h3>
              <ol class="competition-judging__list" data-judge-list></ol>
            </section>

            <section class="competition-result" aria-labelledby="competition-result-title" hidden>
              <div class="competition-result__burst" aria-hidden="true"></div>
              <div class="competition-result__emoji" data-result-emoji aria-hidden="true"></div>
              <p class="competition-result__eyebrow">Final result</p>
              <h3 id="competition-result-title" data-result-title tabindex="-1"></h3>
              <p class="competition-result__message" data-result-message></p>
              <div class="competition-result__actions">
                <button class="competition-result__retry" data-action="try-again" type="button">
                  <span aria-hidden="true">👗</span> Try Again
                </button>
                <button class="competition-result__new" data-action="new-challenge" type="button">
                  <span aria-hidden="true">✨</span> New Challenge
                </button>
              </div>
            </section>

            <footer class="competition-screen__controls">
              <button class="competition-screen__skip" data-action="skip" type="button" hidden>Skip reveal</button>
            </footer>
          </div>
          <div class="competition-confetti" data-confetti aria-hidden="true"></div>
        </section>

        <div class="dressup-competition__live" data-live-region role="status" aria-live="polite" aria-atomic="true"></div>
      </div>`);

    const root = frame.querySelector("#dressup-competition");
    return {
      frame,
      stage,
      root,
      dialog: root.querySelector(".scenario-dialog"),
      scenarioImage: root.querySelector("[data-scenario-image]"),
      scenarioEmoji: root.querySelector("[data-scenario-emoji]"),
      scenarioLabel: root.querySelector("[data-scenario-label]"),
      scenarioTitle: root.querySelector("[data-scenario-title]"),
      scenarioPrompt: root.querySelector("[data-scenario-prompt]"),
      scenarioHint: root.querySelector("[data-scenario-hint]"),
      rerollButton: root.querySelector('[data-action="reroll"]'),
      acceptButton: root.querySelector('[data-action="accept"]'),
      brandTitle: chipHost.querySelector("h1"),
      chip: chipHost.querySelector("#dressup-challenge-chip"),
      chipEmoji: chipHost.querySelector("[data-challenge-emoji]"),
      chipLabel: chipHost.querySelector("[data-challenge-label]"),
      enterButton: ctaHost.querySelector("#dressup-enter-competition"),
      error: stage.querySelector("#dressup-competition-error"),
      screen: root.querySelector(".competition-screen"),
      competitionBackdrop: root.querySelector(".competition-screen__backdrop"),
      competitionScenario: root.querySelector("[data-competition-scenario]"),
      competitionTitle: root.querySelector("[data-competition-title]"),
      prep: root.querySelector(".competition-prep"),
      runway: root.querySelector(".competition-runway"),
      playerLook: root.querySelector("[data-player-look]"),
      rivalLook: root.querySelector("[data-rival-look]"),
      playerMount: root.querySelector("[data-player-mount]"),
      rivalMount: root.querySelector("[data-rival-mount]"),
      playerTotal: root.querySelector("[data-player-total]"),
      rivalTotal: root.querySelector("[data-rival-total]"),
      judging: root.querySelector(".competition-judging"),
      judgeList: root.querySelector("[data-judge-list]"),
      result: root.querySelector(".competition-result"),
      resultEmoji: root.querySelector("[data-result-emoji]"),
      resultTitle: root.querySelector("[data-result-title]"),
      resultMessage: root.querySelector("[data-result-message]"),
      skipButton: root.querySelector('[data-action="skip"]'),
      tryAgainButton: root.querySelector('[data-action="try-again"]'),
      newChallengeButton: root.querySelector('[data-action="new-challenge"]'),
      confetti: root.querySelector("[data-confetti]"),
      live: root.querySelector("[data-live-region]"),
    };
  }

  function buildRounds(adapter, player, rival, scenario, judges) {
    const rounds = judges.map((judge) => ({
      judge,
      playerScore: scoreFor(player, scenario, judge, PLAYER_SCORE_EDGE),
      rivalScore: scoreFor(rival, scenario, judge),
    }));

    const totals = totalScores(rounds);
    if (totals.player === totals.rival) {
      const lastRound = rounds[rounds.length - 1];
      if (lastRound.playerScore < 10) lastRound.playerScore += 1;
      else if (lastRound.rivalScore > 1) lastRound.rivalScore -= 1;
    }
    return rounds;

    function scoreFor(snapshot, selectedScenario, judge, scoreEdge = 0) {
      let base;
      try {
        base = Number(adapter.scoreOutfit(snapshot, selectedScenario, judge));
      } catch (error) {
        console.error(`Could not score an outfit for ${judge.name}:`, error);
        base = randomInteger(4, 8);
      }
      if (!Number.isFinite(base)) base = randomInteger(4, 8);
      const jitter = randomInteger(-2, 2);
      return clamp(Math.round(base + judge.generosity + scoreEdge + jitter), 1, 10);
    }

  }

  function totalScores(rounds) {
    return rounds.reduce(
      (totals, round) => ({
        player: totals.player + round.playerScore,
        rival: totals.rival + round.rivalScore,
      }),
      { player: 0, rival: 0 },
    );
  }

  function launchConfetti(container) {
    container.replaceChildren();
    const colors = ["#ff4f91", "#ffd43b", "#8b5cf6", "#3bc9db", "#69db7c", "#ffffff"];
    for (let index = 0; index < 52; index += 1) {
      const piece = document.createElement("i");
      piece.className = `competition-confetti__piece competition-confetti__piece--${index % 3}`;
      piece.style.setProperty("--confetti-left", `${randomInteger(2, 98)}%`);
      piece.style.setProperty("--confetti-delay", `${(Math.random() * 0.8).toFixed(2)}s`);
      piece.style.setProperty("--confetti-duration", `${(1.8 + Math.random() * 1.5).toFixed(2)}s`);
      piece.style.setProperty("--confetti-drift", `${randomInteger(-90, 90)}px`);
      piece.style.setProperty("--confetti-spin", `${randomInteger(180, 900)}deg`);
      piece.style.setProperty("--confetti-size", `${randomInteger(6, 12)}px`);
      piece.style.setProperty("--confetti-color", randomItem(colors));
      container.appendChild(piece);
    }
  }

  function pickDistinct(values, count) {
    const shuffled = Array.from(values);
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInteger(0, index);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled.slice(0, count);
  }

  function cloneSnapshot(value) {
    if (typeof global.structuredClone === "function") {
      try {
        return global.structuredClone(value);
      } catch { /* fall through to JSON for plain outfit objects */ }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function randomItem(values) {
    return values[randomInteger(0, values.length - 1)];
  }

  function randomInteger(minimum, maximum) {
    return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function focusSoon(element) {
    scheduleFrame(() => {
      try {
        element.focus({ preventScroll: true });
      } catch {
        element.focus();
      }
    });
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function scheduleFrame(callback) {
    if (typeof global.requestAnimationFrame === "function") global.requestAnimationFrame(callback);
    else global.setTimeout(callback, 0);
  }

  global.DressUpCompetition = Object.freeze({ start });
})(window);
