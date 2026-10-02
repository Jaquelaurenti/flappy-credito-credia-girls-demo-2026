const THEME = {
  orange: "#EC7000",
  awsOrange: "#FF9900",
  navy: "#003A70",
  ink: "#232F3E",
  white: "#FFFFFF",
  gray: "#8A99A8",
};
const CREDIT_RULES = window.CreditBusiness;

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 720;
const GRAVITY = 0.42;
const JUMP_STRENGTH = -8.2;
const PIPE_SPEED = 2.8;
const PIPE_GAP = 190;
const PIPE_DISTANCE = 285;
const PIPE_WIDTH = 76;
const GROUND_HEIGHT = 76;
const GHOST_X = 132;
const GHOST_RADIUS = 19;
const BEST_SCORE_KEY = "flappy-ghost-best";
const DEMO_GATES = [
  { label: "ANTIFRAUDE", specialist: 0, squadMember: 0 },
  { label: "SCORE", specialist: 1, squadMember: 1 },
  { label: "POLÍTICA", specialist: 2, squadMember: 2 },
  { label: "LIMITE", specialist: null, squadMember: 3 },
];
const SQUAD = [
  {
    name: "Segurança",
    role: "Antifraude e identidade",
    color: "#FF4D6D",
    gates: ["ANTIFRAUDE", "KYC/PLD"],
    ability: "Bloqueio de Fraude",
    accessory: "shield",
  },
  {
    name: "Dados",
    role: "Score e renda",
    color: "#3FA7FF",
    gates: ["SCORE", "RENDA"],
    ability: "Open Finance",
    accessory: "chart",
  },
  {
    name: "IA / Decisão",
    role: "Política de crédito e limite",
    color: "#B57BFF",
    gates: ["POLÍTICA", "LIMITE"],
    ability: "Motor de Decisão",
    accessory: "chip",
  },
  {
    name: "FinOps / Plataforma",
    role: "Eficiência de plataforma",
    color: "#FF9900",
    gates: [],
    ability: "Otimização",
    accessory: "coin",
  },
];
const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const statusText = document.querySelector("#game-status");
const ghostSprite = new Image();
ghostSprite.src = "assets/ghosty.png";

const jumpSound = new Audio("assets/jump.wav");
const gameOverSound = new Audio("assets/game_over.wav");
jumpSound.preload = "auto";
gameOverSound.preload = "auto";
let gameAudioContext = null;
let gameAudioMaster = null;

const bestStored = Number.parseInt(
  localStorage.getItem(BEST_SCORE_KEY) || "0",
  10,
);
let bestScore = Number.isFinite(bestStored) ? bestStored : 0;
let state = "intro";
let score = 0;
let frame = 0;
let lastTime = 0;
let ghostY = CANVAS_HEIGHT * 0.43;
let ghostVelocity = 0;
let pipes = [];
let nextGateNumber = 0;
let approvalTimer = 0;
let activeSquadIndex = 0;
let lastSquadSwitch = -Infinity;
let squadToastUntil = 0;
let comboCount = 0;
let creditVolume = 0;
let decisionsCost = 0;
let costSaved = 0;
let skillCooldownUntil = SQUAD.map(() => 0);
let fraudBlockArmed = false;
let openFinanceGates = 0;
let slowMotionUntil = 0;
let doubleVolumeArmed = false;
let syncToastUntil = 0;
let specialistToastUntil = 0;
let activeProposal = null;
let nextProposalForPipes = null;
let businessStats = createEmptyBusinessStats();
let reportData = null;
let businessToast = "";
let businessToastUntil = 0;
let businessToastColor = THEME.awsOrange;
let demoMode = false;
let demoCompleted = false;
let demoFinishAt = 0;

function createEmptyBusinessStats() {
  return {
    proposalsStarted: 0,
    approved: 0,
    releasedVolume: 0,
    fraudsAvoided: 0,
    fraudLoss: 0,
    fraudApprovals: 0,
    decisionCostTotal: 0,
    decisions: 0,
    slaTotalMs: 0,
    completedSteers: 0,
    stageReached: 0,
  };
}

function beginProposal() {
  activeProposal = CREDIT_RULES.gerarProposta();
  if (demoMode) {
    const incomeFloor = Math.ceil(
      activeProposal.product.minimo /
        activeProposal.product.multiplicadorLimite,
    );
    activeProposal.monthlyIncome = Math.max(
      activeProposal.monthlyIncome,
      incomeFloor,
    );
    activeProposal.score = Math.max(activeProposal.score, 650);
    activeProposal.commitmentPercent = Math.min(
      activeProposal.commitmentPercent,
      25,
    );
    activeProposal.requestedAmount = Math.min(
      activeProposal.requestedAmount,
      Math.floor(
        activeProposal.monthlyIncome *
          activeProposal.product.multiplicadorLimite,
      ),
    );
    activeProposal.fraudSuspected = true;
  }
  activeProposal.startedAt = performance.now();
  activeProposal.comboBonusPercent = 0;
  businessStats.proposalsStarted += 1;
  nextProposalForPipes = activeProposal;
  return activeProposal;
}

function createPipe(x, gapY) {
  const gateNumber = nextGateNumber;
  nextGateNumber += 1;
  if (demoMode && gateNumber >= DEMO_GATES.length) return null;
  const stageIndex =
    gateNumber %
    (demoMode ? DEMO_GATES.length : CREDIT_RULES.GATE_DEFINITIONS.length);
  const definition = demoMode
    ? DEMO_GATES[stageIndex]
    : CREDIT_RULES.GATE_DEFINITIONS[stageIndex];
  const proposal = stageIndex === 0 ? beginProposal() : nextProposalForPipes;
  const pipe = {
    x,
    gapY,
    scored: false,
    label: definition.label,
    specialist: definition.specialist,
    demoSquadMember: definition.squadMember ?? null,
    stageIndex,
    proposal,
    accent: gateNumber % 2 === 0 ? THEME.orange : THEME.awsOrange,
    gapSize: PIPE_GAP,
    approachApplied: false,
    bypassed: false,
    riskSuspected: proposal.fraudSuspected && definition.label === "ANTIFRAUDE",
  };

  const assessment = CREDIT_RULES.avaliarGate(proposal, definition.label);
  pipe.gapSize *= assessment.gapMultiplier ?? 1;
  pipe.specialBorderColor = assessment.specialBorderColor;
  return pipe;
}

