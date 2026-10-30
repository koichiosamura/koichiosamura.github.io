# Builds the data file for the runoff map story: site_data/addresses_round2.tsv.
#
# One row per polling address, with both rounds: Lula, Flávio, blank, null and absent in
# the runoff, and the same in the first round plus all valid votes (every candidate).
#
# Run this in your analysis project (the folder with data/). It reads the ballot-box
# reports for both rounds (bweb_1t_XX_….csv and bweb_2t_XX_….csv) and saves what it reads
# in data/cache_flows/, the same cache as brazil_vote_flows.qmd: if you have rendered that
# file, nothing is read again. Then copy site_data/addresses_round2.tsv into the story
# folder on the website: stories/2026-10-brazil-runoff-map/site_data/.

library(tidyverse)
library(sf)
library(geobr)

votes_dir     <- "data/votacao_secao_2026"                         # the ballot-box reports, both rounds
places_file   <- "data/eleitorado_local_votacao_2026_BRASIL.csv"   # polling places and coordinates
cache_dir     <- "data/cache_flows"                                # shared with brazil_vote_flows.qmd
out_file      <- "site_data/addresses_round2.tsv"
cand_a        <- 13                                                # Lula
cand_b        <- 22                                                # Flávio
boundary_year <- 2025

keys <- c("CD_MUNICIPIO", "NR_ZONA", "NR_SECAO")
to_number <- function(x) as.numeric(str_replace(x, ",", "."))

# How every TSE file is read: semicolons, ISO-8859-1 so accented names come through,
# no doubled quotes inside fields, surrounding spaces trimmed
tse_locale <- locale(encoding = "ISO-8859-1")
read_tse <- function(file, ...) {
  read_delim(file, delim = ";", escape_double = FALSE, trim_ws = TRUE, locale = tse_locale,
             col_types = cols(.default = col_character()), ...)
}

# Names in title case, with short Portuguese linking words kept lower case
title_pt <- function(x) {
  str_to_title(x) |>
    str_replace_all("(?<=\\s)(De|Da|Do|Das|Dos|E)(?=\\s)", tolower) |>
    str_replace_all("\\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii|Xiii|Xv|Xx)\\b", toupper)   # Dom Pedro II
}

# ---- Ballot-box reports: one row per section and round -----------------------------
# Same reading code as brazil_vote_flows.qmd, so the two share their cache files.
# Blank votes are number 95 and null votes 96; any higher number is also counted as null.
bweb_cols <- c("NR_TURNO", "SG_UF", "NM_MUNICIPIO", keys, "CD_CARGO_PERGUNTA",
               "QT_APTOS", "QT_ABSTENCOES", "NR_VOTAVEL", "NM_VOTAVEL", "QT_VOTOS")

read_bweb <- function(file) {
  missing <- setdiff(bweb_cols, names(read_tse(file, n_max = 0)))
  if (length(missing) > 0) stop(basename(file), " is missing: ", paste(missing, collapse = ", "))

  keep_president <- function(chunk, pos) filter(chunk, to_number(CD_CARGO_PERGUNTA) == 1)
  rows <- read_delim_chunked(
    file, DataFrameCallback$new(keep_president), chunk_size = 500000,
    delim = ";", escape_double = FALSE, trim_ws = TRUE, locale = tse_locale, progress = FALSE,
    col_types = do.call(cols_only, as.list(setNames(rep("c", length(bweb_cols)), bweb_cols)))
  ) |>
    mutate(across(c(NR_TURNO, all_of(keys), QT_APTOS, QT_ABSTENCOES, NR_VOTAVEL, QT_VOTOS), to_number))

  sections <- rows |>
    summarise(round = first(NR_TURNO), uf = first(SG_UF), municipality = first(NM_MUNICIPIO),
              registered = first(QT_APTOS), absent = first(QT_ABSTENCOES),
              reports = n_distinct(QT_APTOS, QT_ABSTENCOES),
              .by = all_of(keys))
  votes <- rows |>
    mutate(choice = case_when(NR_VOTAVEL == 95 ~ "blank",
                              NR_VOTAVEL >= 96 ~ "null",
                              TRUE ~ paste0("c", NR_VOTAVEL))) |>
    summarise(votes = sum(QT_VOTOS), .by = c(all_of(keys), choice)) |>
    pivot_wider(names_from = choice, values_from = votes, values_fill = 0)
  names <- rows |>
    filter(NR_VOTAVEL < 95) |>
    distinct(number = NR_VOTAVEL, name = NM_VOTAVEL)

  list(sections = left_join(sections, votes, by = keys), names = names)
}

bweb_files <- tibble(path = list.files(votes_dir, pattern = "^bweb_[12]t_[A-Z]{2}_\\d{12}\\.csv$",
                                       full.names = TRUE)) |>
  mutate(file  = basename(path),
         round = as.numeric(str_sub(file, 6, 6)),
         state = str_sub(file, 9, 10),
         stamp = as.POSIXct(str_extract(file, "\\d{12}"), format = "%d%m%Y%H%M")) |>
  filter(!state %in% c("BR", "ZZ")) |>
  slice_max(stamp, n = 1, by = c(state, round), with_ties = FALSE)

