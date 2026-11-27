export async function submitRoomAction<Request, Result>(
  build: () => Request | undefined,
  send: (request: Request) => Promise<{ conflict: true } | { conflict: false; data: Result }>,
  refresh: () => Promise<void>
): Promise<Result | undefined> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const request = build();
    if (!request) return;
    const result = await send(request);
    if (!result.conflict) return result.data;
    await refresh();
  }
  throw new Error('The room changed before your action could be applied. Please try again.');
}
