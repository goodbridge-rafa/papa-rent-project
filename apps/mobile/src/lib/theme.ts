import { useColorScheme } from "react-native";

/** Brand tokens (docs/product/brand.md). */
export const palette = {
  navy900: "#0A1B33",
  navy800: "#102A4C",
  navy700: "#1B4172",
  navy600: "#2A5AA0",
  orange500: "#FF6B1A",
  orange600: "#C2410C",
  orange400: "#FF8A47",
  cream50: "#FBF7F1",
  cream100: "#F3ECE2",
  ink: "#11161C",
  muted: "#5A6472",
  border: "#D7DCE3",
  darkBg: "#071426",
  darkSurface: "#0E2340",
  darkText: "#F2F5F9",
  darkMuted: "#9AA8BC",
  success: "#146B46",
  successBg: "#1B8A5A",
  warning: "#8A5800",
  warningBg: "#B4740A",
  danger: "#C6362B",
  white: "#FFFFFF",
} as const;

export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  border: string;
  primary: string; // CTA
  primaryText: string;
  accent: string; // orange for text/icons
  link: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
}

export const lightTheme: Theme = {
  dark: false,
  bg: palette.cream50,
  surface: palette.white,
  surface2: palette.cream100,
  text: palette.ink,
  muted: palette.muted,
  border: palette.border,
  primary: palette.navy900,
  primaryText: palette.white,
  accent: palette.orange600,
  link: palette.navy600,
  success: palette.success,
  successBg: palette.successBg,
  warning: palette.warning,
  warningBg: palette.warningBg,
  danger: palette.danger,
};

export const darkTheme: Theme = {
  dark: true,
  bg: palette.darkBg,
  surface: palette.darkSurface,
  surface2: palette.navy800,
  text: palette.darkText,
  muted: palette.darkMuted,
  border: palette.navy700,
  primary: palette.orange500,
  primaryText: palette.navy900,
  accent: palette.orange400,
  link: palette.orange400,
  success: "#5FCF9A",
  successBg: palette.successBg,
  warning: "#F0B65A",
  warningBg: palette.warningBg,
  danger: "#F07A70",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? darkTheme : lightTheme;
}

export const fonts = {
  display: "Manrope_800ExtraBold",
  heading: "Manrope_700Bold",
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
