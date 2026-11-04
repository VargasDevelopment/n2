// jsdom has HTMLDialogElement but not its modal methods. Tests only need the open state; the
// browser supplies the real focus trap and inert page.
if (!('showModal' in HTMLDialogElement.prototype)) {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.open = true;
    },
    close(this: HTMLDialogElement) {
      this.open = false;
    }
  });
}

// jsdom has no layout, so nothing ever resizes; tests that need resize events install their own.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