function playSound(sound) {
  sound.currentTime = 0;
  const playback = sound.play();
  if (playback) playback.catch(() => {});
}

function playGameCue(cue, stage = 0) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    if (!gameAudioContext) {
      gameAudioContext = new AudioContextClass();
      gameAudioMaster = gameAudioContext.createGain();
      gameAudioMaster.gain.value = 0.32;
      gameAudioMaster.connect(gameAudioContext.destination);
    }
      if (gameAudioContext.state === "suspended") {
        gameAudioContext.resume().catch(() => {});
      }

    const now = gameAudioContext.currentTime;
    const melodies = {
      start: [440, 554.37, 659.25],
      gate: [523.25 + stage * 32],
      fraudAvoided: [783.99, 1046.5],
      approved: [523.25, 659.25, 783.99, 1046.5],
      complete: [1046.5, 783.99],
      denied: [392, 329.63, 261.63],
    };
    const notes = melodies[cue];
    if (!notes) return;

    const spacing = cue === "gate" ? 0 : 0.095;
    const duration = cue === "gate" ? 0.16 : 0.22;
    notes.forEach((frequency, index) => {
      const startAt = now + index * spacing;
      const oscillator = gameAudioContext.createOscillator();
      const envelope = gameAudioContext.createGain();
      oscillator.type = cue === "denied" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      envelope.gain.setValueAtTime(0.0001, startAt);
      envelope.gain.exponentialRampToValueAtTime(0.22, startAt + 0.018);
      envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(envelope);
      envelope.connect(gameAudioMaster);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.02);
    });
  } catch {
    // Audio is optional; gameplay remains available if the browser blocks it.
  }
}

function resetGame() {
  score = 0;
  frame = 0;
  ghostY = CANVAS_HEIGHT * 0.43;
  ghostVelocity = 0;
  nextGateNumber = 0;
  approvalTimer = 0;
  comboCount = 0;
  creditVolume = 0;
  decisionsCost = 0;
  costSaved = 0;
  fraudBlockArmed = false;
  openFinanceGates = 0;
  slowMotionUntil = 0;
  doubleVolumeArmed = false;
  syncToastUntil = 0;
  specialistToastUntil = 0;
  skillCooldownUntil = SQUAD.map(() => 0);
  businessStats = createEmptyBusinessStats();
  activeProposal = null;
  nextProposalForPipes = null;
  reportData = null;
  businessToast = "";
  businessToastUntil = 0;
  demoCompleted = false;
  demoFinishAt = 0;
  pipes = [
    createPipe(CANVAS_WIDTH + 55, 270),
    createPipe(CANVAS_WIDTH + 55 + PIPE_DISTANCE, 405),
  ];
}

function flap() {
  ghostVelocity = JUMP_STRENGTH;
  playSound(jumpSound);
}

function switchSquad(index) {
  const now = performance.now();
  if (index < 0 || index >= SQUAD.length || now - lastSquadSwitch < 1000)
    return;
  activeSquadIndex = index;
  lastSquadSwitch = now;
  squadToastUntil = now + 1000;
}

function activateSquadAbility() {
  const now = performance.now();
  if (state !== "playing" || now < skillCooldownUntil[activeSquadIndex]) return;
  const character = SQUAD[activeSquadIndex];

  if (activeSquadIndex === 0) fraudBlockArmed = true;
  if (activeSquadIndex === 1) openFinanceGates = 3;
  if (activeSquadIndex === 2) slowMotionUntil = now + 3000;
  if (activeSquadIndex === 3) doubleVolumeArmed = true;

  skillCooldownUntil[activeSquadIndex] = now + 12000;
  squadToastUntil = now + 1400;
  statusText.textContent = `${character.ability} ativada.`;
}

function handleInput(event) {
  if (state === "intro") {
    state = "ready";
    statusText.textContent =
      "Abertura concluída. Conheça o Squad para continuar.";
    return;
  }

  if (event.type === "keydown") {
    if (/^Digit[1-4]$/.test(event.code)) {
      event.preventDefault();
      switchSquad(Number(event.code.slice(-1)) - 1);
      return;
    }
    if (event.code === "KeyA") {
      event.preventDefault();
      activateSquadAbility();
      return;
    }
    if (event.code === "KeyD" && state !== "playing") {
      event.preventDefault();
      startSquadDemo();
      return;
    }
    if (state === "over" && ["KeyN", "Enter"].includes(event.code)) {
      event.preventDefault();
      startNewProposal();
      return;
    }
    if (!["Space", "ArrowUp", "KeyW"].includes(event.code) || event.repeat)
      return;
    event.preventDefault();
  }

  if (state === "over") {
    startNewProposal();
    return;
  }

  if (state === "ready") {
    resetGame();
    state = "playing";
    statusText.textContent = "Jogo iniciado.";
    playGameCue("start");
  }

  if (state === "playing") flap();
}

function formatCurrency(value) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(value, maximumFractionDigits = 0) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits });
}

function getNextProposal() {
  const nextPipe = pipes
    .filter(
      (pipe) => !pipe.scored && pipe.x + PIPE_WIDTH >= GHOST_X - PIPE_WIDTH,
    )
    .sort((first, second) => first.x - second.x)[0];
  return nextPipe?.proposal ?? activeProposal;
}

function getCurrentPipe() {
  return (
    pipes
      .filter(
        (pipe) => !pipe.scored && pipe.x + PIPE_WIDTH >= GHOST_X - PIPE_WIDTH,
      )
      .sort((first, second) => first.x - second.x)[0] ?? null
  );
}

function getCurrentKPIs() {
  return CREDIT_RULES.calcularKPIs(businessStats);
}

function startNewProposal() {
  resetGame();
  demoMode = false;
  state = "playing";
  statusText.textContent = "Nova proposta iniciada.";
  playGameCue("start");
  flap();
}

function startSquadDemo() {
  demoMode = true;
  resetGame();
  state = "playing";
  const startingPipe = pipes[0];
  activeSquadIndex = startingPipe.demoSquadMember;
  ghostY = startingPipe.gapY;
  ghostVelocity = 0;
  statusText.textContent = "Demonstração do Squad iniciada.";
  playGameCue("start");
}

