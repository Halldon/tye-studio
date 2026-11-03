import { assertMutationOrigin, requestContext, requireStorage } from "../../lib/server/context";
import { route } from "../../lib/server/errors";
import { uploadAsset } from "../../lib/server/service";
import { Store } from "../../lib/server/store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return route(async () => { const { user, bindings } = await requestContext(request); const { db } = requireStorage(bindings); const store = new Store(db, user.id); const projectId = new URL(request.url).searchParams.get("projectId"); if (projectId) await store.project(projectId); return Response.json({ assets: await store.assets(projectId) }); }); }
export async function POST(request: Request) { return route(async () => { assertMutationOrigin(request); const { user, bindings } = await requestContext(request); return Response.json({ asset: await uploadAsset(bindings, user.id, request) }, { status: 201 }); }); }
