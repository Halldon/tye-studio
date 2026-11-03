import { requestContext } from "../../lib/server/context";
import { route } from "../../lib/server/errors";
import { discoverEngine } from "../../lib/server/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return route(async () => { const { bindings } = await requestContext(request); return Response.json({ engine: (await discoverEngine(bindings)).status }); }); }
