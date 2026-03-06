/**
 * Validates the OpenAPI spec at docs/openapi.yaml for correct YAML syntax
 * and basic OpenAPI 3.1 structural requirements.
 */
import fs from "fs";
import path from "path";
import yaml from "yaml";

const specPath = path.resolve(process.cwd(), "docs/openapi.yaml");

if (!fs.existsSync(specPath)) {
  console.error("ERROR: docs/openapi.yaml not found");
  process.exit(1);
}

try {
  const content = fs.readFileSync(specPath, "utf-8");
  const spec = yaml.parse(content) as Record<string, unknown>;

  // Structural checks
  const errors: string[] = [];

  if (!spec.openapi || !String(spec.openapi).startsWith("3.")) {
    errors.push("Missing or invalid 'openapi' version (expected 3.x)");
  }

  if (!spec.info || typeof spec.info !== "object") {
    errors.push("Missing 'info' object");
  }

  if (!spec.paths || typeof spec.paths !== "object") {
    errors.push("Missing 'paths' object");
  }

  if (!spec.components || typeof spec.components !== "object") {
    errors.push("Missing 'components' object");
  }

  const components = spec.components as Record<string, unknown>;
  if (!components.securitySchemes || typeof components.securitySchemes !== "object") {
    errors.push("Missing 'components.securitySchemes'");
  }

  if (!components.schemas || typeof components.schemas !== "object") {
    errors.push("Missing 'components.schemas'");
  }

  const paths = spec.paths as Record<string, unknown>;
  const pathCount = Object.keys(paths).length;
  if (pathCount === 0) {
    errors.push("'paths' is empty — expected at least one endpoint");
  }

  if (errors.length > 0) {
    console.error("OpenAPI spec validation FAILED:");
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }

  console.log(`OpenAPI spec valid: ${pathCount} paths, version ${spec.openapi}`);
  process.exit(0);
} catch (err) {
  console.error("Failed to parse docs/openapi.yaml:", err);
  process.exit(1);
}
