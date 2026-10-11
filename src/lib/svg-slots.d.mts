export interface PostTextSlots {
  title: string;
  slogan: string;
  price: string;
  occasion: string;
  extra: string;
}

export function getDetectedSlots(source: string): string[];
export function calculateContrastRatio(
  foreground: string,
  background: string,
): number;
export function personalizeSvg(input: {
  sourceSvg: string;
  palette: string[];
  text: PostTextSlots;
  logoDataUri: string;
  imageDataUri?: string;
}): string;
