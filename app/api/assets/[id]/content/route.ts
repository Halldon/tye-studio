import { requestContext } from "../../../../lib/server/context";
import { route } from "../../../../lib/server/errors";
import { assetContent } from "../../../../lib/server/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return route(async () => { const { user, bindings } = await requestContext(request); return assetContent(bindings, user.id, (await context.params).id, request); }); }
