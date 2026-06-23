declare module "jsdom" {
  export class JSDOM {
    constructor(
      html?: string,
      options?: {
        pretendToBeVisual?: boolean;
      },
    );

    window: Window;
  }
}
