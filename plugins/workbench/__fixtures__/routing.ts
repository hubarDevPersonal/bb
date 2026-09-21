import type { RoutingEntry } from "../routing.js";

export const ROUTING_FIXTURE = `# Маршрутизация моделей

Единственный источник истины: субагенты в \`agents/\`, роли в \`workflows/goal.js\`
и раздел «Маршрутизация» в \`CLAUDE.md\` обязаны совпадать с этой таблицей.

| Роль | Что делает | Провайдер / модель | Усилие |
|---|---|---|---|
| **Architect** (оркестратор треда, планировщик, решения, финальная приёмка) | интент, план, спорные решения, отчёт | claude-code / \`claude-fable-5-1\` | high |
| **Implementer** (пишет код) | реализация одной задачи, ремонт по замечаниям | claude-code / \`claude-opus-5[1m]\` (субагент: \`claude-opus-5\`) | high |
| **Scout** (разведка, read-only) | найти файлы, вызовы, паттерны, команды | claude-code / \`claude-sonnet-5\` | medium |
| **Reviewer, кросс-вендорный** (goal-пайплайн, кнопка Review) | независимая приёмка чужого кода другим вендором | **codex / \`gpt-5.6-sol\`** | high |
| **Reviewer, внутри треда** (субагент) | приёмка, когда Codex недоступен как субагент | claude-code / \`claude-fable-5-1\` | high |

Правила:
- **Haiku не используется** ни в одной роли. Минимум для любой роли — Sonnet 5, и только на разведку.
- Код пишет Opus. Планирует и принимает решения Fable 5.1.
- Ревью по возможности делает **другой вендор** (Codex \`gpt-5.6-sol\`): чужой код чужими глазами.
`;

export const ROUTING_FIXTURE_ENTRIES: RoutingEntry[] = [
  {
    role: "architect",
    providerId: "claude-code",
    model: "claude-fable-5-1",
    subagentModel: null,
    effort: "high",
  },
  {
    role: "implementer",
    providerId: "claude-code",
    model: "claude-opus-5[1m]",
    subagentModel: "claude-opus-5",
    effort: "high",
  },
  {
    role: "scout",
    providerId: "claude-code",
    model: "claude-sonnet-5",
    subagentModel: null,
    effort: "medium",
  },
  {
    role: "reviewer-cross-vendor",
    providerId: "codex",
    model: "gpt-5.6-sol",
    subagentModel: null,
    effort: "high",
  },
  {
    role: "reviewer-subagent",
    providerId: "claude-code",
    model: "claude-fable-5-1",
    subagentModel: null,
    effort: "high",
  },
];
