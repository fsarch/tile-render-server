import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Template } from "../../database/entities/template.entity.js";
import { TemplateService } from "./template.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Template])],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
