import { criarPool, type Db } from "../../../lib/db";
import { criarHandlerAperto } from "../../../lib/handler-aperto";

export const dynamic = "force-dynamic";

let pool: Db | undefined;
const poolCompartilhado = () => (pool ??= criarPool());

export const POST = (req: Request) => criarHandlerAperto(poolCompartilhado())(req);
