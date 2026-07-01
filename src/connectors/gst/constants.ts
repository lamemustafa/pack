import type { PortalConnectorDescriptor } from "../../core/contracts";
import { PACK_PRODUCT_VERSION } from "../../extension/version";

export const GST_CONNECTOR_DESCRIPTOR: PortalConnectorDescriptor = {
  id: "gst",
  version: PACK_PRODUCT_VERSION,
  displayName: "GST Portal",
  supportedOrigins: [
    "https://www.gst.gov.in",
    "https://services.gst.gov.in",
    "https://return.gst.gov.in",
  ],
  supportedDocumentTypes: ["GSTR-1", "GSTR-3B", "GSTR-2B"],
  compatibilityVersion: "gst-return-pack-v0",
};

export const SUPPORTED_GST_ORIGINS = new Set(GST_CONNECTOR_DESCRIPTOR.supportedOrigins);

export const DEFAULT_GST_DISCLOSURES = [
  "pack-v0-local-first",
  "pack-v0-no-credentials",
  "pack-v0-no-upload",
  "pack-v0-independent-tool",
];

export const PRIVATE_FILED_RETURNS_SPIKE_DISCLOSURE = "pack-v0-private-filed-returns-spike";
