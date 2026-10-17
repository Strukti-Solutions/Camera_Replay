import { poolCompartilhado } from "../../../lib/pool";
import { criarHandlerAperto } from "../../../lib/handler-aperto";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => criarHandlerAperto(poolCompartilhado())(req);
