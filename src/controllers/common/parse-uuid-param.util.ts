import { BadRequestException } from "@nestjs/common";

// Shared by TemplatesController and DatasetVersionsController - both identify their
// resource by a uuid path param.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuidParam(name: string, value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException(`Path parameter "${name}" must be a valid uuid`);
  }
  return value;
}
