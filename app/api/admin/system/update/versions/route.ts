import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { config } from "@/lib/config";
import { isHostAdmin } from "@/lib/user-access";
import { listUpdateVersions } from "@/lib/github-releases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await getAuthenticatedUserId(req);
  if (!isHostAdmin(userId)) {
    return Response.json({ error: "Only host administrators can list installable versions." }, { status: 403 });
  }
  if (process.env.JARVIS_ENABLE_SELF_UPDATE !== "1") {
    return Response.json({ error: "Private J.A.R.V.I.S. Mk3.1 releases are not published yet." }, { status: 409 });
  }
  try {
    const versions = await listUpdateVersions(config.root, fetch);
    return Response.json(versions, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Could not list GitHub versions.",
    }, { status: 502 });
  }
}
