import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTemplates1788882245339 implements MigrationInterface {
  name = "CreateTemplates1788882245339";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "templates" (
        "id" uuid NOT NULL,
        "name" character varying(128) NOT NULL,
        "colors" jsonb NOT NULL,
        "is_active" boolean NOT NULL DEFAULT false,
        "creation_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk__templates" PRIMARY KEY ("id")
      );
    `);
    // At most one active template at a time - enforced at the DB level, not just in
    // application code (see the matching index on dataset_versions).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "templates_single_active"
        ON "templates" ("is_active")
        WHERE "is_active" = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "templates";`);
  }
}