function finishSquadDemo() {
  if (!demoMode || demoCompleted) return;
  demoCompleted = true;
  state = "over";
  reportData = {
    proposal: activeProposal,
    gate: "DEMO CONCLUÍDA",
    reason: "Os quatro especialistas concluíram suas etapas demonstrativas.",
    specialistIndex: 3,
    stageReached: DEMO_GATES.length,
    score,
    demo: true,
  };
  closeProposal(activeProposal, performance.now());
  statusText.textContent = `Demo concluída. ${score} pontos e ${formatCurrency(businessStats.releasedVolume)} liberados.`;
}

function recordDecision() {
  businessStats.decisions += 1;
  businessStats.decisionCostTotal += CREDIT_RULES.calcularCustoDecisao(
    activeSquadIndex === 3,
  );
}

function closeProposal(proposal, now) {
  if (!proposal || proposal.completed) return;
  proposal.completed = true;
  businessStats.slaTotalMs += now - proposal.startedAt;
  businessStats.completedSteers += 1;
}

function showBusinessToast(text, color = THEME.awsOrange, duration = 1800) {
  businessToast = text;
  businessToastColor = color;
  businessToastUntil = performance.now() + duration;
}

function finishWithReport(pipe, reason) {
  if (state !== "playing") return;
  const proposal = pipe?.proposal ?? getNextProposal();
  const now = performance.now();
  if (pipe && !pipe.decisionRecorded) {
    pipe.decisionRecorded = true;
    recordDecision();
  }
  if (pipe)
    businessStats.stageReached = Math.max(
      businessStats.stageReached,
      pipe.stageIndex + 1,
    );
  closeProposal(proposal, now);
  const specialistIndex = pipe?.specialist ?? null;
  reportData = {
    proposal,
    gate: pipe?.label ?? "VOO",
    reason,
    specialistIndex,
    stageReached: businessStats.stageReached,
    score,
  };
  state = "over";
  playSound(gameOverSound);
  playGameCue("denied");
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
  }
  statusText.textContent = `Proposta negada no gate ${reportData.gate}. ${reason}`;
}

function endGame(pipe = null) {
  if (state !== "playing") return;
  const gatePipe =
    pipe ??
    pipes
      .filter((item) => !item.scored)
      .sort((first, second) => first.x - second.x)[0];
  const proposal = gatePipe?.proposal ?? getNextProposal();
  const assessment = gatePipe
    ? CREDIT_RULES.avaliarGate(proposal, gatePipe.label)
    : { passed: true };
  const reason = !assessment.passed
    ? assessment.reason
    : `A etapa ${gatePipe?.label ?? "VOO"} não foi superada durante a simulação; os dados cadastrais não indicam uma recusa automática.`;
  finishWithReport(gatePipe, reason);
}

