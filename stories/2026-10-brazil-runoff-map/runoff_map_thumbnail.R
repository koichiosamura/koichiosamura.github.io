# Draws thumbnail.png for the Stories listing and link previews: a label-free version
# of the map, from site_data/addresses_round2.tsv, with the same colours as the page.
# Run from this folder. 1200 x 800 px, white background, no text. Link previews may crop
# it to 1.91:1, so the map is kept inside the middle band.

library(tidyverse)
library(sf)
library(geobr)

stops   <- c(0.30, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70)    # Lula's share at each colour
colours <- c("#104281", "#2a78d6", "#86b6ef", "#a3a29c", "#ef9593", "#e34948", "#a51e22")
lean_colour <- function(share) {
  pal <- scales::gradient_n_pal(colours, values = scales::rescale(stops))
  pal(scales::rescale(pmin(pmax(share, 0.30), 0.70), from = c(0.30, 0.70)))
}

addresses <- read_tsv("site_data/addresses_round2.tsv", show_col_types = FALSE)
if (!"a2" %in% names(addresses)) addresses <- rename(addresses, a2 = a, b2 = b)   # older files

addresses <- addresses |>
  mutate(valid = a2 + b2, colour = lean_colour(a2 / valid)) |>
  filter(valid > 0) |>
  arrange(desc(valid))                       # big dots first, so small ones stay visible on top

pts <- st_as_sf(addresses, coords = c("lon", "lat"), crs = 4326) |> st_transform(5880)
states <- read_state(year = 2025, showProgress = FALSE) |> st_transform(5880)

thumb <- ggplot() +
  geom_sf(data = states, fill = "#f4f5f6", colour = "#e1e4e6", linewidth = 0.15) +   # site tint and hairline
  geom_sf(data = pts, aes(size = valid, colour = colour), shape = 16, alpha = 0.8, stroke = 0) +
  scale_colour_identity() +
  scale_size_area(max_size = 1.4, guide = "none") +
  coord_sf(datum = NA, expand = FALSE) +
  theme_void() +
  theme(plot.background = element_rect(fill = "white", colour = NA),
        plot.margin = margin(36, 0, 36, 0))     # keeps the map clear of a 1.91:1 crop

ggsave("thumbnail.png", thumb, width = 6, height = 4, dpi = 200, bg = "white")
