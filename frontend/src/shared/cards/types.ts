export type CardTarget =
  | { group: "hero" | "board" | "dead"; index: number }
  | { group: "opponent"; index: number; player: number };