if (n_distinct(bweb_files$round) < 2) stop("Need ballot-box report files for both rounds in ", votes_dir)

dir.create(cache_dir, showWarnings = FALSE, recursive = TRUE)
read_cached <- function(path) {
  cache <- file.path(cache_dir, str_replace(basename(path), "\\.csv$", ".rds"))
  if (!file.exists(cache)) write_rds(read_bweb(path), cache)
  read_rds(cache)
}

all_sections <- map(bweb_files$path, \(p) read_cached(p)$sections, .progress = TRUE) |>
  list_rbind() |>
  mutate(across(c(any_of(c("blank", "null")), matches("^c\\d+$")), \(x) replace_na(x, 0)))

col_a <- paste0("c", cand_a)
col_b <- paste0("c", cand_b)
cand_cols <- str_subset(names(all_sections), "^c\\d+$")

# Per section and round: the two runoff candidates, all valid votes, blank, null, absent
by_round <- function(r) {
  all_sections |>
    filter(round == r) |>
    transmute(across(all_of(keys)),
              a = .data[[col_a]], b = .data[[col_b]],
              valid = rowSums(pick(all_of(cand_cols))),
              blank, null, absent)
}
round1 <- by_round(1) |> rename_with(\(x) paste0(x, "1"), -all_of(keys))
round2 <- by_round(2) |> rename_with(\(x) paste0(x, "2"), -all_of(keys))

# ---- Polling places ---------------------------------------------------------------
places <- read_tse(places_file, col_select = any_of(c(
  "NR_TURNO", keys, "NR_LATITUDE", "NR_LONGITUDE", "NR_LOCAL_VOTACAO", "NM_MUNICIPIO", "NM_LOCAL_VOTACAO")))
if ("NR_TURNO" %in% names(places)) places <- filter(places, to_number(NR_TURNO) == 2)
has <- function(col) col %in% names(places)

places <- places |>
  mutate(across(all_of(keys), to_number),
         lat = to_number(NR_LATITUDE),
         lon = to_number(NR_LONGITUDE),
         place_id     = paste(CD_MUNICIPIO, NR_ZONA, if (has("NR_LOCAL_VOTACAO")) NR_LOCAL_VOTACAO else NR_SECAO),
         municipality = if (has("NM_MUNICIPIO")) title_pt(NM_MUNICIPIO) else NA_character_,
         place        = if (has("NM_LOCAL_VOTACAO")) title_pt(NM_LOCAL_VOTACAO) else NA_character_) |>
  select(all_of(keys), lat, lon, place_id, municipality, place) |>
  distinct(across(all_of(keys)), .keep_all = TRUE)

# ---- Addresses --------------------------------------------------------------------
# Runoff sections at the same point (to about 10 m) become one address, as on the static
# map. The first round is compared only where every section at the address voted in both
# rounds; elsewhere (new or merged sections) the first-round columns are left empty.
by_address <- round2 |>
  left_join(round1, by = keys) |>
  left_join(places, by = keys) |>
  filter(!is.na(lat), !is.na(lon), lat != -1, lon != -1) |>
  mutate(lat = round(lat, 4), lon = round(lon, 4)) |>
  group_by(lat, lon) |>
  summarise(sections = n(), places = n_distinct(place_id),
            municipality = first(municipality), place = first(place),
            in_both = all(!is.na(a1)),
            across(c(a2, b2, blank2, null2, absent2, a1, b1, valid1, blank1, null1, absent1), sum),
            .groups = "drop") |>
  mutate(across(c(a1, b1, valid1, blank1, null1, absent1), \(x) if_else(in_both, x, NA_real_))) |>
  filter(a2 + b2 > 0)

# Drop points more than 5 km outside Brazil
country <- read_country(year = boundary_year, showProgress = FALSE) |> st_transform(5880)
inside <- by_address |>
  st_as_sf(coords = c("lon", "lat"), crs = 4326, remove = FALSE) |>
  st_transform(5880) |>
  st_is_within_distance(country, dist = 5000) |>
  lengths() > 0
by_address <- by_address[inside, ]

# Checks: the biggest addresses (many polling places at one point usually means shared
# placeholder coordinates), and how many addresses have a first-round comparison
by_address |>
  mutate(valid = a2 + b2) |>
  slice_max(valid, n = 10) |>
  select(municipality, place, places, sections, valid) |>
  print()
cat("Addresses:", nrow(by_address), " with a first-round comparison:", sum(by_address$in_both), "\n")

# ---- Write the file ---------------------------------------------------------------
# Registered voters are not stored: in each round they are all votes plus absentees.
dir.create(dirname(out_file), showWarnings = FALSE, recursive = TRUE)
by_address |>
  transmute(lon, lat, sections, places,
            municipality = str_squish(coalesce(municipality, "")),
            place = str_squish(coalesce(place, "")),
            a2, b2, blank2, null2, absent2,
            a1, b1, valid1, blank1, null1, absent1) |>
  arrange(desc(a2 + b2)) |>
  write_tsv(out_file, na = "")
