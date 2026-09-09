import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DatasetVersion } from "../../database/entities/dataset-version.entity.js";

@Injectable()
export class DatasetVersionService {
  constructor(
    @InjectRepository(DatasetVersion) private readonly repository: Repository<DatasetVersion>
  ) {}

  // The row TilesService opens its PMTiles archive from (see src/controllers/tiles/
  // tiles.service.ts). Resolves to null when none is active yet (e.g. a fresh install
  // before any dataset version has been registered).
  getActive(): Promise<DatasetVersion | null> {
    return this.repository.findOneBy({ isActive: true });
  }

  list(): Promise<DatasetVersion[]> {
    return this.repository.find({ order: { creationTime: "DESC" } });
  }

  create(path: string): Promise<DatasetVersion> {
    const entity = this.repository.create({ id: crypto.randomUUID(), path, isActive: false });
    return this.repository.save(entity);
  }

  // Activates exactly this row, deactivating whatever was active before. Runs both
  // updates in one transaction so a concurrent read never observes zero or two active
  // rows (the partial unique index in the create-dataset-versions migration also
  // guards against the latter at the DB level).
  async activate(id: string): Promise<DatasetVersion> {
    return this.repository.manager.transaction(async (manager) => {
      await manager.update(DatasetVersion, { isActive: true }, { isActive: false });
      const result = await manager.update(DatasetVersion, { id }, { isActive: true });
      if (!result.affected) {
        throw new NotFoundException(`DatasetVersion "${id}" not found`);
      }
      return manager.findOneByOrFail(DatasetVersion, { id });
    });
  }
}
