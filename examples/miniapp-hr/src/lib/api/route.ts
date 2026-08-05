import type { RecordDto, UserDto } from "erp-sdk";
import type { NextRequest } from "next/server";
import type { z } from "zod";
import type { HrErp } from "@/lib/erp/app";
import { resolveEmployee, resolveUser } from "@/lib/erp/session";
import { errorResponse, unauthorized } from "./errors";

export const INIT_DATA_HEADER = "x-init-data";

export interface HrContext {
  erp: HrErp;
  user: UserDto;
  /** The signed-in user's own "Nhân sự" record — the anchor for every data scope. */
  employee: RecordDto;
}

async function identify(request: NextRequest): Promise<UserDto> {
  const initData = request.headers.get(INIT_DATA_HEADER);
  if (!initData) throw unauthorized("Thiếu initData — hãy mở app từ trong ERP");
  return resolveUser(initData);
}

async function contextFrom(request: NextRequest): Promise<HrContext> {
  const user = await identify(request);
  const { erp, employee } = await resolveEmployee(user);
  return { erp, user, employee };
}

type Handler<P> = (context: HrContext, request: NextRequest, params: P) => Promise<unknown>;

/**
 * Wraps a route handler with the app-authority contract: every call is
 * identified through initData before it touches ERP data, and every failure
 * comes back as JSON the frontend can act on (401 → ask the host for a fresh
 * initData and retry).
 */
export function withHr<P = unknown>(handler: Handler<P>) {
  return async (request: NextRequest, routeContext: { params: Promise<P> }): Promise<Response> => {
    try {
      const context = await contextFrom(request);
      return Response.json(await handler(context, request, await routeContext.params));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function parseBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  return schema.parse(await request.json());
}
