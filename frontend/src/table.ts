import { z } from "zod";

export const tableSchema = z
  .object({
    dealer: z.number().int().min(0).max(8),
    smallBlind: z.number().int().min(1).max(1000000),
    bigBlind: z.number().int().min(1).max(2000000),
  })
  .strict()
  .refine((value) => value.bigBlind >= value.smallBlind, {
    message: "大盲不能小于小盲",
  });
export type TableConfig = z.infer<typeof tableSchema>;
export const defaultTable = (): TableConfig => ({
  dealer: 0,
  smallBlind: 5,
  bigBlind: 10,
});
