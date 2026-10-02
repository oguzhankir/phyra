// React development effects can replay setup/cleanup without retiring the mounted session.
// Delay native retirement until the next microtask and cancel it when setup adopts the session.
export function sessionRetirement(release: () => Promise<unknown>) {
  let generation = 0;
  return () => {
    const adopted = ++generation;
    return () => {
      queueMicrotask(() => {
        if (generation === adopted) void release().catch(() => {});
      });
    };
  };
}
