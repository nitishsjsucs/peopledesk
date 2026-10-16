import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Chat's status region repeats each new reply for screen readers. Text queries skip it, so a test that
// finds a reply finds the message itself; the announcer is asserted through its test id.
configure({ defaultIgnore: "script, style, [data-testid=chat-announcer]" });

afterEach(() => {
  cleanup();
});
