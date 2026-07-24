import { render, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Code } from "./ui";

const mockWriteText = vi.mocked(writeText);

describe("Code", () => {
  beforeEach(() => vi.clearAllMocks());

  it("copies its contents to the clipboard", async () => {
    render(<Code>steamcmd +login adaptiq_</Code>);

    screen.getByRole("button", { name: /copy to clipboard/i }).click();

    await waitFor(() =>
      expect(mockWriteText).toHaveBeenCalledWith("steamcmd +login adaptiq_"),
    );
    await waitFor(() => screen.getByRole("button", { name: /copied/i }));
  });

  it("falls back to the web clipboard when the plugin fails", async () => {
    mockWriteText.mockRejectedValueOnce(new Error("no plugin"));
    const webWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: webWrite },
      configurable: true,
    });

    render(<Code>echo hello</Code>);
    screen.getByRole("button", { name: /copy to clipboard/i }).click();

    await waitFor(() => expect(webWrite).toHaveBeenCalledWith("echo hello"));
  });

  it("offers no copy button for non-text content", () => {
    render(
      <Code>
        <span>rendered markup</span>
      </Code>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
