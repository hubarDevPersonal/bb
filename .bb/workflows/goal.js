export const meta = {
  name: "goal",
  description:
    "Ведёт цель от сырой идеи до проверенной реализации: интент, план, исполнение, сверка. Старшие модели думают и сверяют, дешёвый исполнитель пишет код.",
  inputSchema: {
    type: "object",
    properties: {
      goal: { type: "string", minLength: 1, description: "Сырая идея или задача" },
      constraints: { type: "string", description: "Ограничения, которые нельзя нарушать" },
      maxTasks: { type: "integer", minimum: 1, maximum: 12 },
    },
    required: ["goal"],
    additionalProperties: false,
  },
  phases: [
    { title: "Intent", detail: "Старшая модель превращает идею в интент с критериями приёмки" },
    { title: "Plan", detail: "Вторая старшая модель режет интент на задачи, первая сверяет план" },
    { title: "Build", detail: "Дешёвый исполнитель реализует и тестирует каждую задачу" },
    { title: "Verify", detail: "Старшая модель сверяет результат с критериями приёмки" },
    { title: "Report", detail: "Сводка: что сделано, что не сошлось" },
  ],
};

// Маршрутизация моделей по ролям. Тройки пишутся литералами в каждом вызове
// намеренно: валидатор сверяет только литеральные provider/model/reasoningLevel
// с живым каталогом провайдеров, поэтому опечатка ловится до запуска, а не на
// третьей фазе. Меняя роль, поменяй её везде — их ровно столько, сколько ниже.
//
//   ARCHITECT  claude-code / claude-fable-5-1   / high  интент, сверка плана, финальный отчёт
//   PLANNER    claude-code / claude-fable-5-1   / high  декомпозиция на задачи (решения — Fable)
//   REVIEWER   codex       / gpt-5.6-sol        / high  приёмка каждой задачи другим вендором
//   EXECUTOR   claude-code / claude-opus-5-5[1m]  / high  реализация и ремонт (код пишет Opus)

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    restated: { type: "string", description: "Задача своими словами, однозначно" },
    problem: { type: "string" },
    scope: { type: "array", items: { type: "string" }, maxItems: 12 },
    nonGoals: { type: "array", items: { type: "string" }, maxItems: 12 },
    acceptanceCriteria: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 12,
      description: "Проверяемые критерии: каждый можно подтвердить командой или чтением кода",
    },
    openQuestions: { type: "array", items: { type: "string" }, maxItems: 8 },
    risk: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["restated", "problem", "acceptanceCriteria", "risk"],
  additionalProperties: false,
};

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          intent: { type: "string", description: "Что именно должно измениться и зачем" },
          files: { type: "array", items: { type: "string" }, maxItems: 12 },
          verification: { type: "string", description: "Команда или проверка, доказывающая результат" },
        },
        required: ["id", "title", "intent", "verification"],
        additionalProperties: false,
      },
    },
    sequencing: { type: "string", description: "Почему задачи независимы или в каком порядке их брать" },
  },
  required: ["tasks"],
  additionalProperties: false,
};

const PLAN_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    blockingIssues: { type: "array", items: { type: "string" }, maxItems: 10 },
    revisedTasks: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          intent: { type: "string" },
          files: { type: "array", items: { type: "string" }, maxItems: 12 },
          verification: { type: "string" },
        },
        required: ["id", "title", "intent", "verification"],
        additionalProperties: false,
      },
    },
  },
  required: ["approved"],
  additionalProperties: false,
};

const BUILD_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    changedFiles: { type: "array", items: { type: "string" }, maxItems: 30 },
    verificationCommand: { type: "string" },
    verificationOutcome: { type: "string", enum: ["passed", "failed", "not-run"] },
    verificationEvidence: { type: "string", description: "Реальный вывод команды, не пересказ" },
    notes: { type: "string" },
  },
  required: ["summary", "verificationOutcome"],
  additionalProperties: false,
};

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["accepted", "needs-repair", "rejected"] },
    reasoning: { type: "string" },
    unmetCriteria: { type: "array", items: { type: "string" }, maxItems: 12 },
    repairInstructions: { type: "string" },
  },
  required: ["verdict", "reasoning"],
  additionalProperties: false,
};

