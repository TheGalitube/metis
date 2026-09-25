import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { config } from "@/lib/config";
import { isHostAdmin } from "@/lib/user-access";
import { readUpdateHistory } from "@/lib/update-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await getAuthenticatedUserId(req);
  if (!isHostAdmin(userId)) {
    return Response.json({ error: "Only host administrators can read update logs." }, { status: 403 });
  }
  const entries = await readUpdateHistory(config.dataDir);
  return Response.json({ entries }, { headers: { "Cache-Control": "private, no-store" } });
}
