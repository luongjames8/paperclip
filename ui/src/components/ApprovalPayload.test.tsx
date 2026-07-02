// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalPayloadRenderer, approvalLabel } from "./ApprovalPayload";

vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ children, className }: { children: string; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("approvalLabel", () => {
  it("uses payload titles for generic board approvals", () => {
    expect(
      approvalLabel("request_board_approval", {
        title: "Reply with an ASCII frog",
      }),
    ).toBe("Board Approval: Reply with an ASCII frog");
  });
});

describe("ApprovalPayloadRenderer", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders request_board_approval payload fields without falling back to raw JSON", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          payload={{
            title: "Reply with an ASCII frog",
            summary: "Board asked for approval before posting the frog.",
            recommendedAction: "Approve the frog reply.",
            nextActionOnApproval: "Post the frog comment on the issue.",
            risks: ["The frog might be too powerful."],
            proposedComment: "(o)<",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Reply with an ASCII frog");
    expect(container.textContent).toContain("Board asked for approval before posting the frog.");
    expect(container.textContent).toContain("Approve the frog reply.");
    expect(container.textContent).toContain("Post the frog comment on the issue.");
    expect(container.textContent).toContain("The frog might be too powerful.");
    expect(container.textContent).toContain("(o)<");
    expect(container.textContent).not.toContain("\"recommendedAction\"");

    act(() => {
      root.unmount();
    });
  });

  it("can hide the repeated title when the card header already shows it", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          hidePrimaryTitle
          payload={{
            title: "Reply with an ASCII frog",
            summary: "Board asked for approval before posting the frog.",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Board asked for approval before posting the frog.");
    expect(container.textContent).not.toContain("TitleReply with an ASCII frog");

    act(() => {
      root.unmount();
    });
  });

  it("renders details and description fields via MarkdownBody", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          payload={{
            title: "A proposal",
            summary: "Short summary.",
            proposedComment: "## Comment\nThe comment body.",
            details: "## Full details\nAll the context the board needs.",
            description: "A separate description paragraph.",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Details");
    expect(container.textContent).toContain("## Full details\nAll the context the board needs.");
    expect(container.textContent).toContain("Description");
    expect(container.textContent).toContain("A separate description paragraph.");

    act(() => {
      root.unmount();
    });
  });

  it("suppresses details if identical to proposedComment", () => {
    const root = createRoot(container);
    const sharedText = "Shared content.";

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          payload={{
            proposedComment: sharedText,
            details: sharedText,
          }}
        />,
      );
    });

    expect(container.textContent).not.toContain("Details");

    act(() => {
      root.unmount();
    });
  });

  it("suppresses description if identical to details", () => {
    const root = createRoot(container);
    const sharedText = "Same content for both.";

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          payload={{
            details: sharedText,
            description: sharedText,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Details");
    expect(container.textContent).toContain(sharedText);
    expect(container.textContent).not.toContain("Description");

    act(() => {
      root.unmount();
    });
  });

  it("suppresses description if identical to summary", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          payload={{
            summary: "The summary text.",
            description: "The summary text.",
          }}
        />,
      );
    });

    expect(container.textContent).not.toContain("Description");

    act(() => {
      root.unmount();
    });
  });

  it("skips details and description when absent or empty", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          payload={{
            title: "Minimal payload",
            details: "",
            description: 42,
          }}
        />,
      );
    });

    expect(container.textContent).not.toContain("Details");
    expect(container.textContent).not.toContain("Description");

    act(() => {
      root.unmount();
    });
  });
});
