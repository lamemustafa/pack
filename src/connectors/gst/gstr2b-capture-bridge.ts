export const GSTR2B_CAPTURE_MESSAGE_SOURCE = "complyeaze-pack-gstr2b-capture";
export const GSTR2B_CAPTURE_CONTROL_ATTRIBUTE = "data-pack-gstr2b-capture-action";
export const GSTR2B_CAPTURE_TIMEOUT_MS = 15_000;
export const GSTR2B_CAPTURE_MAX_BYTES = 50 * 1024 * 1024;

export interface Gstr2bCaptureRequestMessage {
  actionId: string;
  controlAttribute: string;
  controlId: string;
  maxBytes: number;
  nonce: string;
  source: typeof GSTR2B_CAPTURE_MESSAGE_SOURCE;
  type: "capture-request";
}

export interface Gstr2bCaptureAckMessage {
  actionId: string;
  nonce: string;
  source: typeof GSTR2B_CAPTURE_MESSAGE_SOURCE;
  type: "ack";
}

export interface Gstr2bCaptureCapturedMessage {
  actionId: string;
  dataUrl: string;
  nonce: string;
  safeSignals: string[];
  source: typeof GSTR2B_CAPTURE_MESSAGE_SOURCE;
  type: "captured";
}

export type Gstr2bCaptureMessage =
  Gstr2bCaptureRequestMessage | Gstr2bCaptureAckMessage | Gstr2bCaptureCapturedMessage;