const json = (value) => JSON.stringify(value, null, 2);

const NO_COMMIT = [
  "Правила исполнения:",
  "- Не делай git commit, git push и не меняй ветку. Оставь изменения в рабочем дереве.",
  "- Не трогай файлы вне задачи.",
  "- Проверку запускай реально и приводи настоящий вывод команды, а не пересказ.",
].join("\n");

const goalText = typeof args.goal === "string" ? args.goal : "";
const constraints = typeof args.constraints === "string" ? args.constraints : "";
const maxTasks = typeof args.maxTasks === "number" ? args.maxTasks : 6;

if (goalText.length === 0) {
  throw new Error("goal обязателен: передай --args '{\"goal\":\"...\"}'");
}

phase("Intent");
log("Разбираю идею в интент");

const intent = await agent(
  [
    "Ты ведущий инженер. Преврати сырую идею в однозначный интент, прежде чем кто-то напишет код.",
    "",
    "Идея пользователя:",
    goalText,
    constraints.length > 0 ? "\nОграничения:\n" + constraints : "",
    "",
    "Изучи рабочее дерево, чтобы интент опирался на реальный код, а не на догадки.",
    "Критерии приёмки должны быть проверяемыми: каждый подтверждается командой или конкретным местом в коде.",
    "Ничего не меняй на диске — это фаза понимания.",
  ].join("\n"),
  { provider: "claude-code", model: "claude-fable-5-1", reasoningLevel: "high", schema: INTENT_SCHEMA, title: "intent", phase: "Intent" },
);

if (intent === null) {
  throw new Error("Фаза интента не дала результата");
}

log("Интент готов, риск: " + intent.risk);

phase("Plan");

const plan = await agent(
  [
    "Ты планировщик. Разрежь интент на независимые задачи, которые исполнитель послабее сделает без домысливания.",
    "",
    "Интент:",
    json(intent),
    "",
    "Требования к плану:",
    "- Не больше " + maxTasks + " задач.",
    "- Каждая задача самодостаточна: из её описания понятно, что менять, не читая остальные задачи.",
    "- У каждой задачи есть verification — конкретная команда или проверка.",
    "- Задачи не должны конфликтовать за одни и те же строки.",
    "Ничего не меняй на диске — это фаза планирования.",
  ].join("\n"),
  { provider: "claude-code", model: "claude-fable-5-1", reasoningLevel: "high", schema: PLAN_SCHEMA, title: "plan", phase: "Plan" },
);

if (plan === null) {
  throw new Error("Фаза плана не дала результата");
}

const planReview = await agent(
  [
    "Ты сверяешь чужой план с интентом. Твоя задача — поймать расхождения до того, как начнётся работа.",
    "",
    "Интент:",
    json(intent),
    "",
    "Предложенный план:",
    json(plan),
    "",
    "Проверь: план покрывает все критерии приёмки; задачи не пересекаются; verification реально доказывает результат.",
    "Если план годится — approved: true. Если нет — approved: false, перечисли blockingIssues и верни исправленный revisedTasks.",
    "Ничего не меняй на диске.",
  ].join("\n"),
  { provider: "claude-code", model: "claude-fable-5-1", reasoningLevel: "high", schema: PLAN_REVIEW_SCHEMA, title: "plan-review", phase: "Plan" },
);

const revised = planReview !== null && Array.isArray(planReview.revisedTasks) && planReview.revisedTasks.length > 0;
const tasks = (revised ? planReview.revisedTasks : plan.tasks).slice(0, maxTasks);

if (planReview !== null && planReview.approved === false) {
  log("План отправлен на правку: " + (planReview.blockingIssues || []).join("; "));
}
log("К исполнению задач: " + tasks.length);

phase("Build");

