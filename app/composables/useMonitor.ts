import { onMounted, onUnmounted, watch } from "vue";
import { createMonitorState } from "../utils/monitor-state";
import { createMonitorConnection } from "../utils/monitor-connection";
import { SAMPLE_INTERVAL_MS } from "../../shared/utils/monitor";

export function useMonitor() {
  const state = createMonitorState();
  const connection = createMonitorConnection(state);
  let clock: ReturnType<typeof setInterval> | undefined;
  let frame = 0;
  let lastFrame = 0;
  let reducedMotion: MediaQueryList | undefined;

  function tick(time: number) {
    // Keep movement below a pixel per update, with fewer redraws for wider windows.
    const interval = Math.min(50 * state.minutes.value, 200);
    if (time - lastFrame >= interval) {
      state.now.value = Date.now();
      lastFrame = time - ((time - lastFrame) % interval);
    }
    frame = requestAnimationFrame(tick);
  }
  function updateAnimation() {
    cancelAnimationFrame(frame);
    if (!document.hidden && !state.paused.value && !reducedMotion?.matches) {
      lastFrame = 0;
      frame = requestAnimationFrame(tick);
    }
  }

  function visibilityChanged() {
    if (document.hidden) connection.stop();
    else {
      state.now.value = Date.now();
      connection.start();
    }
    updateAnimation();
  }
  onMounted(() => {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.addEventListener("change", updateAnimation);
    state.now.value = Date.now();
    if (!document.hidden) connection.start();
    updateAnimation();
    clock = setInterval(() => {
      const now = Date.now();
      if (!document.hidden && now - state.now.value >= SAMPLE_INTERVAL_MS) state.now.value = now;
    }, SAMPLE_INTERVAL_MS);
    document.addEventListener("visibilitychange", visibilityChanged);
  });
  onUnmounted(() => {
    connection.stop();
    clearInterval(clock);
    cancelAnimationFrame(frame);
    reducedMotion?.removeEventListener("change", updateAnimation);
    document.removeEventListener("visibilitychange", visibilityChanged);
  });
  watch(state.paused, updateAnimation);
  return state;
}
