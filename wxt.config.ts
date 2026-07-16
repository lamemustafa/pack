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
const enableLocalGstr1Debugger = process.env.PACK_ENABLE_LOCAL_GSTR1_DEBUGGER === "1";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: PACK_EXTENSION_NAME,
    short_name: PACK_EXTENSION_SHORT_NAME,
    description: PACK_EXTENSION_DESCRIPTION,
    version: pkg.version,
    homepage_url: PACK_EXTENSION_HOMEPAGE_URL,
    icons: PACK_EXTENSION_ICONS,
    minimum_chrome_version: "116",
    permissions: [
      ...PACK_EXTENSION_PERMISSIONS,
      ...(enableLocalGstr1Debugger ? (["debugger"] as const) : []),
    ],
    host_permissions: [...PACK_GST_HOST_PERMISSIONS],
    content_security_policy: {
      extension_pages: PACK_EXTENSION_CSP,
    },
    action: {
      default_icon: PACK_EXTENSION_ACTION_DEFAULT_ICON,
      default_title: PACK_EXTENSION_SHORT_NAME,
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
