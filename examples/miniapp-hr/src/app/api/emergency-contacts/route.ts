import { emergencyContacts } from "@/lib/api/collections";

export const dynamic = "force-dynamic";

export const GET = emergencyContacts.list;
export const POST = emergencyContacts.create;
