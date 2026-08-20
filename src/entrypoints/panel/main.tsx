import React from "react";
import { createRoot } from "react-dom/client";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import "../../styles/panel.css";
import { usePackPopupController } from "../popup/use-pack-popup-controller";
import { PanelSurface } from "./panel-surface";

/**
 * Phase A of the target-plan surface.
 *
 * This is an ordinary extension page — no manifest change and no new permission. The same
 * document is what a side panel would render if `sidePanel` is ever approved, which is why
 * the surface is built before the permission is asked for rather than after.
 *
 * It deliberately reuses the popup's controller. The flows, guards and recovery are the
 * existing ones; only the way a user reaches them is new. Duplicating the flow logic here
 * would create exactly the second source of truth this repo keeps paying for.
 */
function Panel() {
  return <PanelSurface pack={usePackPopupController()} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
