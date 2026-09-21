import {
  ROUTING_ROLES,
  routingEntryFor,
  type RoutingEntry,
  type RoutingRole,
} from "./routing.js";

export const THREAD_DEPENDENT_REVIEW_MESSAGE =
  "no ROUTING.md reviewer available — the button uses the first provider " +
  "other than the thread's own";

export const REVIEW_TARGET_SOURCES = [
  "routing-cross-vendor",
  "routing-subagent",
  "routing",
  "provider-default",
  "fallback",
] as const;
export type ReviewTargetSource = (typeof REVIEW_TARGET_SOURCES)[number];

export type ReviewTargetRequest =
  | { kind: "auto" }
  | { kind: "provider"; providerId: string };

export type ReviewTargetResolution<P, M> =
  | {
      ok: true;
      provider: P;
      model: M;
      effort: string | null;
      source: ReviewTargetSource;
    }
  | { ok: false; error: "no_provider_available" | "provider_unavailable" };

const AUTO_ROUTING_ROLES = [
  "reviewer-cross-vendor",
  "reviewer-subagent",
] as const satisfies readonly RoutingRole[];

const EXPLICIT_ROUTING_ORDER: readonly RoutingRole[] = [
  ...AUTO_ROUTING_ROLES,
  ...ROUTING_ROLES.filter(
    (role) => role !== "reviewer-cross-vendor" && role !== "reviewer-subagent",
  ),
];

function sourceForRole(role: RoutingRole): ReviewTargetSource {
  if (role === "reviewer-cross-vendor") return "routing-cross-vendor";
  if (role === "reviewer-subagent") return "routing-subagent";
  return "routing";
}

interface ReviewTargetInput<P, M> {
  request: ReviewTargetRequest;
  entries: readonly RoutingEntry[];
  available: readonly P[];
  loadModels: (providerId: string) => Promise<readonly M[]>;
}

function cachedCatalog<M>(
  loadModels: (providerId: string) => Promise<readonly M[]>,
): (providerId: string) => Promise<readonly M[]> {
  const catalogs = new Map<string, Promise<readonly M[]>>();
  return (providerId) => {
    let pending = catalogs.get(providerId);
    if (pending === undefined) {
      pending = loadModels(providerId).catch(() => []);
      catalogs.set(providerId, pending);
    }
    return pending;
  };
}

function defaultModelOf<M extends { isDefault: boolean }>(
  models: readonly M[],
): M | null {
  return models.find((model) => model.isDefault) ?? models[0] ?? null;
}

export async function resolveReviewTarget<
  P extends { id: string },
  M extends { model: string; isDefault: boolean },
>(
  input: ReviewTargetInput<P, M> & { threadProviderId: string },
): Promise<ReviewTargetResolution<P, M>> {
  const loadModels = cachedCatalog(input.loadModels);
  const routed = await resolveRoutedReviewTarget({ ...input, loadModels });
  if (routed !== null) return routed;
  const fallback = input.available.find(
    (candidate) => candidate.id !== input.threadProviderId,
  );
  if (fallback === undefined) {
    return { ok: false, error: "no_provider_available" };
  }
  const model = defaultModelOf(await loadModels(fallback.id));
  if (model === null) return { ok: false, error: "provider_unavailable" };
  return {
    ok: true,
    provider: fallback,
    model,
    effort: null,
    source: "fallback",
  };
}

export async function resolveRoutedReviewTarget<
  P extends { id: string },
  M extends { model: string; isDefault: boolean },
>(
  input: ReviewTargetInput<P, M>,
): Promise<ReviewTargetResolution<P, M> | null> {
  const modelsFor = cachedCatalog(input.loadModels);
  const defaultModel = async (providerId: string): Promise<M | null> =>
    defaultModelOf(await modelsFor(providerId));
  const routedModel = async (
    entry: RoutingEntry,
    provider: P,
  ): Promise<M | null> =>
    (await modelsFor(provider.id)).find(
      (model) => model.model === entry.model,
    ) ?? null;

  if (input.request.kind === "provider") {
    const requestedId = input.request.providerId;
    const provider = input.available.find(
      (candidate) => candidate.id === requestedId,
    );
    if (provider === undefined) {
      return { ok: false, error: "provider_unavailable" };
    }
    for (const role of EXPLICIT_ROUTING_ORDER) {
      const entry = routingEntryFor(input.entries, role);
      if (entry === null || entry.providerId !== provider.id) continue;
      const model = await routedModel(entry, provider);
      if (model !== null) {
        return {
          ok: true,
          provider,
          model,
          effort: entry.effort,
          source: sourceForRole(role),
        };
      }
    }
    const model = await defaultModel(provider.id);
    if (model === null) return { ok: false, error: "provider_unavailable" };
    return {
      ok: true,
      provider,
      model,
      effort: null,
      source: "provider-default",
    };
  }

  for (const role of AUTO_ROUTING_ROLES) {
    const entry = routingEntryFor(input.entries, role);
    if (entry === null) continue;
    const provider = input.available.find(
      (candidate) => candidate.id === entry.providerId,
    );
    if (provider === undefined) continue;
    const model = await routedModel(entry, provider);
    if (model !== null) {
      return {
        ok: true,
        provider,
        model,
        effort: entry.effort,
        source: sourceForRole(role),
      };
    }
  }
  return null;
}
