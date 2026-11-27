/** An enumerable, typed repository object whose implementation loads on first call. */
export type RepositoryShape<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? true : RepositoryShape<T[K]>;
};

export function lazyRepository<T extends object>(load: () => Promise<T>, shape: RepositoryShape<T>): T {
  let pending: Promise<T> | undefined;
  const implementation = () => {
    if (!pending) {
      pending = load().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
  const build = (node: object, path: string[]): object => Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, value === true
      ? (...args: unknown[]) => implementation().then((repository) => {
        const owner = path.reduce<Record<string, unknown>>(
          (parent, part) => parent[part] as Record<string, unknown>,
          repository as Record<string, unknown>,
        );
        const method = owner[key] as (...parameters: unknown[]) => unknown;
        return method.apply(owner, args);
      })
      : build(value as object, [...path, key])]),
  );
  return build(shape, []) as T;
}
