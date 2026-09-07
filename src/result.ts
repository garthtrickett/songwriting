export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: string): Result<never> => ({ ok: false, error });
export const attemptAsync = async <T>(
  run: () => Promise<T>,
): Promise<Result<T>> => {
  try {
    return ok(await run());
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
};
