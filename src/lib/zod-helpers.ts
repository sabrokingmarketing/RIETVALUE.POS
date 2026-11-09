import { z } from "zod";

/** Form-friendly boolean: true for true/"true"/"on"/"1"; everything else is false (unlike z.coerce.boolean, "false" is false). */
export const boolish = () => z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());
