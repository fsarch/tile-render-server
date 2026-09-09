import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDatasetVersions1788882245338 implements MigrationInterface {
  name = "CreateDatasetVersions1788882245338";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "dataset_versions" (
        "id" uuid NOT NULL,
        "path" character varying(1024) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT false,
        "creation_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk__dataset_versions" PRIMARY KEY ("id")
      );
    `);
    // At most one active dataset version at a time - enforced at the DB level, not
    // just in application code (a partial unique index only covers rows where the
    // condition holds, so any number of inactive rows are unaffected).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "dataset_versions_single_active"
        ON "dataset_versions" ("is_active")
        WHERE "is_active" = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "dataset_versions";`);
  }
}
