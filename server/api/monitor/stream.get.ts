export default defineEventHandler((event) => {
  const origin = getRequestHeader(event, "origin");
  if (origin && origin !== getRequestURL(event).origin) throw createError({ statusCode: 403 });
  setHeader(event, "Cache-Control", "no-cache, no-transform");
  setHeader(event, "X-Accel-Buffering", "no");
  const stream = createEventStream(event);
  const monitor = getMonitor();
  monitor.start();
  const unsubscribe = monitor.subscribe((message) => {
    void stream.push({ event: message.type, data: JSON.stringify(message.data) }).catch(() => {
      void stream.close();
    });
  });
  const heartbeat = setInterval(() => {
    void stream.push({ event: "heartbeat", data: "{}" }).catch(() => {
      void stream.close();
    });
  }, 15000);
  stream.onClosed(() => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return stream.send();
});
