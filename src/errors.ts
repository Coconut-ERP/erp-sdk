import type { RequiredPermission } from "./types";

export class ErpApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly trace?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ErpApiError";
  }
}

export class MissingPermissionsError extends Error {
  constructor(readonly missing: RequiredPermission[]) {
    super(
      `API key is missing required permissions: ${missing
        .map((p) => `${p.resource}:${p.action}`)
        .join(", ")}`,
    );
    this.name = "MissingPermissionsError";
  }
}

export class UnknownObjectError extends Error {
  constructor(readonly object: string) {
    super(`Object not found in workspace: "${object}"`);
    this.name = "UnknownObjectError";
  }
}

export class UnknownFieldError extends Error {
  constructor(
    readonly field: string,
    readonly objectName: string,
    readonly known: string[],
  ) {
    super(
      `Field "${field}" does not exist on object "${objectName}". Known fields: ${known.join(", ")}`,
    );
    this.name = "UnknownFieldError";
  }
}
