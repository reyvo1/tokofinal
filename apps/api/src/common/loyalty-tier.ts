export type LoyaltyTierResult = { code: string; minPoints: number; discountPct: number };

type LoyaltyTierConfig = { code?: unknown; minPoints?: unknown; discountPct?: unknown };

/** Pure deterministic tier resolver shared by POS promotions and customer storefront views. */
export function resolveLoyaltyTier(tiersValue: unknown, lifetimePoints: number): LoyaltyTierResult {
  const lifetime = Number.isFinite(lifetimePoints) ? Math.max(0, Math.floor(lifetimePoints)) : 0;
  const tiers = Array.isArray(tiersValue) ? tiersValue : [];
  const normalized = tiers.flatMap((value): LoyaltyTierResult[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const raw = value as LoyaltyTierConfig;
    const code = typeof raw.code === 'string' ? raw.code.trim().toUpperCase() : '';
    const minPoints = Number(raw.minPoints ?? 0);
    const discountPct = Number(raw.discountPct ?? 0);
    if (!code || !Number.isFinite(minPoints) || minPoints < 0 || !Number.isFinite(discountPct)) return [];
    return [{ code, minPoints: Math.floor(minPoints), discountPct: Math.min(50, Math.max(0, discountPct)) }];
  });
  const tier = normalized.filter((item) => lifetime >= item.minPoints).sort((a, b) => b.minPoints - a.minPoints || a.code.localeCompare(b.code))[0];
  return tier ?? { code: 'MEMBER', minPoints: 0, discountPct: 0 };
}
