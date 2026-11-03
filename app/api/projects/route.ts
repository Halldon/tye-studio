import { assertMutationOrigin, requestContext, requireStorage } from "../../lib/server/context";
import { ApiFailure, readJson, route } from "../../lib/server/errors";
import { Store } from "../../lib/server/store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return route(async () => { const { user, bindings } = await requestContext(request); const { db } = requireStorage(bindings); return Response.json({ projects: await new Store(db, user.id).projects() }); }); }
export async function POST(request: Request) { return route(async () => { assertMutationOrigin(request); const { user, bindings } = await requestContext(request); const { db } = requireStorage(bindings); const body = await readJson<{ name?: string }>(request); if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100)) throw new ApiFailure(400, "invalid_name", "Use a project name between 1 and 100 characters."); return Response.json({ project: await new Store(db, user.id).createProject(body.name?.trim() || "Untitled project") }, { status: 201 }); }); }
