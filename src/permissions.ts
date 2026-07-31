import type { PermissionDto, RequiredPermission } from "./types";

const WILDCARD = "*";

function matches(policy: string, requested: string): boolean {
  return policy === requested || policy === WILDCARD;
}

export function isAllowed(
  permissions: PermissionDto[],
  resource: string,
  action: string,
): boolean {
  let allowed = false;
  for (const permission of permissions) {
    if (
      !matches(permission.resource, resource) ||
      !matches(permission.action, action)
    ) {
      continue;
    }
    if (permission.effect === "deny") return false;
    allowed = true;
  }
  return allowed;
}

export function missingPermissions(
  permissions: PermissionDto[],
  required: RequiredPermission[],
): RequiredPermission[] {
  return required.filter(
    (need) => !isAllowed(permissions, need.resource, need.action),
  );
}
