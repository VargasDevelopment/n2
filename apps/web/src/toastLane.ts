/**
 * Fits the toast stack, newest first, into a lane `available` tall with `gap` between toasts.
 * Returns how many of the newest toasts show and the height they use. The first toast that does
 * not fit queues along with every older one, so the stack keeps its order.
 *
 * Decision, always admit the newest: from the supported minimum of 640x480 up, the lane is tall
 * enough for the tallest toast (two clamped lines each of message, detail and failure), so this
 * never overflows there. Below 480px tall the newest may overflow its lane and cover chrome. It
 * still shows, because hiding the latest error or Undo is worse than a brief overlap.
 */
export const fitToastLane = (
  heights: readonly number[],
  available: number,
  gap: number
): { shown: number; height: number } => {
  let shown = 0;
  let height = 0;
  for (const toastHeight of heights) {
    const next = shown === 0 ? toastHeight : height + gap + toastHeight;
    const alwaysAdmitNewest = shown === 0;
    if (!alwaysAdmitNewest && next > available) break;
    shown += 1;
    height = next;
  }
  return { shown, height };
};
