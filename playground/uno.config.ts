import type { Preset } from 'unocss'

import { presetChromatic } from '@proj-airi/unocss-preset-chromatic'
import {
  defineConfig,
  presetIcons,
  presetTypography,
  presetWebFonts,
  presetWind3,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
  presets: [
    presetWind3(),
    presetTypography(),
    presetWebFonts({
      fonts: {
        mono: 'DM Mono',
        sans: 'DM Sans',
      },
      timeouts: {
        failure: 10_000,
        warning: 5_000,
      },
    }),
    presetIcons(),
    presetChromatic({
      baseHue: 70,
      colors: {
        complementary: 180,
        hundredEighty: 180,
        hundredFifty: 150,
        hundredTwenty: 120,
        ninety: 90,
        primary: 0,
        sixty: 60,
        thirty: 30,
        threeHundred: 300,
        threeThirty: 330,
        twoForty: 240,
        twoSeventy: 270,
        twoTen: 210,
        zero: 0,
      },
    }) as Preset,
  ],
  transformers: [
    transformerDirectives({
      applyVariable: ['--at-apply'],
    }),
    transformerVariantGroup(),
  ],
})