function processGate(pipe, now) {
  if (pipe.decisionRecorded) return;
  pipe.decisionRecorded = true;
  recordDecision();
  businessStats.stageReached = Math.max(
    businessStats.stageReached,
    pipe.stageIndex + 1,
  );

  const assessment = CREDIT_RULES.avaliarGate(pipe.proposal, pipe.label);
  if (!assessment.passed) {
    finishWithReport(pipe, assessment.reason);
    return;
  }
  playGameCue("gate", pipe.stageIndex);

  if (pipe.riskSuspected) {
    const fraudEvaluation = CREDIT_RULES.avaliarFraude(
      pipe.proposal,
      activeSquadIndex === 0,
      pipe.bypassed,
    );
    if (fraudEvaluation.avoided) {
      businessStats.fraudsAvoided += 1;
      showBusinessToast("Fraude evitada!", SQUAD[0].color, 2200);
      playGameCue("fraudAvoided");
    } else {
      const exposure = fraudEvaluation.lossAmount;
      businessStats.fraudApprovals += 1;
      businessStats.fraudLoss += exposure;
      showBusinessToast(
        `Fraude aprovada · perda ${formatCurrency(exposure)}`,
        "#FF4D6D",
        2600,
      );
    }
  }

  if (pipe.label === "LIMITE") {
    const multiplier = doubleVolumeArmed ? 2 : 1;
    const comboBonus = pipe.proposal.comboBonusPercent ?? 0;
    const volumeReleased = CREDIT_RULES.calcularVolumeLiberado(
      pipe.proposal,
      multiplier,
      comboBonus,
    );
    businessStats.approved += 1;
    businessStats.releasedVolume += volumeReleased;
    approvalTimer = 95;
    if (assessment.partial) {
      showBusinessToast(
        `Aprovado parcial · ${formatCurrency(assessment.approvedAmount)}`,
        THEME.awsOrange,
        2400,
      );
    } else {
      showBusinessToast(
        `Crédito aprovado · ${formatCurrency(assessment.approvedAmount)}`,
        "#68D391",
        2200,
      );
    }
    doubleVolumeArmed = false;
    closeProposal(pipe.proposal, now);
    playGameCue("approved");
  }
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  sky.addColorStop(0, THEME.ink);
  sky.addColorStop(1, THEME.navy);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.globalAlpha = 0.15;
  ctx.fillStyle = THEME.white;
  for (let index = 0; index < 5; index += 1) {
    const x =
      ((((index * 153 - frame * (0.12 + index * 0.015)) %
        (CANVAS_WIDTH + 180)) +
        CANVAS_WIDTH +
        180) %
        (CANVAS_WIDTH + 180)) -
      90;
    const y = 105 + ((index * 123) % 405);
    drawCloud(x, y, 0.72 + (index % 3) * 0.16);
  }

  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = THEME.awsOrange;
  ctx.lineWidth = 1;
  for (let index = 0; index < 8; index += 1) {
    const y = 104 + index * 59;
    const offset = (frame * 0.85 + index * 47) % CANVAS_WIDTH;
    ctx.beginPath();
    ctx.moveTo(-CANVAS_WIDTH + offset, y);
    ctx.lineTo(offset, y);
    ctx.moveTo(offset + 42, y);
    ctx.lineTo(offset + CANVAS_WIDTH, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawCloud(x, y, scale) {
  ctx.beginPath();
  ctx.roundRect(x - 20 * scale, y, 76 * scale, 19 * scale, 10 * scale);
  ctx.arc(x, y + scale, 15 * scale, Math.PI, Math.PI * 2);
  ctx.arc(x + 22 * scale, y - 8 * scale, 20 * scale, Math.PI, Math.PI * 2);
  ctx.arc(x + 45 * scale, y + scale, 14 * scale, Math.PI, Math.PI * 2);
  ctx.fill();
}

function drawPipe(pipe) {
  const topHeight = pipe.gapY - pipe.gapSize / 2;
  const bottomY = pipe.gapY + pipe.gapSize / 2;
  const groundY = CANVAS_HEIGHT - GROUND_HEIGHT;
  const lip = 42;
  const gateAccent =
    pipe.riskSuspected && Math.floor(frame / 8) % 2 === 0
      ? "#FF4D6D"
      : (pipe.specialBorderColor ?? pipe.accent);

  ctx.fillStyle = THEME.navy;
  ctx.fillRect(pipe.x + 5, 0, PIPE_WIDTH - 10, topHeight - lip);
  ctx.fillRect(
    pipe.x + 5,
    bottomY + lip,
    PIPE_WIDTH - 10,
    groundY - bottomY - lip,
  );

  ctx.save();
  ctx.globalAlpha = pipe.riskSuspected ? 0.9 : 0.55;
  ctx.shadowColor = gateAccent;
  ctx.shadowBlur = pipe.riskSuspected ? 16 : 9;
  ctx.strokeStyle = gateAccent;
  ctx.lineWidth = 4;
  ctx.strokeRect(pipe.x + 6.5, -1, PIPE_WIDTH - 13, topHeight - lip + 2);
  ctx.strokeRect(
    pipe.x + 6.5,
    bottomY + lip,
    PIPE_WIDTH - 13,
    groundY - bottomY - lip,
  );
  ctx.fillStyle = gateAccent;
  ctx.fillRect(pipe.x, topHeight - lip, PIPE_WIDTH, lip);
  ctx.fillRect(pipe.x, bottomY, PIPE_WIDTH, lip);
  ctx.restore();

  ctx.strokeStyle = gateAccent;
  ctx.lineWidth = 3;
  ctx.strokeRect(pipe.x + 6.5, -1, PIPE_WIDTH - 13, topHeight - lip + 2);
  ctx.strokeRect(
    pipe.x + 6.5,
    bottomY + lip,
    PIPE_WIDTH - 13,
    groundY - bottomY - lip,
  );
  ctx.fillStyle = gateAccent;
  ctx.fillRect(pipe.x, topHeight - lip, PIPE_WIDTH, lip);
  ctx.fillRect(pipe.x, bottomY, PIPE_WIDTH, lip);

  ctx.font = "bold 11px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = THEME.navy;
  ctx.fillStyle = THEME.white;
  const topMouthCenter = topHeight - lip / 2;
  const bottomMouthCenter = bottomY + lip / 2;
  const recommendedSquadMember = demoMode
    ? pipe.demoSquadMember
    : pipe.specialist;
  [topMouthCenter, bottomMouthCenter].forEach((centerY) => {
    ctx.strokeText(
      pipe.label,
      pipe.x + PIPE_WIDTH / 2,
      centerY - 8,
      PIPE_WIDTH - 8,
    );
    ctx.fillText(
      pipe.label,
      pipe.x + PIPE_WIDTH / 2,
      centerY - 8,
      PIPE_WIDTH - 8,
    );
    if (recommendedSquadMember !== null) {
      drawSquadIcon(
        recommendedSquadMember,
        pipe.x + PIPE_WIDTH / 2,
        centerY + 11,
        20,
        false,
        false,
      );
    }
  });
}

function drawSquadIcon(
  index,
  centerX,
  centerY,
  size,
  selected,
  disabled,
  cooldown = 0,
) {
  const character = SQUAD[index];
  const radius = size / 2;
  ctx.save();
  ctx.globalAlpha = disabled ? 0.42 : 1;
  ctx.fillStyle = THEME.ink;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = selected ? character.color : `${character.color}99`;
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.stroke();

  if (size <= 16) {
    ctx.fillStyle = character.color;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = THEME.ink;
    ctx.font = `bold ${Math.max(7, size * 0.48)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), centerX, centerY + 0.5);
  } else {
    ctx.fillStyle = THEME.white;
    ctx.beginPath();
    ctx.arc(centerX, centerY + 2, radius * 0.47, Math.PI, 0);
    ctx.lineTo(centerX + radius * 0.47, centerY + radius * 0.47);
    ctx.quadraticCurveTo(
      centerX + radius * 0.2,
      centerY + radius * 0.32,
      centerX,
      centerY + radius * 0.47,
    );
    ctx.quadraticCurveTo(
      centerX - radius * 0.2,
      centerY + radius * 0.32,
      centerX - radius * 0.47,
      centerY + radius * 0.47,
    );
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = THEME.ink;
    ctx.beginPath();
    ctx.arc(centerX - radius * 0.16, centerY, 1.3, 0, Math.PI * 2);
    ctx.arc(centerX + radius * 0.16, centerY, 1.3, 0, Math.PI * 2);
    ctx.fill();
    drawAccessory(
      character.accessory,
      centerX + radius * 0.48,
      centerY - radius * 0.35,
      size * 0.44,
      character.color,
    );
  }

  if (cooldown > 0) {
    ctx.fillStyle = "#11182099";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(
      centerX,
      centerY,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * cooldown,
    );
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = character.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      centerX,
      centerY,
      radius - 1,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * cooldown,
    );
    ctx.stroke();
    ctx.fillStyle = "#111820CC";
    ctx.fillRect(centerX - radius + 6, centerY + radius - 7, size - 12, 3);
    ctx.fillStyle = character.color;
    ctx.fillRect(
      centerX - radius + 6,
      centerY + radius - 7,
      (size - 12) * (1 - cooldown),
      3,
    );
  }
  ctx.restore();
}

function drawAccessory(type, centerX, centerY, size, color) {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.14);
  if (type === "shield") {
    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(size * 0.42, -size * 0.3);
    ctx.lineTo(size * 0.34, size * 0.18);
    ctx.lineTo(0, size / 2);
    ctx.lineTo(-size * 0.34, size * 0.18);
    ctx.lineTo(-size * 0.42, -size * 0.3);
    ctx.closePath();
    ctx.fill();
  } else if (type === "chart") {
    [-0.3, 0, 0.3].forEach((offset, bar) => {
      ctx.fillRect(
        size * offset - size * 0.09,
        size * (0.18 - bar * 0.15),
        size * 0.18,
        size * (0.32 + bar * 0.15),
      );
    });
  } else if (type === "chip") {
    ctx.fillRect(-size * 0.31, -size * 0.31, size * 0.62, size * 0.62);
    ctx.strokeStyle = THEME.white;
    ctx.strokeRect(-size * 0.13, -size * 0.13, size * 0.26, size * 0.26);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = THEME.ink;
    ctx.font = `bold ${size * 0.75}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", 0, 0.5);
  }
  ctx.restore();
}

function drawGhost() {
  const bob = state === "ready" ? Math.sin(frame * 0.055) * 9 : 0;
  const tilt = Math.max(-0.42, Math.min(0.55, ghostVelocity * 0.055));
  ctx.save();
  ctx.translate(GHOST_X, ghostY + bob);
  ctx.rotate(tilt);

  if (ghostSprite.complete && ghostSprite.naturalWidth > 0) {
    ctx.drawImage(ghostSprite, -27, -27, 54, 54);
    drawAccessory(
      SQUAD[activeSquadIndex].accessory,
      20,
      -14,
      13,
      SQUAD[activeSquadIndex].color,
    );
    drawGhostBadge();
    ctx.restore();
    return;
  }

  ctx.shadowColor = "#00000055";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = THEME.white;
  ctx.beginPath();
  ctx.moveTo(-GHOST_RADIUS, 18);
  ctx.lineTo(-GHOST_RADIUS, -3);
  ctx.arc(0, -3, GHOST_RADIUS, Math.PI, 0);
  ctx.lineTo(GHOST_RADIUS, 18);
  ctx.quadraticCurveTo(12, 13, 6, 19);
  ctx.quadraticCurveTo(0, 24, -6, 19);
  ctx.quadraticCurveTo(-12, 13, -GHOST_RADIUS, 18);
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.fillStyle = THEME.ink;
  ctx.beginPath();
  ctx.ellipse(-7, -4, 2.6, 4.2, -0.12, 0, Math.PI * 2);
  ctx.ellipse(7, -4, 2.6, 4.2, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = THEME.orange;
  ctx.beginPath();
  ctx.arc(-13, 5, 3, 0, Math.PI * 2);
  ctx.arc(13, 5, 3, 0, Math.PI * 2);
  ctx.fill();
  drawAccessory(
    SQUAD[activeSquadIndex].accessory,
    20,
    -14,
    13,
    SQUAD[activeSquadIndex].color,
  );
  drawGhostBadge();
  ctx.restore();
}

function drawGhostBadge() {
  ctx.fillStyle = THEME.orange;
  ctx.beginPath();
  ctx.roundRect(7, 11, 23, 14, 3);
  ctx.fill();
  ctx.fillStyle = THEME.white;
  ctx.font = "bold 9px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PF", 18.5, 18);
}

function drawGround() {
  const groundY = CANVAS_HEIGHT - GROUND_HEIGHT;
  ctx.fillStyle = THEME.ink;
  ctx.fillRect(0, groundY, CANVAS_WIDTH, GROUND_HEIGHT);
  ctx.fillStyle = THEME.orange;
  ctx.fillRect(0, groundY, CANVAS_WIDTH, 10);
  ctx.fillStyle = THEME.gray;
  ctx.globalAlpha = 0.55;
  for (let x = -((frame * PIPE_SPEED) % 44); x < CANVAS_WIDTH; x += 44) {
    ctx.fillRect(x, groundY + 26, 23, 2);
    ctx.fillRect(x + 17, groundY + 49, 14, 2);
  }
  ctx.globalAlpha = 1;
}

function drawLabel(text, y, font, color) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#00000066";
  ctx.fillText(text, CANVAS_WIDTH / 2 + 2, y + 3);
  ctx.fillStyle = color;
  ctx.fillText(text, CANVAS_WIDTH / 2, y);
}

function drawStartButton(text, y) {
  ctx.font = "bold 18px Trebuchet MS, sans-serif";
  const buttonWidth = Math.max(
    166,
    Math.ceil(ctx.measureText(text).width + 36),
  );
  const buttonHeight = 48;
  const buttonX = (CANVAS_WIDTH - buttonWidth) / 2;
  ctx.fillStyle = THEME.orange;
  ctx.beginPath();
  ctx.roundRect(buttonX, y, buttonWidth, buttonHeight, 8);
  ctx.fill();
  ctx.strokeStyle = "#FFFFFF55";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = THEME.white;
  ctx.fillText(text, CANVAS_WIDTH / 2, y + buttonHeight / 2);
}

function drawDemoButton(text, y) {
  const buttonWidth = 270;
  const buttonHeight = 44;
  const buttonX = (CANVAS_WIDTH - buttonWidth) / 2;
  ctx.fillStyle = THEME.ink;
  ctx.beginPath();
  ctx.roundRect(buttonX, y, buttonWidth, buttonHeight, 8);
  ctx.fill();
  ctx.strokeStyle = "#3FA7FF";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = THEME.white;
  ctx.font = "bold 14px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, CANVAS_WIDTH / 2, y + buttonHeight / 2);
}

function drawOverlay() {
  if (state === "playing") return;
  ctx.fillStyle = "#00000044";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT - GROUND_HEIGHT);

  if (state === "intro") {
    drawIntroFrame();
  } else if (state === "ready") {
    drawLabel("Flappy Crédito", 92, "bold 34px Georgia, serif", THEME.white);
    drawLabel(
      "Conheça o Squad · CredIA Girls",
      129,
      "bold 18px Trebuchet MS, sans-serif",
      THEME.awsOrange,
    );
    drawSquadIntro();
    drawLabel(
      "1-4 ou clique nos ícones troca  ·  A habilidade  ·  ESPAÇO voar",
      491,
      "bold 11px Trebuchet MS, sans-serif",
      THEME.white,
    );
    drawLabel(
      "Dados fictícios para fins de demonstração",
      507,
      "bold 10px Trebuchet MS, sans-serif",
      THEME.gray,
    );
    drawStartButton("Começar", 520);
    drawDemoButton("Assistir demo · 4 especialistas", 578);
  } else {
    drawCommitteeReport();
  }
}

function drawIntroFrame() {
  drawLabel(
    "FLAPPY CRÉDITO",
    158,
    "bold 14px Trebuchet MS, sans-serif",
    THEME.awsOrange,
  );
  drawLabel(
    "Uma proposta. Quatro especialistas.",
    222,
    "bold 22px Georgia, serif",
    THEME.white,
  );
  drawLabel(
    "Guie o fantasma pelos gates de uma análise de crédito PF.",
    267,
    "14px Trebuchet MS, sans-serif",
    THEME.white,
  );

  const introLines = [
    ["01", "Desvie dos gates e acompanhe uma proposta fictícia."],
    ["02", "Troque entre Segurança, Dados, IA e FinOps."],
    ["03", "Cada passagem soma pontos e avança a decisão."],
  ];
  introLines.forEach(([number, text], index) => {
    const y = 330 + index * 48;
    ctx.fillStyle = "#232F3EEE";
    ctx.beginPath();
    ctx.roundRect(38, y - 17, CANVAS_WIDTH - 76, 38, 6);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = THEME.awsOrange;
    ctx.font = "bold 12px Trebuchet MS, sans-serif";
    ctx.fillText(number, 52, y + 2);
    ctx.fillStyle = THEME.white;
    ctx.font = "12px Trebuchet MS, sans-serif";
    ctx.fillText(text, 83, y + 2, CANVAS_WIDTH - 135);
  });

  drawStartButton("Entender e continuar", 500);
  drawLabel(
    "Dados fictícios para fins de demonstração",
    574,
    "bold 11px Trebuchet MS, sans-serif",
    THEME.gray,
  );
}

function drawCommitteeReport() {
  const kpis = getCurrentKPIs();
  const report = reportData ?? {
    proposal: activeProposal,
    gate: "VOO",
    reason: "A proposta não concluiu a esteira.",
    specialistIndex: null,
    stageReached: businessStats.stageReached,
  };
  ctx.fillStyle = "#101820F2";
  ctx.fillRect(12, 75, CANVAS_WIDTH - 24, CANVAS_HEIGHT - GROUND_HEIGHT - 85);
  ctx.strokeStyle = THEME.awsOrange;
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 75, CANVAS_WIDTH - 24, CANVAS_HEIGHT - GROUND_HEIGHT - 85);
  drawLabel(
    report.demo ? "DEMO DO SQUAD CONCLUÍDA" : "RELATÓRIO DO COMITÊ DE CRÉDITO",
    100,
    report.demo ? "bold 22px Georgia, serif" : "bold 20px Georgia, serif",
    report.demo ? "#68D391" : THEME.white,
  );

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = report.demo ? "#68D391" : "#FF4D6D";
  ctx.font = "bold 12px Trebuchet MS, sans-serif";
  ctx.fillText(
    report.demo
      ? "Resultado: quatro gates atravessados"
      : `Proposta negada no gate: ${report.gate}`,
    30,
    123,
  );
  ctx.fillStyle = THEME.white;
  ctx.font = "10px Trebuchet MS, sans-serif";
  drawWrappedText(
    `Motivo: ${report.reason}`,
    30,
    144,
    CANVAS_WIDTH - 60,
    14,
    2,
  );

  let detailY = 176;
  if (report.specialistIndex !== null && report.specialistIndex !== undefined) {
    ctx.fillStyle = THEME.awsOrange;
    ctx.font = "bold 10px Trebuchet MS, sans-serif";
    ctx.fillText(
      `Especialista recomendada: ${SQUAD[report.specialistIndex].name}`,
      30,
      detailY,
    );
    detailY += 18;
  }
  if (report.proposal) {
    ctx.fillStyle = THEME.gray;
    ctx.font = "bold 9px Trebuchet MS, sans-serif";
    ctx.fillText(
      `Cliente #${formatNumber(report.proposal.clientId)} · ${report.proposal.product.nome} · Pedido ${formatCurrency(report.proposal.requestedAmount)}`,
      30,
      detailY,
      CANVAS_WIDTH - 60,
    );
    ctx.fillText(
      `Renda ${formatCurrency(report.proposal.monthlyIncome)}/mês · Score ${formatNumber(report.proposal.score)} · Comprometimento ${formatNumber(report.proposal.commitmentPercent)}% · Risco ${report.proposal.fraudSuspected ? "suspeita de fraude" : "sem alerta"}`,
      30,
      detailY + 13,
      CANVAS_WIDTH - 60,
    );
  }

  const rows = [
    ["Créditos aprovados", formatNumber(kpis.approved)],
    ["Volume liberado", formatCurrency(kpis.releasedVolume)],
    ["Taxa de aprovação", `${formatNumber(kpis.approvalRate * 100, 1)}%`],
    ["Fraudes evitadas", formatNumber(kpis.fraudsAvoided)],
    ["Perda por fraude", formatCurrency(kpis.fraudLoss)],
    ["Custo médio por decisão", formatCurrency(kpis.decisionCost)],
    ["SLA médio por esteira", `${formatNumber(kpis.averageSlaSeconds, 2)} s`],
    ["Pontuação do Squad", formatNumber(report.score ?? score)],
    [
      "Fase alcançada",
      `${formatNumber(report.stageReached)} / ${report.demo ? DEMO_GATES.length : 6} · ${report.gate}`,
    ],
    ["Recorde", formatNumber(bestScore)],
  ];
  const tableTop = 231;
  ctx.fillStyle = THEME.ink;
  ctx.fillRect(25, tableTop, CANVAS_WIDTH - 50, 22);
  ctx.textBaseline = "middle";
  ctx.fillStyle = THEME.awsOrange;
  ctx.font = "bold 9px Trebuchet MS, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("INDICADOR", 34, tableTop + 11);
  ctx.textAlign = "right";
  ctx.fillText("RESULTADO", CANVAS_WIDTH - 34, tableTop + 11);
  rows.forEach(([label, value], index) => {
    const rowY = tableTop + 22 + index * 19;
    ctx.fillStyle = index % 2 === 0 ? "#FFFFFF12" : "#FFFFFF08";
    ctx.fillRect(25, rowY, CANVAS_WIDTH - 50, 19);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = THEME.white;
    ctx.font = "10px Trebuchet MS, sans-serif";
    ctx.fillText(label, 34, rowY + 9.5);
    ctx.textAlign = "right";
    ctx.fillStyle = THEME.awsOrange;
    ctx.font = "bold 10px Trebuchet MS, sans-serif";
    ctx.fillText(value, CANVAS_WIDTH - 34, rowY + 9.5);
  });

  const seal = getHealthSeal(kpis);
  ctx.fillStyle = seal.color;
  ctx.beginPath();
  ctx.roundRect(118, 470, CANVAS_WIDTH - 236, 32, 16);
  ctx.fill();
  ctx.fillStyle = THEME.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 13px Trebuchet MS, sans-serif";
  ctx.fillText(seal.label, CANVAS_WIDTH / 2, 486);
  drawStartButton(report.demo ? "Repetir demonstração" : "Nova proposta", 521);
  drawLabel(
    report.demo
      ? "D para repetir · dados fictícios"
      : "N ou Enter para nova proposta · dados fictícios",
    584,
    "10px Trebuchet MS, sans-serif",
    THEME.gray,
  );
}

