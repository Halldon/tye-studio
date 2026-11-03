import { assertMutationOrigin, requestContext } from "../../../lib/server/context";
import { route } from "../../../lib/server/errors";
import { acknowledgeEngineCheck, discoverEngine } from "../../../lib/server/service";
export const dynamic = "force-dynamic";
/** Explicit user check: authenticated reads only, never a paid generation or automatic retry. */
export async function POST(request: Request) { return route(async () => {
  assertMutationOrigin(request); const { user, bindings } = await requestContext(request);
  const { status: engine } = await discoverEngine(bindings);
  await acknowledgeEngineCheck(bindings, user.id, engine);
  return Response.json({ engine, saved: !!bindings.connectionSaved });
}); }
