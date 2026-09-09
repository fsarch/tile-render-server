// A "global anchor" is a zoom-independent position for a feature that's split across
// many per-tile fragments (see renderer.ts for how it's computed): fx/fy are fractions
// of the whole world in [0,1), reprojected to any zoom via `256 * 2**zoom`.
export type GlobalAreaAnchor = { fx: number; fy: number };

// A feature is identified by which MVT source layer it comes from (a bare feature id
// is only unique within one layer's own feature table, not globally) plus its id
// within that layer - see renderer.ts for how featureId is derived (real MVT/OSM id
// when available, otherwise a synthetic "name:<normalized>" fallback).
export type LabelAnchorKey = {
  sourceLayer: string;
  featureId: string;
};

// Storage abstraction for resolved global anchors, so renderer.ts stays framework/DB
// agnostic. A `null` stored value means "resolution was attempted and found nothing"
// (distinct from "never looked up") - implementations aren't required to persist that
// distinction, since a cache miss and a cached null are handled identically by callers
// (both mean "go compute it").
export interface LabelAnchorCache {
  get(key: LabelAnchorKey): Promise<GlobalAreaAnchor | null | undefined>;
  set(key: LabelAnchorKey, value: GlobalAreaAnchor | null): Promise<void>;
}

function toCacheKey(key: LabelAnchorKey): string {
  return `${key.sourceLayer}|${key.featureId}`;
}

// Process-lifetime, in-memory implementation. This is the default `renderTileToSvg`
// uses when no cache is injected (preserves pre-Postgres behavior for the batch
// CLI/worker.ts, and is the fast fake used throughout renderer.spec.ts).
export class InMemoryLabelAnchorCache implements LabelAnchorCache {
  private readonly store = new Map<string, GlobalAreaAnchor | null>();

  async get(key: LabelAnchorKey): Promise<GlobalAreaAnchor | null | undefined> {
    return this.store.get(toCacheKey(key));
  }

  async set(key: LabelAnchorKey, value: GlobalAreaAnchor | null): Promise<void> {
    this.store.set(toCacheKey(key), value);
  }
}