function drawWrappedText(text, x, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(" ");
  let line = "";
  let lineIndex = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineIndex * lineHeight, maxWidth);
      line = word;
      lineIndex += 1;
      if (lineIndex >= maxLines) return;
    } else {
      line = candidate;
    }
  }
  if (line && lineIndex < maxLines)
    ctx.fillText(line, x, y + lineIndex * lineHeight, maxWidth);
}

function getHealthSeal(kpis) {
  return CREDIT_RULES.avaliarSaudePortfolio(kpis);
}

function drawSquadIntro() {
  const panelX = 25;
  const panelY = 151;
  const panelWidth = CANVAS_WIDTH - 50;
  const rowHeight = 76;
  ctx.fillStyle = "#232F3EEE";
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelWidth, rowHeight * SQUAD.length + 8, 10);
  ctx.fill();
  ctx.strokeStyle = "#FF990088";
  ctx.lineWidth = 1;
  ctx.stroke();

  SQUAD.forEach((character, index) => {
    const rowY = panelY + 10 + index * rowHeight;
    drawSquadIcon(index, 57, rowY + 25, 38, index === activeSquadIndex, false);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = character.color;
    ctx.font = "bold 15px Trebuchet MS, sans-serif";
    ctx.fillText(character.name, 88, rowY + 13);
    ctx.fillStyle = THEME.white;
    ctx.font = "bold 12px Trebuchet MS, sans-serif";
    ctx.fillText(character.role, 88, rowY + 32);
    ctx.fillStyle = "#D6E0EB";
    ctx.font = "bold 11px Trebuchet MS, sans-serif";
    ctx.fillText(
      `${character.ability}${character.gates.length ? `  ·  ${character.gates.join(" / ")}` : "  ·  Custo -30%"}`,
      88,
      rowY + 50,
      350,
    );
  });
}

