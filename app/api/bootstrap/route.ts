import { requestContext } from "../../lib/server/context";
import { route } from "../../lib/server/errors";
import { bootstrap } from "../../lib/server/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return route(async () => { const { user, bindings } = await requestContext(request); return Response.json(await bootstrap(bindings, user)); }); }
