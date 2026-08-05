import { ErpApiError, MissingPermissionsError, UnknownObjectError } from "erp-sdk";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = (message = "Phiên làm việc đã hết hạn") => new HttpError(401, message);
export const notFound = (message = "Không tìm thấy dữ liệu") => new HttpError(404, message);

function describe(error: unknown): { status: number; message: string } {
  if (error instanceof HttpError) return { status: error.status, message: error.message };

  if (error instanceof ZodError) {
    const detail = error.issues
      .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
      .join("; ");
    return { status: 400, message: `Dữ liệu không hợp lệ — ${detail}` };
  }

  if (error instanceof MissingPermissionsError) {
    const missing = error.missing.map((p) => `${p.resource}:${p.action}`).join(", ");
    return { status: 500, message: `Service account của app thiếu quyền: ${missing}` };
  }

  if (error instanceof UnknownObjectError) {
    return { status: 500, message: `Bảng "${error.object}" chưa được tạo trong workspace` };
  }

  if (error instanceof ErpApiError) {
    return { status: error.status, message: error.message };
  }

  return {
    status: 500,
    message: error instanceof Error ? error.message : "Lỗi không xác định",
  };
}

export function errorResponse(error: unknown): Response {
  const { status, message } = describe(error);
  if (status >= 500) console.error("[hr-portal]", error);
  return Response.json({ error: message }, { status });
}
