import 'cannon-es';

// What the game tags its physics bodies with (read by systems/rules.ts when the chassis hits one).
export interface BodyData {
  isPenalized?: boolean;
  type?: string;
  isStatic?: boolean;
  isCurb?: boolean;
  isParked?: boolean;
  touchOk?: boolean;
  onHit?: () => void;
}

declare module 'cannon-es' {
  interface Body {
    userData?: BodyData;
  }
}
