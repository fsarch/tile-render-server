import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateSchema1786019144724 implements MigrationInterface {
  name = "CreateSchema1786019144724";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Registers a known planet.pmtiles build the REST API can serve - see
    // src/database/entities/dataset-version.entity.ts. Created first: label_anchors
    // below has a foreign key onto it.
    await queryRunner.createTable(
      new Table({
        name: "dataset_versions",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            primaryKeyConstraintName: "pk__dataset_versions",
          },
          {
            name: "path",
            type: "character varying",
            length: "2048",
          },
          {
            name: "is_active",
            type: "boolean",
            default: false,
          },
          {
            name: "creation_time",
            type: "timestamp with time zone",
            default: "now()",
          },
          {
            name: "update_time",
            type: "timestamp with time zone",
            default: "now()",
          },
        ],
      }),
    );
    // At most one active dataset version at a time - enforced at the DB level, not
    // just in application code (a partial unique index only covers rows where the
    // condition holds, so any number of inactive rows are unaffected).
    await queryRunner.createIndex(
      "dataset_versions",
      new TableIndex({
        name: "dataset_versions_single_active",
        columnNames: ["is_active"],
        isUnique: true,
        where: `"is_active" = true`,
      }),
    );

    // Persisted, shared cache of resolved cross-tile label anchor positions - see
    // src/database/entities/label-anchor.entity.ts. dataset_version is a real foreign
    // key onto dataset_versions.id (which registered pmtiles build the anchor was
    // resolved against) rather than a manually-bumped string - a new dataset_versions
    // row always gets a fresh id, so anchors from a prior build are naturally never
    // matched against it, with no separate invalidation lever to remember to bump.
    await queryRunner.createTable(
      new Table({
        name: "label_anchors",
        columns: [
          {
            name: "source_layer",
            type: "character varying",
            length: "64",
            isPrimary: true,
            primaryKeyConstraintName: "pk__label_anchors",
          },
          {
            name: "feature_id",
            type: "character varying",
            length: "128",
            isPrimary: true,
            primaryKeyConstraintName: "pk__label_anchors",
          },
          {
            name: "dataset_version",
            type: "uuid",
            isPrimary: true,
            primaryKeyConstraintName: "pk__label_anchors",
          },
          {
            name: "fx",
            type: "double precision",
          },
          {
            name: "fy",
            type: "double precision",
          },
          {
            name: "resolved_zoom",
            type: "smallint",
            isNullable: true,
          },
          {
            name: "creation_time",
            type: "timestamp with time zone",
            default: "now()",
          },
          {
            name: "update_time",
            type: "timestamp with time zone",
            default: "now()",
          },
        ],
        foreignKeys: [
          {
            name: "fk__label_anchors__dataset_version",
            columnNames: ["dataset_version"],
            referencedTableName: "dataset_versions",
            referencedColumnNames: ["id"],
            // A deleted dataset_versions row invalidates every anchor resolved against
            // it - there's nothing left for them to usefully refer to.
            onDelete: "CASCADE",
          },
        ],
      }),
    );

    // Color theme applied on top of a rendered tile - see
    // src/database/entities/template.entity.ts.
    await queryRunner.createTable(
      new Table({
        name: "templates",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            primaryKeyConstraintName: "pk__templates",
          },
          {
            name: "name",
            type: "character varying",
            length: "2048",
          },
          {
            name: "colors",
            type: "jsonb",
          },
          {
            name: "is_active",
            type: "boolean",
            default: false,
          },
          {
            name: "creation_time",
            type: "timestamp with time zone",
            default: "now()",
          },
          {
            name: "update_time",
            type: "timestamp with time zone",
            default: "now()",
          },
          {
            name: "deletion_time",
            type: "timestamp with time zone",
            isNullable: true,
          },
        ],
      }),
    );
    // At most one active template at a time - enforced at the DB level, not just in
    // application code (see the matching index on dataset_versions).
    await queryRunner.createIndex(
      "templates",
      new TableIndex({
        name: "templates_single_active",
        columnNames: ["is_active"],
        isUnique: true,
        where: `"is_active" = true`,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("templates");
    await queryRunner.dropTable("label_anchors");
    await queryRunner.dropTable("dataset_versions");
  }
}
