import { dependents } from "@/lib/api/collections";

export const dynamic = "force-dynamic";

export const GET = dependents.list;
export const POST = dependents.create;
