import { requestContext, requireStorage } from "../../../lib/server/context";
import { route } from "../../../lib/server/errors";
import { jobView, Store } from "../../../lib/server/store";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return route(async () => { const { user, bindings } = await requestContext(request); const { db } = requireStorage(bindings); return Response.json({ job: jobView(await new Store(db, user.id).job((await context.params).id)) }); }); }
