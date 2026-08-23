import React from "react";
import { createRoot } from "react-dom/client";
import "../../styles/global.css";
import "../../styles/popup.css";
import "../../styles/popup-controls.css";
import "../../styles/panel.css";
import { usePackPopupController } from "../popup/use-pack-popup-controller";
import { PanelSurface } from "./panel-surface";

/**
 * Pack's surface. Rendered as a side panel, and reachable as an ordinary
 * extension page at the same path.
 *
 * Built as a page before the permission existed, which is why the document did
 * not change when `sidePanel` was approved — only how it is opened did. The
 * popup it replaced is gone: it died on outside focus, and `getRequiredGstTab`
 * focuses the GST tab and its window when a run starts, so the old surface
 * closed at exactly the moment a user wanted to watch.
 *
 * It deliberately reuses the popup's controller. The flows, guards and recovery
 * are the existing ones; only the way a user reaches them is new. Duplicating
 * the flow logic here would create exactly the second source of truth this repo
 * keeps paying for.
 */
function Panel() {
  return <PanelSurface pack={usePackPopupController()} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
