import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Template } from "../../database/entities/template.entity.js";

@Injectable()
export class TemplateService {
  constructor(@InjectRepository(Template) private readonly repository: Repository<Template>) {}

  // The color theme TilesService injects into a rendered tile as the very last step
  // before responding (see injectStyleTemplate in src/core/svg.ts). Resolves to null
  // when none is active - the response then keeps every themeable color's default
  // (see THEMEABLE_COLOR_VARIABLES in styles.ts), i.e. today's look.
  getActive(): Promise<Template | null> {
    return this.repository.findOneBy({ isActive: true });
  }

  // Looked up when a request names a template explicitly (the `:id` path segment on
  // GET /v1/templates/:id/tiles/:z/:x/:y.svg) - independent of which one, if any, is
  // `isActive`.
  getById(id: string): Promise<Template | null> {
    return this.repository.findOneBy({ id });
  }

  list(): Promise<Template[]> {
    return this.repository.find({ order: { creationTime: "DESC" } });
  }

  create(name: string, colors: Record<string, string>): Promise<Template> {
    const entity = this.repository.create({ id: crypto.randomUUID(), name, colors, isActive: false });
    return this.repository.save(entity);
  }

  // Activates exactly this row, deactivating whatever was active before. See
  // DatasetVersionService.activate for why this runs in one transaction.
  async activate(id: string): Promise<Template> {
    return this.repository.manager.transaction(async (manager) => {
      await manager.update(Template, { isActive: true }, { isActive: false });
      const result = await manager.update(Template, { id }, { isActive: true });
      if (!result.affected) {
        throw new NotFoundException(`Template "${id}" not found`);
      }
      return manager.findOneByOrFail(Template, { id });
    });
  }
}
