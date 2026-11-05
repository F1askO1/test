import { createServer, createConnection, type Socket } from "node:net";
import { once } from "node:events";
export async function socksFixture(stall = false) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    if (stall) return;
    let data = Buffer.alloc(0),
      stage = 0;
    const onData = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      if (stage === 0) {
        if (data.length < 2 || data.length < 2 + data[1]) return;
        data = data.subarray(2 + data[1]);
        socket.write(Buffer.from([5, 0]));
        stage = 1;
      }
      if (stage !== 1 || data.length < 5) return;
      const end = data[3] === 1 ? 8 : data[3] === 3 ? 5 + data[4] : 20;
      if (data.length < end + 2) return;
      const host =
        data[3] === 1
          ? [...data.subarray(4, 8)].join(".")
          : data.subarray(5, end).toString();
      const port = data.readUInt16BE(end),
        rest = data.subarray(end + 2);
      stage = 2;
      const upstream = createConnection({ host, port }, () => {
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        socket.off("data", onData);
        if (rest.length) upstream.write(rest);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      sockets.add(upstream);
      upstream.on("error", () => socket.destroy());
      upstream.on("close", () => sockets.delete(upstream));
      socket.on("close", () => upstream.destroy());
    };
    socket.on("data", onData);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `socks5h://127.0.0.1:${(server.address() as any).port}`,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
