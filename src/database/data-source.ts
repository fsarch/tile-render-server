// Plain TypeORM DataSource for the `migration:create|run|revert` npm scripts only.
// The bare TypeORM CLI can't consume NestJS's `TypeOrmModule.forRootAsync` factory
// config, so this file reads the same `database:` section of config.yaml directly.
//
// This is NOT imported by the running application - the app's real connection comes
// from FsArchAppBuilder.setDatabase(DATABASE_OPTIONS) in main.ts (which already runs
// migrations automatically on every boot via the installed @fsarch/server's
// `migrationsRun: true`). This file exists purely as a dev convenience for scaffolding
// new migrations or running/reverting them without booting the whole app.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import { load } from "js-yaml";
import { DatasetVersion } from "./entities/dataset-version.entity.js";
import { LabelAnchor } from "./entities/label-anchor.entity.js";
import { Template } from "./entities/template.entity.js";
import { CreateLabelAnchors1786019144724 } from "./migrations/1786019144724-create-label-anchors.js";
import { CreateDatasetVersions1788882245338 } from "./migrations/1788882245338-create-dataset-versions.js";
import { CreateTemplates1788882245339 } from "./migrations/1788882245339-create-templates.js";

type DatabaseConfig = {
  type: string;
  host: string;
  username: string;
  password?: string;
  database: string;
  port?: number;
};

function loadDatabaseConfig(): DatabaseConfig {
  const configPath = resolve(process.cwd(), process.env.CONFIG_FILE_PATH || "config.yaml");
  const config = load(readFileSync(configPath, "utf8")) as { database?: DatabaseConfig };
  if (!config.database) {
    throw new Error(`No "database" section found in ${configPath}`);
  }
  return config.database;
}

const databaseConfig = loadDatabaseConfig();
if (databaseConfig.type !== "postgres") {
  // Only postgres is used by this project; keep this CLI helper simple rather than
  // reproducing @fsarch/server's full sqlite/cockroachdb type-narrowing dance.
  throw new Error(`database.type "${databaseConfig.type}" is not supported by the migration CLI (expected "postgres")`);
}

export default new DataSource({
  type: "postgres",
  host: databaseConfig.host,
  username: databaseConfig.username,
  password: databaseConfig.password,
  database: databaseConfig.database,
  port: databaseConfig.port ?? 5432,
  entities: [LabelAnchor, DatasetVersion, Template],
  migrations: [CreateLabelAnchors1786019144724, CreateDatasetVersions1788882245338, CreateTemplates1788882245339],
});
