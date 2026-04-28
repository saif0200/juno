/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#1f2937';
const tintColorDark = '#f8fafc';

export const Colors = {
  light: {
    text: '#0f172a',
    background: '#f5f7fb',
    surface: '#ffffff',
    surfaceMuted: '#eef2f7',
    border: '#d7dde8',
    muted: '#64748b',
    tint: tintColorLight,
    accent: '#2563eb',
    accentSoft: '#dbeafe',
    success: '#0f766e',
    danger: '#b91c1c',
    icon: '#64748b',
    tabIconDefault: '#94a3b8',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#f8fafc',
    background: '#09090b',
    surface: '#121214',
    surfaceMuted: '#18181b',
    border: '#27272a',
    muted: '#a1a1aa',
    tint: tintColorDark,
    accent: '#60a5fa',
    accentSoft: '#172554',
    success: '#5eead4',
    danger: '#fca5a5',
    icon: '#a1a1aa',
    tabIconDefault: '#71717a',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
