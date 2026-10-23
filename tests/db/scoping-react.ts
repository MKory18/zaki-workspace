import * as React from "react";

/**
 * The server pages are TSX. Next compiles them with the automatic JSX runtime, but
 * under vitest the transform is the classic one (`React.createElement`), which looks
 * for a global `React`. Rendering a page in a test therefore needs this one line.
 */
(globalThis as { React?: typeof React }).React = React;
