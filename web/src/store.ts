import { create } from "zustand";
import type { Risk } from "./lib/api";

interface State {
  mine: string; horizon: 7 | 14; sim: Risk | null;
  instant: boolean;                                      // last mine change came from the keyboard
  setMine: (m: string, instant?: boolean) => void; setHorizon: (h: 7 | 14) => void; setSim: (r: Risk | null) => void;
}
export const useStore = create<State>((set) => ({
  mine: "", horizon: 7, sim: null, instant: false,
  setMine: (mine, instant = false) => set({ mine, instant }), setHorizon: (horizon) => set({ horizon }), setSim: (sim) => set({ sim }),
}));