function drawHud() {
  const kpis = getCurrentKPIs();
  const currentPipe = getCurrentPipe();
  const proposal = currentPipe?.proposal ?? activeProposal;
  const totalStages = demoMode
    ? DEMO_GATES.length
    : CREDIT_RULES.GATE_DEFINITIONS.length;
  const currentStage = currentPipe
    ? currentPipe.stageIndex + 1
    : businessStats.stageReached;
  const stageLabel =
    currentPipe?.label ??
    (currentStage >= totalStages ? "LIMITE" : "EM ANÁLISE");
  ctx.fillStyle = "rgba(35, 47, 62, 0.85)";
  ctx.fillRect(0, 0, CANVAS_WIDTH, 70);
  ctx.fillStyle = THEME.orange;
  ctx.fillRect(0, 68, CANVAS_WIDTH, 2);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "bold 9px Trebuchet MS, sans-serif";
  ctx.fillStyle = THEME.gray;
  ctx.fillText("CRÉDITOS", 18, 19);
  ctx.textAlign = "center";
  ctx.fillText("VOLUME LIBERADO", CANVAS_WIDTH / 2, 19);
  ctx.textAlign = "right";
  ctx.fillText("APROVAÇÃO", CANVAS_WIDTH - 18, 19);
  ctx.font = "bold 16px Georgia, serif";
  ctx.fillStyle = THEME.awsOrange;
  ctx.textAlign = "left";
  ctx.fillText(formatNumber(kpis.approved), 18, 40);
  ctx.textAlign = "center";
  ctx.fillText(formatCurrency(kpis.releasedVolume), CANVAS_WIDTH / 2, 40);
  ctx.textAlign = "right";
  ctx.fillText(
    `${formatNumber(kpis.approvalRate * 100, 1)}%`,
    CANVAS_WIDTH - 18,
    40,
  );

  ctx.font = "bold 7px Trebuchet MS, sans-serif";
  ctx.fillStyle = THEME.white;
  ctx.textAlign = "left";
  ctx.fillText(
    `${formatNumber(Math.max(0, kpis.proposalsStarted - kpis.approved))} EM ANÁLISE`,
    18,
    58,
  );
  ctx.textAlign = "center";
  ctx.fillText(
    proposal
      ? `PEDIDO ${formatCurrency(proposal.requestedAmount)}`
      : "VOLUME CONFIRMADO",
    CANVAS_WIDTH / 2,
    58,
  );
  ctx.textAlign = "right";
  ctx.fillText(
    `${formatNumber(Math.min(currentStage, totalStages))}/${totalStages} · ${stageLabel}`,
    CANVAS_WIDTH - 18,
    58,
  );
}

