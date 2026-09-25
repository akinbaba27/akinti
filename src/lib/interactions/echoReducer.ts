/**
 * Optimistic Echo/Un-echo state for a Wave card (Wave E, `docs/ECHOES.md`).
 * A line-for-line mirror of `saveReducer.ts` — same reasoning: the button
 * must never feel laggy, kept as a pure reducer so the optimistic-update +
 * rollback logic is trivial to unit test without mounting React or a
 * Supabase client.
 */

export interface EchoState {
  readonly isEchoed: boolean;
  readonly echoCount: number;
  readonly status: "idle" | "pending" | "error";
}

export type EchoAction = { type: "toggle" } | { type: "confirm" } | { type: "rollback" };

function flip(state: EchoState): EchoState {
  const isEchoed = !state.isEchoed;
  const echoCount = Math.max(0, state.echoCount + (isEchoed ? 1 : -1));
  return { ...state, isEchoed, echoCount };
}

export function echoReducer(state: EchoState, action: EchoAction): EchoState {
  switch (action.type) {
    case "toggle":
      return { ...flip(state), status: "pending" };
    case "confirm":
      return { ...state, status: "idle" };
    case "rollback":
      return { ...flip(state), status: "error" };
    default:
      return state;
  }
}
