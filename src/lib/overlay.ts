/**
 * Opacity of the shade layer on each basemap. It is constant: where shade
 * falls is geometry, and must stay readable whatever the forecast says. How
 * strong the sun is shows in the weather panel and the sun label instead.
 * Over a photo it is stronger, to stand out from the picture.
 */
export const SHADE_OPACITY = { map: 0.46, satellite: 0.62 } as const

/**
 * Opacity of the sun-hours map on each basemap. Its colours already carry
 * their own strength; this only lifts the whole picture a little over a photo.
 */
export const SUN_HOURS_OPACITY = { map: 0.85, satellite: 1 } as const