function drawSquadHud() {
  const barY = CANVAS_HEIGHT - 60;
  ctx.fillStyle = "rgba(35, 47, 62, 0.94)";
  ctx.beginPath();
  ctx.roundRect(12, barY, CANVAS_WIDTH - 24, 54, 8);
  ctx.fill();
  ctx.strokeStyle = "#FF990066";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = THEME.awsOrange;
  ctx.font = "bold 10px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `PONTOS DO SQUAD  ${formatNumber(score)}`,
    CANVAS_WIDTH / 2,
    barY + 7,
  );

  const now = performance.now();
  const centers = SQUAD.map((_, index) => 70 + index * 113);
  const shortNames = ["1 SEGURANÇA", "2 DADOS", "3 IA / DECISÃO", "4 FINOPS"];
  SQUAD.forEach((character, index) => {
    const cooldown = Math.max(
      0,
      Math.min(1, (skillCooldownUntil[index] - now) / 12000),
    );
    drawSquadIcon(
      index,
      centers[index],
      barY + 26,
      32,
      index === activeSquadIndex,
      false,
      cooldown,
    );
    ctx.fillStyle = character.color;
    ctx.font = "bold 10px Trebuchet MS, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shortNames[index], centers[index], barY + 47);
  });
}

function handleCanvasInput(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / bounds.width) * CANVAS_WIDTH;
  const y = ((event.clientY - bounds.top) / bounds.height) * CANVAS_HEIGHT;
  if (state === "intro") {
    state = "ready";
    statusText.textContent =
      "Abertura concluída. Conheça o Squad para continuar.";
    return;
  }
  if (state === "over") {
    if (reportData?.demo && y >= 521 && y <= 569) startSquadDemo();
    else startNewProposal();
    return;
  }
  if (state === "ready" && y >= 578 && y <= 622) {
    startSquadDemo();
    return;
  }
  const barY = CANVAS_HEIGHT - 60;
  const iconCenters = SQUAD.map((_, index) => 70 + index * 113);
  const clickedSquad =
    y >= barY && y <= barY + 54
      ? iconCenters.findIndex((centerX) => Math.abs(x - centerX) <= 24)
      : -1;
  if (clickedSquad >= 0) {
    event.preventDefault();
    switchSquad(clickedSquad);
    return;
  }
  handleInput(event);
}

