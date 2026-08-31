import { defineConfig } from "wxt";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PACK_EXTENSION_CSP,
  PACK_EXTENSION_ACTION_DEFAULT_ICON,
  PACK_EXTENSION_DESCRIPTION,
  PACK_EXTENSION_HOMEPAGE_URL,
  PACK_EXTENSION_ICONS,
  PACK_EXTENSION_NAME,
  PACK_EXTENSION_PERMISSIONS,
  PACK_EXTENSION_SHORT_NAME,
  PACK_GST_HOST_PERMISSIONS,
} from "./src/extension/manifest-policy";

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf-8")) as {
  version: string;
};

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: (env) => {
    // `--mode alpha` selects which surfaces compile in; it does not mean "a
    // development build". Vite derives `isProduction` from NODE_ENV, which it
    // only defaults to production when the mode is literally "production", so
    // an alpha build shipped the React development JSX transform and inlined
    // absolute source paths -- including the builder's home directory -- into
    // the bundle. Alpha builds are what live testing runs against, so they
    // have to be production builds that merely expose more surface.
    //
    // The mode itself must stay "alpha": `import.meta.env.MODE === "alpha"`
    // is the constant the alpha gate folds on, and rewriting it here would
    // silently remove every gated surface.
    // Gated on the command, not the mode. `wxt dev --mode alpha` serves the
    // alpha-gated UI and needs the development transform and refresh; only a
    // build produces the artifact that must not carry them.
    if (env.command === "build") process.env.NODE_ENV = "production";
    return { build: { modulePreload: false } };
  },
  manifest: {
    name: PACK_EXTENSION_NAME,
    short_name: PACK_EXTENSION_SHORT_NAME,
    description: PACK_EXTENSION_DESCRIPTION,
    version: pkg.version,
    homepage_url: PACK_EXTENSION_HOMEPAGE_URL,
    icons: PACK_EXTENSION_ICONS,
    minimum_chrome_version: "116",
    permissions: [...PACK_EXTENSION_PERMISSIONS],
    host_permissions: [...PACK_GST_HOST_PERMISSIONS],
    content_security_policy: {
      extension_pages: PACK_EXTENSION_CSP,
    },
    action: {
      default_icon: PACK_EXTENSION_ACTION_DEFAULT_ICON,
      default_title: PACK_EXTENSION_SHORT_NAME,
    },
    // The action deliberately declares no popup. One registered here takes
    // precedence over the action's click event, and that click is what opens
    // the side panel.
    side_panel: {
      default_path: "panel.html",
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
  },
  webExt: {
    disabled: true,
  },
});
