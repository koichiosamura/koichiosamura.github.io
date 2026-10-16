# Listing thumbnail for the "Stories" post on:
# Osamura, Koichi. 2026. "Bureaucratic appointments and coalition support in presidential systems -- An analysis of Brazil's Chamber of Deputies." Party Politics.

# Draws a small, label-free version of the "Support across groups" chart: for each president
# shown, the distribution of party results (share of a party's voting deputies who followed
# the president on one roll call), with a box for the middle half, a diamond for the average
# and one dot per party result. Same method and colours as the page.
# Run it from the post folder (the one that contains "site_data"). It reads
# site_data/explorer_data.json and writes thumbnail.png (1200 x 800 px), which the post's
# front matter uses as the listing image and the link preview image.
# The script can stay in the post folder: Quarto does not copy it to the website output.


##############################################################
############################ SETUP ###########################
##############################################################

rm(list = ls())
options(scipen = 10, digits = 4)

# install packages (if not installed yet) and load them
p_needed <- c("dplyr", "purrr", "jsonlite", "ggplot2", "ragg")

packages <- rownames(installed.packages())
p_to_install <- p_needed[!(p_needed %in% packages)]
if (length(p_to_install) > 0) {
  install.packages(p_to_install)
}

invisible(lapply(p_needed, require, character.only = TRUE))

groups_shown <- c("Rousseff II", "Temer II")  # presidents, top to bottom
x_from <- 0.40                                # left edge of the chart (share followed)

# Colours from coalition-support.css and the site theme (light)
col_follow      <- "#2a78d6"
col_follow_wash <- "#2a78d629"  # #2a78d6 at 16% opacity
col_follow_dot  <- "#2a78d673"  # #2a78d6 at 45% opacity
col_ink         <- "#121a21"    # site body text
col_ink2        <- "#4d5359"    # site secondary text
col_grid        <- "#4d53591f"


##############################################################
########################## 1. DATA ###########################
##############################################################

site <- fromJSON("site_data/explorer_data.json")

# One row per party and roll call with a published result (cells below five deputies are withheld)
cells <- site$party_rollcalls |>
  filter(!is.na(fol)) |>
  left_join(site$rollcalls |> select(id, president), by = "id") |>
  mutate(p = fol / n) |>
  filter(president %in% groups_shown) |>
  mutate(group = factor(president, levels = groups_shown))

## --- Density as on the page: Gaussian kernel, bandwidth 0.025, reflected at 0% and 100% ---
kde <- function(v, bw = 0.025) {
  xs <- seq(0, 1, by = 0.005)
  k <- function(u) exp(-0.5 * u^2)
  ds <- map_dbl(xs, ~ sum(k((.x - v) / bw) + k((.x - (2 - v)) / bw) + k((.x + v) / bw)))
  tibble(x = xs, d = ds / max(ds))
}

## --- Vertical layout: each group gets a band; density above its baseline, box and dots below ---
band <- 2.35
offset <- tibble(group = factor(groups_shown, levels = groups_shown),
                 off = -band * (seq_along(groups_shown) - 1))

dens <- cells |>
  group_by(group) |>
  reframe(kde(p)) |>
  left_join(offset, by = "group") |>
  filter(x >= x_from)

boxes <- cells |>
  group_by(group) |>
  summarise(
    q1 = quantile(p, 0.25, type = 7),
    md = quantile(p, 0.50, type = 7),
    q3 = quantile(p, 0.75, type = 7),
    lo = min(p[p >= q1 - 1.5 * (q3 - q1)]),
    hi = max(p[p <= q3 + 1.5 * (q3 - q1)]),
    mean = mean(p),
    .groups = "drop"
  ) |>
  left_join(offset, by = "group") |>
  mutate(lo = pmax(lo, x_from))

set.seed(17)
dots <- cells |>
  mutate(jy = -0.56 - runif(n()) * 0.38) |>
  left_join(offset, by = "group") |>
  filter(p >= x_from)


##############################################################
########################## 2. PLOT ###########################
##############################################################

thumb <- ggplot() +
  geom_vline(xintercept = seq(0.4, 1, by = 0.1), colour = col_grid, linewidth = 0.35) +
  # distribution
  geom_ribbon(data = dens, aes(x = x, ymin = off, ymax = off + d, group = group),
              fill = col_follow_wash) +
  geom_line(data = dens, aes(x = x, y = off + d, group = group),
            colour = col_follow, linewidth = 0.85) +
  # party results
  geom_point(data = dots, aes(x = p, y = off + jy),
             shape = 16, size = 1.7, colour = col_follow_dot) +
  # whiskers, middle half with the median, average
  geom_segment(data = boxes, aes(x = lo, xend = hi, y = off - 0.3, yend = off - 0.3),
               colour = col_ink2, linewidth = 0.4) +
  geom_rect(data = boxes, aes(xmin = q1, xmax = q3, ymin = off - 0.42, ymax = off - 0.18),
            fill = "#ffffff", colour = col_ink2, linewidth = 0.4) +
  geom_segment(data = boxes, aes(x = md, xend = md, y = off - 0.42, yend = off - 0.18),
               colour = col_ink2, linewidth = 0.7) +
  geom_point(data = boxes, aes(x = mean, y = off - 0.3),
             shape = 23, size = 4.6, stroke = 0.9, fill = col_ink, colour = "#ffffff") +
  scale_x_continuous(limits = c(x_from, 1.004), expand = expansion(0)) +
  scale_y_continuous(limits = c(-band * (length(groups_shown) - 1) - 1, 1.08), expand = expansion(0)) +
  theme_void() +
  theme(
    plot.background = element_rect(fill = "#ffffff", colour = NA),
    plot.margin = margin(30, 40, 30, 40, unit = "pt")
  )


##############################################################
######################### 3. OUTPUT ##########################
##############################################################

ggsave("thumbnail.png", thumb, device = ragg::agg_png,
       width = 1200, height = 800, units = "px", dpi = 200, bg = "#ffffff")

cat("Wrote thumbnail.png:", paste(groups_shown, collapse = ", "), "|",
    nrow(cells), "party results,", sum(cells$p < x_from), "below", x_from * 100, "% left out of view\n")

### End --------------------------------------------------------------