const results = await pipeline(
  tasks,
  (task) =>
    agent(
      [
        "Реализуй одну задачу целиком и проверь её.",
        "",
        "Задача:",
        json(task),
        "",
        "Контекст цели (не расширяй объём за его пределы):",
        json({ restated: intent.restated, acceptanceCriteria: intent.acceptanceCriteria, nonGoals: intent.nonGoals }),
        "",
        NO_COMMIT,
      ].join("\n"),
      { provider: "claude-code", model: "claude-opus-5-5[1m]", reasoningLevel: "high", schema: BUILD_SCHEMA, title: "build:" + task.id, phase: "Build" },
    ),
  async (build, task) => {
    const verdict = await agent(
      [
        "Ты сверяешь выполненную задачу с тем, что требовалось. Будь скептичен: отчёт исполнителя — это заявка, а не доказательство.",
        "",
        "Задача:",
        json(task),
        "",
        "Отчёт исполнителя:",
        json(build),
        "",
        "Критерии приёмки цели:",
        json(intent.acceptanceCriteria),
        "",
        "Прочитай реальные изменения в рабочем дереве и, если нужно, сам запусти проверку.",
        "Если результат не сходится — verdict: needs-repair и напиши repairInstructions конкретно, шагами.",
        "Сам код не правь.",
      ].join("\n"),
      { provider: "codex", model: "gpt-5.6-sol", reasoningLevel: "high", schema: VERDICT_SCHEMA, title: "verify:" + task.id, phase: "Verify" },
    );

    // Сорвавшийся ревьюер — это не приёмка. Ремонтировать вслепую тоже нельзя:
    // непонятно, что чинить. Помечаем непроверенной, итог посчитает её проваленной.
    if (verdict === null) {
      log("Ревьюер не ответил по задаче " + task.id + " — задача осталась непроверенной");
      return { task: task, build: build, verdict: null, repaired: false };
    }

    if (verdict.verdict === "accepted") {
      return { task: task, build: build, verdict: verdict, repaired: false };
    }

    log("Задача " + task.id + " уходит на ремонт");

    const repair = await agent(
      [
        "Почини свою работу по замечаниям ревьюера. Одна попытка.",
        "",
        "Задача:",
        json(task),
        "",
        "Замечания:",
        json(verdict),
        "",
        NO_COMMIT,
      ].join("\n"),
      { provider: "claude-code", model: "claude-opus-5-5[1m]", reasoningLevel: "high", schema: BUILD_SCHEMA, title: "repair:" + task.id, phase: "Build" },
    );

    const recheck = await agent(
      [
        "Перепроверь задачу после ремонта. Те же правила: доверяй только тому, что видишь в рабочем дереве.",
        "",
        "Задача:",
        json(task),
        "",
        "Отчёт после ремонта:",
        json(repair),
        "",
        "Прошлые замечания:",
        json(verdict),
      ].join("\n"),
      { provider: "codex", model: "gpt-5.6-sol", reasoningLevel: "high", schema: VERDICT_SCHEMA, title: "recheck:" + task.id, phase: "Verify" },
    );

    return { task: task, build: repair, verdict: recheck, repaired: true };
  },
);

phase("Report");

const settled = results.filter((entry) => entry !== null);
const accepted = settled.filter((entry) => entry.verdict !== null && entry.verdict.verdict === "accepted");
const failed = settled.filter((entry) => entry.verdict === null || entry.verdict.verdict !== "accepted");
const dropped = results.length - settled.length;

log("Принято " + accepted.length + " из " + tasks.length);

const report = await agent(
  [
    "Собери итог по цели для человека, который не следил за работой.",
    "",
    "Интент:",
    json(intent),
    "",
    "Результаты задач:",
    json(settled.map((entry) => ({ task: entry.task.title, verdict: entry.verdict, repaired: entry.repaired }))),
    "",
    dropped > 0 ? "Задач сорвалось без результата: " + dropped : "",
    "",
    "Скажи прямо: какие критерии приёмки закрыты, какие нет, и что осталось человеку.",
    "Не преувеличивай готовность. Если что-то не проверено — так и скажи.",
    "Ничего не меняй на диске.",
  ].join("\n"),
  { provider: "claude-code", model: "claude-fable-5-1", reasoningLevel: "high", title: "report", phase: "Report" },
);

return {
  intent: intent,
  tasksPlanned: tasks.length,
  accepted: accepted.length,
  failed: failed.length,
  dropped: dropped,
  unmet: failed.map((entry) => entry.task.title),
  report: report,
};
