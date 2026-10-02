const PRODUTOS = [
  {
    nome: "Crédito Pessoal",
    minimo: 2000,
    maximo: 30000,
    multiplicadorLimite: 3,
    margemConsignavelMaxima: null,
  },
  {
    nome: "Consignado",
    minimo: 5000,
    maximo: 80000,
    multiplicadorLimite: 6,
    margemConsignavelMaxima: 35,
  },
  {
    nome: "Veículos",
    minimo: 30000,
    maximo: 150000,
    multiplicadorLimite: 12,
    margemConsignavelMaxima: null,
  },
  {
    nome: "Imobiliário",
    minimo: 150000,
    maximo: 800000,
    multiplicadorLimite: 40,
    margemConsignavelMaxima: null,
  },
];

const CREDIT_CUT_SCORE = 500;
const MAX_COMMITMENT_PERCENT = 35;
const BASE_DECISION_COST = 1.2;
const GATE_DEFINITIONS = [
  { label: "ANTIFRAUDE", specialist: 0 },
  { label: "SCORE", specialist: 1 },
  { label: "POLÍTICA", specialist: 2 },
  { label: "KYC/PLD", specialist: 0 },
  { label: "RENDA", specialist: 1 },
  { label: "LIMITE", specialist: 2 },
];

function gerarProposta(random = Math.random) {
  const chooseInteger = (minimum, maximum) =>
    Math.floor(random() * (maximum - minimum + 1)) + minimum;
  const product = PRODUTOS[Math.floor(random() * PRODUTOS.length)];

  return {
    clientId: chooseInteger(100000, 999999),
    product,
    requestedAmount: chooseInteger(product.minimo, product.maximo),
    monthlyIncome: chooseInteger(1800, 24000),
    score: chooseInteger(300, 900),
    commitmentPercent: chooseInteger(10, 50),
    fraudSuspected: random() < 0.15,
  };
}

function calcularLimite(proposta) {
  const incomeLimit =
    proposta.monthlyIncome * proposta.product.multiplicadorLimite;
  const approvedAmount = Math.min(proposta.requestedAmount, incomeLimit);
  return {
    approvedAmount,
    incomeLimit,
    partial: approvedAmount < proposta.requestedAmount,
  };
}

function avaliarGate(proposta, gate) {
  const gateLabel = typeof gate === "string" ? gate : gate.label;

  if (gateLabel === "SCORE" && proposta.score < CREDIT_CUT_SCORE) {
    return {
      passed: false,
      approvedAmount: 0,
      partial: false,
      gapMultiplier: 0.85,
      specialBorderColor: "#FF4D6D",
      reason: `Score ${proposta.score} abaixo do corte de ${CREDIT_CUT_SCORE}`,
    };
  }

  if (gateLabel === "RENDA") {
    const maxCommitment =
      proposta.product.margemConsignavelMaxima ?? MAX_COMMITMENT_PERCENT;
    if (proposta.commitmentPercent > maxCommitment) {
      return {
        passed: false,
        approvedAmount: 0,
        partial: false,
        gapMultiplier: 0.85,
        reason: `Comprometimento de ${proposta.commitmentPercent}% acima da margem de ${maxCommitment}%`,
      };
    }
  }

  if (gateLabel === "LIMITE") {
    const limit = calcularLimite(proposta);
    return {
      passed: true,
      ...limit,
      reason: limit.partial
        ? "Aprovado parcial: limite calculado pela renda"
        : "Limite aprovado",
    };
  }

  return {
    passed: true,
    approvedAmount: null,
    partial: false,
    reason: "Critério atendido",
  };
}

function avaliarFraude(proposta, specialistActive, bypassed = false) {
  const avoided = proposta.fraudSuspected && (specialistActive || bypassed);
  return {
    suspected: proposta.fraudSuspected,
    avoided,
    approvedFraud: proposta.fraudSuspected && !avoided,
    lossAmount:
      proposta.fraudSuspected && !avoided
        ? calcularLimite(proposta).approvedAmount
        : 0,
  };
}

function calcularVolumeLiberado(proposta, multiplier = 1, bonusPercent = 0) {
  return (
    calcularLimite(proposta).approvedAmount * multiplier * (1 + bonusPercent)
  );
}

function calcularCustoDecisao(finopsActive = false) {
  return BASE_DECISION_COST * (finopsActive ? 0.7 : 1);
}

function avaliarSaudePortfolio(kpis) {
  if (kpis.fraudLoss > 0 || kpis.approvalRate < 0.3) {
    return { label: "Revisar Política", color: "#FF6B6B" };
  }
  if (kpis.approvalRate >= 0.6) {
    return { label: "Esteira Saudável", color: "#68D391" };
  }
  return { label: "Atenção ao Risco", color: "#F6C453" };
}

function calcularKPIs(stats) {
  const proposalsStarted = stats.proposalsStarted ?? 0;
  const approved = stats.approved ?? 0;
  const decisions = stats.decisions ?? 0;
  const completedSteers = stats.completedSteers ?? 0;
  return {
    approved,
    releasedVolume: stats.releasedVolume ?? 0,
    approvalRate: proposalsStarted === 0 ? 0 : approved / proposalsStarted,
    fraudsAvoided: stats.fraudsAvoided ?? 0,
    fraudLoss: stats.fraudLoss ?? 0,
    decisionCost:
      decisions === 0 ? 0 : (stats.decisionCostTotal ?? 0) / decisions,
    averageSlaSeconds:
      completedSteers === 0
        ? 0
        : (stats.slaTotalMs ?? 0) / completedSteers / 1000,
    proposalsStarted,
    decisions,
  };
}

globalThis.CreditBusiness = {
  PRODUTOS,
  CREDIT_CUT_SCORE,
  MAX_COMMITMENT_PERCENT,
  BASE_DECISION_COST,
  GATE_DEFINITIONS,
  gerarProposta,
  avaliarGate,
  calcularLimite,
  avaliarFraude,
  calcularVolumeLiberado,
  calcularCustoDecisao,
  avaliarSaudePortfolio,
  calcularKPIs,
};
