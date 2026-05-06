type ConsoleMethod =
  | "log"
  | "info"
  | "warn"
  | "error"
  | "debug"
  | "trace"
  | "table"
  | "group"
  | "groupCollapsed"
  | "groupEnd"
  | "dir"
  | "dirxml"
  | "count"
  | "assert"
  | "profile"
  | "profileEnd"
  | "time"
  | "timeEnd";

const PROD = import.meta.env.PROD;

const NOOP = (): void => undefined;

const CONSOLE_METHODS: ConsoleMethod[] = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
  "table",
  "group",
  "groupCollapsed",
  "groupEnd",
  "dir",
  "dirxml",
  "count",
  "assert",
  "profile",
  "profileEnd",
  "time",
  "timeEnd",
];

function disableReactDevTools(): void {
  try {
    const w = window as unknown as Record<string, unknown>;
    const existing = w.__REACT_DEVTOOLS_GLOBAL_HOOK__ as
      | Record<string, unknown>
      | undefined;
    if (existing) {
      existing.inject = NOOP;
      existing.onCommitFiberRoot = NOOP;
      existing.onCommitFiberUnmount = NOOP;
      existing.supportsFiber = false;
      existing.renderers = new Map();
    } else {
      Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
        configurable: false,
        enumerable: false,
        writable: false,
        value: {
          inject: NOOP,
          onCommitFiberRoot: NOOP,
          onCommitFiberUnmount: NOOP,
          supportsFiber: false,
          renderers: new Map(),
        },
      });
    }
  } catch {

  }
}

function silenceConsole(): void {
  for (const method of CONSOLE_METHODS) {
    try {
      (console as unknown as Record<string, unknown>)[method] = NOOP;
    } catch {

    }
  }
  setInterval(() => {
    try {
      console.clear();
    } catch {

    }
  }, 1500);
}

export function installSecurityHardening(): void {
  if (!PROD) return;
  disableReactDevTools();
  silenceConsole();
}
