import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LabelAnchor } from "../../database/entities/label-anchor.entity.js";
import type { GlobalAreaAnchor, LabelAnchorCache, LabelAnchorKey } from "../../core/label-anchor-cache.js";

@Injectable()
export class PostgresLabelAnchorCache implements LabelAnchorCache {
  // The active dataset_versions.id, scoping every cache row via a real foreign key
  // (see the label_anchors entity/migration) - set once by TilesService as soon as it
  // resolves the active DatasetVersion, before any tile is rendered.
  private datasetVersionId?: string;

  constructor(@InjectRepository(LabelAnchor) private readonly repository: Repository<LabelAnchor>) {}

  setDatasetVersionId(id: string): void {
    this.datasetVersionId = id;
  }

  async get(key: LabelAnchorKey): Promise<GlobalAreaAnchor | null | undefined> {
    const row = await this.repository.findOneBy({
      sourceLayer: key.sourceLayer,
      featureId: key.featureId,
      datasetVersion: this.getDatasetVersionId(),
    });
    if (!row) return undefined; // cache miss - go compute it
    return { fx: row.fx, fy: row.fy };
  }

  async set(key: LabelAnchorKey, value: GlobalAreaAnchor | null): Promise<void> {
    // A `null` result ("resolution attempted, nothing found") isn't persisted: the
    // entity's fx/fy columns are not-null (there's nothing meaningful to store), and
    // re-attempting an unresolvable lookup later is cheap and safe - unlike a
    // successful resolution, there's no expensive-to-redo work being avoided here.
    if (!value) return;
    await this.repository.upsert(
      {
        sourceLayer: key.sourceLayer,
        featureId: key.featureId,
        datasetVersion: this.getDatasetVersionId(),
        fx: value.fx,
        fy: value.fy,
      },
      ["sourceLayer", "featureId", "datasetVersion"]
    );
  }

  private getDatasetVersionId(): string {
    if (!this.datasetVersionId) {
      throw new Error("PostgresLabelAnchorCache used before setDatasetVersionId() was called");
    }
    return this.datasetVersionId;
  }
}
