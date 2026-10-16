/**
 * Public-entry tests keep the saved replay useful and remove developer controls.
 * They also protect the fixture boundary and the sample-report route.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CLAIM_BOUNDARY } from "../../shared/contracts";
import { PublicDemo } from "./publicDemo";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("public saved replay", () => {
  it("offers saved playback and report navigation without developer controls", async () => {
    render(<PublicDemo />);

    expect(await screen.findByRole("button", { name: "Play recorded run" })).toBeEnabled();
    expect(screen.getAllByText(CLAIM_BOUNDARY).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/No live camera, robot, sensor, operator, or evaluation is connected/)).toBeInTheDocument();
    expect(screen.queryByText(/Fixture controls/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fail next action/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish report/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start run/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Describe the inspection")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play recorded run" }));
    expect(await screen.findByRole("button", { name: "Pause playback" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open saved sample report" }));
    expect(await screen.findByRole("button", { name: "Return to saved replay" })).toBeInTheDocument();
    expect(await screen.findByText("Site Blind Spot Report")).toBeInTheDocument();
  });

  it("opens the sample report when reached through a deep link", async () => {
    window.history.replaceState(null, "", "/reports/rpt-fixture-0001");
    render(<PublicDemo />);
    expect(await screen.findByText("Site Blind Spot Report")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to saved replay" })).toBeInTheDocument();
  });

  it("does not expose the phone-controller route in the public sample", async () => {
    window.history.replaceState(null, "", "/control/sess-fixture-01");
    render(<PublicDemo />);
    expect(await screen.findByText("Page not available in this saved demo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Higher resolution" })).not.toBeInTheDocument();
  });
});
