interface StreamClient {
  readyState: number;
  send(payload: string): void;
  on(event: "close", listener: () => void): void;
}

export function createStreamHub() {
  const clients = new Set<StreamClient>();

  return {
    add(client: StreamClient) {
      clients.add(client);
      client.on("close", () => clients.delete(client));
    },

    broadcast(event: unknown) {
      const payload = JSON.stringify(event);
      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    }
  };
}