function update(delta) {
  if (state !== "playing") return;
  const now = performance.now();
  if (demoFinishAt > 0) {
    if (now >= demoFinishAt) finishSquadDemo();
    return;
  }
  let demoTargetPipe = null;
  if (demoMode) {
    demoTargetPipe =
      pipes.find(
        (pipe) =>
          pipe.x <= GHOST_X + GHOST_RADIUS &&
          pipe.x + PIPE_WIDTH >= GHOST_X - GHOST_RADIUS,
      ) ?? getCurrentPipe();
    if (
      demoTargetPipe?.demoSquadMember !== null &&
      demoTargetPipe?.demoSquadMember !== undefined
    ) {
      if (activeSquadIndex !== demoTargetPipe.demoSquadMember) {
        activeSquadIndex = demoTargetPipe.demoSquadMember;
        squadToastUntil = now + 1000;
      }
    }
  }
  const slowFactor = now < slowMotionUntil ? 0.6 : 1;
  const step = Math.min((delta * slowFactor) / 16.667, 2.5);
  ghostVelocity += GRAVITY * step;
  ghostY += ghostVelocity * step;
  if (demoMode && demoTargetPipe) {
    ghostY = demoTargetPipe.gapY;
    ghostVelocity = 0;
  }
  approvalTimer = Math.max(0, approvalTimer - step);

  for (const pipe of pipes) {
    pipe.x -= PIPE_SPEED * step;
    if (!pipe.approachApplied && pipe.x <= GHOST_X + 112) {
      pipe.approachApplied = true;
      if (pipe.specialist === activeSquadIndex) {
        pipe.gapSize *= 1.25;
        pipe.specialistBoost = true;
      }
      if (pipe.specialist === 0 && fraudBlockArmed) {
        pipe.bypassed = true;
        fraudBlockArmed = false;
      }
      if (openFinanceGates > 0) {
        pipe.gapSize *= 1.2;
        openFinanceGates -= 1;
      }
    }

    if (!pipe.scored && pipe.x + PIPE_WIDTH < GHOST_X) {
      pipe.scored = true;
      const scoringSpecialist = demoMode
        ? pipe.demoSquadMember
        : pipe.specialist;
      const matchedSpecialist =
        scoringSpecialist !== null && activeSquadIndex === scoringSpecialist;
      score += matchedSpecialist ? 3 : 1;
      if (matchedSpecialist) {
        comboCount += 1;
        if (comboCount === 3) {
          pipe.proposal.comboBonusPercent =
            (pipe.proposal.comboBonusPercent ?? 0) + 0.03;
          syncToastUntil = now + 1900;
        }
      } else {
        comboCount = 0;
      }

      approvalTimer = 95;
      if (matchedSpecialist) {
        specialistToastUntil = now + 1800;
      }
      processGate(pipe, now);
      if (state !== "playing") return;
      if (demoMode && pipe.stageIndex === DEMO_GATES.length - 1) {
        demoFinishAt = now + 3000;
        return;
      }
    }

    const overlapsGhost =
      GHOST_X + GHOST_RADIUS > pipe.x &&
      GHOST_X - GHOST_RADIUS < pipe.x + PIPE_WIDTH;
    const outsideGap =
      ghostY - GHOST_RADIUS < pipe.gapY - pipe.gapSize / 2 ||
      ghostY + GHOST_RADIUS > pipe.gapY + pipe.gapSize / 2;
    if (overlapsGhost && outsideGap && !pipe.bypassed) {
      endGame(pipe);
      return;
    }
  }

  pipes = pipes.filter((pipe) => pipe && pipe.x + PIPE_WIDTH > -10);
  if (
    (pipes.length === 0 ||
      pipes[pipes.length - 1].x < CANVAS_WIDTH - PIPE_DISTANCE) &&
    (!demoMode || nextGateNumber < DEMO_GATES.length)
  ) {
    const previous = pipes[pipes.length - 1];
    const gapY = 230 + Math.random() * 250;
    const nextPipe = createPipe(
      previous ? previous.x + PIPE_DISTANCE : CANVAS_WIDTH + 35,
      gapY,
    );
    if (nextPipe) pipes.push(nextPipe);
  }

  if (
    ghostY - GHOST_RADIUS < 0 ||
    ghostY + GHOST_RADIUS > CANVAS_HEIGHT - GROUND_HEIGHT
  )
    endGame();
}

function draw() {
  if (state === "over") {
    ctx.fillStyle = THEME.ink;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    drawHud();
    drawOverlay();
    return;
  }

  drawBackground();
  if (state === "intro") {
    drawGround();
    drawOverlay();
    return;
  }
  pipes.forEach(drawPipe);
  drawGround();
  drawGhost();
  drawOverlay();
  if (state === "playing") {
    drawHud();
    drawSquadHud();
  }
}

function gameLoop(time) {
  const delta = lastTime ? time - lastTime : 16.667;
  lastTime = time;
  frame += delta / 16.667;
  update(delta);
  draw();
  requestAnimationFrame(gameLoop);
}

resetGame();
canvas.addEventListener("pointerdown", handleCanvasInput);
window.addEventListener("keydown", handleInput);
requestAnimationFrame(gameLoop);
