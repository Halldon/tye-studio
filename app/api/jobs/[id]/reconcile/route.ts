import { assertMutationOrigin, requestContext } from "../../../../lib/server/context";
import { route } from "../../../../lib/server/errors";
import { reconcileJob } from "../../../../lib/server/service";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return route(async () => { assertMutationOrigin(request); const { user, bindings } = await requestContext(request); return Response.json({ job: await reconcileJob(bindings, user.id, (await context.params).id) }); }); }
