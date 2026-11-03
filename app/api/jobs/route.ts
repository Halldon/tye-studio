import { assertMutationOrigin, requestContext, requireStorage } from "../../lib/server/context";
import type { GenerationRequest } from "../../lib/server/contracts";
import { readJson, route } from "../../lib/server/errors";
import { submitGeneration } from "../../lib/server/service";
import { Store } from "../../lib/server/store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return route(async () => { const { user, bindings } = await requestContext(request); const { db } = requireStorage(bindings); return Response.json({ jobs: await new Store(db, user.id).jobs() }); }); }
export async function POST(request: Request) { return route(async () => { assertMutationOrigin(request); const { user, bindings } = await requestContext(request); return Response.json({ job: await submitGeneration(bindings, user.id, await readJson<GenerationRequest>(request)) }, { status: 202 }); }); }
