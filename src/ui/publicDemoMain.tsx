/**
 * Browser bootstrap for the public saved-replay entry.
 * PublicDemo owns the read-only fixture state and evidence display.
 * This file only mounts that view into the page root.
 */
import { createRoot } from "react-dom/client";
import { PublicDemo } from "./publicDemo";

const root = document.getElementById("root");
if (!root) throw new Error("Public demo root is missing.");
createRoot(root).render(<PublicDemo />);
