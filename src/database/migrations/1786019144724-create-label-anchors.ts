import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLabelAnchors1786019144724 implements MigrationInterface {
  name = "CreateLabelAnchors1786019144724";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "label_anchors" (
        "source_layer" character varying(64) NOT NULL,
        "feature_id" character varying(128) NOT NULL,
        "dataset_version" character varying(64) NOT NULL DEFAULT '',
        "fx" double precision NOT NULL,
        "fy" double precision NOT NULL,
        "resolved_zoom" smallint,
        "creation_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "update_time" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk__label_anchors" PRIMARY KEY ("source_layer", "feature_id", "dataset_version")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "label_anchors";`);
  }
}
