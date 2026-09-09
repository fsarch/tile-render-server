import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LabelAnchor } from "../../database/entities/label-anchor.entity.js";
import type { GlobalAreaAnchor, LabelAnchorCache, LabelAnchorKey } from "../../core/label-anchor-cache.js";

@Injectable()
export class PostgresLabelAnchorCache implements LabelAnchorCache {
  constructor(
    @InjectRepository(LabelAnchor) private readonly repository: Repository<LabelAnchor>,
    private readonly configService: ConfigService
  ) {}

  async get(key: LabelAnchorKey): Promise<GlobalAreaAnchor | null | undefined> {
    const row = await this.repository.findOneBy({
      sourceLayer: key.sourceLayer,
      featureId: key.featureId,
      datasetVersion: this.getDatasetVersion(),
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
        datasetVersion: this.getDatasetVersion(),
        fx: value.fx,
        fy: value.fy,
      },
      ["sourceLayer", "featureId", "datasetVersion"]
    );
  }

  private getDatasetVersion(): string {
    const value = this.configService.get<string>("tiles.datasetVersion");
    return typeof value === "string" ? value : "";
  }
}
